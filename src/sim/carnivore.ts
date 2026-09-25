import type { Board } from './board';
import { idx, NEIGHBOR_OFFSETS_8, wrap } from './board';
import { CARCASS_SPECIES, spawnCarcass, type CarcassState } from './carcass';
import { removeHerbivoreAt, type HerbivoreState } from './herbivore';
import { CARNIVORE_PARAMS } from './params';

// Mirrors HerbivoreState -- same two independent stocks (age vs hunger), same
// reasoning for keeping them separate. The predator/prey relationship is the
// only structural difference: a carnivore's "food" is a live herbivore on a
// tile, not that tile's grass.
export interface CarnivoreState {
  capacity: number;
  count: number;
  x: Int16Array;
  y: Int16Array;
  hunger: Float32Array;
  age: Uint16Array;
  // Ticks remaining before this individual will move or hunt again -- see
  // HerbivoreState.rest for the same mechanism on the prey side.
  rest: Uint8Array;
  // Stable per-individual identity -- see HerbivoreState.id for why array
  // index alone can't be trusted across ticks (swap-remove on death).
  id: Uint32Array;
  nextId: number;
}

export function createCarnivoreState(capacity: number): CarnivoreState {
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

export function spawnCarnivore(c: CarnivoreState, x: number, y: number, hunger: number): number | null {
  if (c.count >= c.capacity) return null;
  const i = c.count;
  c.x[i] = x;
  c.y[i] = y;
  c.hunger[i] = hunger;
  c.age[i] = 0;
  c.rest[i] = 0;
  c.id[i] = c.nextId++;
  c.count++;
  return i;
}

function removeCarnivoreAt(c: CarnivoreState, index: number): void {
  const last = c.count - 1;
  if (index !== last) {
    c.x[index] = c.x[last] ?? 0;
    c.y[index] = c.y[last] ?? 0;
    c.hunger[index] = c.hunger[last] ?? 0;
    c.age[index] = c.age[last] ?? 0;
    c.rest[index] = c.rest[last] ?? 0;
    c.id[index] = c.id[last] ?? 0;
  }
  c.count--;
}

export function seedCarnivores(c: CarnivoreState, board: Board, count: number, rng: () => number): void {
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rng() * board.width);
    const y = Math.floor(rng() * board.height);
    spawnCarnivore(c, x, y, CARNIVORE_PARAMS.initialHunger);
  }
}

// tileIndex -> array indices (into `herd`) of the herbivores standing there,
// as of the start of this tick. Mutated as carnivores claim prey during the
// same pass, so a tile a predator already emptied looks empty to the next
// one, and a bucket's current length doubles as "how many *unclaimed* prey
// are here" for movement (mirrors how grazeTile mutates grass.biomass live).
function buildHerbivoreTileBuckets(h: HerbivoreState, board: Board): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < h.count; i++) {
    const tileIdx = idx(board, h.x[i] ?? 0, h.y[i] ?? 0);
    let bucket = buckets.get(tileIdx);
    if (!bucket) {
      bucket = [];
      buckets.set(tileIdx, bucket);
    }
    bucket.push(i);
  }
  return buckets;
}

export function stepCarnivores(
  c: CarnivoreState,
  herd: HerbivoreState,
  carcasses: CarcassState,
  board: Board,
  rng: () => number,
): void {
  const {
    hungerGainPerTick,
    predationRelief,
    starvationHunger,
    reproHungerThreshold,
    reproHungerCost,
    lifespanTicks,
    restTicksAfterEating,
    capacity: maxPop,
  } = CARNIVORE_PARAMS;

  const deaths: number[] = [];
  const births: Array<[number, number]> = [];
  const eatenHerbivoreIndices: number[] = [];

  const carcassTiles = new Set<number>();
  for (let k = 0; k < carcasses.count; k++) {
    carcassTiles.add(idx(board, carcasses.x[k] ?? 0, carcasses.y[k] ?? 0));
  }
  const preyBuckets = buildHerbivoreTileBuckets(herd, board);

  for (let i = 0; i < c.count; i++) {
    const x = c.x[i] ?? 0;
    const y = c.y[i] ?? 0;

    // Still digesting a kill from a previous tick -- holds still instead of
    // hunting again (see CARNIVORE_PARAMS.restTicksAfterEating).
    const restLeft = c.rest[i] ?? 0;
    const resting = restLeft > 0;
    let bestI = idx(board, x, y);
    let bestX = x;
    let bestY = y;

    if (resting) {
      c.rest[i] = restLeft - 1;
    } else {
      // Greedy move toward the neighbor tile with the most (unclaimed) prey --
      // same shape as a herbivore chasing grass biomass, just hunting a moving
      // target instead of a stationary one.
      let bestPrey = preyBuckets.get(bestI)?.length ?? 0;
      for (const [dx, dy] of NEIGHBOR_OFFSETS_8) {
        const nx = wrap(x + dx, board.width);
        const ny = wrap(y + dy, board.height);
        const ni = idx(board, nx, ny);
        if (carcassTiles.has(ni)) continue;
        const preyHere = (preyBuckets.get(ni)?.length ?? 0) + rng() * 0.001;
        if (preyHere > bestPrey) {
          bestPrey = preyHere;
          bestX = nx;
          bestY = ny;
          bestI = ni;
        }
      }
      c.x[i] = bestX;
      c.y[i] = bestY;
    }

    // Frozen instead of climbing while resting off a kill -- see the matching
    // comment in herbivore.ts for why (a stalled hunger oscillation instead
    // of trending down, confirmed by tracing it on the herbivore side).
    let hunger = c.hunger[i] ?? 0;
    if (!resting) hunger += hungerGainPerTick;
    if (!resting) {
      const bucket = preyBuckets.get(bestI);
      if (bucket && bucket.length > 0) {
        const preyIndex = bucket.pop()!; // claims it -- no other carnivore can eat it this tick
        eatenHerbivoreIndices.push(preyIndex);
        hunger -= predationRelief;
        c.rest[i] = restTicksAfterEating;
      }
    }
    hunger = Math.max(0, hunger);

    const age = (c.age[i] ?? 0) + 1;
    c.age[i] = age;

    if (hunger >= starvationHunger || age > lifespanTicks) {
      // fromX/fromY (x,y = position before the move step above) let the
      // renderer glide the carcass in from where it was last drawn alive --
      // see the matching comment in herbivore.ts.
      spawnCarcass(carcasses, bestX, bestY, CARCASS_SPECIES.CARNIVORE, x, y);
      deaths.push(i);
      continue;
    }
    if (hunger <= reproHungerThreshold && c.count + births.length < maxPop) {
      hunger += reproHungerCost;
      births.push([bestX, bestY]);
    }
    c.hunger[i] = hunger;
  }

  // Highest-index-first for both removals, same reason as everywhere else in
  // this codebase: swap-remove reshuffles indices, so later (smaller) ones
  // must be removed before earlier ones are disturbed.
  eatenHerbivoreIndices.sort((a, b) => b - a);
  for (const i of eatenHerbivoreIndices) removeHerbivoreAt(herd, i);

  deaths.sort((a, b) => b - a);
  for (const i of deaths) removeCarnivoreAt(c, i);

  for (const [x, y] of births) {
    spawnCarnivore(c, x, y, CARNIVORE_PARAMS.initialHunger);
  }
}
