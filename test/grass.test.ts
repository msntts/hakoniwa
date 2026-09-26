import { describe, expect, it } from 'vitest';
import { idx, type Board } from '../src/sim/board';
import { createGrassState, deriveHeightAndColor, depositFertility, grazeTile, seedGrass, stepGrass } from '../src/sim/grass';
import { GRASS_PARAMS } from '../src/sim/params';

const board: Board = { width: 4, height: 4 };
const noRandom = () => 0;

// A small, fixed-period PRNG (distinct from the sim's own mulberry32 in
// loop.ts) purely so seedGrass's patch-count/bounds tests can sample varied,
// reproducible values instead of the single degenerate point noRandom gives.
function varyingRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

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

describe('seedGrass', () => {
  // Big enough that a tile at the far corner from (0,0) is well outside even
  // patchRadiusMax on the torus (half the board's own diagonal), so it can
  // only be reached by patch influence if the wrap math is wrong.
  const bigBoard: Board = { width: 40, height: 40 };

  it('is dense at a patch center and bare in ground far from every patch', () => {
    // rng()=>0 collapses every patch to the same degenerate point: x=0,
    // y=0, radius=patchRadiusMin, peak=patchPeakMin, and a constant
    // (negative-most) noise offset -- deterministic without needing to
    // reproduce the RNG's actual sequence by hand.
    const state = createGrassState(bigBoard);
    seedGrass(state, bigBoard, noRandom);

    const centerBiomass = state.biomass[idx(bigBoard, 0, 0)] ?? 0;
    expect(centerBiomass).toBeCloseTo(GRASS_PARAMS.patchPeakMin - GRASS_PARAMS.patchNoise, 5);
    // Existing grass implies some soil fertility already banked (4.2章).
    expect(state.fertility[idx(bigBoard, 0, 0)]).toBeCloseTo(centerBiomass * 0.5, 5);

    // (20,20) is patchRadiusMax away or more from (0,0) even via the
    // shortest torus path -- outside every patch's reach.
    const farBiomass = state.biomass[idx(bigBoard, 20, 20)] ?? -1;
    expect(farBiomass).toBe(0);
  });

  it('wraps a patch near the edge across the seam instead of only influencing the tiles before it', () => {
    // A patch planted at the seam (x=0) should still noticeably raise
    // biomass just *before* the seam (e.g. x = width-1), not just after it.
    const state = createGrassState(bigBoard);
    seedGrass(state, bigBoard, noRandom);

    const justBeforeSeam = state.biomass[idx(bigBoard, bigBoard.width - 1, 0)] ?? 0;
    expect(justBeforeSeam).toBeGreaterThan(0);
  });

  it('returns patchCount patches, each within the configured radius/peak bounds', () => {
    const state = createGrassState(bigBoard);
    const patches = seedGrass(state, bigBoard, varyingRng(12345));

    expect(patches.length).toBe(GRASS_PARAMS.patchCount);
    for (const patch of patches) {
      expect(patch.x).toBeGreaterThanOrEqual(0);
      expect(patch.x).toBeLessThan(bigBoard.width);
      expect(patch.y).toBeGreaterThanOrEqual(0);
      expect(patch.y).toBeLessThan(bigBoard.height);
      expect(patch.radius).toBeGreaterThanOrEqual(GRASS_PARAMS.patchRadiusMin);
      expect(patch.radius).toBeLessThanOrEqual(GRASS_PARAMS.patchRadiusMax);
    }
  });

  it('never produces biomass outside [0, capacity], even with varied noise', () => {
    const state = createGrassState(bigBoard);
    seedGrass(state, bigBoard, varyingRng(999));

    for (let i = 0; i < bigBoard.width * bigBoard.height; i++) {
      expect(state.biomass[i]).toBeGreaterThanOrEqual(0);
      expect(state.biomass[i]).toBeLessThanOrEqual(GRASS_PARAMS.capacity);
    }
  });
});
