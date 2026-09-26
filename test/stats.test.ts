import { describe, expect, it } from 'vitest';
import { computeHistogram, histogramMean, histogramTotal } from '../src/sim/stats';

describe('computeHistogram', () => {
  it('sorts values into equal-width buckets covering [0, domainMax]', () => {
    // domainMax=1, 10 bins -> each bin is width 0.1
    const values = [0, 0.05, 0.5, 0.55, 0.95];
    const counts = computeHistogram(values, values.length, 1, 10);
    expect(counts[0]).toBe(2); // 0 and 0.05
    expect(counts[5]).toBe(2); // 0.5 and 0.55
    expect(counts[9]).toBe(1); // 0.95
    expect(histogramTotal(counts)).toBe(values.length);
  });

  it('puts a value exactly at domainMax in the last bin instead of overflowing', () => {
    const counts = computeHistogram([1], 1, 1, 10);
    expect(counts[9]).toBe(1);
    expect(counts.length).toBe(10);
  });

  it('clamps out-of-range values into the nearest edge bin rather than dropping them', () => {
    const counts = computeHistogram([-5, 999], 2, 1, 10);
    expect(counts[0]).toBe(1);
    expect(counts[9]).toBe(1);
    expect(histogramTotal(counts)).toBe(2);
  });

  it('only reads the first `count` entries, ignoring the rest of a larger backing array', () => {
    const backing = new Float32Array([0.05, 0.05, 0.95, 0.95, 0.95]);
    const counts = computeHistogram(backing, 2, 1, 10);
    expect(histogramTotal(counts)).toBe(2);
    expect(counts[0]).toBe(2);
  });

  it('returns all-zero bins when domainMax is 0', () => {
    const counts = computeHistogram([0, 0, 0], 3, 0, 10);
    expect(histogramTotal(counts)).toBe(0);
  });
});

describe('histogramMean', () => {
  it('reconstructs a close approximation of the mean from bin midpoints', () => {
    // Two clusters of values near 0.05 and 0.95 (domainMax=1, 10 bins -> bin
    // width 0.1, midpoints 0.05 and 0.95) should average to ~0.5.
    const counts = computeHistogram([0.05, 0.05, 0.95, 0.95], 4, 1, 10);
    expect(histogramMean(counts, 1)).toBeCloseTo(0.5, 5);
  });

  it('is 0 for an empty histogram', () => {
    const counts = computeHistogram([], 0, 1, 10);
    expect(histogramMean(counts, 1)).toBe(0);
  });
});
