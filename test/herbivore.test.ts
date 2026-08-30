import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createGrassState } from '../src/sim/grass';
import { createHerbivoreState, spawnHerbivore, stepHerbivores } from '../src/sim/herbivore';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };
const noRandom = () => 0;

describe('stepHerbivores', () => {
  it('starves an individual once hunger reaches the starvation threshold, regardless of age', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0); // no food anywhere, so hunger only ever climbs
    const herd = createHerbivoreState(10);
    // Already at the starvation line; plenty of lifespan left.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.starvationHunger);

    expect(herd.count).toBe(1);
    stepHerbivores(herd, grass, board, noRandom);
    expect(herd.count).toBe(0);
  });

  it('removes an individual once it exceeds its lifespan, even while well fed', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1); // plenty of food so hunger never drives death
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0);
    herd.age[0] = HERBIVORE_PARAMS.lifespanTicks; // one tick away from exceeding lifespan

    stepHerbivores(herd, grass, board, noRandom);
    expect(herd.count).toBe(0);
  });

  it('a bite relieves hunger proportionally to how much biomass was actually eaten', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    const startHunger = 0.5;
    spawnHerbivore(herd, 2, 2, startHunger);

    stepHerbivores(herd, grass, board, noRandom);

    expect(herd.count).toBe(1);
    const expectedHunger =
      startHunger + HERBIVORE_PARAMS.hungerGainPerTick - HERBIVORE_PARAMS.grazeHungerRelief;
    expect(herd.hunger[0]).toBeCloseTo(expectedHunger, 5);
  });

  it('spawns an offspring once hunger is low enough, and only then', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    // Already at the reproduction threshold before this tick's feeding, so
    // it stays well under the threshold afterward too.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.reproHungerThreshold);

    stepHerbivores(herd, grass, board, noRandom);

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
    // Well above the reproduction threshold and the graze relief this tick
    // isn't enough to bring it back under -- should feed but not reproduce.
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.reproHungerThreshold + 0.5);

    stepHerbivores(herd, grass, board, noRandom);

    expect(herd.count).toBe(1);
  });

  it('returns a share of what it eats to the tile as fertility (excretion)', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    grass.fertility.fill(0);
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5);

    stepHerbivores(herd, grass, board, noRandom);

    const tile = 2 * board.width + 2;
    const expectedFertility = GRASS_PARAMS.grazePerBite * HERBIVORE_PARAMS.excretionRatio;
    expect(grass.fertility[tile]).toBeCloseTo(expectedFertility, 5);
  });

  it('deposits a carcass worth of fertility on the tile where it starves', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0); // no food, so it starves this tick
    grass.fertility.fill(0);
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.starvationHunger);

    stepHerbivores(herd, grass, board, noRandom);

    expect(herd.count).toBe(0);
    const tile = 2 * board.width + 2;
    expect(grass.fertility[tile]).toBeCloseTo(HERBIVORE_PARAMS.carcassFertility, 5);
  });
});
