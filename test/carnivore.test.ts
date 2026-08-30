import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createCarcassState, spawnCarcass } from '../src/sim/carcass';
import { createCarnivoreState, spawnCarnivore, stepCarnivores } from '../src/sim/carnivore';
import { createHerbivoreState, spawnHerbivore } from '../src/sim/herbivore';
import { CARNIVORE_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };
const noRandom = () => 0;

describe('stepCarnivores', () => {
  it('catches a herbivore standing on its tile, removing it and relieving hunger', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5);
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    // High enough that a catch's relief still leaves it above
    // reproHungerThreshold, so this test isn't also triggering a birth.
    const startHunger = 0.6;
    spawnCarnivore(predators, 2, 2, startHunger);

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(herd.count).toBe(0); // eaten
    expect(predators.count).toBe(1);
    const expectedHunger = Math.max(
      0,
      startHunger + CARNIVORE_PARAMS.hungerGainPerTick - CARNIVORE_PARAMS.predationRelief,
    );
    expect(expectedHunger).toBeGreaterThan(CARNIVORE_PARAMS.reproHungerThreshold); // sanity check on the test setup itself
    expect(predators.hunger[0]).toBeCloseTo(expectedHunger, 5);
  });

  it('moves toward a neighboring tile with prey when its own tile has none', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 3, 2, 0.5); // one tile east of the predator
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, 0.5);

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.x[0]).toBe(3);
    expect(predators.y[0]).toBe(2);
    expect(herd.count).toBe(0); // caught after moving onto its tile
  });

  it('only lets one carnivore claim a given herbivore per tick', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5); // a single, lonely prey
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, 0.9);
    spawnCarnivore(predators, 2, 2, 0.9); // a second predator on the same tile

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(herd.count).toBe(0);
    // Exactly one of the two predators should show the predation relief;
    // the other went hungry this tick.
    const relieved = [predators.hunger[0], predators.hunger[1]].filter(
      (h) => (h ?? 0) < 0.9 + CARNIVORE_PARAMS.hungerGainPerTick - 0.01,
    );
    expect(relieved.length).toBe(1);
  });

  it('gains no relief and just gets hungrier when there is no prey anywhere nearby', () => {
    const herd = createHerbivoreState(10); // empty -- no prey at all
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, 0.5);

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.hunger[0]).toBeCloseTo(0.5 + CARNIVORE_PARAMS.hungerGainPerTick, 5);
  });

  it('starves once hunger reaches the starvation threshold, leaving a carcass behind', () => {
    const herd = createHerbivoreState(10); // no food anywhere
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, CARNIVORE_PARAMS.starvationHunger);

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.count).toBe(0);
    expect(carcasses.count).toBe(1);
    expect(carcasses.x[0]).toBe(2);
    expect(carcasses.y[0]).toBe(2);
  });

  it('dies of old age once past lifespanTicks, even while well fed', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5); // plenty of prey, would otherwise survive
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, 0);
    predators.age[0] = CARNIVORE_PARAMS.lifespanTicks;

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.count).toBe(0);
  });

  it('reproduces only once hunger is low enough after a catch', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5);
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    // Already at the threshold before this tick's meal, so a catch drops it
    // comfortably under.
    spawnCarnivore(predators, 2, 2, CARNIVORE_PARAMS.reproHungerThreshold);

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.count).toBe(2);
  });

  it('refuses to move onto a tile occupied by a carcass, even with prey there', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 3, 2, 0.5); // the only prey around, one tile east
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 3, 2); // but that tile has a carcass on it
    spawnCarnivore(predators, 2, 2, 0.5);

    stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.x[0]).toBe(2);
    expect(predators.y[0]).toBe(2);
    expect(herd.count).toBe(1); // left alone
  });
});
