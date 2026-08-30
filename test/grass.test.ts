import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createGrassState, deriveHeightAndColor, depositFertility, grazeTile, stepGrass } from '../src/sim/grass';
import { GRASS_PARAMS } from '../src/sim/params';

const board: Board = { width: 4, height: 4 };

describe('stepGrass', () => {
  it('grows biomass toward capacity without overshooting, given enough fertility', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0;
    state.fertility[0] = 10; // far more than a full regrowth could ever consume
    for (let i = 0; i < 5000; i++) stepGrass(state, board);
    expect(state.biomass[0]).toBeGreaterThan(0.99);
    expect(state.biomass[0]).toBeLessThanOrEqual(GRASS_PARAMS.capacity);
  });

  it('never exceeds capacity even starting above it', () => {
    const state = createGrassState(board);
    state.biomass[0] = GRASS_PARAMS.capacity;
    state.fertility[0] = 10;
    stepGrass(state, board);
    expect(state.biomass[0]).toBeCloseTo(GRASS_PARAMS.capacity, 5);
  });

  it('does not grow at all without fertility, no matter how empty the tile looks', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0;
    state.fertility[0] = 0;
    for (let i = 0; i < 100; i++) stepGrass(state, board);
    expect(state.biomass[0]).toBe(0);
  });

  it('consumes fertility 1:1 with the biomass it grows', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0.5;
    state.fertility[0] = 0.01; // less than one tick's growth potential
    const potential = GRASS_PARAMS.growthRate * (GRASS_PARAMS.capacity - 0.5);
    expect(state.fertility[0]).toBeLessThan(potential); // sanity check on the test setup itself

    stepGrass(state, board);

    expect(state.biomass[0]).toBeCloseTo(0.5 + 0.01, 5);
    expect(state.fertility[0]).toBeCloseTo(0, 5);
  });

  it('grows faster next to an already-lush neighbor than in isolation, fertility allowing', () => {
    const state = createGrassState(board);
    state.fertility.fill(1); // plenty everywhere -- isolate the spread effect from the fertility cap
    // Tile 0 = (0,0) has a lush neighbor at (0,1) = index 4. Tile 10 = (2,2)
    // is surrounded entirely by bare tiles.
    state.biomass[0] = 0.1;
    state.biomass[4] = 0.9;
    state.biomass[10] = 0.1;

    stepGrass(state, board);

    const ownPotential = GRASS_PARAMS.growthRate * (GRASS_PARAMS.capacity - 0.1);
    const neighborAvg = 0.9 / 8; // 7 bare neighbors + the one lush one
    const expectedIsolated = 0.1 + ownPotential;
    const expectedNextToLush = 0.1 + ownPotential + GRASS_PARAMS.spreadRate * neighborAvg;

    expect(state.biomass[10]).toBeCloseTo(expectedIsolated, 5);
    expect(state.biomass[0]).toBeCloseTo(expectedNextToLush, 5);
    expect(state.biomass[0]).toBeGreaterThan(state.biomass[10]);
  });

  it('cannot spread onto a tile with no fertility, no matter how lush its neighbors are', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0;
    state.fertility[0] = 0;
    for (const n of [1, 4, 5]) state.biomass[n] = 1; // several lush neighbors of tile 0

    stepGrass(state, board);

    expect(state.biomass[0]).toBe(0);
  });
});

describe('grazeTile', () => {
  it('clamps removal so biomass never goes negative', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0.05;
    const removed = grazeTile(state, 0, 0.5);
    expect(removed).toBeCloseTo(0.05, 5);
    expect(state.biomass[0]).toBe(0);
  });

  it('removes the requested amount when enough biomass is available', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0.8;
    const removed = grazeTile(state, 0, 0.3);
    expect(removed).toBeCloseTo(0.3, 5);
    expect(state.biomass[0]).toBeCloseTo(0.5, 5);
  });
});

describe('depositFertility', () => {
  it('adds the deposited amount', () => {
    const state = createGrassState(board);
    state.fertility[0] = 0.2;
    depositFertility(state, 0, 0.1);
    expect(state.fertility[0]).toBeCloseTo(0.3, 5);
  });

  it('clamps at fertilityCap', () => {
    const state = createGrassState(board);
    state.fertility[0] = GRASS_PARAMS.fertilityCap - 0.05;
    depositFertility(state, 0, 1);
    expect(state.fertility[0]).toBeCloseTo(GRASS_PARAMS.fertilityCap, 5);
  });
});

describe('deriveHeightAndColor', () => {
  it('only reports tiles whose quantized height or color bucket actually changed', () => {
    const state = createGrassState(board);
    state.biomass.fill(0.5);
    const first = deriveHeightAndColor(state, board);
    expect(first.length).toBe(board.width * board.height);

    const second = deriveHeightAndColor(state, board);
    expect(second.length).toBe(0);

    state.biomass[3] = 0.99;
    const third = deriveHeightAndColor(state, board);
    expect(third.map((d) => d.i)).toEqual([3]);
  });
});
