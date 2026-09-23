import { bakeSprites } from './render/sprites';
import { applyTick, createRenderer, paintInit, startOverlayAnimation } from './render/renderer';
import { BOARD_HEIGHT, BOARD_WIDTH, DEFAULT_EPOCH_MS, DEFAULT_TICK_MS, TILE_SIZE } from './types';
import type { WorkerToMain } from './types';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const hudTick = document.querySelector<HTMLSpanElement>('#hud-tick')!;
const hudDirty = document.querySelector<HTMLSpanElement>('#hud-dirty')!;
const hudEpoch = document.querySelector<HTMLSpanElement>('#hud-epoch')!;
const hudPop = document.querySelector<HTMLSpanElement>('#hud-pop')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;

// Cap at 2x: sharp enough to fix glyph blur on HiDPI screens without
// ballooning the canvas backing store on very high (e.g. 3x) displays.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const sheet = bakeSprites(TILE_SIZE * dpr);
const renderer = createRenderer(canvas, sheet, BOARD_WIDTH, BOARD_HEIGHT, TILE_SIZE, DEFAULT_TICK_MS);

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
      worker.postMessage({ type: 'start' });
      break;
    case 'tick': {
      const repainted = applyTick(renderer, msg.dirty, msg.herbivores, msg.carnivores, msg.carcasses);
      hudTick.textContent = `tick: ${msg.tickCount}`;
      hudDirty.textContent = `dirty: ${repainted} / ${BOARD_WIDTH * BOARD_HEIGHT}`;
      hudPop.textContent = `herbivores: ${msg.herbivores.count} / carnivores: ${msg.carnivores.count}`;
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
