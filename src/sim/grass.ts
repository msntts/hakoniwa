import type { Board } from './board';
import { idx, NEIGHBOR_OFFSETS_8, torusDelta, wrap } from './board';
import type { DirtyTile } from '../types';
import { GRASS_PARAMS } from './params';

// A single seeded meadow -- see seedGrass. Exposed so callers that place
// other things at start (e.g. seedHerbivores clustering herds near food
// instead of scattering them board-wide) can reuse the same centers rather
// than inventing their own, unrelated ones.
export interface GrassPatch {
  x: number;
  y: number;
  radius: number;
}

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

// Scatters patchCount round meadows over the board -- independent per-tile
// noise (the previous approach) reads as a single undifferentiated lawn
// from the very first frame, with no spatial story for a herd to react to.
// A tile's biomass is the *strongest* nearby patch's falloff (not a sum --
// two overlapping patches make one bigger meadow, not a denser one) plus a
// small independent jitter, so ground far from every patch center stays
// close to bare. Returns the patch centers so other seeding (see
// seedHerbivores) can start life near food instead of anywhere on the board.
export function seedGrass(state: GrassState, board: Board, rng: () => number): GrassPatch[] {
  const { patchCount, patchRadiusMin, patchRadiusMax, patchPeakMin, patchPeakMax, patchNoise, capacity } = GRASS_PARAMS;

  const patches: Array<GrassPatch & { peak: number }> = [];
  for (let p = 0; p < patchCount; p++) {
    patches.push({
      x: Math.floor(rng() * board.width),
      y: Math.floor(rng() * board.height),
      radius: patchRadiusMin + rng() * (patchRadiusMax - patchRadiusMin),
      peak: patchPeakMin + rng() * (patchPeakMax - patchPeakMin),
    });
  }

  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      let biomass = 0;
      for (const patch of patches) {
        const dx = torusDelta(x, patch.x, board.width);
        const dy = torusDelta(y, patch.y, board.height);
        const t = Math.sqrt(dx * dx + dy * dy) / patch.radius;
        if (t >= 1) continue; // outside this patch's reach
        // Quadratic falloff: full density at the center, tapering smoothly
        // (not linearly) to bare right at the patch's edge.
        const falloff = 1 - t * t;
        biomass = Math.max(biomass, patch.peak * falloff);
      }
      biomass = Math.max(0, Math.min(capacity, biomass + (rng() - 0.5) * 2 * patchNoise));
      const i = idx(board, x, y);
      state.biomass[i] = biomass;
      // Existing grass implies some soil fertility already built up before
      // the player arrived, but not a full bank -- further growth still has
      // to be earned back through the herbivore/decomposer cycle.
      state.fertility[i] = biomass * 0.5;
    }
  }

  return patches;
}

export function depositFertility(state: GrassState, i: number, amount: number): void {
  const cap = GRASS_PARAMS.fertilityCap;
  state.fertility[i] = Math.min(cap, (state.fertility[i] ?? 0) + amount);
}

export function stepGrass(state: GrassState, board: Board): void {
  const { growthRate, capacity, spreadRate, senescenceRate } = GRASS_PARAMS;
  // Snapshot so every tile reads the *same* pre-tick neighbor biomass --
  // otherwise a tile processed early in the loop would already show its
  // grown value to a tile processed later, biasing the spread in scan order.
  const prevBiomass = state.biomass.slice();

  // Pass 1: standing grass constantly turns over -- old leaves and roots
  // die back (senescence: this tile actually loses that biomass, "grass
  // dies too," and what dies is what feeds the soil back) and some drifts
  // onto neighboring soil (spread: litter, roots reaching over -- a surplus
  // that doesn't cost the source tile its own standing biomass). Neither
  // needs an animal to happen. Senescence is what keeps an ungrazed, herd-
  // free landscape from freezing wherever the herd last left it: without it,
  // fertility only ever came from excretion/carcasses, so once every animal
  // was gone there was no way for bare, nutrient-exhausted ground to ever
  // recover on its own again. Both are deliberately slow (much slower than
  // growthRate/excretion) so they don't undercut scarcity while a herd is
  // actually grazing -- they only matter once grazing pressure eases off.
  if (spreadRate > 0 || senescenceRate > 0) {
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const i = idx(board, x, y);
        const b = prevBiomass[i] ?? 0;
        if (b <= 0) continue;
        if (senescenceRate > 0) {
          const died = senescenceRate * b;
          state.biomass[i] = (state.biomass[i] ?? 0) - died; // this is what "grass also dies" means: real turnover, not a free top-up
          depositFertility(state, i, died);
        }
        if (spreadRate <= 0) continue;
        const shedPerNeighbor = (spreadRate * b) / NEIGHBOR_OFFSETS_8.length;
        for (const [dx, dy] of NEIGHBOR_OFFSETS_8) {
          const nx = wrap(x + dx, board.width);
          const ny = wrap(y + dy, board.height);
          depositFertility(state, idx(board, nx, ny), shedPerNeighbor);
        }
      }
    }
  }

  // Pass 2: ordinary fertility-gated growth.
  for (let i = 0; i < board.width * board.height; i++) {
    const b = state.biomass[i] ?? 0;
    const potential = growthRate * (capacity - b);
    if (potential <= 0) continue;
    const available = state.fertility[i] ?? 0;
    const used = Math.min(potential, available);
    if (used <= 0) continue;
    state.biomass[i] = b + used;
    state.fertility[i] = available - used;
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
