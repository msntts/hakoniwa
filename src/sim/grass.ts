import type { Board } from './board';
import type { DirtyTile } from '../types';
import { GRASS_PARAMS } from './params';

export interface GrassState {
  biomass: Float32Array;
  height: Uint8Array;
  colorBucket: Uint8Array;
  prevHeight: Uint8Array;
  prevColorBucket: Uint8Array;
}

export function createGrassState(board: Board): GrassState {
  const n = board.width * board.height;
  return {
    biomass: new Float32Array(n),
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
    if (r < 0.1) {
      state.biomass[i] = 0.15 + rng() * 0.1; // sparse but will still cross a low height threshold
    } else if (r < 0.2) {
      state.biomass[i] = 0.75 + rng() * 0.2; // dense and tall
    } else {
      state.biomass[i] = 0.3 + rng() * 0.5;
    }
  }
}

export function stepGrass(state: GrassState, board: Board): void {
  const n = board.width * board.height;
  const { growthRate, capacity } = GRASS_PARAMS;
  for (let i = 0; i < n; i++) {
    const b = state.biomass[i] ?? 0;
    state.biomass[i] = b + growthRate * (capacity - b);
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
