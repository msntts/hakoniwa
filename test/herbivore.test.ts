import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createGrassState } from '../src/sim/grass';
import { createHerbivoreState, spawnHerbivore, stepHerbivores } from '../src/sim/herbivore';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };
const noRandom = () => 0;

describe('stepHerbivores', () => {
  it('removes an individual once its energy drops to zero or below', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(0); // no food anywhere, so metabolism alone drains energy
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.metabolism); // exactly one tick of energy left

    expect(herd.count).toBe(1);
    stepHerbivores(herd, grass, board, noRandom);
    expect(herd.count).toBe(0);
  });

  it('removes an individual once it exceeds its lifespan', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1); // plenty of food so energy never drives death
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5);
    herd.age[0] = HERBIVORE_PARAMS.lifespanTicks; // one tick away from exceeding lifespan

    stepHerbivores(herd, grass, board, noRandom);
    expect(herd.count).toBe(0);
  });

  it('spawns an offspring once energy reaches the reproduction threshold', () => {
    const grass = createGrassState(board);
    grass.biomass.fill(1);
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, HERBIVORE_PARAMS.reproThreshold);

    stepHerbivores(herd, grass, board, noRandom);

    expect(herd.count).toBe(2);
    const grazeGainedEnergy = GRASS_PARAMS.grazePerBite * HERBIVORE_PARAMS.grazeGain;
    const parentEnergy =
      HERBIVORE_PARAMS.reproThreshold +
      grazeGainedEnergy -
      HERBIVORE_PARAMS.metabolism -
      HERBIVORE_PARAMS.reproCost;
    expect(herd.energy[0]).toBeCloseTo(parentEnergy, 5);
    expect(herd.energy[1]).toBeCloseTo(HERBIVORE_PARAMS.initialEnergy, 5);
  });
});
