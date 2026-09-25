import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createCarcassState, spawnCarcass, stepCarcasses } from '../src/sim/carcass';
import { createGrassState } from '../src/sim/grass';
import { CARCASS_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };

describe('spawnCarcass', () => {
  it('defaults fromX/fromY to x/y when the caller does not pass a separate origin', () => {
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 3, 4);

    expect(carcasses.fromX[0]).toBe(3);
    expect(carcasses.fromY[0]).toBe(4);
  });

  it('records a distinct fromX/fromY when the individual moved before dying', () => {
    // Mirrors sim/herbivore.ts and sim/carnivore.ts: movement happens before
    // the death check each tick, so a carcass can land a tile away from
    // where the individual was actually standing at the start of that tick.
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 3, 4, 0, 2, 4);

    expect(carcasses.x[0]).toBe(3);
    expect(carcasses.y[0]).toBe(4);
    expect(carcasses.fromX[0]).toBe(2);
    expect(carcasses.fromY[0]).toBe(4);
  });

  it('carries fromX/fromY along when swap-remove relocates a later carcass', () => {
    const grass = createGrassState(board);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 0, 0, 0, 0, 0);
    // Bring it to one tick short of expiring: the first call is the free
    // "just spawned" tick (see the stepCarcasses tests below), then
    // decayTicks-1 more real decay steps.
    for (let i = 0; i < CARCASS_PARAMS.decayTicks; i++) {
      stepCarcasses(carcasses, grass, board);
    }
    expect(carcasses.age[0]).toBe(CARCASS_PARAMS.decayTicks - 1);

    spawnCarcass(carcasses, 9, 9, 0, 8, 9); // index 1 -- will become the swap source

    stepCarcasses(carcasses, grass, board); // index 0 expires and is removed via swap-remove

    expect(carcasses.count).toBe(1);
    expect(carcasses.x[0]).toBe(9);
    expect(carcasses.y[0]).toBe(9);
    expect(carcasses.fromX[0]).toBe(8);
    expect(carcasses.fromY[0]).toBe(9);
  });
});

describe('stepCarcasses', () => {
  it('does not decay on the tick it spawns -- that tick is "just died", not yet decomposing', () => {
    // spawnCarcass() runs mid-tick, earlier than stepCarcasses() in the same
    // sim tick (see sim/loop.ts), so without this the carcass would always
    // report age=1 (never age=0) the first time the renderer ever sees it,
    // and expire one real tick early at the other end.
    const grass = createGrassState(board);
    grass.fertility.fill(0);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 2, 2);

    stepCarcasses(carcasses, grass, board);

    const tile = 2 * board.width + 2;
    expect(grass.fertility[tile]).toBe(0);
    expect(carcasses.age[0]).toBe(0);
  });

  it('releases fertility gradually, an even share per tick, instead of all at once', () => {
    const grass = createGrassState(board);
    grass.fertility.fill(0);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 2, 2);
    stepCarcasses(carcasses, grass, board); // the free "just spawned" tick, see above

    stepCarcasses(carcasses, grass, board);

    const tile = 2 * board.width + 2;
    const perTick = CARCASS_PARAMS.fertility / CARCASS_PARAMS.decayTicks;
    expect(grass.fertility[tile]).toBeCloseTo(perTick, 5);
    expect(grass.fertility[tile]).toBeLessThan(CARCASS_PARAMS.fertility);
  });

  it('has released the full carcassFertility and disappeared once fully decayed', () => {
    const grass = createGrassState(board);
    grass.fertility.fill(0);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 2, 2);

    // +1: the first call is the free "just spawned" tick (see above), decay
    // itself takes exactly decayTicks calls after that.
    for (let i = 0; i < CARCASS_PARAMS.decayTicks + 1; i++) {
      stepCarcasses(carcasses, grass, board);
    }

    const tile = 2 * board.width + 2;
    expect(grass.fertility[tile]).toBeCloseTo(CARCASS_PARAMS.fertility, 5);
    expect(carcasses.count).toBe(0);
  });

  it('does nothing beyond a no-op when there are no carcasses', () => {
    const grass = createGrassState(board);
    const carcasses = createCarcassState(10);

    expect(() => stepCarcasses(carcasses, grass, board)).not.toThrow();
    expect(carcasses.count).toBe(0);
  });
});
