import { CARCASS_PARAMS, CARNIVORE_PARAMS, HERBIVORE_PARAMS } from '../sim/params';
import type { CarcassSnapshot, CarnivoreSnapshot, DirtyTile, HerbivoreSnapshot } from '../types';
import {
  animalSpriteRect,
  drawCarcassSprite,
  grassSpriteRect,
  hungerToBucket,
  pickAnimalFrame,
  type SpriteSheet,
} from './sprites';

// One loop through the baked pose strip, in ms -- independent of the sim
// tick rate (DEFAULT_TICK_MS). Slightly different per species so a mixed
// herd doesn't animate in lockstep.
const HERBIVORE_FRAME_MS = 140;
const CARNIVORE_FRAME_MS = 170;

const emptyHerbivores: HerbivoreSnapshot = {
  x: new Int16Array(0),
  y: new Int16Array(0),
  hunger: new Float32Array(0),
  id: new Uint32Array(0),
  rest: new Uint8Array(0),
  count: 0,
};
const emptyCarnivores: CarnivoreSnapshot = {
  x: new Int16Array(0),
  y: new Int16Array(0),
  hunger: new Float32Array(0),
  id: new Uint32Array(0),
  rest: new Uint8Array(0),
  count: 0,
};
const emptyCarcasses: CarcassSnapshot = {
  x: new Int16Array(0),
  y: new Int16Array(0),
  age: new Uint16Array(0),
  species: new Uint8Array(0),
  count: 0,
};

export interface RendererState {
  ctx: CanvasRenderingContext2D;
  sheet: SpriteSheet;
  width: number;
  height: number;
  colorBucket: Uint8Array;
  heightCat: Uint8Array;
  // Tiles carrying a top-layer glyph last frame (live animal or carcass) --
  // needed so a tile that loses its occupant gets its grass repainted to
  // erase the stale glyph, same idea for all of them since they share the layer.
  prevOverlayTiles: Set<number>;
  // Latest snapshots (this tick's landing spot), cached so the animation
  // loop can keep drawing animals (idle bob, mouth nibble) between sim
  // ticks, not just when a tick arrives.
  herbivores: HerbivoreSnapshot;
  carnivores: CarnivoreSnapshot;
  carcasses: CarcassSnapshot;
  // The "from" side of this tick's walk/glide interpolation (herbivores/
  // carnivores above is the "to" side), aligned index-for-index with the
  // *current* snapshot -- herbFromX[k]/herbFromY[k] is where herbivores.x[k]/
  // y[k]'s individual glides from. undefined at index k means no known
  // previous position (a birth), so it's drawn at rest, no glide. Computed
  // via id lookup (see herbPrevById below), not by reusing last tick's array
  // position at the same index -- swap-remove on death reshuffles indices,
  // so "index k last tick" and "index k this tick" can be two unrelated
  // individuals, which used to show up as a wrong pair gliding across the
  // whole board between their unrelated positions.
  herbFromX: Array<number | undefined>;
  herbFromY: Array<number | undefined>;
  carnFromX: Array<number | undefined>;
  carnFromY: Array<number | undefined>;
  // performance.now() when herbivores/carnivores/carcasses last landed, plus
  // how long (ms) a tick is meant to span -- together these turn "now" into
  // the 0..1 progress used to glide from the from* arrays to herbivores over
  // the full tick instead of jump-cutting there (see docs/manual.html #s5).
  tickStartMs: number;
  tickDurationMs: number;
  // Facing per current individual (+1 = drawn as baked, -1 = mirrored),
  // aligned with herbivores/carnivores the same way herbFromX/carnFromX are.
  herbFacing: Int8Array;
  carnFacing: Int8Array;
  // Whether this individual is actually sitting still digesting *this* tick
  // (see computeGlide's doc comment on the one-tick phase shift) -- gates the
  // bite animation loop, and for carnivores also draws the being-eaten prey
  // ghost underneath them.
  herbEating: Uint8Array;
  carnEating: Uint8Array;
  // Last-landed position + facing + rest per stable individual id, carried
  // across ticks so herbFromX/carnFromX, herbFacing/carnFacing and
  // herbEating/carnEating can look an individual up by identity instead of by
  // array index. Rebuilt fresh each tick (see computeGlide) from the current
  // snapshot, so a dead individual's entry is naturally dropped rather than
  // accumulating.
  herbPrevById: Map<number, GlideEntry>;
  carnPrevById: Map<number, GlideEntry>;
  // Grass-tile changes from the tick just applied, held back from
  // colorBucket/heightCat until that tick's glide finishes (progress 1, see
  // paintOverlayFrame) -- otherwise a grazed tile visually emptied the
  // instant the tick landed, while the herbivore that ate it was still
  // mid-walk toward the tile. Committing on arrival instead makes the visual
  // order move -> eat -> grass shrinks, matching what actually causes what.
  pendingDirty: DirtyTile[];
}

export interface GlideEntry {
  x: number;
  y: number;
  facing: number;
  // This individual's HerbivoreState.rest/CarnivoreState.rest as reported in
  // the tick that produced this entry. Looked up *one tick late* (see
  // computeGlide's `eating` output) so the bite/being-eaten visuals land on
  // the tick where the individual is actually sitting still digesting, not
  // the tick where it was still walking toward the bite.
  rest: number;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  sheet: SpriteSheet,
  width: number,
  height: number,
  cssTileSize: number = sheet.tileSize,
  tickDurationMs: number = 0,
): RendererState {
  // Backing store is sized in device pixels (sheet.tileSize, which callers
  // scale by devicePixelRatio) while the CSS box stays at the logical tile
  // size -- otherwise glyphs render blurry on high-DPI screens.
  canvas.width = width * sheet.tileSize;
  canvas.height = height * sheet.tileSize;
  canvas.style.width = `${width * cssTileSize}px`;
  canvas.style.height = `${height * cssTileSize}px`;
  const ctx = canvas.getContext('2d')!;
  return {
    ctx,
    sheet,
    width,
    height,
    colorBucket: new Uint8Array(width * height),
    heightCat: new Uint8Array(width * height),
    prevOverlayTiles: new Set(),
    herbivores: emptyHerbivores,
    carnivores: emptyCarnivores,
    carcasses: emptyCarcasses,
    herbFromX: [],
    herbFromY: [],
    carnFromX: [],
    carnFromY: [],
    tickStartMs: 0,
    tickDurationMs,
    herbFacing: new Int8Array(0),
    carnFacing: new Int8Array(0),
    herbEating: new Uint8Array(0),
    carnEating: new Uint8Array(0),
    herbPrevById: new Map(),
    carnPrevById: new Map(),
    pendingDirty: [],
  };
}

function paintGrassTile(r: RendererState, i: number): void {
  const x = i % r.width;
  const y = Math.floor(i / r.width);
  const rect = grassSpriteRect(r.sheet, r.colorBucket[i] ?? 0, r.heightCat[i] ?? 0);
  r.ctx.drawImage(
    r.sheet.grassCanvas,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    x * r.sheet.tileSize,
    y * r.sheet.tileSize,
    r.sheet.tileSize,
    r.sheet.tileSize,
  );
}

// Board wraps horizontally (see board.ts wrap()), so a step across the seam
// (e.g. x=79 -> x=0) must not read as "moved left".
function facingFromDelta(currX: number, prevX: number, boardWidth: number, fallback: number): number {
  let dx = currX - prevX;
  if (dx > boardWidth / 2) dx -= boardWidth;
  else if (dx < -boardWidth / 2) dx += boardWidth;
  if (dx > 0) return 1;
  if (dx < 0) return -1;
  return fallback;
}

// Interpolates one axis from a previous-tick coordinate to this tick's,
// taking the board's wrap into account the same way facingFromDelta does
// (shortest way around, not always increasing). `fromV` is undefined only
// for an id with no previous-tick counterpart at all (a birth) -- that
// individual just appears at its landing tile with no glide, same as the
// existing facing fallback.
function interpAxis(fromV: number | undefined, toV: number, max: number, progress: number): number {
  if (fromV === undefined) return toV;
  let d = toV - fromV;
  if (d > max / 2) d -= max;
  else if (d < -max / 2) d += max;
  const v = fromV + d * progress;
  return ((v % max) + max) % max;
}

// Builds this tick's from*/facing/eating arrays (index-aligned with the
// incoming snapshot) by looking each individual up in `prevById` by its
// stable id, not by reusing whatever sat at the same array index last tick --
// see the RendererState.herbFromX/herbPrevById doc comments for why that
// distinction matters. Also returns the id->position/facing/rest map for the
// *next* tick's lookup, rebuilt fresh so ids no longer present (deaths) fall
// out on their own instead of accumulating.
//
// `eating` is deliberately read from *last* tick's rest (prev.rest), not
// this tick's `rest` array -- a bite and the move that lands on its tile
// happen in the very same sim tick (see sim/herbivore.ts, sim/carnivore.ts),
// so the tick that reports the fresh rest>0 is still the one gliding *toward*
// the food; the individual doesn't actually sit still digesting until the
// *following* tick, whose own incoming rest has already ticked back down.
// Shifting the read by one tick this way makes the bite/being-eaten visuals
// land on the tick where the individual is actually stationary.
//
// Within that, `eating` only fires on the *first* such tick (prev.rest ===
// maxRest, the value a fresh bite sets it to), not for every tick the
// individual has rest > 0. With restTicksAfterEating at 1 today the two are
// the same thing, but they diverge the moment that's raised above 1: without
// this distinction, a longer rest reads as a longer *bite* (mouth
// open/closing every one of those ticks), which is backwards -- only the
// tick right after landing the bite is actually chewing; the remaining rest
// ticks are just standing still, already fed, and should fall back to the
// (mouth-closed) walk loop like any other stationary tick.
export function computeGlide(
  ids: Uint32Array,
  toX: Int16Array,
  toY: Int16Array,
  rest: Uint8Array,
  count: number,
  prevById: Map<number, GlideEntry>,
  boardWidth: number,
  maxRest: number,
): {
  fromX: Array<number | undefined>;
  fromY: Array<number | undefined>;
  facing: Int8Array;
  eating: Uint8Array;
  nextById: Map<number, GlideEntry>;
} {
  const fromX: Array<number | undefined> = new Array(count);
  const fromY: Array<number | undefined> = new Array(count);
  const facing = new Int8Array(count);
  const eating = new Uint8Array(count);
  const nextById = new Map<number, GlideEntry>();
  for (let k = 0; k < count; k++) {
    const id = ids[k] ?? 0;
    const tx = toX[k] ?? 0;
    const ty = toY[k] ?? 0;
    const tr = rest[k] ?? 0;
    const prev = prevById.get(id);
    let f = 1; // birth (or first frame ever): no previous position, no fallback facing to inherit
    if (prev) {
      fromX[k] = prev.x;
      fromY[k] = prev.y;
      f = facingFromDelta(tx, prev.x, boardWidth, prev.facing);
      eating[k] = prev.rest === maxRest ? 1 : 0;
    }
    facing[k] = f;
    nextById.set(id, { x: tx, y: ty, facing: f, rest: tr });
  }
  return { fromX, fromY, facing, eating, nextById };
}

// Live animals take priority over a carcass on the same tile (design.md:
// animals are always the top layer), so carcasses are drawn first and
// animals painted over them. Between the two animal layers, carnivores paint
// last (on top of herbivores) -- the rarer case is the one worth seeing.
function drawCarcasses(r: RendererState, carcasses: CarcassSnapshot): void {
  const decayTicks = CARCASS_PARAMS.decayTicks;
  for (let k = 0; k < carcasses.count; k++) {
    const x = carcasses.x[k] ?? 0;
    const y = carcasses.y[k] ?? 0;
    const t = Math.min(1, (carcasses.age[k] ?? 0) / decayTicks);
    const species = carcasses.species[k] ?? 0;
    drawCarcassSprite(r.ctx, r.sheet.tileSize, x, y, species, t);
  }
}

// facing >= 0 blits the baked (rightward-facing) frame as-is; facing < 0
// mirrors it around the tile's own center, so a horizontal flip is free --
// no separate leftward sprite sheet needed.
function drawFacingSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  rect: { sx: number; sy: number; sw: number; sh: number },
  dx: number,
  dy: number,
  size: number,
  facing: number,
): void {
  if (facing >= 0) {
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, size, size);
    return;
  }
  ctx.save();
  ctx.translate(dx + size, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, size, size);
  ctx.restore();
}

function drawAnimatedHerbivores(
  r: RendererState,
  herbivores: HerbivoreSnapshot,
  fromX: Array<number | undefined>,
  fromY: Array<number | undefined>,
  eating: Uint8Array,
  progress: number,
  nowMs: number,
): void {
  const baseFrame = Math.floor(nowMs / HERBIVORE_FRAME_MS);
  for (let k = 0; k < herbivores.count; k++) {
    const toX = herbivores.x[k] ?? 0;
    const toY = herbivores.y[k] ?? 0;
    const ix = interpAxis(fromX[k], toX, r.width, progress);
    const iy = interpAxis(fromY[k], toY, r.height, progress);
    const bucket = hungerToBucket(herbivores.hunger[k] ?? 0);
    // Desync neighboring individuals so a herd doesn't nibble in lockstep.
    // Which loop plays (calm walk vs. bite) is driven by eating[k] -- last
    // tick's rest, looked up by id in computeGlide -- not this tick's, so the
    // bite plays while stationary, not while still walking toward the food.
    const frame = pickAnimalFrame(baseFrame + k * 3, eating[k] === 1);
    const rect = animalSpriteRect(r.sheet, frame, bucket);
    const facing = r.herbFacing[k] ?? 1;
    drawFacingSprite(r.ctx, r.sheet.herbivoreCanvas, rect, ix * r.sheet.tileSize, iy * r.sheet.tileSize, r.sheet.tileSize, facing);
  }
}

// Stand-in for whichever herbivore a carnivore just caught -- the sim
// doesn't report the victim's identity or pose to the renderer (it's already
// removed by the time the tick is serialized), and a specific likeness
// doesn't matter for a shape that's visibly shrinking away under its
// predator. Shown for exactly the tick the carnivore spends stationary
// digesting (carnEating[k], see computeGlide), fading and shrinking across
// that tick's progress so it reads as being consumed, not just deleted.
function drawPreyGhost(ctx: CanvasRenderingContext2D, sheet: SpriteSheet, ix: number, iy: number, progress: number): void {
  const rect = animalSpriteRect(sheet, 0, 2);
  const size = sheet.tileSize;
  const cx = ix * size + size / 2;
  const cy = iy * size + size / 2;
  const scale = 1 - progress * 0.6;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.drawImage(sheet.herbivoreCanvas, rect.sx, rect.sy, rect.sw, rect.sh, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawAnimatedCarnivores(
  r: RendererState,
  carnivores: CarnivoreSnapshot,
  fromX: Array<number | undefined>,
  fromY: Array<number | undefined>,
  eating: Uint8Array,
  progress: number,
  nowMs: number,
): void {
  const baseFrame = Math.floor(nowMs / CARNIVORE_FRAME_MS);
  for (let k = 0; k < carnivores.count; k++) {
    const toX = carnivores.x[k] ?? 0;
    const toY = carnivores.y[k] ?? 0;
    const ix = interpAxis(fromX[k], toX, r.width, progress);
    const iy = interpAxis(fromY[k], toY, r.height, progress);
    const bucket = hungerToBucket(carnivores.hunger[k] ?? 0);
    const isEating = eating[k] === 1;
    if (isEating) drawPreyGhost(r.ctx, r.sheet, ix, iy, progress);
    // Bite loop plays exactly while this individual is sitting on its kill
    // (see the eating[k] doc comment above) -- previously there was no such
    // signal at all, so carnivores never showed a visible bite.
    const frame = pickAnimalFrame(baseFrame + k * 3, isEating);
    const rect = animalSpriteRect(r.sheet, frame, bucket);
    const facing = r.carnFacing[k] ?? 1;
    drawFacingSprite(r.ctx, r.sheet.carnivoreCanvas, rect, ix * r.sheet.tileSize, iy * r.sheet.tileSize, r.sheet.tileSize, facing);
  }
}

// A gliding animal's sprite sits at a fractional tile coordinate, so it can
// overlap up to 2x2 grid tiles instead of exactly one -- add all of them, or
// the tile it's mid-crossing into never gets its grass repainted underneath.
function addInterpolatedTiles(
  tiles: Set<number>,
  width: number,
  height: number,
  toX: Int16Array,
  toY: Int16Array,
  fromX: Array<number | undefined>,
  fromY: Array<number | undefined>,
  count: number,
  progress: number,
): void {
  for (let k = 0; k < count; k++) {
    const ix = interpAxis(fromX[k], toX[k] ?? 0, width, progress);
    const iy = interpAxis(fromY[k], toY[k] ?? 0, height, progress);
    const x0 = Math.floor(ix) % width;
    const y0 = Math.floor(iy) % height;
    const x1 = (x0 + 1) % width;
    const y1 = (y0 + 1) % height;
    tiles.add(y0 * width + x0);
    tiles.add(y0 * width + x1);
    tiles.add(y1 * width + x0);
    tiles.add(y1 * width + x1);
  }
}

function overlayTileSet(
  r: RendererState,
  herbivores: HerbivoreSnapshot,
  carnivores: CarnivoreSnapshot,
  carcasses: CarcassSnapshot,
  progress: number,
): Set<number> {
  const tiles = new Set<number>();
  addInterpolatedTiles(tiles, r.width, r.height, herbivores.x, herbivores.y, r.herbFromX, r.herbFromY, herbivores.count, progress);
  addInterpolatedTiles(tiles, r.width, r.height, carnivores.x, carnivores.y, r.carnFromX, r.carnFromY, carnivores.count, progress);
  for (let k = 0; k < carcasses.count; k++) {
    tiles.add((carcasses.y[k] ?? 0) * r.width + (carcasses.x[k] ?? 0));
  }
  return tiles;
}

// Applies and paints whatever grass-tile changes were held back from the
// tick that just finished gliding in (see RendererState.pendingDirty) --
// called once progress reaches 1, i.e. right as that tick's animals actually
// arrive at their new tiles.
function commitPendingDirty(r: RendererState): void {
  for (const d of r.pendingDirty) {
    r.colorBucket[d.i] = d.color;
    r.heightCat[d.i] = d.height;
  }
  for (const d of r.pendingDirty) paintGrassTile(r, d.i);
  r.pendingDirty = [];
}

// Repaints just the overlay layer (carcasses + animals) against the current
// animation phase, at whatever cadence the caller drives it -- once per sim
// tick from applyTick (so a tick's move/death/birth shows immediately) and
// continuously from the rAF loop started by startOverlayAnimation (so idle
// motion reads smoothly between ticks). Grass beneath a vacated tile is
// repainted here too, same as the old single tick-driven repaint used to do.
function paintOverlayFrame(r: RendererState, nowMs: number): void {
  const progress = r.tickDurationMs > 0 ? Math.min(1, Math.max(0, (nowMs - r.tickStartMs) / r.tickDurationMs)) : 1;
  // Runs even while paused (this loop never stops, see startOverlayAnimation)
  // so a tick's grass change still lands the moment its glide finishes,
  // rather than waiting on a next tick that may not come for a while.
  if (progress >= 1 && r.pendingDirty.length > 0) commitPendingDirty(r);

  const currOverlayTiles = overlayTileSet(r, r.herbivores, r.carnivores, r.carcasses, progress);

  const repaint = new Set<number>();
  for (const i of r.prevOverlayTiles) repaint.add(i);
  for (const i of currOverlayTiles) repaint.add(i);
  for (const i of repaint) paintGrassTile(r, i);

  drawCarcasses(r, r.carcasses);
  drawAnimatedHerbivores(r, r.herbivores, r.herbFromX, r.herbFromY, r.herbEating, progress, nowMs);
  drawAnimatedCarnivores(r, r.carnivores, r.carnFromX, r.carnFromY, r.carnEating, progress, nowMs);

  r.prevOverlayTiles = currOverlayTiles;
}

// Starts a requestAnimationFrame loop that keeps the overlay layer animating
// (idle bob, mouth nibble) between sim ticks, decoupled from the tick rate.
// Runs regardless of sim pause state -- pausing only stops the simulation
// clock, not the ambient motion of what's already on the board (design.md:
// pause is "observe only", not "freeze frame").
export function startOverlayAnimation(r: RendererState): () => void {
  let cancelled = false;
  let rafId = 0;
  function frame(nowMs: number): void {
    if (cancelled) return;
    paintOverlayFrame(r, nowMs);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}

export function paintInit(
  r: RendererState,
  grass: { biomass: Float32Array; height: Uint8Array; colorBucket: Uint8Array },
  herbivores: HerbivoreSnapshot,
  carnivores: CarnivoreSnapshot,
  carcasses: CarcassSnapshot,
): void {
  r.colorBucket.set(grass.colorBucket);
  r.heightCat.set(grass.height);
  const n = r.width * r.height;
  for (let i = 0; i < n; i++) paintGrassTile(r, i);

  r.herbivores = herbivores;
  r.carnivores = carnivores;
  r.carcasses = carcasses;
  // No previous-tick positions yet, so everything appears at rest (no glide),
  // faces right, and shows no bite -- computeGlide does all three on its own
  // when prevById is empty.
  const herbGlide = computeGlide(herbivores.id, herbivores.x, herbivores.y, herbivores.rest, herbivores.count, new Map(), r.width, HERBIVORE_PARAMS.restTicksAfterEating);
  const carnGlide = computeGlide(carnivores.id, carnivores.x, carnivores.y, carnivores.rest, carnivores.count, new Map(), r.width, CARNIVORE_PARAMS.restTicksAfterEating);
  r.herbFromX = herbGlide.fromX;
  r.herbFromY = herbGlide.fromY;
  r.herbFacing = herbGlide.facing;
  r.herbEating = herbGlide.eating;
  r.herbPrevById = herbGlide.nextById;
  r.carnFromX = carnGlide.fromX;
  r.carnFromY = carnGlide.fromY;
  r.carnFacing = carnGlide.facing;
  r.carnEating = carnGlide.eating;
  r.carnPrevById = carnGlide.nextById;
  r.tickStartMs = performance.now();

  paintOverlayFrame(r, r.tickStartMs);
}

export function applyTick(
  r: RendererState,
  dirty: DirtyTile[],
  herbivores: HerbivoreSnapshot,
  carnivores: CarnivoreSnapshot,
  carcasses: CarcassSnapshot,
): number {
  // The previous tick's grass changes should have already committed at
  // progress 1 during its own glide (see paintOverlayFrame) -- but if a new
  // tick ever lands before that happened (e.g. the sim tick rate outruns
  // tickDurationMs), flush it now rather than silently overwrite/lose it.
  if (r.pendingDirty.length > 0) commitPendingDirty(r);
  // This tick's own grass changes are *not* applied yet -- held back until
  // its glide reaches progress 1 (see paintOverlayFrame/commitPendingDirty),
  // so a grazed tile only visibly empties once the herbivore that ate it has
  // actually finished walking there instead of the instant the tick lands.
  r.pendingDirty = dirty;

  // herbPrevById/carnPrevById hold each individual's last-landed position (+
  // facing + rest) by stable id (not array index -- see the type's doc
  // comment for why that distinction is the whole point), so this glide
  // always starts from where *that same animal* actually was, even if a
  // same-tick death elsewhere reshuffled the array via swap-remove.
  const herbGlide = computeGlide(herbivores.id, herbivores.x, herbivores.y, herbivores.rest, herbivores.count, r.herbPrevById, r.width, HERBIVORE_PARAMS.restTicksAfterEating);
  const carnGlide = computeGlide(carnivores.id, carnivores.x, carnivores.y, carnivores.rest, carnivores.count, r.carnPrevById, r.width, CARNIVORE_PARAMS.restTicksAfterEating);
  r.herbFromX = herbGlide.fromX;
  r.herbFromY = herbGlide.fromY;
  r.herbFacing = herbGlide.facing;
  r.herbEating = herbGlide.eating;
  r.herbPrevById = herbGlide.nextById;
  r.carnFromX = carnGlide.fromX;
  r.carnFromY = carnGlide.fromY;
  r.carnFacing = carnGlide.facing;
  r.carnEating = carnGlide.eating;
  r.carnPrevById = carnGlide.nextById;
  r.herbivores = herbivores;
  r.carnivores = carnivores;
  r.carcasses = carcasses;
  r.tickStartMs = performance.now();

  // Paint immediately too (not just on the next animation frame) so a tick's
  // move/death/birth never waits on the rAF loop to show up -- this first
  // frame lands at progress 0, i.e. still drawn at the old position with the
  // old grass, and the rAF loop then glides position (and, on arrival, grass
  // and bite state) forward over the coming tick.
  paintOverlayFrame(r, r.tickStartMs);

  return dirty.length;
}
