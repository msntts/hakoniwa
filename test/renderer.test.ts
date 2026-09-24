import { describe, expect, it } from 'vitest';
import { computeGlide, type GlideEntry } from '../src/render/renderer';

const boardWidth = 80;

describe('computeGlide', () => {
  it('glides an individual from its own previous position, not whatever sat at its new array index', () => {
    // Mirrors what stepHerbivores/stepCarnivores actually do on a death:
    // removeHerbivoreAt swap-removes by moving the *last* individual into the
    // dead one's slot. So after id=0 (at index 0) dies, id=2 (previously the
    // last individual, far away on the board) ends up at index 0 instead.
    const prevById = new Map<number, GlideEntry>([
      [0, { x: 5, y: 5, facing: 1 }], // dies this tick
      [1, { x: 6, y: 5, facing: 1 }],
      [2, { x: 70, y: 40, facing: 1 }], // unrelated individual, far across the board
    ]);

    // This tick's snapshot: id=0 is gone, id=2 has moved into slot 0 (one
    // tile of its own real movement), id=1 is still at slot 1 (also one
    // tile of movement).
    const ids = new Uint32Array([2, 1]);
    const toX = new Int16Array([71, 7]);
    const toY = new Int16Array([40, 5]);

    const { fromX, fromY } = computeGlide(ids, toX, toY, 2, prevById, boardWidth);

    // id=2's glide must start from its OWN previous position (70,40), not
    // from index 0's previous occupant id=0's position (5,5) -- the latter
    // is the bug: it would draw id=2 as a single animal flying diagonally
    // from (5,5) all the way to (71,40) in one tick.
    expect(fromX[0]).toBe(70);
    expect(fromY[0]).toBe(40);

    // id=1 didn't move array slots, so its glide is unaffected either way.
    expect(fromX[1]).toBe(6);
    expect(fromY[1]).toBe(5);
  });

  it('has no glide origin for a newly born individual (unknown id)', () => {
    const prevById = new Map<number, GlideEntry>();
    const ids = new Uint32Array([42]);
    const toX = new Int16Array([10]);
    const toY = new Int16Array([10]);

    const { fromX, fromY, facing } = computeGlide(ids, toX, toY, 1, prevById, boardWidth);

    expect(fromX[0]).toBeUndefined();
    expect(fromY[0]).toBeUndefined();
    expect(facing[0]).toBe(1);
  });

  it('carries facing forward by id, and derives it from the real per-id movement', () => {
    const prevById = new Map<number, GlideEntry>([
      [0, { x: 5, y: 5, facing: -1 }], // was facing left
      [2, { x: 70, y: 40, facing: 1 }],
    ]);
    const ids = new Uint32Array([2, 0]);
    const toX = new Int16Array([71, 4]); // id=2 moved right; id=0 continues moving left
    const toY = new Int16Array([40, 5]);

    const { facing } = computeGlide(ids, toX, toY, 2, prevById, boardWidth);

    expect(facing[0]).toBe(1); // id=2: 70 -> 71, moved right
    expect(facing[1]).toBe(-1); // id=0: 5 -> 4, moved left
  });
});
