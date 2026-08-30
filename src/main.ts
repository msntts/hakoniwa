import { bakeSprites } from './render/sprites';
import { applyTick, createRenderer, paintInit } from './render/renderer';
import { BOARD_HEIGHT, BOARD_WIDTH, DEFAULT_EPOCH_MS, DEFAULT_TICK_MS, TILE_SIZE } from './types';
import type { WorkerToMain } from './types';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const hudTick = document.querySelector<HTMLSpanElement>('#hud-tick')!;
const hudDirty = document.querySelector<HTMLSpanElement>('#hud-dirty')!;
const hudEpoch = document.querySelector<HTMLSpanElement>('#hud-epoch')!;
const hudPop = document.querySelector<HTMLSpanElement>('#hud-pop')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;

const sheet = bakeSprites(TILE_SIZE);
const renderer = createRenderer(canvas, sheet, BOARD_WIDTH, BOARD_HEIGHT);

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
      paintInit(renderer, msg.grass, msg.herbivores);
      hudPop.textContent = `herbivores: ${msg.herbivores.count}`;
      worker.postMessage({ type: 'start' });
      break;
    case 'tick': {
      const repainted = applyTick(renderer, msg.dirty, msg.herbivores);
      hudTick.textContent = `tick: ${msg.tickCount}`;
      hudDirty.textContent = `dirty: ${repainted} / ${BOARD_WIDTH * BOARD_HEIGHT}`;
      hudPop.textContent = `herbivores: ${msg.herbivores.count}`;
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
