export const BOARD_WIDTH = 80;
export const BOARD_HEIGHT = 45;
// CSS-pixel tile size. design.md's 16px candidate ("文字も動物記号も余裕") --
// the 12px candidate was tried first but glyphs like `W` were unreadable mush
// once actually rendered at that size.
export const TILE_SIZE = 16;

// 4x a raw sim step's worth of time (was 500ms): eating/hunting only read as
// legible "scenes" once each animal has enough on-screen time per turn to
// glide into its new tile instead of jump-cutting there (see renderer.ts's
// from/to position interpolation). Slowing this down also slows the sim's
// real-time progression by the same 4x -- intentional, not a side effect.
export const DEFAULT_TICK_MS = 2000;
export const DEFAULT_EPOCH_MS = 10_000;

// Speed control: multiplies how often ticks land in real time by scaling the
// worker's setInterval delay (tickMs / speed) -- sim step logic itself never
// changes, so 2x just means the same ticks arrive twice as often. Because
// each tick still advances msSinceEpochStart by its own (now smaller) real
// interval, an epoch keeps landing every 10 real seconds at any speed (see
// docs/manual.html #s1's "実時間は変わらない"); only the per-tick pace of
// hunger/movement/etc speeds up or down. 4x lands back on the pre-slowdown
// 500ms tick (see DEFAULT_TICK_MS's history); 0.5x is slow enough to study a
// single tick's effect without pausing outright.
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 4;
export const SPEED_STEP = 0.5;
export const DEFAULT_SPEED = 1;

export interface HerbivoreSnapshot {
  x: Int16Array;
  y: Int16Array;
  hunger: Float32Array;
  // Stable per-individual id (see sim/herbivore.ts HerbivoreState.id) -- the
  // renderer uses this, not array index, to match an individual to its
  // previous-tick position for glide/facing (index alone breaks across a
  // same-tick death's swap-remove).
  id: Uint32Array;
  // Ticks left resting after a bite (see HerbivoreState.rest) -- >0 is the
  // renderer's only signal that this individual is actually eating right
  // now, as opposed to just walking; it picks the bite animation over the
  // idle walk cycle on that basis (render/sprites.ts).
  rest: Uint8Array;
  count: number;
}

// Same shape as HerbivoreSnapshot today -- kept as its own type since the two
// species' state is conceptually distinct and may diverge later.
export interface CarnivoreSnapshot {
  x: Int16Array;
  y: Int16Array;
  hunger: Float32Array;
  id: Uint32Array;
  rest: Uint8Array;
  count: number;
}

export interface CarcassSnapshot {
  x: Int16Array;
  y: Int16Array;
  age: Uint16Array;
  species: Uint8Array; // 0 = herbivore, 1 = carnivore -- see CARCASS_SPECIES
  // Where the individual was standing before the tick it died (see
  // sim/carcass.ts CarcassState.fromX/fromY) -- only meaningful while
  // age === 0, the one tick the renderer glides the carcass in from here
  // instead of popping it straight into x/y.
  fromX: Int16Array;
  fromY: Int16Array;
  count: number;
}

export interface DirtyTile {
  i: number;
  color: number;
  height: number;
}

// One entry per herbivore a carnivore caught this tick, at the tile it was
// caught on (see sim/carnivore.ts's PredationEvent). No id, no species field
// -- a kill leaves no carcass (see CarcassSnapshot's doc comment), so this is
// the only signal the renderer gets that "an animal was eaten here, right
// now" -- it draws a generic herbivore likeness fading away at that exact
// position, synced to *this* tick (not delayed to the next one, unlike the
// bite-animation rest signal above -- a caught individual is already gone
// from herbivores by the time this message is built, so there's no "wait
// until it's actually standing still" tick to delay to).
export interface PredationSnapshot {
  x: Int16Array;
  y: Int16Array;
  count: number;
}

// Dashboard-only aggregates (sim/stats.ts's computeHistogram), sent alongside
// the normal per-tick snapshots so main.ts can draw a live distribution
// without shipping every tile's biomass or every individual's hunger/age over
// the wire each tick. Each array has HISTOGRAM_BINS equal-width buckets
// covering a fixed domain: grassBiomass over [0, GRASS_PARAMS.capacity],
// herbivoreHunger over [0, HERBIVORE_PARAMS.starvationHunger], herbivoreAge
// over [0, HERBIVORE_PARAMS.lifespanTicks].
export interface Histograms {
  grassBiomass: Uint32Array;
  herbivoreHunger: Uint32Array;
  herbivoreAge: Uint32Array;
}

// Board-wide sums (sim/stats.ts's sumArray over the full grass arrays), sent
// alongside Histograms so the dashboard can plot a running total-over-time
// line -- distinct from a histogram's *distribution* at a single tick, this
// is the single number needed to see whether the system's material is net
// growing/shrinking/stable across many ticks (docs/manual.html section 2's
// "質量は保存されない" means neither total is guaranteed to hold steady by
// construction; this is what lets that be *observed* instead of assumed).
export interface Totals {
  grassBiomass: number;
  fertility: number;
}

export type MainToWorker =
  | { type: 'init'; width: number; height: number; tickMs: number; epochMs: number; seed?: number }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'set-tick-rate'; ms: number };

export type WorkerToMain =
  | { type: 'ready' }
  | {
      type: 'init-done';
      width: number;
      height: number;
      grass: { biomass: Float32Array; height: Uint8Array; colorBucket: Uint8Array };
      herbivores: HerbivoreSnapshot;
      carnivores: CarnivoreSnapshot;
      carcasses: CarcassSnapshot;
      histograms: Histograms;
      totals: Totals;
    }
  | {
      type: 'tick';
      tickCount: number;
      dirty: DirtyTile[];
      herbivores: HerbivoreSnapshot;
      carnivores: CarnivoreSnapshot;
      carcasses: CarcassSnapshot;
      predations: PredationSnapshot;
      histograms: Histograms;
      totals: Totals;
    }
  | { type: 'epoch'; epochIndex: number };
