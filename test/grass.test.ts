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
    // Senescence nibbles even a maxed-out tile a little ("grass dies too"),
    // so it won't sit at *exactly* capacity anymore -- just never above it.
    expect(state.biomass[0]).toBeLessThanOrEqual(GRASS_PARAMS.capacity);
    expect(state.biomass[0]).toBeGreaterThan(GRASS_PARAMS.capacity - 0.01);
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

    // Own senescence dies back and regrows the same tick when fertility is
    // the limiting factor (see the dedicated senescence test below for what
    // it looks like when growth *isn't* reabsorbing it immediately) -- net
    // effect on biomass this tick is a wash, so this stays a clean 1:1 check.
    expect(state.biomass[0]).toBeCloseTo(0.5 + 0.01, 5);
    expect(state.fertility[0]).toBeCloseTo(0, 5);
  });

  it('recovers fertility faster -- and so grows faster -- next to an already-lush neighbor than in isolation', () => {
    const state = createGrassState(board);
    // Tile 0 = (0,0) has zero fertility of its own but a lush neighbor at
    // (0,1) = index 4, which sheds fertility onto it this same tick. Tile 10
    // = (2,2) starts identically but is surrounded entirely by bare tiles.
    state.biomass[0] = 0.1;
    state.fertility[0] = 0;
    state.biomass[4] = 0.9;
    state.biomass[10] = 0.1;
    state.fertility[10] = 0;

    stepGrass(state, board);

    const shedFromNeighbor = (GRASS_PARAMS.spreadRate * 0.9) / 8; // 7 bare neighbors + the one lush one

    // Isolated: its own senescence dies back and regrows by the same amount
    // this same tick (fertility-limited), netting to no change. Next to a
    // lush neighbor: that same wash, plus a genuine net gain from what the
    // neighbor shed in -- shedding doesn't cost the *source* tile anything,
    // unlike self-senescence.
    expect(state.biomass[10]).toBeCloseTo(0.1, 5);
    expect(state.biomass[0]).toBeCloseTo(0.1 + shedFromNeighbor, 5);
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

  it('grass also dies: standing biomass declines a little from senescence even at a standstill', () => {
    const state = createGrassState(board);
    // At capacity, growth potential is exactly zero, so senescence's effect
    // isn't reabsorbed by growth in the same tick -- this isolates the "grass
    // dies too" claim (and where the fertility it generates actually goes)
    // from the regrowth math covered by the other tests above.
    state.biomass[0] = GRASS_PARAMS.capacity;
    state.fertility[0] = 0;

    stepGrass(state, board);

    const died = GRASS_PARAMS.senescenceRate * GRASS_PARAMS.capacity;
    expect(died).toBeGreaterThan(0); // sanity check on the test setup itself
    expect(state.biomass[0]).toBeCloseTo(GRASS_PARAMS.capacity - died, 5);
    expect(state.fertility[0]).toBeCloseTo(died, 5);
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
