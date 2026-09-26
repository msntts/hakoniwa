import { histogramMean, histogramTotal } from '../sim/stats';

// Debug/tuning panel only -- not part of the sim's visual model (docs/manual.html
// section 5), so it draws into its own small canvases rather than the board.
// Like renderer.ts's canvas-drawing functions, this can't be unit-tested (no
// DOM/canvas in the vitest env, per docs/manual.html section 7's note on
// canvas-only invariants) -- the pure binning/mean math it reads lives in
// sim/stats.ts instead, where it's covered by test/stats.test.ts.

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
