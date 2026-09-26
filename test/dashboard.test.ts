import { describe, expect, it } from 'vitest';
import { createTotalsHistory, pushTotals, totalsHistoryOrdered } from '../src/render/dashboard';

describe('TotalsHistory', () => {
  it('returns pushed samples in oldest-to-newest order while under capacity', () => {
    const history = createTotalsHistory(5);
    pushTotals(history, 1, 10);
    pushTotals(history, 2, 20);
    pushTotals(history, 3, 30);
    expect(totalsHistoryOrdered(history)).toEqual({
      grassBiomass: [1, 2, 3],
      fertility: [10, 20, 30],
    });
  });

  it('drops the oldest sample once capacity is exceeded, keeping chronological order', () => {
    const history = createTotalsHistory(3);
    for (let i = 1; i <= 5; i++) pushTotals(history, i, i * 10);
    // Samples 1 and 2 should have been evicted; 3, 4, 5 remain, oldest first.
    expect(totalsHistoryOrdered(history)).toEqual({
      grassBiomass: [3, 4, 5],
      fertility: [30, 40, 50],
    });
  });

  it('is empty right after creation', () => {
    const history = createTotalsHistory(3);
    expect(totalsHistoryOrdered(history)).toEqual({ grassBiomass: [], fertility: [] });
  });
});
