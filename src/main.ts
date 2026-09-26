import {
  createTotalsHistory,
  drawHistogram,
  drawTotalsChart,
  GRASS_COLOR,
  HERBIVORE_COLOR,
  initHistogramCanvas,
  pushTotals,
} from './render/dashboard';
import { bakeSprites } from './render/sprites';
import { applyTick, createRenderer, paintInit, setTickDuration, startOverlayAnimation } from './render/renderer';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from './sim/params';
import { clampSpeed, speedToTickMs } from './speed';
import { BOARD_HEIGHT, BOARD_WIDTH, DEFAULT_EPOCH_MS, DEFAULT_SPEED, DEFAULT_TICK_MS, SPEED_MAX, SPEED_MIN, SPEED_STEP, TILE_SIZE } from './types';
import type { Histograms, Totals, WorkerToMain } from './types';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const hudTick = document.querySelector<HTMLSpanElement>('#hud-tick')!;
const hudDirty = document.querySelector<HTMLSpanElement>('#hud-dirty')!;
const hudEpoch = document.querySelector<HTMLSpanElement>('#hud-epoch')!;
const hudPop = document.querySelector<HTMLSpanElement>('#hud-pop')!;
const hudSpeed = document.querySelector<HTMLSpanElement>('#hud-speed')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const btnSpeedDown = document.querySelector<HTMLButtonElement>('#btn-speed-down')!;
const btnSpeedUp = document.querySelector<HTMLButtonElement>('#btn-speed-up')!;

const histGrassCanvas = document.querySelector<HTMLCanvasElement>('#hist-grass')!;
const histHungerCanvas = document.querySelector<HTMLCanvasElement>('#hist-hunger')!;
const histAgeCanvas = document.querySelector<HTMLCanvasElement>('#hist-age')!;
const totalsCanvas = document.querySelector<HTMLCanvasElement>('#chart-totals')!;

// Cap at 2x: sharp enough to fix glyph blur on HiDPI screens without
// ballooning the canvas backing store on very high (e.g. 3x) displays.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const sheet = bakeSprites(TILE_SIZE * dpr);
const renderer = createRenderer(canvas, sheet, BOARD_WIDTH, BOARD_HEIGHT, TILE_SIZE, DEFAULT_TICK_MS);

// Debug/tuning dashboard (docs/manual.html section 6): live distributions,
// not part of the sim's own visual model.
const HIST_W = 220;
const HIST_H = 120;
for (const c of [histGrassCanvas, histHungerCanvas, histAgeCanvas]) {
  initHistogramCanvas(c, HIST_W, HIST_H, dpr);
}

const TOTALS_W = 460;
const TOTALS_H = 140;
initHistogramCanvas(totalsCanvas, TOTALS_W, TOTALS_H, dpr);
// ~2000 ticks of history (~1h6m at DEFAULT_TICK_MS) before the oldest samples
// start scrolling off -- long enough to watch a boom/bust cycle play out.
const totalsHistory = createTotalsHistory(2000);
// Ceiling both totals are compared against: the highest either sum could
// reach if every tile were simultaneously maxed out (biomass capacity and
// fertilityCap are both 1.0/tile, see sim/params.ts).
const TOTALS_DOMAIN_MAX = BOARD_WIDTH * BOARD_HEIGHT;

function drawDashboard(histograms: Histograms, totals: Totals): void {
  drawHistogram(histGrassCanvas, '草 biomass', histograms.grassBiomass, GRASS_PARAMS.capacity, { color: GRASS_COLOR, unit: '' }, HIST_W, HIST_H);
  drawHistogram(
    histHungerCanvas,
    '草食獣 空腹度',
    histograms.herbivoreHunger,
    HERBIVORE_PARAMS.starvationHunger,
    { color: HERBIVORE_COLOR, unit: '' },
    HIST_W,
    HIST_H,
  );
  drawHistogram(
    histAgeCanvas,
    '草食獣 年齢',
    histograms.herbivoreAge,
    HERBIVORE_PARAMS.lifespanTicks,
    { color: HERBIVORE_COLOR, unit: 't' },
    HIST_W,
    HIST_H,
  );
  pushTotals(totalsHistory, totals.grassBiomass, totals.fertility);
  drawTotalsChart(totalsCanvas, totalsHistory, TOTALS_DOMAIN_MAX, TOTALS_W, TOTALS_H);
}

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });

let paused = false;
let speed = DEFAULT_SPEED;

// tickMs (real ms between ticks) is DEFAULT_TICK_MS/speed, not speed itself --
// see types.ts's SPEED_MIN/SPEED_MAX doc comment for why the worker and
// renderer both key off this real interval rather than the multiplier.
function applySpeed(next: number): void {
  speed = clampSpeed(next);
  const tickMs = speedToTickMs(speed);
  worker.postMessage({ type: 'set-tick-rate', ms: tickMs });
  setTickDuration(renderer, tickMs);
  hudSpeed.textContent = `${speed.toFixed(1)}x`;
  btnSpeedDown.disabled = speed <= SPEED_MIN;
  btnSpeedUp.disabled = speed >= SPEED_MAX;
}
applySpeed(speed);

worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'ready':
      worker.postMessage({
        type: 'init',
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
        tickMs: DEFAULT_TICK_MS,
        epochMs: DEFAULT_EPOCH_MS,
      });
      break;
    case 'init-done':
      paintInit(renderer, msg.grass, msg.herbivores, msg.carnivores, msg.carcasses);
      startOverlayAnimation(renderer);
      hudPop.textContent = `herbivores: ${msg.herbivores.count} / carnivores: ${msg.carnivores.count}`;
      drawDashboard(msg.histograms, msg.totals);
      worker.postMessage({ type: 'start' });
      break;
    case 'tick': {
      const repainted = applyTick(renderer, msg.dirty, msg.herbivores, msg.carnivores, msg.carcasses, msg.predations);
      hudTick.textContent = `tick: ${msg.tickCount}`;
      hudDirty.textContent = `dirty: ${repainted} / ${BOARD_WIDTH * BOARD_HEIGHT}`;
      hudPop.textContent = `herbivores: ${msg.herbivores.count} / carnivores: ${msg.carnivores.count}`;
      drawDashboard(msg.histograms, msg.totals);
      break;
    }
    case 'epoch':
      hudEpoch.textContent = `epoch: ${msg.epochIndex}`;
      break;
  }
};

btnPause.addEventListener('click', () => {
  paused = !paused;
  worker.postMessage({ type: paused ? 'pause' : 'resume' });
  btnPause.textContent = paused ? 'resume' : 'pause';
});

btnSpeedDown.addEventListener('click', () => applySpeed(speed - SPEED_STEP));
btnSpeedUp.addEventListener('click', () => applySpeed(speed + SPEED_STEP));
