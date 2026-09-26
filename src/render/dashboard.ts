import { histogramMean, histogramTotal } from '../sim/stats';

// Debug/tuning panel only -- not part of the sim's visual model (docs/manual.html
// section 5), so it draws into its own small canvases rather than the board.
// Like renderer.ts's canvas-drawing functions, the actual canvas drawing below
// can't be unit-tested (no DOM/canvas in the vitest env, per docs/manual.html
// section 7's note on canvas-only invariants) -- but TotalsHistory's ring-
// buffer bookkeeping is plain array math with no canvas dependency, so (like
// renderer.ts's computeGlide) it's exported and covered by
// test/dashboard.test.ts instead of going untested by association.

// One color per entity, reused across every panel that shows it (dataviz
// skill: "color follows the entity, never its rank") -- grass biomass is
// always this green whether it's today's distribution or its history,
// herbivores are always this tan, soil fertility (a third, independent stock)
// gets its own hue rather than borrowing either.
export const GRASS_COLOR = '#6fbf73';
export const HERBIVORE_COLOR = '#d99a4e';
export const FERTILITY_COLOR = '#5fa8d3';

export interface HistogramPanelStyle {
  color: string;
  unit: string;
}

const PADDING = { top: 14, right: 6, bottom: 14, left: 6 };

// Backing store sized in device pixels, CSS box in logical pixels -- same
// devicePixelRatio handling as render/renderer.ts's createRenderer, so bars
// and text stay crisp on HiDPI screens.
export function initHistogramCanvas(canvas: HTMLCanvasElement, logicalWidth: number, logicalHeight: number, dpr: number): void {
  canvas.width = Math.round(logicalWidth * dpr);
  canvas.height = Math.round(logicalHeight * dpr);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function drawRoundedTopRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (h <= 0 || w <= 0) return;
  const rr = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

// Draws one bar-chart histogram, auto-scaled to its own current tallest bin
// (a live per-tick view, not a fixed-scale comparison across ticks). `title`
// names the single series -- no legend needed (dataviz skill: a lone series
// doesn't need one, the title carries identity).
export function drawHistogram(
  canvas: HTMLCanvasElement,
  title: string,
  counts: Uint32Array,
  domainMax: number,
  style: HistogramPanelStyle,
  logicalWidth: number,
  logicalHeight: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const dpr = canvas.width / logicalWidth;
  ctx.save();
  ctx.scale(dpr, dpr);
  const logicalW = logicalWidth;
  const logicalH = logicalHeight;

  const plotLeft = PADDING.left;
  const plotRight = logicalW - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = logicalH - PADDING.bottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const bins = counts.length;
  const gap = 2;
  const barW = Math.max(1, (plotW - gap * (bins - 1)) / bins);

  let maxCount = 0;
  for (let i = 0; i < bins; i++) maxCount = Math.max(maxCount, counts[i] ?? 0);

  ctx.fillStyle = style.color;
  for (let i = 0; i < bins; i++) {
    const c = counts[i] ?? 0;
    const barH = maxCount > 0 ? (c / maxCount) * plotH : 0;
    const x = plotLeft + i * (barW + gap);
    const y = plotBottom - barH;
    drawRoundedTopRect(ctx, x, y, barW, barH, 2);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom + 0.5);
  ctx.lineTo(plotRight, plotBottom + 0.5);
  ctx.stroke();

  ctx.fillStyle = 'rgba(230,230,230,0.6)';
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0', plotLeft, plotBottom + 3);
  ctx.textAlign = 'right';
  ctx.fillText(`${trimNumber(domainMax)}${style.unit}`, plotRight, plotBottom + 3);

  const total = histogramTotal(counts);
  const mean = total > 0 ? histogramMean(counts, domainMax) : 0;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(230,230,230,0.85)';
  ctx.fillText(`${title}  n=${total}  mean=${trimNumber(mean)}${style.unit}`, plotLeft, 2);

  ctx.restore();
}

// Fixed-capacity ring buffer of the board-wide totals (Totals, types.ts) sent
// with every tick/init-done message -- one line-chart sample per tick. Fixed
// capacity (not unbounded) so a long-running session's memory use stays
// bounded instead of growing for as long as the tab stays open; oldest
// samples are silently dropped once full, same tradeoff as any other
// scrolling live chart.
export interface TotalsHistory {
  capacity: number;
  grassBiomass: Float64Array;
  fertility: Float64Array;
  length: number; // valid samples so far, <= capacity
  cursor: number; // next write position, wraps once full
}

export function createTotalsHistory(capacity: number): TotalsHistory {
  return {
    capacity,
    grassBiomass: new Float64Array(capacity),
    fertility: new Float64Array(capacity),
    length: 0,
    cursor: 0,
  };
}

export function pushTotals(history: TotalsHistory, grassBiomass: number, fertility: number): void {
  history.grassBiomass[history.cursor] = grassBiomass;
  history.fertility[history.cursor] = fertility;
  history.cursor = (history.cursor + 1) % history.capacity;
  history.length = Math.min(history.length + 1, history.capacity);
}

// Unwraps the ring into oldest-to-newest order for drawing.
export function totalsHistoryOrdered(history: TotalsHistory): { grassBiomass: number[]; fertility: number[] } {
  const n = history.length;
  const grassBiomass = new Array<number>(n);
  const fertility = new Array<number>(n);
  const start = n < history.capacity ? 0 : history.cursor;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % history.capacity;
    grassBiomass[i] = history.grassBiomass[idx] ?? 0;
    fertility[i] = history.fertility[idx] ?? 0;
  }
  return { grassBiomass, fertility };
}

// Draws both totals as lines sharing one y-axis (dataviz skill: never a dual-
// axis chart -- these are commensurate, both a sum of a same-scale per-tile
// [0,1] value across the board, so one shared axis is correct here, not a
// shortcut). `domainMax` is fixed at the board's tile count (the highest
// either sum could theoretically reach, both caps being 1.0/tile) rather than
// auto-scaled to the observed max, so a real decline reads as a falling line
// against a stable ceiling instead of being rescaled to always fill the
// panel.
export function drawTotalsChart(canvas: HTMLCanvasElement, history: TotalsHistory, domainMax: number, logicalWidth: number, logicalHeight: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const dpr = canvas.width / logicalWidth;
  ctx.save();
  ctx.scale(dpr, dpr);

  const plotLeft = PADDING.left;
  const plotRight = logicalWidth - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = logicalHeight - PADDING.bottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const { grassBiomass, fertility } = totalsHistoryOrdered(history);
  const n = grassBiomass.length;

  function drawLine(c: CanvasRenderingContext2D, values: number[], color: string): void {
    if (values.length < 2) return;
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = plotLeft + (i / (n - 1)) * plotW;
      const frac = Math.max(0, Math.min(1, (values[i] ?? 0) / domainMax));
      const y = plotBottom - frac * plotH;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }

  drawLine(ctx, fertility, FERTILITY_COLOR);
  drawLine(ctx, grassBiomass, GRASS_COLOR);

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom + 0.5);
  ctx.lineTo(plotRight, plotBottom + 0.5);
  ctx.stroke();

  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(230,230,230,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText('0', plotLeft, plotBottom + 3);
  ctx.textAlign = 'right';
  ctx.fillText(trimNumber(domainMax), plotRight, plotBottom + 3);

  // Legend (>=2 series always gets one, per the dataviz skill) doubles as the
  // current-value readout, so the two most-asked questions -- "which line is
  // which" and "what's it at right now" -- are answered by the same text.
  const lastGrass = grassBiomass[n - 1] ?? 0;
  const lastFertility = fertility[n - 1] ?? 0;
  ctx.textAlign = 'left';
  ctx.fillStyle = GRASS_COLOR;
  ctx.fillText('■', plotLeft, 2);
  ctx.fillStyle = 'rgba(230,230,230,0.85)';
  ctx.fillText(`草biomass合計=${trimNumber(lastGrass)}`, plotLeft + 10, 2);
  ctx.fillStyle = FERTILITY_COLOR;
  ctx.fillText('■', plotLeft + 150, 2);
  ctx.fillStyle = 'rgba(230,230,230,0.85)';
  ctx.fillText(`土壌養分合計=${trimNumber(lastFertility)}`, plotLeft + 160, 2);

  ctx.restore();
}
