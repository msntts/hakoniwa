import type { Board } from './board';
import { idx, wrap } from './board';
import { grazeTile, type GrassState } from './grass';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from './params';

export interface HerbivoreState {
  capacity: number;
  count: number;
  x: Int16Array;
  y: Int16Array;
  energy: Float32Array;
  age: Uint16Array;
}

export function createHerbivoreState(capacity: number): HerbivoreState {
  return {
    capacity,
    count: 0,
    x: new Int16Array(capacity),
    y: new Int16Array(capacity),
    energy: new Float32Array(capacity),
    age: new Uint16Array(capacity),
  };
}

export function spawnHerbivore(h: HerbivoreState, x: number, y: number, energy: number): number | null {
  if (h.count >= h.capacity) return null;
  const i = h.count;
  h.x[i] = x;
  h.y[i] = y;
  h.energy[i] = energy;
  h.age[i] = 0;
  h.count++;
  return i;
}

function removeHerbivoreAt(h: HerbivoreState, index: number): void {
  const last = h.count - 1;
  if (index !== last) {
    h.x[index] = h.x[last] ?? 0;
    h.y[index] = h.y[last] ?? 0;
    h.energy[index] = h.energy[last] ?? 0;
    h.age[index] = h.age[last] ?? 0;
  }
  h.count--;
}

export function seedHerbivores(h: HerbivoreState, board: Board, count: number, rng: () => number): void {
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rng() * board.width);
    const y = Math.floor(rng() * board.height);
    spawnHerbivore(h, x, y, HERBIVORE_PARAMS.initialEnergy);
  }
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

export function stepHerbivores(h: HerbivoreState, grass: GrassState, board: Board, rng: () => number): void {
  const { metabolism, grazeGain, grazeBiomassThreshold, reproThreshold, reproCost, lifespanTicks, capacity: maxPop } =
    HERBIVORE_PARAMS;

  const deaths: number[] = [];
  const births: Array<[number, number]> = [];

  for (let i = 0; i < h.count; i++) {
    const x = h.x[i] ?? 0;
    const y = h.y[i] ?? 0;

    // Greedy move toward the neighbor tile with the most biomass (small random
    // tie-break so equal-biomass neighbors don't produce deterministic clumping).
    let bestI = idx(board, x, y);
    let bestBiomass = grass.biomass[bestI] ?? 0;
    let bestX = x;
    let bestY = y;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = wrap(x + dx, board.width);
      const ny = wrap(y + dy, board.height);
      const ni = idx(board, nx, ny);
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

    let energy = h.energy[i] ?? 0;
    if ((grass.biomass[bestI] ?? 0) > grazeBiomassThreshold) {
      const eaten = grazeTile(grass, bestI, GRASS_PARAMS.grazePerBite);
      energy += eaten * grazeGain;
    }
    energy -= metabolism;
    const age = (h.age[i] ?? 0) + 1;
    h.age[i] = age;

    if (energy <= 0 || age > lifespanTicks) {
      deaths.push(i);
      continue;
    }
    if (energy >= reproThreshold && h.count + births.length < maxPop) {
      energy -= reproCost;
      births.push([bestX, bestY]);
    }
    h.energy[i] = energy;
  }

  // Apply removals highest-index-first so swap-remove doesn't disturb indices
  // still pending in `deaths`.
  deaths.sort((a, b) => b - a);
  for (const i of deaths) removeHerbivoreAt(h, i);

  for (const [x, y] of births) {
    spawnHerbivore(h, x, y, HERBIVORE_PARAMS.initialEnergy);
  }
}
