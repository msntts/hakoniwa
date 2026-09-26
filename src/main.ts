import { drawHistogram, initHistogramCanvas } from './render/dashboard';
import { bakeSprites } from './render/sprites';
import { applyTick, createRenderer, paintInit, startOverlayAnimation } from './render/renderer';
import { GRASS_PARAMS, HERBIVORE_PARAMS } from './sim/params';
import { BOARD_HEIGHT, BOARD_WIDTH, DEFAULT_EPOCH_MS, DEFAULT_TICK_MS, TILE_SIZE } from './types';
import type { Histograms, WorkerToMain } from './types';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const hudTick = document.querySelector<HTMLSpanElement>('#hud-tick')!;
const hudDirty = document.querySelector<HTMLSpanElement>('#hud-dirty')!;
const hudEpoch = document.querySelector<HTMLSpanElement>('#hud-epoch')!;
const hudPop = document.querySelector<HTMLSpanElement>('#hud-pop')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;

const histGrassCanvas = document.querySelector<HTMLCanvasElement>('#hist-grass')!;
const histHungerCanvas = document.querySelector<HTMLCanvasElement>('#hist-hunger')!;
const histAgeCanvas = document.querySelector<HTMLCanvasElement>('#hist-age')!;

// Cap at 2x: sharp enough to fix glyph blur on HiDPI screens without
// ballooning the canvas backing store on very high (e.g. 3x) displays.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const sheet = bakeSprites(TILE_SIZE * dpr);
const renderer = createRenderer(canvas, sheet, BOARD_WIDTH, BOARD_HEIGHT, TILE_SIZE, DEFAULT_TICK_MS);

// Debug/tuning dashboard (docs/manual.html section 6): live distributions,
// not part of the sim's own visual model. One accent color per species so the
// two herbivore panels read as the same population at a glance.
const HIST_W = 220;
const HIST_H = 120;
const GRASS_COLOR = '#6fbf73';
const HERBIVORE_COLOR = '#d99a4e';
for (const c of [histGrassCanvas, histHungerCanvas, histAgeCanvas]) {
  initHistogramCanvas(c, HIST_W, HIST_H, dpr);
}

function drawDashboard(histograms: Histograms): void {
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
}

const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });

let paused = false;

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
      drawDashboard(msg.histograms);
      worker.postMessage({ type: 'start' });
      break;
    case 'tick': {
      const repainted = applyTick(renderer, msg.dirty, msg.herbivores, msg.carnivores, msg.carcasses, msg.predations);
      hudTick.textContent = `tick: ${msg.tickCount}`;
      hudDirty.textContent = `dirty: ${repainted} / ${BOARD_WIDTH * BOARD_HEIGHT}`;
      hudPop.textContent = `herbivores: ${msg.herbivores.count} / carnivores: ${msg.carnivores.count}`;
      drawDashboard(msg.histograms);
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
