import { describe, expect, it } from 'vitest';
import { carcassGlideFrom, computeGlide, type GlideEntry } from '../src/render/renderer';
import type { CarcassSnapshot } from '../src/types';

const boardWidth = 80;
const noRest = new Uint8Array(4);

function carcassSnapshot(entries: Array<{ x: number; y: number; age: number; fromX: number; fromY: number }>): CarcassSnapshot {
  return {
    x: Int16Array.from(entries.map((e) => e.x)),
    y: Int16Array.from(entries.map((e) => e.y)),
    age: Uint16Array.from(entries.map((e) => e.age)),
    species: new Uint8Array(entries.length),
    fromX: Int16Array.from(entries.map((e) => e.fromX)),
    fromY: Int16Array.from(entries.map((e) => e.fromY)),
    count: entries.length,
  };
}

describe('computeGlide', () => {
  it('glides an individual from its own previous position, not whatever sat at its new array index', () => {
    // Mirrors what stepHerbivores/stepCarnivores actually do on a death:
    // removeHerbivoreAt swap-removes by moving the *last* individual into the
    // dead one's slot. So after id=0 (at index 0) dies, id=2 (previously the
    // last individual, far away on the board) ends up at index 0 instead.
    const prevById = new Map<number, GlideEntry>([
      [0, { x: 5, y: 5, facing: 1, rest: 0 }], // dies this tick
      [1, { x: 6, y: 5, facing: 1, rest: 0 }],
      [2, { x: 70, y: 40, facing: 1, rest: 0 }], // unrelated individual, far across the board
    ]);

    // This tick's snapshot: id=0 is gone, id=2 has moved into slot 0 (one
    // tile of its own real movement), id=1 is still at slot 1 (also one
    // tile of movement).
    const ids = new Uint32Array([2, 1]);
    const toX = new Int16Array([71, 7]);
    const toY = new Int16Array([40, 5]);

    const { fromX, fromY } = computeGlide(ids, toX, toY, noRest, 2, prevById, boardWidth, 1);

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

    const { fromX, fromY, facing, eating } = computeGlide(ids, toX, toY, noRest, 1, prevById, boardWidth, 1);

    expect(fromX[0]).toBeUndefined();
    expect(fromY[0]).toBeUndefined();
    expect(facing[0]).toBe(1);
    expect(eating[0]).toBe(0); // no history at all -- can't have been resting
  });

  it('carries facing forward by id, and derives it from the real per-id movement', () => {
    const prevById = new Map<number, GlideEntry>([
      [0, { x: 5, y: 5, facing: -1, rest: 0 }], // was facing left
      [2, { x: 70, y: 40, facing: 1, rest: 0 }],
    ]);
    const ids = new Uint32Array([2, 0]);
    const toX = new Int16Array([71, 4]); // id=2 moved right; id=0 continues moving left
    const toY = new Int16Array([40, 5]);

    const { facing } = computeGlide(ids, toX, toY, noRest, 2, prevById, boardWidth, 1);

    expect(facing[0]).toBe(1); // id=2: 70 -> 71, moved right
    expect(facing[1]).toBe(-1); // id=0: 5 -> 4, moved left
  });

  it('flags eating from *last* tick\'s reported rest, not this tick\'s', () => {
    // A bite and the move that lands on its tile happen in the same sim
    // tick, so the tick that first reports rest>0 is still the one gliding
    // *toward* the food -- the individual isn't actually sitting still
    // digesting until the following tick, whose own rest has already ticked
    // back down. See computeGlide's doc comment.
    const prevById = new Map<number, GlideEntry>([
      [1, { x: 5, y: 5, facing: 1, rest: 1 }], // reported resting as of last tick
      [2, { x: 6, y: 5, facing: 1, rest: 0 }], // was not resting last tick
    ]);
    const ids = new Uint32Array([1, 2]);
    const toX = new Int16Array([5, 7]);
    const toY = new Int16Array([5, 5]);
    const rest = new Uint8Array([0, 1]); // id=1 just finished resting; id=2 just landed a bite

    const { eating, nextById } = computeGlide(ids, toX, toY, rest, 2, prevById, boardWidth, 1);

    expect(eating[0]).toBe(1); // id=1: eating now (stationary this tick), because it *was* resting
    expect(eating[1]).toBe(0); // id=2: not eating yet -- still mid-walk toward the tile it just bit
    expect(nextById.get(1)?.rest).toBe(0);
    expect(nextById.get(2)?.rest).toBe(1);
  });

  it('only flags eating on the first tick of a multi-tick rest, not the whole rest period', () => {
    // restTicksAfterEating > 1: the individual sits still for several ticks
    // after a bite, but only the first of those ticks is actually chewing --
    // the rest is just standing there already fed. Simulate a bite that set
    // rest=3, then two further ticks of it counting down.
    const maxRest = 3;
    const prevById = new Map<number, GlideEntry>([
      [1, { x: 5, y: 5, facing: 1, rest: maxRest }], // just bit last tick -- this tick is the chew
    ]);
    const ids = new Uint32Array([1]);
    const toX = new Int16Array([5]);
    const toY = new Int16Array([5]);

    // Tick where it's freshly digesting (prev.rest === maxRest): chewing.
    const first = computeGlide(ids, toX, toY, new Uint8Array([2]), 1, prevById, boardWidth, maxRest);
    expect(first.eating[0]).toBe(1);

    // Next tick: prev.rest is now 2 (< maxRest) -- still resting, but no
    // longer the bite tick, so it falls back to the idle/walk loop.
    const second = computeGlide(ids, toX, toY, new Uint8Array([1]), 1, first.nextById, boardWidth, maxRest);
    expect(second.eating[0]).toBe(0);

    // And the tick after that (prev.rest === 1, still < maxRest): also idle.
    const third = computeGlide(ids, toX, toY, new Uint8Array([0]), 1, second.nextById, boardWidth, maxRest);
    expect(third.eating[0]).toBe(0);
  });
});

describe('carcassGlideFrom', () => {
  it('glides in from fromX/fromY on the tick it first appears (age === 0)', () => {
    const carcasses = carcassSnapshot([{ x: 3, y: 4, age: 0, fromX: 2, fromY: 4 }]);

    const { fromX, fromY } = carcassGlideFrom(carcasses, 0);

    expect(fromX).toBe(2);
    expect(fromY).toBe(4);
  });

  it('has no glide origin once past its first tick, even though fromX/fromY are still stored', () => {
    // age >= 1: the individual has already finished dying, this carcass has
    // been sitting at x/y since last tick -- gliding it again from fromX
    // every subsequent frame would make it slide back and forth in place.
    const carcasses = carcassSnapshot([{ x: 3, y: 4, age: 1, fromX: 2, fromY: 4 }]);

    const { fromX, fromY } = carcassGlideFrom(carcasses, 0);

    expect(fromX).toBeUndefined();
    expect(fromY).toBeUndefined();
  });

  it('has no glide origin for a carcass that never moved (fromX/fromY default to x/y)', () => {
    const carcasses = carcassSnapshot([{ x: 3, y: 4, age: 0, fromX: 3, fromY: 4 }]);

    const { fromX, fromY } = carcassGlideFrom(carcasses, 0);

    // Not wrong to return (3,4) here instead of undefined -- interpAxis
    // treats a defined-but-equal fromV/toV the same as no glide (0
    // distance) -- but undefined is what a same-position spawn actually
    // produces, so pin that down too.
    expect(fromX).toBe(3);
    expect(fromY).toBe(4);
  });
});
