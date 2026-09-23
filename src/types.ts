export const BOARD_WIDTH = 80;
export const BOARD_HEIGHT = 45;
// CSS-pixel tile size. design.md's 16px candidate ("文字も動物記号も余裕") --
// the 12px candidate was tried first but glyphs like `W` were unreadable mush
// once actually rendered at that size.
export const TILE_SIZE = 16;

// 4x a raw sim step's worth of time (was 500ms): eating/hunting only read as
// legible "scenes" once each animal has enough on-screen time per turn to
// glide into its new tile instead of jump-cutting there (see renderer.ts's
// from/to position interpolation). Slowing this down also slows the sim's
// real-time progression by the same 4x -- intentional, not a side effect.
export const DEFAULT_TICK_MS = 2000;
export const DEFAULT_EPOCH_MS = 10_000;

export interface HerbivoreSnapshot {
  x: Int16Array;
  y: Int16Array;
  hunger: Float32Array;
  count: number;
}

// Same shape as HerbivoreSnapshot today -- kept as its own type since the two
// species' state is conceptually distinct and may diverge later.
export interface CarnivoreSnapshot {
  x: Int16Array;
  y: Int16Array;
  hunger: Float32Array;
  count: number;
}

export interface CarcassSnapshot {
  x: Int16Array;
  y: Int16Array;
  age: Uint16Array;
  species: Uint8Array; // 0 = herbivore, 1 = carnivore -- see CARCASS_SPECIES
  count: number;
}

export interface DirtyTile {
  i: number;
  color: number;
  height: number;
}

export type MainToWorker =
  | { type: 'init'; width: number; height: number; tickMs: number; epochMs: number; seed?: number }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'set-tick-rate'; ms: number };

export type WorkerToMain =
  | { type: 'ready' }
  | {
      type: 'init-done';
      width: number;
      height: number;
      grass: { biomass: Float32Array; height: Uint8Array; colorBucket: Uint8Array };
      herbivores: HerbivoreSnapshot;
      carnivores: CarnivoreSnapshot;
      carcasses: CarcassSnapshot;
    }
  | {
      type: 'tick';
      tickCount: number;
      dirty: DirtyTile[];
      herbivores: HerbivoreSnapshot;
      carnivores: CarnivoreSnapshot;
      carcasses: CarcassSnapshot;
    }
  | { type: 'epoch'; epochIndex: number };
