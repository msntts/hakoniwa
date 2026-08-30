import { describe, expect, it } from 'vitest';
import type { Board } from '../src/sim/board';
import { createCarcassState, spawnCarcass, stepCarcasses } from '../src/sim/carcass';
import { createGrassState } from '../src/sim/grass';
import { HERBIVORE_PARAMS } from '../src/sim/params';

const board: Board = { width: 5, height: 5 };

describe('stepCarcasses', () => {
  it('releases fertility gradually, an even share per tick, instead of all at once', () => {
    const grass = createGrassState(board);
    grass.fertility.fill(0);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 2, 2);

    stepCarcasses(carcasses, grass, board);

    const tile = 2 * board.width + 2;
    const perTick = HERBIVORE_PARAMS.carcassFertility / HERBIVORE_PARAMS.carcassDecayTicks;
    expect(grass.fertility[tile]).toBeCloseTo(perTick, 5);
    expect(grass.fertility[tile]).toBeLessThan(HERBIVORE_PARAMS.carcassFertility);
  });

  it('has released the full carcassFertility and disappeared once fully decayed', () => {
    const grass = createGrassState(board);
    grass.fertility.fill(0);
    const carcasses = createCarcassState(10);
    spawnCarcass(carcasses, 2, 2);

    for (let i = 0; i < HERBIVORE_PARAMS.carcassDecayTicks; i++) {
      stepCarcasses(carcasses, grass, board);
    }

    const tile = 2 * board.width + 2;
    expect(grass.fertility[tile]).toBeCloseTo(HERBIVORE_PARAMS.carcassFertility, 5);
    expect(carcasses.count).toBe(0);
  });

  it('does nothing beyond a no-op when there are no carcasses', () => {
    const grass = createGrassState(board);
    const carcasses = createCarcassState(10);

    expect(() => stepCarcasses(carcasses, grass, board)).not.toThrow();
    expect(carcasses.count).toBe(0);
  });
});
