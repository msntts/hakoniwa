import { DEFAULT_TICK_MS, SPEED_MAX, SPEED_MIN } from './types';

// Snaps to the nearest 0.5 step and clamps to [SPEED_MIN, SPEED_MAX] -- guards
// against float drift from repeated +/- SPEED_STEP arithmetic (0.1 + 0.2 !==
// 0.3 in JS) landing the displayed multiplier off-grid, e.g. "1.7999999999999998x".
export function clampSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed * 10) / 10));
}

// Real ms between ticks for a given multiplier -- see types.ts's speed-control
// doc comment for why the worker and renderer both key off this real interval
// rather than the multiplier itself.
export function speedToTickMs(speed: number): number {
  return Math.round(DEFAULT_TICK_MS / speed);
}
