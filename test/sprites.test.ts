import { describe, expect, it } from 'vitest';
import { ANIMAL_ANIM_FRAMES, pickAnimalFrame } from '../src/render/sprites';

describe('pickAnimalFrame', () => {
  it('stays within the calm walk range while not eating', () => {
    for (let counter = 0; counter < ANIMAL_ANIM_FRAMES * 3; counter++) {
      const frame = pickAnimalFrame(counter, false);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(5);
    }
  });

  it('stays within the bite range while eating', () => {
    for (let counter = 0; counter < ANIMAL_ANIM_FRAMES * 3; counter++) {
      const frame = pickAnimalFrame(counter, true);
      expect(frame).toBeGreaterThanOrEqual(5);
      expect(frame).toBeLessThan(ANIMAL_ANIM_FRAMES);
    }
  });

  it('picks a different frame range for the same counter depending on eating state', () => {
    // Same wall-clock counter, same individual -- only the eating flag
    // differs, and it alone must decide which loop plays.
    for (let counter = 0; counter < ANIMAL_ANIM_FRAMES; counter++) {
      expect(pickAnimalFrame(counter, true)).not.toBe(pickAnimalFrame(counter, false));
    }
  });

  it('handles negative counters (can happen via desync offsets) without leaving its range', () => {
    expect(pickAnimalFrame(-1, false)).toBeGreaterThanOrEqual(0);
    expect(pickAnimalFrame(-1, false)).toBeLessThan(5);
    expect(pickAnimalFrame(-1, true)).toBeGreaterThanOrEqual(5);
    expect(pickAnimalFrame(-1, true)).toBeLessThan(ANIMAL_ANIM_FRAMES);
  });
});
