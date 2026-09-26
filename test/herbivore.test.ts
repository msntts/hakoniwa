import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { torusDelta } from '../src/sim/board';
import { createCarcassState, spawnCarcass } from '../src/sim/carcass';
import type { GrassPatch } from '../src/sim/grass';
import { createGrassState } from '../src/sim/grass';
import { createHerbivoreState, seedHerbivores, spawnHerbivore, stepHerbivores } from '../src/sim/herbivore';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };
const noRandom = () => 0;

// Same small fixed-period PRNG as grass.test.ts's seedGrass tests -- varied,
// reproducible values instead of noRandom's single degenerate point.
function varyingRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('stepHerbivores', () => {
  it('starves an individual once hunger reaches the starvation threshold, regardless of age', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0); // no food anywhere, so hunger only ever climbs
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    // Already at the starvation line; plenty of lifespan left.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.starvationHunger);

    expect(herd.count).toBe(1);
    stepHerbivores(herd, grass, carcasses, board, noRandom);
    expect(herd.count).toBe(0);
  });

  it('removes an individual once it exceeds its lifespan, even while well fed', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1); // plenty of food so hunger never drives death
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    spawnHerbivore(herd, 2, 2, 0);
    herd.age[0] = HERBIVORE_PARAMS.lifespanTicks; // one tick away from exceeding lifespan

    stepHerbivores(herd, grass, carcasses, board, noRandom);
    expect(herd.count).toBe(0);
  });

  it('a bite relieves hunger proportionally to how much biomass was actually eaten', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    const startHunger = 0.5;
    spawnHerbivore(herd, 2, 2, startHunger);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    expect(herd.count).toBe(1);
    const expectedHunger =
      startHunger + HERBIVORE_PARAMS.hungerGainPerTick - HERBIVORE_PARAMS.grazeHungerRelief;
    expect(herd.hunger[0]).toBeCloseTo(expectedHunger, 5);
  });

  it('spawns an offspring once hunger is low enough, and only then', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    // Already at the reproduction threshold before this tick's feeding, so
    // it stays well under the threshold afterward too.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.reproHungerThreshold);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    expect(herd.count).toBe(2);
    // Grass is abundant, so the bite is a full one and relief == grazeHungerRelief;
    // hunger can't go below 0 ("more than full").
    const fedHunger = Math.max(
      0,
      HERBIVORE_PARAMS.reproHungerThreshold + HERBIVORE_PARAMS.hungerGainPerTick - HERBIVORE_PARAMS.grazeHungerRelief,
    );
    const parentHunger = fedHunger + HERBIVORE_PARAMS.reproHungerCost;
    expect(herd.hunger[0]).toBeCloseTo(parentHunger, 5);
    expect(herd.hunger[1]).toBeCloseTo(HERBIVORE_PARAMS.initialHunger, 5);
  });

  it('refuses to reproduce when hunger is above the threshold, even with food available', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    // Well above the reproduction threshold and the graze relief this tick
    // isn't enough to bring it back under -- should feed but not reproduce.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.reproHungerThreshold + 0.5);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    expect(herd.count).toBe(1);
  });

  it('returns a share of what it eats to the tile as fertility (excretion)', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    grass.fertility.fill(0);
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    spawnHerbivore(herd, 2, 2, 0.5);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    const tile = 2 * board.width + 2;
    const expectedFertility = GRASS_PARAMS.grazePerBite * HERBIVORE_PARAMS.excretionRatio;
    expect(grass.fertility[tile]).toBeCloseTo(expectedFertility, 5);
  });

  it('leaves a carcass where it starves, instead of dumping fertility immediately', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0); // no food, so it starves this tick
    grass.fertility.fill(0);
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.starvationHunger);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    expect(herd.count).toBe(0);
    expect(carcasses.count).toBe(1);
    expect(carcasses.x[0]).toBe(2);
    expect(carcasses.y[0]).toBe(2);
    expect(carcasses.age[0]).toBe(0);
    // The nutrient payoff comes later, via stepCarcasses decomposing it --
    // not as an instant dump the moment it dies.
    const tile = 2 * board.width + 2;
    expect(grass.fertility[tile]).toBe(0);
  });

  it('records the carcass fromX/fromY at where it was standing before this tick\'s move, not where it died', () => {
    // Movement happens before the death check each tick (see the step order
    // above), so an individual that moves and then dies the same tick leaves
    // its carcass up to a tile away from where it was last standing alive --
    // the renderer needs fromX/fromY to glide the carcass in from there
    // instead of popping it straight into x/y (see render/renderer.ts's
    // carcassGlideFrom, and docs/manual.html section 10).
    const grass = createGrassState(board);
    grass.biomass.fill(0);
    // Just enough biomass to pull it east (bestBiomass starts at its own
    // tile's 0), but below grazeBiomassThreshold (0.1) so it doesn't actually
    // eat there -- it moves toward food it can't reach in time and starves.
    grass.biomass[2 * board.width + 3] = 0.05;
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    // Already at the starvation line -- this tick's unavoidable hunger gain
    // (it doesn't clear grazeBiomassThreshold, see above) pushes it over.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.starvationHunger);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    expect(herd.count).toBe(0);
    expect(carcasses.count).toBe(1);
    expect(carcasses.x[0]).toBe(3); // moved east before dying
    expect(carcasses.y[0]).toBe(2);
    expect(carcasses.fromX[0]).toBe(2);
    expect(carcasses.fromY[0]).toBe(2); // but it was standing here at the start of the tick
  });

  it('stays put and does not eat again for restTicksAfterEating ticks after a bite', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0.2); // below every other neighbor, so it never wins the move
    grass.biomass[2 * board.width + 2] = 1; // start tile
    grass.biomass[2 * board.width + 3] = 1; // (3,2): untouched, so it pulls ahead once (2,2) is grazed to 0.85
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    spawnHerbivore(herd, 2, 2, 0.5);

    stepHerbivores(herd, grass, carcasses, board, noRandom); // eats at (2,2), enters rest
    const grazedTile = 2 * board.width + 2;
    const biomassJustAfterBite = grass.biomass[grazedTile];
    const hungerJustAfterBite = herd.hunger[0];
    expect(herd.rest[0]).toBe(HERBIVORE_PARAMS.restTicksAfterEating);

    for (let tick = 0; tick < HERBIVORE_PARAMS.restTicksAfterEating; tick++) {
      stepHerbivores(herd, grass, carcasses, board, noRandom);
      // Resting: stays on the grazed tile even though a neighbor now has more food.
      expect(herd.x[0]).toBe(2);
      expect(herd.y[0]).toBe(2);
      expect(grass.biomass[grazedTile]).toBeCloseTo(biomassJustAfterBite, 5);
    }
    // Hunger is frozen during the rest -- it already ate this cycle, so this
    // isn't a second tick of going hungry, just the same meal spread out.
    expect(herd.hunger[0]).toBeCloseTo(hungerJustAfterBite, 5);

    stepHerbivores(herd, grass, carcasses, board, noRandom); // rest over -- free to move and eat again
    expect(herd.x[0]).toBe(3);
    expect(herd.y[0]).toBe(2);
  });

  it('keeps trending toward satiation over time when constantly well-fed, even with a rest tick after each bite', () => {
    // Regression guard: an earlier version of the rest mechanic let hunger
    // keep climbing during the rest tick, which canceled out each bite's
    // relief and left a constantly-fed individual oscillating in place
    // instead of ever approaching reproHungerThreshold.
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    const startHunger = 0.5;
    spawnHerbivore(herd, 2, 2, startHunger);

    // Few enough ticks that reproduction (which would perturb hunger by
    // reproHungerCost) can't have kicked in yet.
    for (let t = 0; t < 6; t++) {
      stepHerbivores(herd, grass, carcasses, board, noRandom);
    }

    expect(herd.count).toBe(1);
    expect(herd.hunger[0]).toBeLessThan(startHunger);
  });

  it('refuses to move onto a tile occupied by a carcass, even if it has the best food', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0);
    grass.biomass[2 * board.width + 3] = 1; // (3,2), one tile east of (2,2) -- by far the best food around
    const herd = createHerbivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 3, 2); // a carcass is occupying that same tile
    spawnHerbivore(herd, 2, 2, 0.5);

    stepHerbivores(herd, grass, carcasses, board, noRandom);

    expect(herd.x[0]).toBe(2);
    expect(herd.y[0]).toBe(2);
  });
});

describe('seedHerbivores', () => {
  it('spawns exactly at the patch center when rng always returns 0 (angle=0, radius=0)', () => {
    const patches: GrassPatch[] = [{ x: 3, y: 3, radius: 5 }];
    const h = createHerbivoreState(10);

    seedHerbivores(h, board, 1, noRandom, patches);

    expect(h.x[0]).toBe(3);
    expect(h.y[0]).toBe(3);
  });

  it('lands every individual within its patch\'s radius of the patch center, even on the torus', () => {
    const bigBoard: Board = { width: 40, height: 40 };
    // Patch centered right at the seam so a naive (non-wrapping) distance
    // check would wrongly fail individuals that landed just past x=39->0.
    const patches: GrassPatch[] = [{ x: 0, y: 20, radius: 8 }];
    const h = createHerbivoreState(200);

    seedHerbivores(h, bigBoard, 200, varyingRng(42), patches);

    expect(h.count).toBe(200);
    for (let i = 0; i < h.count; i++) {
      const dx = torusDelta(patches[0]?.x ?? 0, h.x[i] ?? 0, bigBoard.width);
      const dy = torusDelta(patches[0]?.y ?? 0, h.y[i] ?? 0, bigBoard.height);
      const dist = Math.sqrt(dx * dx + dy * dy);
      // +0.71 (~sqrt(2)/2): landing coordinates are rounded to the nearest
      // tile, which can push a point sampled right at the radius's edge out
      // by up to half a tile diagonally.
      expect(dist).toBeLessThanOrEqual((patches[0]?.radius ?? 0) + 0.71);
    }
  });

  it('falls back to a board-wide position instead of throwing when given no patches', () => {
    const h = createHerbivoreState(10);

    expect(() => seedHerbivores(h, board, 3, noRandom, [])).not.toThrow();
    expect(h.count).toBe(3);
  });
});
