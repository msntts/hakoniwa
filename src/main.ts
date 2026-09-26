import { bakeSprites } from './render/sprites';
import { applyTick, createRenderer, paintInit, setTickDuration, startOverlayAnimation } from './render/renderer';
import { clampSpeed, speedToTickMs } from './speed';
import { BOARD_HEIGHT, BOARD_WIDTH, DEFAULT_EPOCH_MS, DEFAULT_SPEED, DEFAULT_TICK_MS, SPEED_MAX, SPEED_MIN, SPEED_STEP, TILE_SIZE } from './types';
import type { WorkerToMain } from './types';

const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const hudTick = document.querySelector<HTMLSpanElement>('#hud-tick')!;
const hudDirty = document.querySelector<HTMLSpanElement>('#hud-dirty')!;
const hudEpoch = document.querySelector<HTMLSpanElement>('#hud-epoch')!;
const hudPop = document.querySelector<HTMLSpanElement>('#hud-pop')!;
const hudSpeed = document.querySelector<HTMLSpanElement>('#hud-speed')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const btnSpeedDown = document.querySelector<HTMLButtonElement>('#btn-speed-down')!;
const btnSpeedUp = document.querySelector<HTMLButtonElement>('#btn-speed-up')!;

// Cap at 2x: sharp enough to fix glyph blur on HiDPI screens without
// ballooning the canvas backing store on very high (e.g. 3x) displays.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const sheet = bakeSprites(TILE_SIZE * dpr);
const renderer = createRenderer(canvas, sheet, BOARD_WIDTH, BOARD_HEIGHT, TILE_SIZE, DEFAULT_TICK_MS);

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
      worker.postMessage({ type: 'start' });
      break;
    case 'tick': {
      const repainted = applyTick(renderer, msg.dirty, msg.herbivores, msg.carnivores, msg.carcasses, msg.predations);
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

btnSpeedDown.addEventListener('click', () => applySpeed(speed - SPEED_STEP));
btnSpeedUp.addEventListener('click', () => applySpeed(speed + SPEED_STEP));
