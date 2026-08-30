import type { Board } from './board';
import { idx, NEIGHBOR_OFFSETS_8, wrap } from './board';
import type { DirtyTile } from '../types';
import { GRASS_PARAMS } from './params';

export interface GrassState {
  biomass: Float32Array;
  // Soil nutrient available to grow *new* biomass -- decomposition's output
  // (herbivore excretion, carcasses) and growth's input. Without it, biomass
  // cannot increase no matter how empty a tile looks: grass doesn't grow
  // from nothing, it grows from what decomposed nearby.
  fertility: Float32Array;
  height: Uint8Array;
  colorBucket: Uint8Array;
  prevHeight: Uint8Array;
  prevColorBucket: Uint8Array;
}

export function createGrassState(board: Board): GrassState {
  const n = board.width * board.height;
  return {
    biomass: new Float32Array(n),
    fertility: new Float32Array(n),
    height: new Uint8Array(n),
    colorBucket: new Uint8Array(n),
    prevHeight: new Uint8Array(n).fill(255),
    prevColorBucket: new Uint8Array(n).fill(255),
  };
}

export function seedGrass(state: GrassState, board: Board, rng: () => number): void {
  const n = board.width * board.height;
  for (let i = 0; i < n; i++) {
    // Mostly moderate noise, with a few deliberately sparse-but-tall vs
    // dense-but-low patches so the two visual axes are distinguishable at a glance.
    const r = rng();
    let biomass: number;
    if (r < 0.1) {
      biomass = 0.15 + rng() * 0.1; // sparse but will still cross a low height threshold
    } else if (r < 0.2) {
      biomass = 0.75 + rng() * 0.2; // dense and tall
    } else {
      biomass = 0.3 + rng() * 0.5;
    }
    state.biomass[i] = biomass;
    // Existing grass implies some soil fertility already built up before the
    // player arrived, but not a full bank -- further growth still has to be
    // earned back through the herbivore/decomposer cycle.
    state.fertility[i] = biomass * 0.5;
  }
}

export function depositFertility(state: GrassState, i: number, amount: number): void {
  const cap = GRASS_PARAMS.fertilityCap;
  state.fertility[i] = Math.min(cap, (state.fertility[i] ?? 0) + amount);
}

export function stepGrass(state: GrassState, board: Board): void {
  const { growthRate, capacity, spreadRate } = GRASS_PARAMS;
  // Snapshot so every tile reads the *same* pre-tick neighbor biomass --
  // otherwise a tile processed early in the loop would already show its
  // grown value to a tile processed later, biasing the spread in scan order.
  const prevBiomass = state.biomass.slice();

  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const i = idx(board, x, y);
      const b = prevBiomass[i] ?? 0;
      const ownPotential = growthRate * (capacity - b);
      if (ownPotential <= 0) continue;

      // Existing grass on a neighboring tile helps a patch thicken outward,
      // on top of what the tile's own condition alone would grow -- but
      // still capped by this tile's own fertility below, so it can't spread
      // onto soil with nothing to grow from.
      let neighborSum = 0;
      for (const [dx, dy] of NEIGHBOR_OFFSETS_8) {
        const nx = wrap(x + dx, board.width);
        const ny = wrap(y + dy, board.height);
        neighborSum += prevBiomass[idx(board, nx, ny)] ?? 0;
      }
      const neighborAvg = neighborSum / NEIGHBOR_OFFSETS_8.length;
      const potential = ownPotential + spreadRate * neighborAvg;

      const available = state.fertility[i] ?? 0;
      const used = Math.min(potential, available);
      if (used <= 0) continue;
      state.biomass[i] = b + used;
      state.fertility[i] = available - used;
    }
  }
}

export function grazeTile(state: GrassState, i: number, amount: number): number {
  const b = state.biomass[i] ?? 0;
  const removed = Math.min(b, amount);
  state.biomass[i] = b - removed;
  return removed;
}

function heightFor(biomass: number): number {
  const [t0, t1, t2] = GRASS_PARAMS.heightThresholds;
  if (biomass < t0) return 0;
  if (biomass < t1) return 1;
  if (biomass < t2) return 2;
  return 3;
}

function colorBucketFor(biomass: number): number {
  const buckets = GRASS_PARAMS.colorBuckets;
  const b = Math.max(0, Math.min(1, biomass));
  return Math.min(buckets - 1, Math.floor(b * buckets));
}

export function deriveHeightAndColor(state: GrassState, board: Board): DirtyTile[] {
  const n = board.width * board.height;
  const dirty: DirtyTile[] = [];
  for (let i = 0; i < n; i++) {
    const biomass = state.biomass[i] ?? 0;
    const height = heightFor(biomass);
    const colorBucket = colorBucketFor(biomass);
    state.height[i] = height;
    state.colorBucket[i] = colorBucket;
    if (height !== state.prevHeight[i] || colorBucket !== state.prevColorBucket[i]) {
      dirty.push({ i, color: colorBucket, height });
      state.prevHeight[i] = height;
      state.prevColorBucket[i] = colorBucket;
    }
  }
  return dirty;
}
