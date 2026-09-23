import { CARCASS_PARAMS } from '../sim/params';
import type { CarcassSnapshot, CarnivoreSnapshot, DirtyTile, HerbivoreSnapshot } from '../types';
import {
  ANIMAL_ANIM_FRAMES,
  animalSpriteRect,
  CARCASS_DECAYED_COLOR,
  CARCASS_FRESH_COLOR,
  drawCarcassGlyph,
  grassSpriteRect,
  hungerToBucket,
  lerpColor,
  type SpriteSheet,
} from './sprites';

// One loop through the baked pose strip, in ms -- independent of the sim
// tick rate (DEFAULT_TICK_MS). Slightly different per species so a mixed
// herd doesn't animate in lockstep.
const HERBIVORE_FRAME_MS = 140;
const CARNIVORE_FRAME_MS = 170;

const emptyHerbivores: HerbivoreSnapshot = { x: new Int16Array(0), y: new Int16Array(0), hunger: new Float32Array(0), count: 0 };
const emptyCarnivores: CarnivoreSnapshot = { x: new Int16Array(0), y: new Int16Array(0), hunger: new Float32Array(0), count: 0 };
const emptyCarcasses: CarcassSnapshot = { x: new Int16Array(0), y: new Int16Array(0), age: new Uint16Array(0), count: 0 };

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
  // Latest snapshots, cached so the animation loop can keep drawing animals
  // (idle bob, mouth nibble) between sim ticks, not just when a tick arrives.
  herbivores: HerbivoreSnapshot;
  carnivores: CarnivoreSnapshot;
  carcasses: CarcassSnapshot;
  // Index-aligned facing (+1 = drawn as baked, -1 = mirrored). There's no
  // stable per-individual id in HerbivoreState/CarnivoreState (death uses
  // swap-remove), so this occasionally mis-attributes for one tick right
  // when a death reshuffles indices -- a cosmetic, self-correcting glitch.
  herbFacing: Int8Array;
  carnFacing: Int8Array;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  sheet: SpriteSheet,
  width: number,
  height: number,
  cssTileSize: number = sheet.tileSize,
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
    herbFacing: new Int8Array(0),
    carnFacing: new Int8Array(0),
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

// Index-aligned with the incoming snapshot, not identity-aligned with the
// previous one -- see the RendererState.herbFacing/carnFacing doc comment.
function computeFacing(currX: Int16Array, count: number, prevX: Int16Array, prevFacing: Int8Array, boardWidth: number): Int8Array {
  const facing = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    const cx = currX[i] ?? 0;
    const px = prevX[i];
    const fallback = prevFacing[i] ?? 1;
    facing[i] = px === undefined ? fallback : facingFromDelta(cx, px, boardWidth, fallback);
  }
  return facing;
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
    const color = lerpColor(CARCASS_FRESH_COLOR, CARCASS_DECAYED_COLOR, t);
    drawCarcassGlyph(r.ctx, r.sheet.tileSize, x, y, color);
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

function drawAnimatedHerbivores(r: RendererState, herbivores: HerbivoreSnapshot, nowMs: number): void {
  const baseFrame = Math.floor(nowMs / HERBIVORE_FRAME_MS) % ANIMAL_ANIM_FRAMES;
  for (let k = 0; k < herbivores.count; k++) {
    const x = herbivores.x[k] ?? 0;
    const y = herbivores.y[k] ?? 0;
    const bucket = hungerToBucket(herbivores.hunger[k] ?? 0);
    // Desync neighboring individuals so a herd doesn't nibble in lockstep.
    const frame = (baseFrame + k * 3) % ANIMAL_ANIM_FRAMES;
    const rect = animalSpriteRect(r.sheet, frame, bucket);
    const facing = r.herbFacing[k] ?? 1;
    drawFacingSprite(r.ctx, r.sheet.herbivoreCanvas, rect, x * r.sheet.tileSize, y * r.sheet.tileSize, r.sheet.tileSize, facing);
  }
}

function drawAnimatedCarnivores(r: RendererState, carnivores: CarnivoreSnapshot, nowMs: number): void {
  const baseFrame = Math.floor(nowMs / CARNIVORE_FRAME_MS) % ANIMAL_ANIM_FRAMES;
  for (let k = 0; k < carnivores.count; k++) {
    const x = carnivores.x[k] ?? 0;
    const y = carnivores.y[k] ?? 0;
    const bucket = hungerToBucket(carnivores.hunger[k] ?? 0);
    const frame = (baseFrame + k * 3) % ANIMAL_ANIM_FRAMES;
    const rect = animalSpriteRect(r.sheet, frame, bucket);
    const facing = r.carnFacing[k] ?? 1;
    drawFacingSprite(r.ctx, r.sheet.carnivoreCanvas, rect, x * r.sheet.tileSize, y * r.sheet.tileSize, r.sheet.tileSize, facing);
  }
}

function overlayTileSet(
  r: RendererState,
  herbivores: HerbivoreSnapshot,
  carnivores: CarnivoreSnapshot,
  carcasses: CarcassSnapshot,
): Set<number> {
  const tiles = new Set<number>();
  for (let k = 0; k < herbivores.count; k++) {
    tiles.add((herbivores.y[k] ?? 0) * r.width + (herbivores.x[k] ?? 0));
  }
  for (let k = 0; k < carnivores.count; k++) {
    tiles.add((carnivores.y[k] ?? 0) * r.width + (carnivores.x[k] ?? 0));
  }
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
  const currOverlayTiles = overlayTileSet(r, r.herbivores, r.carnivores, r.carcasses);

  const repaint = new Set<number>();
  for (const i of r.prevOverlayTiles) repaint.add(i);
  for (const i of currOverlayTiles) repaint.add(i);
  for (const i of repaint) paintGrassTile(r, i);

  drawCarcasses(r, r.carcasses);
  drawAnimatedHerbivores(r, r.herbivores, nowMs);
  drawAnimatedCarnivores(r, r.carnivores, nowMs);

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
  r.herbFacing = new Int8Array(herbivores.count).fill(1);
  r.carnFacing = new Int8Array(carnivores.count).fill(1);

  paintOverlayFrame(r, performance.now());
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

  r.herbFacing = computeFacing(herbivores.x, herbivores.count, r.herbivores.x, r.herbFacing, r.width);
  r.carnFacing = computeFacing(carnivores.x, carnivores.count, r.carnivores.x, r.carnFacing, r.width);
  r.herbivores = herbivores;
  r.carnivores = carnivores;
  r.carcasses = carcasses;

  // Paint immediately too (not just on the next animation frame) so a tick's
  // move/death/birth never waits on the rAF loop to show up.
  paintOverlayFrame(r, performance.now());

  return dirty.length;
}
