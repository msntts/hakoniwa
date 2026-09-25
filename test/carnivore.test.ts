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

    const predations = stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(herd.count).toBe(0); // eaten
    expect(predators.count).toBe(1);
    const expectedHunger = Math.max(
      0,
      startHunger + CARNIVORE_PARAMS.hungerGainPerTick - CARNIVORE_PARAMS.predationRelief,
    );
    expect(expectedHunger).toBeGreaterThan(CARNIVORE_PARAMS.reproHungerThreshold); // sanity check on the test setup itself
    expect(predators.hunger[0]).toBeCloseTo(expectedHunger, 5);
    // No carcass is left behind by a kill (the body's nutrients go to the
    // predator, not the ground), so this is the *only* record of the catch --
    // the renderer uses it to draw the eaten individual fading away exactly
    // where it happened, in the same tick, instead of inferring it
    // indirectly from the predator's own rest state (10章).
    expect(predations).toEqual([{ x: 2, y: 2 }]);
  });

  it('moves toward a neighboring tile with prey when its own tile has none', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 3, 2, 0.5); // one tile east of the predator
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, 0.5);

    const predations = stepCarnivores(predators, herd, carcasses, board, noRandom);

    expect(predators.x[0]).toBe(3);
    expect(predators.y[0]).toBe(2);
    expect(herd.count).toBe(0); // caught after moving onto its tile
    // The catch happens on the tile the predator moved *to*, not where it
    // started -- the renderer needs this to draw the eaten individual fading
    // away at the right spot, not back where the predator used to be.
    expect(predations).toEqual([{ x: 3, y: 2 }]);
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

  it('records the carcass fromX/fromY at where it was standing before this tick\'s move, not where it died', () => {
    // Movement happens before the death check each tick (see the step order
    // above), so an individual that moves and then dies the same tick leaves
    // its carcass up to a tile away from where it was last standing alive --
    // the renderer needs fromX/fromY to glide the carcass in from there
    // instead of popping it straight into x/y (see render/renderer.ts's
    // carcassGlideFrom, and docs/manual.html section 10).
    const herd = createHerbivoreState(10); // no prey anywhere
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    // A constant (non-zero) rng makes the tie-break noise in the move step
    // always favor the first neighbor checked (NEIGHBOR_OFFSETS_8[0] =
    // [0,-1], i.e. north) even with zero prey anywhere, so it moves north
    // exactly one tile and then starves in its new spot.
    const constRng = () => 0.5;
    // Already at the starvation line -- this tick's unavoidable hunger gain
    // (no prey anywhere to relieve it) pushes it over.
    spawnCarnivore(predators, 2, 2, CARNIVORE_PARAMS.starvationHunger);

    stepCarnivores(predators, herd, carcasses, board, constRng);

    expect(predators.count).toBe(0);
    expect(carcasses.count).toBe(1);
    expect(carcasses.x[0]).toBe(2);
    expect(carcasses.y[0]).toBe(1); // moved north before dying
    expect(carcasses.fromX[0]).toBe(2);
    expect(carcasses.fromY[0]).toBe(2); // but it was standing here at the start of the tick
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

  it('stays put and does not hunt again for restTicksAfterEating ticks after a kill', () => {
    const herd = createHerbivoreState(10);
    spawnHerbivore(herd, 2, 2, 0.5); // caught this tick
    spawnHerbivore(herd, 3, 2, 0.5); // a second, uncaught prey one tile east
    const predators = createCarnivoreState(10);
    const carcasses = createCarcassState(10);
    spawnCarnivore(predators, 2, 2, 0.6);

    stepCarnivores(predators, herd, carcasses, board, noRandom); // catches the first, enters rest
    expect(herd.count).toBe(1); // only the (2,2) prey was eaten
    const hungerJustAfterKill = predators.hunger[0];
    expect(predators.rest[0]).toBe(CARNIVORE_PARAMS.restTicksAfterEating);

    for (let tick = 0; tick < CARNIVORE_PARAMS.restTicksAfterEating; tick++) {
      stepCarnivores(predators, herd, carcasses, board, noRandom);
      // Resting: stays put and leaves the nearby prey uncaught.
      expect(predators.x[0]).toBe(2);
      expect(predators.y[0]).toBe(2);
      expect(herd.count).toBe(1);
    }
    // Hunger is frozen during the rest -- it already ate this cycle.
    expect(predators.hunger[0]).toBeCloseTo(hungerJustAfterKill, 5);

    stepCarnivores(predators, herd, carcasses, board, noRandom); // rest over -- hunts again
    expect(predators.x[0]).toBe(3);
    expect(predators.y[0]).toBe(2);
    expect(herd.count).toBe(0);
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
