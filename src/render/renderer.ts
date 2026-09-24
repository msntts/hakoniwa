import { CARCASS_PARAMS } from '../sim/params';
import type { CarcassSnapshot, CarnivoreSnapshot, DirtyTile, HerbivoreSnapshot } from '../types';
import {
  ANIMAL_ANIM_FRAMES,
  animalSpriteRect,
  drawCarcassSprite,
  grassSpriteRect,
  hungerToBucket,
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
  count: 0,
};
const emptyCarnivores: CarnivoreSnapshot = {
  x: new Int16Array(0),
  y: new Int16Array(0),
  hunger: new Float32Array(0),
  id: new Uint32Array(0),
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
  // Last-landed position + facing per stable individual id, carried across
  // ticks so herbFromX/carnFromX and herbFacing/carnFacing can look an
  // individual up by identity instead of by array index. Rebuilt fresh each
  // tick (see computeGlide) from the current snapshot, so a dead
  // individual's entry is naturally dropped rather than accumulating.
  herbPrevById: Map<number, GlideEntry>;
  carnPrevById: Map<number, GlideEntry>;
}

export interface GlideEntry {
  x: number;
  y: number;
  facing: number;
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
    herbPrevById: new Map(),
    carnPrevById: new Map(),
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

// Builds this tick's from*/facing arrays (index-aligned with the incoming
// snapshot) by looking each individual up in `prevById` by its stable id,
// not by reusing whatever sat at the same array index last tick -- see the
// RendererState.herbFromX/herbPrevById doc comments for why that distinction
// matters. Also returns the id->position/facing map for the *next* tick's
// lookup, rebuilt fresh so ids no longer present (deaths) fall out on their
// own instead of accumulating.
export function computeGlide(
  ids: Uint32Array,
  toX: Int16Array,
  toY: Int16Array,
  count: number,
  prevById: Map<number, GlideEntry>,
  boardWidth: number,
): { fromX: Array<number | undefined>; fromY: Array<number | undefined>; facing: Int8Array; nextById: Map<number, GlideEntry> } {
  const fromX: Array<number | undefined> = new Array(count);
  const fromY: Array<number | undefined> = new Array(count);
  const facing = new Int8Array(count);
  const nextById = new Map<number, GlideEntry>();
  for (let k = 0; k < count; k++) {
    const id = ids[k] ?? 0;
    const tx = toX[k] ?? 0;
    const ty = toY[k] ?? 0;
    const prev = prevById.get(id);
    let f = 1; // birth (or first frame ever): no previous position, no fallback facing to inherit
    if (prev) {
      fromX[k] = prev.x;
      fromY[k] = prev.y;
      f = facingFromDelta(tx, prev.x, boardWidth, prev.facing);
    }
    facing[k] = f;
    nextById.set(id, { x: tx, y: ty, facing: f });
  }
  return { fromX, fromY, facing, nextById };
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
  progress: number,
  nowMs: number,
): void {
  const baseFrame = Math.floor(nowMs / HERBIVORE_FRAME_MS) % ANIMAL_ANIM_FRAMES;
  for (let k = 0; k < herbivores.count; k++) {
    const toX = herbivores.x[k] ?? 0;
    const toY = herbivores.y[k] ?? 0;
    const ix = interpAxis(fromX[k], toX, r.width, progress);
    const iy = interpAxis(fromY[k], toY, r.height, progress);
    const bucket = hungerToBucket(herbivores.hunger[k] ?? 0);
    // Desync neighboring individuals so a herd doesn't nibble in lockstep.
    const frame = (baseFrame + k * 3) % ANIMAL_ANIM_FRAMES;
    const rect = animalSpriteRect(r.sheet, frame, bucket);
    const facing = r.herbFacing[k] ?? 1;
    drawFacingSprite(r.ctx, r.sheet.herbivoreCanvas, rect, ix * r.sheet.tileSize, iy * r.sheet.tileSize, r.sheet.tileSize, facing);
  }
}

function drawAnimatedCarnivores(
  r: RendererState,
  carnivores: CarnivoreSnapshot,
  fromX: Array<number | undefined>,
  fromY: Array<number | undefined>,
  progress: number,
  nowMs: number,
): void {
  const baseFrame = Math.floor(nowMs / CARNIVORE_FRAME_MS) % ANIMAL_ANIM_FRAMES;
  for (let k = 0; k < carnivores.count; k++) {
    const toX = carnivores.x[k] ?? 0;
    const toY = carnivores.y[k] ?? 0;
    const ix = interpAxis(fromX[k], toX, r.width, progress);
    const iy = interpAxis(fromY[k], toY, r.height, progress);
    const bucket = hungerToBucket(carnivores.hunger[k] ?? 0);
    const frame = (baseFrame + k * 3) % ANIMAL_ANIM_FRAMES;
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

// Repaints just the overlay layer (carcasses + animals) against the current
// animation phase, at whatever cadence the caller drives it -- once per sim
// tick from applyTick (so a tick's move/death/birth shows immediately) and
// continuously from the rAF loop started by startOverlayAnimation (so idle
// motion reads smoothly between ticks). Grass beneath a vacated tile is
// repainted here too, same as the old single tick-driven repaint used to do.
function paintOverlayFrame(r: RendererState, nowMs: number): void {
  const progress = r.tickDurationMs > 0 ? Math.min(1, Math.max(0, (nowMs - r.tickStartMs) / r.tickDurationMs)) : 1;
  const currOverlayTiles = overlayTileSet(r, r.herbivores, r.carnivores, r.carcasses, progress);

  const repaint = new Set<number>();
  for (const i of r.prevOverlayTiles) repaint.add(i);
  for (const i of currOverlayTiles) repaint.add(i);
  for (const i of repaint) paintGrassTile(r, i);

  drawCarcasses(r, r.carcasses);
  drawAnimatedHerbivores(r, r.herbivores, r.herbFromX, r.herbFromY, progress, nowMs);
  drawAnimatedCarnivores(r, r.carnivores, r.carnFromX, r.carnFromY, progress, nowMs);

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
  // No previous-tick positions yet, so everything appears at rest (no glide)
  // and faces right by default -- computeGlide does this on its own when
  // prevById is empty.
  const herbGlide = computeGlide(herbivores.id, herbivores.x, herbivores.y, herbivores.count, new Map(), r.width);
  const carnGlide = computeGlide(carnivores.id, carnivores.x, carnivores.y, carnivores.count, new Map(), r.width);
  r.herbFromX = herbGlide.fromX;
  r.herbFromY = herbGlide.fromY;
  r.herbFacing = herbGlide.facing;
  r.herbPrevById = herbGlide.nextById;
  r.carnFromX = carnGlide.fromX;
  r.carnFromY = carnGlide.fromY;
  r.carnFacing = carnGlide.facing;
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
  for (const d of dirty) {
    r.colorBucket[d.i] = d.color;
    r.heightCat[d.i] = d.height;
  }
  for (const d of dirty) paintGrassTile(r, d.i);

  // herbPrevById/carnPrevById hold each individual's last-landed position by
  // stable id (not array index -- see the type's doc comment for why that
  // distinction is the whole point), so this glide always starts from where
  // *that same animal* actually was, even if a same-tick death elsewhere
  // reshuffled the array via swap-remove.
  const herbGlide = computeGlide(herbivores.id, herbivores.x, herbivores.y, herbivores.count, r.herbPrevById, r.width);
  const carnGlide = computeGlide(carnivores.id, carnivores.x, carnivores.y, carnivores.count, r.carnPrevById, r.width);
  r.herbFromX = herbGlide.fromX;
  r.herbFromY = herbGlide.fromY;
  r.herbFacing = herbGlide.facing;
  r.herbPrevById = herbGlide.nextById;
  r.carnFromX = carnGlide.fromX;
  r.carnFromY = carnGlide.fromY;
  r.carnFacing = carnGlide.facing;
  r.carnPrevById = carnGlide.nextById;
  r.herbivores = herbivores;
  r.carnivores = carnivores;
  r.carcasses = carcasses;
  r.tickStartMs = performance.now();

  // Paint immediately too (not just on the next animation frame) so a tick's
  // move/death/birth never waits on the rAF loop to show up -- this first
  // frame lands at progress 0, i.e. still drawn at the old position, and the
  // rAF loop then glides it to the new one over the coming tick.
  paintOverlayFrame(r, r.tickStartMs);

  return dirty.length;
}
