import { CARCASS_PARAMS } from '../sim/params';
import type { CarcassSnapshot, CarnivoreSnapshot, DirtyTile, HerbivoreSnapshot } from '../types';
import { CARCASS_DECAYED_COLOR, CARCASS_FRESH_COLOR, drawCarcassGlyph, grassSpriteRect, lerpColor, type SpriteSheet } from './sprites';

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

function drawHerbivoreSprites(r: RendererState, herbivores: HerbivoreSnapshot): void {
  for (let k = 0; k < herbivores.count; k++) {
    const x = herbivores.x[k] ?? 0;
    const y = herbivores.y[k] ?? 0;
    r.ctx.drawImage(r.sheet.herbivoreCanvas, x * r.sheet.tileSize, y * r.sheet.tileSize);
  }
}

function drawCarnivoreSprites(r: RendererState, carnivores: CarnivoreSnapshot): void {
  for (let k = 0; k < carnivores.count; k++) {
    const x = carnivores.x[k] ?? 0;
    const y = carnivores.y[k] ?? 0;
    r.ctx.drawImage(r.sheet.carnivoreCanvas, x * r.sheet.tileSize, y * r.sheet.tileSize);
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
  drawCarcasses(r, carcasses);
  drawHerbivoreSprites(r, herbivores);
  drawCarnivoreSprites(r, carnivores);
  r.prevOverlayTiles = overlayTileSet(r, herbivores, carnivores, carcasses);
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

  const currOverlayTiles = overlayTileSet(r, herbivores, carnivores, carcasses);

  // Repaint every tile whose grass changed, plus every tile that had (or now
  // has) an animal/carcass on it -- otherwise a vacated tile leaves a ghost
  // glyph behind on grass whose color/height didn't itself change this tick.
  const repaint = new Set<number>();
  for (const d of dirty) repaint.add(d.i);
  for (const i of r.prevOverlayTiles) repaint.add(i);
  for (const i of currOverlayTiles) repaint.add(i);

  for (const i of repaint) paintGrassTile(r, i);
  drawCarcasses(r, carcasses);
  drawHerbivoreSprites(r, herbivores);
  drawCarnivoreSprites(r, carnivores);

  r.prevOverlayTiles = currOverlayTiles;
  return repaint.size;
}
