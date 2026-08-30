import type { Board } from './board';
import { createGrassState, deriveHeightAndColor, seedGrass, stepGrass, type GrassState } from './grass';
import { createHerbivoreState, seedHerbivores, stepHerbivores, type HerbivoreState } from './herbivore';
import { HERBIVORE_PARAMS } from './params';
import type { DirtyTile } from '../types';

export interface SimState {
  board: Board;
  grass: GrassState;
  herd: HerbivoreState;
  tickCount: number;
  msSinceEpochStart: number;
  epochCount: number;
  tickIntervalMs: number;
  epochIntervalMs: number;
  rng: () => number;
}

// Small deterministic PRNG (mulberry32) so a given seed reproduces the same board.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimState(
  width: number,
  height: number,
  tickIntervalMs: number,
  epochIntervalMs: number,
  seed = Date.now(),
): SimState {
  const board: Board = { width, height };
  const rng = mulberry32(seed);
  const grass = createGrassState(board);
  seedGrass(grass, board, rng);
  // Populate height/colorBucket + prev* from the seeded biomass before the sim
  // starts, so the first real tick only reports tiles that actually changed.
  deriveHeightAndColor(grass, board);

  const herd = createHerbivoreState(HERBIVORE_PARAMS.capacity);
  seedHerbivores(herd, board, HERBIVORE_PARAMS.initialCount, rng);

  return {
    board,
    grass,
    herd,
    tickCount: 0,
    msSinceEpochStart: 0,
    epochCount: 0,
    tickIntervalMs,
    epochIntervalMs,
    rng,
  };
}

export interface TickResult {
  dirty: DirtyTile[];
  epoch?: number;
}

export function tick(state: SimState): TickResult {
  stepGrass(state.grass, state.board);
  stepHerbivores(state.herd, state.grass, state.board, state.rng);
  const dirty = deriveHeightAndColor(state.grass, state.board);

  state.tickCount++;
  state.msSinceEpochStart += state.tickIntervalMs;

  let epoch: number | undefined;
  if (state.msSinceEpochStart >= state.epochIntervalMs) {
    state.msSinceEpochStart -= state.epochIntervalMs;
    state.epochCount++;
    epoch = state.epochCount;
  }

  return { dirty, epoch };
}
