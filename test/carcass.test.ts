import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createCarcassState, spawnCarcass, stepCarcasses } from '../src/sim/carcass';
import { createGrassState } from '../src/sim/grass';
import { CARCASS_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };

describe('stepCarcasses', () => {
  it('releases fertility gradually, an even share per tick, instead of all at once', () => {
    const grass = createGrassState(board);
    grass.fertility.fill(0);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 2, 2);

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

    for (let i = 0; i < CARCASS_PARAMS.decayTicks; i++) {
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
