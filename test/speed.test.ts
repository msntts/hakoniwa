import { describe, expect, it } from 'vitest';
import { clampSpeed, speedToTickMs } from '../src/speed';
import { DEFAULT_TICK_MS, SPEED_MAX, SPEED_MIN } from '../src/types';

describe('clampSpeed', () => {
  it('clamps below SPEED_MIN up to SPEED_MIN', () => {
    expect(clampSpeed(0)).toBe(SPEED_MIN);
  });

  it('clamps above SPEED_MAX down to SPEED_MAX', () => {
    expect(clampSpeed(SPEED_MAX + 1)).toBe(SPEED_MAX);
  });

  it('leaves an on-grid value unchanged', () => {
    expect(clampSpeed(1.5)).toBe(1.5);
  });

  it('snaps float drift from repeated +/-0.5 steps back onto the 0.5 grid', () => {
    // 0.1 + 0.2 !== 0.3 in JS -- three SPEED_STEP additions from SPEED_MIN can
    // land a hair off 2.0 (e.g. 1.9999999999999998) without this rounding.
    expect(clampSpeed(0.5 + 0.5 + 0.5 + 0.5)).toBe(2);
  });
});

describe('speedToTickMs', () => {
  it('returns DEFAULT_TICK_MS at 1x', () => {
    expect(speedToTickMs(1)).toBe(DEFAULT_TICK_MS);
  });

  it('halves the tick interval at 2x', () => {
    expect(speedToTickMs(2)).toBe(DEFAULT_TICK_MS / 2);
  });

  it('lands back on the pre-slowdown 500ms tick at 4x (SPEED_MAX)', () => {
    expect(speedToTickMs(SPEED_MAX)).toBe(500);
  });

  it('doubles the tick interval at 0.5x (SPEED_MIN)', () => {
    expect(speedToTickMs(SPEED_MIN)).toBe(DEFAULT_TICK_MS * 2);
  });
});
