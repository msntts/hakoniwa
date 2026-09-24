import type { Board } from './board';
import { idx, NEIGHBOR_OFFSETS_8, wrap } from './board';
import { CARCASS_SPECIES, spawnCarcass, type CarcassState } from './carcass';
import { depositFertility, grazeTile, type GrassState } from './grass';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from './params';

export interface HerbivoreState {
  capacity: number;
  count: number;
  x: Int16Array;
  y: Int16Array;
  // 0 = just ate, 1 = starving. Tracks *current* feeding, independent of age.
  hunger: Float32Array;
  age: Uint16Array;
  // Ticks remaining before this individual will move or eat again -- set by
  // a successful bite (see HERBIVORE_PARAMS.restTicksAfterEating), decremented
  // every tick regardless. 0 = free to act.
  rest: Uint8Array;
  // Stable per-individual identity, assigned once at birth and never reused.
  // Array *index* is not stable across ticks -- death uses swap-remove, which
  // moves the last individual into a dead one's slot -- but `id` survives
  // that move (see removeHerbivoreAt), so the renderer can tell "this is the
  // same animal, just relocated in the array" from "this is a different
  // animal that happens to be at the same index now" (see renderer.ts's
  // glide/facing tracking, keyed by id for exactly this reason).
  id: Uint32Array;
  nextId: number;
}

export function createHerbivoreState(capacity: number): HerbivoreState {
  return {
    capacity,
    count: 0,
    x: new Int16Array(capacity),
    y: new Int16Array(capacity),
    hunger: new Float32Array(capacity),
    age: new Uint16Array(capacity),
    rest: new Uint8Array(capacity),
    id: new Uint32Array(capacity),
    nextId: 0,
  };
}

export function spawnHerbivore(h: HerbivoreState, x: number, y: number, hunger: number): number | null {
  if (h.count >= h.capacity) return null;
  const i = h.count;
  h.x[i] = x;
  h.y[i] = y;
  h.hunger[i] = hunger;
  h.age[i] = 0;
  h.rest[i] = 0;
  h.id[i] = h.nextId++;
  h.count++;
  return i;
}

export function removeHerbivoreAt(h: HerbivoreState, index: number): void {
  const last = h.count - 1;
  if (index !== last) {
    h.x[index] = h.x[last] ?? 0;
    h.y[index] = h.y[last] ?? 0;
    h.hunger[index] = h.hunger[last] ?? 0;
    h.age[index] = h.age[last] ?? 0;
    h.rest[index] = h.rest[last] ?? 0;
    h.id[index] = h.id[last] ?? 0;
  }
  h.count--;
}

export function seedHerbivores(h: HerbivoreState, board: Board, count: number, rng: () => number): void {
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rng() * board.width);
    const y = Math.floor(rng() * board.height);
    spawnHerbivore(h, x, y, HERBIVORE_PARAMS.initialHunger);
  }
}

export function stepHerbivores(
  h: HerbivoreState,
  grass: GrassState,
  carcasses: CarcassState,
  board: Board,
  rng: () => number,
): void {
  const {
    hungerGainPerTick,
    grazeHungerRelief,
    starvationHunger,
    grazeBiomassThreshold,
    reproHungerThreshold,
    reproHungerCost,
    excretionRatio,
    lifespanTicks,
    restTicksAfterEating,
    capacity: maxPop,
  } = HERBIVORE_PARAMS;

  const deaths: number[] = [];
  const births: Array<[number, number]> = [];

  // While it's decomposing, a carcass occupies its tile exclusively -- a
  // grass-eater can't move onto it (a scavenger species could, once one
  // exists; there isn't one yet, so for now this just blocks everyone).
  const carcassTiles = new Set<number>();
  for (let k = 0; k < carcasses.count; k++) {
    carcassTiles.add(idx(board, carcasses.x[k] ?? 0, carcasses.y[k] ?? 0));
  }

  for (let i = 0; i < h.count; i++) {
    const x = h.x[i] ?? 0;
    const y = h.y[i] ?? 0;

    // Still digesting a bite from a previous tick -- holds still instead of
    // moving or eating again (see HERBIVORE_PARAMS.restTicksAfterEating).
    const restLeft = h.rest[i] ?? 0;
    const resting = restLeft > 0;
    let bestI = idx(board, x, y);
    let bestX = x;
    let bestY = y;

    if (resting) {
      h.rest[i] = restLeft - 1;
    } else {
      // Greedy move toward the neighbor tile with the most biomass (small random
      // tie-break so equal-biomass neighbors don't produce deterministic clumping).
      let bestBiomass = grass.biomass[bestI] ?? 0;
      for (const [dx, dy] of NEIGHBOR_OFFSETS_8) {
        const nx = wrap(x + dx, board.width);
        const ny = wrap(y + dy, board.height);
        const ni = idx(board, nx, ny);
        if (carcassTiles.has(ni)) continue;
        const nb = (grass.biomass[ni] ?? 0) + rng() * 0.001;
        if (nb > bestBiomass) {
          bestBiomass = nb;
          bestX = nx;
          bestY = ny;
          bestI = ni;
        }
      }
      h.x[i] = bestX;
      h.y[i] = bestY;
    }

    // Hunger always climbs -- there is no reserve to bank against a future
    // famine. A bite only relieves however much of it actually landed. While
    // resting (digesting a just-landed bite), hunger is frozen instead of
    // climbing: it already ate this cycle, so this isn't a second tick of
    // going hungry, just the same meal's relief spread over 2 ticks instead
    // of 1. Letting hunger keep climbing here would silently halve the real
    // relief rate of sustained grazing (an extra ungained tick every cycle)
    // without changing grazeHungerRelief to compensate, which flattens a
    // constantly-fed individual's hunger into a stalled oscillation instead
    // of trending toward reproHungerThreshold -- confirmed by tracing hunger
    // over 20 ticks with unlimited grass before landing on this design.
    let hunger = h.hunger[i] ?? 0;
    if (!resting) hunger += hungerGainPerTick;
    if (!resting && (grass.biomass[bestI] ?? 0) > grazeBiomassThreshold) {
      const eaten = grazeTile(grass, bestI, GRASS_PARAMS.grazePerBite);
      hunger -= grazeHungerRelief * (eaten / GRASS_PARAMS.grazePerBite);
      // 排泄: what isn't digested returns to the same tile as fertility --
      // eating here is what makes something able to grow here again later.
      depositFertility(grass, bestI, eaten * excretionRatio);
      h.rest[i] = restTicksAfterEating;
    }
    hunger = Math.max(0, hunger);

    const age = (h.age[i] ?? 0) + 1;
    h.age[i] = age;

    if (hunger >= starvationHunger || age > lifespanTicks) {
      // 死骸: stays put and visible, releasing fertility gradually as it
      // decomposes (see stepCarcasses) instead of dumping it all at once.
      spawnCarcass(carcasses, bestX, bestY, CARCASS_SPECIES.HERBIVORE);
      deaths.push(i);
      continue;
    }
    // Only a currently well-fed individual reproduces -- a large reserve
    // banked during a past boom can't buy a birth once food is scarce again.
    if (hunger <= reproHungerThreshold && h.count + births.length < maxPop) {
      hunger += reproHungerCost;
      births.push([bestX, bestY]);
    }
    h.hunger[i] = hunger;
  }

  // Apply removals highest-index-first so swap-remove doesn't disturb indices
  // still pending in `deaths`.
  deaths.sort((a, b) => b - a);
  for (const i of deaths) removeHerbivoreAt(h, i);

  for (const [x, y] of births) {
    spawnHerbivore(h, x, y, HERBIVORE_PARAMS.initialHunger);
  }
}
