import type { PredationEvent } from '../sim/carnivore';
import { createSimState, tick, type SimState } from '../sim/loop';
import type { CarcassSnapshot, CarnivoreSnapshot, HerbivoreSnapshot, MainToWorker, PredationSnapshot, WorkerToMain } from '../types';

let state: SimState | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  (postMessage as (m: WorkerToMain, t: Transferable[]) => void)(msg, transfer);
}

function herdSnapshot(s: SimState): HerbivoreSnapshot {
  // Structured-clone copies, not transfers: the worker keeps owning the live
  // typed arrays across ticks, so we can't hand off their buffers.
  return {
    x: s.herd.x.slice(0, s.herd.count),
    y: s.herd.y.slice(0, s.herd.count),
    hunger: s.herd.hunger.slice(0, s.herd.count),
    id: s.herd.id.slice(0, s.herd.count),
    rest: s.herd.rest.slice(0, s.herd.count),
    count: s.herd.count,
  };
}

function predatorSnapshot(s: SimState): CarnivoreSnapshot {
  return {
    x: s.predators.x.slice(0, s.predators.count),
    y: s.predators.y.slice(0, s.predators.count),
    hunger: s.predators.hunger.slice(0, s.predators.count),
    id: s.predators.id.slice(0, s.predators.count),
    rest: s.predators.rest.slice(0, s.predators.count),
    count: s.predators.count,
  };
}

function carcassSnapshot(s: SimState): CarcassSnapshot {
  return {
    x: s.carcasses.x.slice(0, s.carcasses.count),
    y: s.carcasses.y.slice(0, s.carcasses.count),
    age: s.carcasses.age.slice(0, s.carcasses.count),
    species: s.carcasses.species.slice(0, s.carcasses.count),
    fromX: s.carcasses.fromX.slice(0, s.carcasses.count),
    fromY: s.carcasses.fromY.slice(0, s.carcasses.count),
    count: s.carcasses.count,
  };
}

function predationSnapshot(events: PredationEvent[]): PredationSnapshot {
  return {
    x: Int16Array.from(events, (e) => e.x),
    y: Int16Array.from(events, (e) => e.y),
    count: events.length,
  };
}

function stopLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function startLoop(): void {
  if (!state || intervalId !== null) return;
  intervalId = setInterval(() => {
    if (!state) return;
    const result = tick(state);
    post({
      type: 'tick',
      tickCount: state.tickCount,
      dirty: result.dirty,
      herbivores: herdSnapshot(state),
      carnivores: predatorSnapshot(state),
      carcasses: carcassSnapshot(state),
      predations: predationSnapshot(result.predations),
    });
    if (result.epoch !== undefined) {
      post({ type: 'epoch', epochIndex: result.epoch });
    }
  }, state.tickIntervalMs);
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      stopLoop();
      state = createSimState(msg.width, msg.height, msg.tickMs, msg.epochMs, msg.seed);
      const biomass = state.grass.biomass.slice();
      const height = state.grass.height.slice();
      const colorBucket = state.grass.colorBucket.slice();
      post(
        {
          type: 'init-done',
          width: state.board.width,
          height: state.board.height,
          grass: { biomass, height, colorBucket },
          herbivores: herdSnapshot(state),
          carnivores: predatorSnapshot(state),
          carcasses: carcassSnapshot(state),
        },
        [biomass.buffer, height.buffer, colorBucket.buffer],
      );
      break;
    }
    case 'start':
      startLoop();
      break;
    case 'pause':
      stopLoop();
      break;
    case 'resume':
      startLoop();
      break;
    case 'set-tick-rate':
      if (state) {
        state.tickIntervalMs = msg.ms;
        if (intervalId !== null) {
          stopLoop();
          startLoop();
        }
      }
      break;
  }
};

post({ type: 'ready' });
