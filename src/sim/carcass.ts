import type { Board } from './board';
import { idx } from './board';
import { depositFertility, type GrassState } from './grass';
import { CARCASS_PARAMS } from './params';

// A dead individual doesn't just vanish -- it decomposes in place over
// several ticks, releasing its fertility gradually rather than all at once,
// and stays visible while it does. This is the causal loop (death -> decay
// -> nutrient -> future growth) made visible, not just an internal number.
// Which species a carcass came from, purely for the fallen-silhouette drawn
// in sprites.ts -- decay mechanics below don't care.
export const CARCASS_SPECIES = { HERBIVORE: 0, CARNIVORE: 1 } as const;

export interface CarcassState {
  capacity: number;
  count: number;
  x: Int16Array;
  y: Int16Array;
  age: Uint16Array; // ticks since death
  species: Uint8Array; // see CARCASS_SPECIES
  // Where the individual was standing at the *start* of the tick it died --
  // usually equal to x/y (it died in place), but movement happens before the
  // death check each tick (sim/herbivore.ts, sim/carnivore.ts), so a body can
  // land up to 1 tile from where it was last drawn alive. The renderer glides
  // the carcass in from here on its first visible tick (age === 0) instead of
  // having it pop into existence a tile away from where the animal vanished.
  fromX: Int16Array;
  fromY: Int16Array;
  // True only until this carcass's first stepCarcasses call -- see there.
  justSpawned: Uint8Array;
}

export function createCarcassState(capacity: number): CarcassState {
  return {
    capacity,
    count: 0,
    x: new Int16Array(capacity),
    y: new Int16Array(capacity),
    age: new Uint16Array(capacity),
    species: new Uint8Array(capacity),
    fromX: new Int16Array(capacity),
    fromY: new Int16Array(capacity),
    justSpawned: new Uint8Array(capacity),
  };
}

export function spawnCarcass(
  c: CarcassState,
  x: number,
  y: number,
  species: 0 | 1 = CARCASS_SPECIES.HERBIVORE,
  fromX: number = x,
  fromY: number = y,
): void {
  if (c.count >= c.capacity) return; // extreme die-offs just skip the visual, decay pressure already applied via death
  const i = c.count;
  c.x[i] = x;
  c.y[i] = y;
  c.age[i] = 0;
  c.species[i] = species;
  c.fromX[i] = fromX;
  c.fromY[i] = fromY;
  c.justSpawned[i] = 1;
  c.count++;
}

function removeCarcassAt(c: CarcassState, index: number): void {
  const last = c.count - 1;
  if (index !== last) {
    c.x[index] = c.x[last] ?? 0;
    c.y[index] = c.y[last] ?? 0;
    c.age[index] = c.age[last] ?? 0;
    c.species[index] = c.species[last] ?? 0;
    c.fromX[index] = c.fromX[last] ?? 0;
    c.fromY[index] = c.fromY[last] ?? 0;
    c.justSpawned[index] = c.justSpawned[last] ?? 0;
  }
  c.count--;
}

export function stepCarcasses(c: CarcassState, grass: GrassState, board: Board): void {
  const { fertility, decayTicks } = CARCASS_PARAMS;
  const perTickRelease = fertility / decayTicks;
  const expired: number[] = [];

  for (let i = 0; i < c.count; i++) {
    // Skip decay entirely on the tick a carcass is born: spawnCarcass() runs
    // earlier in the same sim tick (see sim/loop.ts's step order), so without
    // this it would immediately age from 0 to 1 before ever being reported to
    // the renderer -- age 0 (freshly dead, not yet decomposing) was never
    // actually observable, and the carcass disappeared a tick early at the
    // other end (age reaches decayTicks, and gets removed here, one call
    // sooner than intended). Consuming the flag here means it decays for
    // exactly decayTicks *real* ticks starting next tick, same total as
    // before -- this doesn't add or remove any lifetime, it just stops
    // double-counting the spawn tick.
    if (c.justSpawned[i]) {
      c.justSpawned[i] = 0;
      continue;
    }
    const x = c.x[i] ?? 0;
    const y = c.y[i] ?? 0;
    depositFertility(grass, idx(board, x, y), perTickRelease);
    const age = (c.age[i] ?? 0) + 1;
    c.age[i] = age;
    if (age >= decayTicks) expired.push(i);
  }

  expired.sort((a, b) => b - a);
  for (const i of expired) removeCarcassAt(c, i);
}
