// Display-only aggregation: bins raw per-tile/per-individual values into a
// fixed-size histogram for the dashboard (main.ts + render/dashboard.ts). Pure
// and generic on purpose -- it doesn't know what "biomass" or "hunger" mean,
// just an array of numbers and a domain, so it can't accidentally couple grass
// and herbivore the way a species-specific helper would (see CLAUDE.md's
// module-boundary rule).
export const HISTOGRAM_BINS = 20;

// Bins `values[0..count)` into `bins` equal-width buckets covering [0, domainMax].
// A value that's outside that range (shouldn't normally happen, but this is a
// display-only concern, not a simulation invariant) is clamped into the
// nearest edge bucket rather than dropped, so a stray out-of-range value still
// shows up somewhere instead of silently vanishing from the total.
export function computeHistogram(
  values: ArrayLike<number>,
  count: number,
  domainMax: number,
  bins: number = HISTOGRAM_BINS,
): Uint32Array {
  const counts = new Uint32Array(bins);
  if (domainMax <= 0) return counts;
  for (let i = 0; i < count; i++) {
    const v = values[i] ?? 0;
    const clamped = v < 0 ? 0 : v > domainMax ? domainMax : v;
    const bin = Math.min(bins - 1, Math.floor((clamped / domainMax) * bins));
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  return counts;
}

// Weighted mean of the original values, reconstructed from bin midpoints --
// good enough for a dashboard label (not a substitute for the real mean, which
// the histogram doesn't retain).
export function histogramMean(counts: ArrayLike<number>, domainMax: number): number {
  const bins = counts.length;
  if (bins === 0 || domainMax <= 0) return 0;
  const binWidth = domainMax / bins;
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < bins; i++) {
    const c = counts[i] ?? 0;
    total += c;
    weighted += c * (i + 0.5) * binWidth;
  }
  return total > 0 ? weighted / total : 0;
}

export function histogramTotal(counts: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i] ?? 0;
  return total;
}

// Plain sum of `values[0..count)` -- used for the dashboard's board-wide
// totals (e.g. summed grass biomass/fertility across every tile), as opposed
// to computeHistogram's per-bucket counts.
export function sumArray(values: ArrayLike<number>, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += values[i] ?? 0;
  return total;
}
