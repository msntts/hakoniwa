import type { Board } from './board';
import { idx } from './board';
import { depositFertility, type GrassState } from './grass';
import { HERBIVORE_PARAMS } from './params';

// A dead individual doesn't just vanish -- it decomposes in place over
// several ticks, releasing its fertility gradually rather than all at once,
// and stays visible while it does. This is the causal loop (death -> decay
// -> nutrient -> future growth) made visible, not just an internal number.
export interface CarcassState {
  capacity: number;
  count: number;
  x: Int16Array;
  y: Int16Array;
  age: Uint16Array; // ticks since death
}

export function createCarcassState(capacity: number): CarcassState {
  return {
    capacity,
    count: 0,
    x: new Int16Array(capacity),
    y: new Int16Array(capacity),
    age: new Uint16Array(capacity),
  };
}

export function spawnCarcass(c: CarcassState, x: number, y: number): void {
  if (c.count >= c.capacity) return; // extreme die-offs just skip the visual, decay pressure already applied via death
  const i = c.count;
  c.x[i] = x;
  c.y[i] = y;
  c.age[i] = 0;
  c.count++;
}

function removeCarcassAt(c: CarcassState, index: number): void {
  const last = c.count - 1;
  if (index !== last) {
    c.x[index] = c.x[last] ?? 0;
    c.y[index] = c.y[last] ?? 0;
    c.age[index] = c.age[last] ?? 0;
  }
  c.count--;
}

export function stepCarcasses(c: CarcassState, grass: GrassState, board: Board): void {
  const { carcassFertility, carcassDecayTicks } = HERBIVORE_PARAMS;
  const perTickRelease = carcassFertility / carcassDecayTicks;
  const expired: number[] = [];

  for (let i = 0; i < c.count; i++) {
    const x = c.x[i] ?? 0;
    const y = c.y[i] ?? 0;
    depositFertility(grass, idx(board, x, y), perTickRelease);
    const age = (c.age[i] ?? 0) + 1;
    c.age[i] = age;
    if (age >= carcassDecayTicks) expired.push(i);
  }

  expired.sort((a, b) => b - a);
  for (const i of expired) removeCarcassAt(c, i);
}
