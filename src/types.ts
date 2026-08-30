export const BOARD_WIDTH = 106;
export const BOARD_HEIGHT = 60;
export const TILE_SIZE = 12;

export const DEFAULT_TICK_MS = 500;
export const DEFAULT_EPOCH_MS = 10_000;

export interface HerbivoreSnapshot {
  x: Int16Array;
  y: Int16Array;
  energy: Float32Array;
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
    }
  | {
      type: 'tick';
      tickCount: number;
      dirty: DirtyTile[];
      herbivores: HerbivoreSnapshot;
    }
  | { type: 'epoch'; epochIndex: number };
