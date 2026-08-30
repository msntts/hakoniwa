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
    state.fertility[0] = 0.01;
    const potential = GRASS_PARAMS.growthRate * (GRASS_PARAMS.capacity - 0.5);
    // This tile's own senescence trickle also adds to its fertility this same
    // tick (see the dedicated senescence test below) -- account for it here
    // too so this test stays about the 1:1 consumption, not senescence.
    const available = state.fertility[0] + GRASS_PARAMS.senescenceRate * 0.5;
    expect(available).toBeLessThan(potential); // sanity check on the test setup itself

    stepGrass(state, board);

    expect(state.biomass[0]).toBeCloseTo(0.5 + available, 5);
    expect(state.fertility[0]).toBeCloseTo(0, 5);
  });

  it('recovers fertility faster -- and so grows faster -- next to an already-lush neighbor than in isolation', () => {
    const state = createGrassState(board);
    // Tile 0 = (0,0) has zero fertility of its own but a lush neighbor at
    // (0,1) = index 4, which sheds fertility onto it this same tick. Tile 10
    // = (2,2) starts identically but is surrounded entirely by bare tiles, so
    // it only has its own (much smaller) senescence trickle to grow from.
    state.biomass[0] = 0.1;
    state.fertility[0] = 0;
    state.biomass[4] = 0.9;
    state.biomass[10] = 0.1;
    state.fertility[10] = 0;

    stepGrass(state, board);

    const ownPotential = GRASS_PARAMS.growthRate * (GRASS_PARAMS.capacity - 0.1);
    const ownSenescence = GRASS_PARAMS.senescenceRate * 0.1;
    const shedFromNeighbor = (GRASS_PARAMS.spreadRate * 0.9) / 8; // 7 bare neighbors + the one lush one

    // Growth is still capped by whatever fertility actually arrived this tick.
    const grownIsolated = Math.min(ownPotential, ownSenescence);
    const grownNextToLush = Math.min(ownPotential, ownSenescence + shedFromNeighbor);

    expect(state.biomass[10]).toBeCloseTo(0.1 + grownIsolated, 5);
    expect(state.biomass[0]).toBeCloseTo(0.1 + grownNextToLush, 5);
    expect(state.biomass[0]).toBeGreaterThan(state.biomass[10]);
  });

  it('does not grow when it has no biomass of its own and no lush neighbors (nothing to decompose)', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0;
    state.fertility[0] = 0;
    // every neighbor also bare

    stepGrass(state, board);

    expect(state.biomass[0]).toBe(0);
  });

  it('still slowly self-fertilizes from senescence alone, with no neighbors and no animals involved', () => {
    const state = createGrassState(board);
    state.biomass[0] = 0.5;
    state.fertility[0] = 0;
    // every neighbor bare -- this tile's own standing biomass is the only source

    stepGrass(state, board);

    const ownPotential = GRASS_PARAMS.growthRate * (GRASS_PARAMS.capacity - 0.5);
    const ownSenescence = GRASS_PARAMS.senescenceRate * 0.5;
    const grown = Math.min(ownPotential, ownSenescence);

    expect(grown).toBeGreaterThan(0); // sanity check on the test setup itself
    expect(state.biomass[0]).toBeCloseTo(0.5 + grown, 5);
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
