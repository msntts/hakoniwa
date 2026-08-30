import type { DirtyTile, HerbivoreSnapshot } from '../types';
import { grassSpriteRect, type SpriteSheet } from './sprites';

export interface RendererState {
  ctx: CanvasRenderingContext2D;
  sheet: SpriteSheet;
  width: number;
  height: number;
  colorBucket: Uint8Array;
  heightCat: Uint8Array;
  prevAnimalTiles: Set<number>;
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
    prevAnimalTiles: new Set(),
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

function animalTileSet(r: RendererState, herbivores: HerbivoreSnapshot): Set<number> {
  const tiles = new Set<number>();
  for (let k = 0; k < herbivores.count; k++) {
    const x = herbivores.x[k] ?? 0;
    const y = herbivores.y[k] ?? 0;
    tiles.add(y * r.width + x);
  }
  return tiles;
}

function drawAnimalSprites(r: RendererState, herbivores: HerbivoreSnapshot): void {
  for (let k = 0; k < herbivores.count; k++) {
    const x = herbivores.x[k] ?? 0;
    const y = herbivores.y[k] ?? 0;
    r.ctx.drawImage(r.sheet.animalCanvas, x * r.sheet.tileSize, y * r.sheet.tileSize);
  }
}

export function paintInit(
  r: RendererState,
  grass: { biomass: Float32Array; height: Uint8Array; colorBucket: Uint8Array },
  herbivores: HerbivoreSnapshot,
): void {
  r.colorBucket.set(grass.colorBucket);
  r.heightCat.set(grass.height);
  const n = r.width * r.height;
  for (let i = 0; i < n; i++) paintGrassTile(r, i);
  drawAnimalSprites(r, herbivores);
  r.prevAnimalTiles = animalTileSet(r, herbivores);
}

export function applyTick(r: RendererState, dirty: DirtyTile[], herbivores: HerbivoreSnapshot): number {
  for (const d of dirty) {
    r.colorBucket[d.i] = d.color;
    r.heightCat[d.i] = d.height;
  }

  const currAnimalTiles = animalTileSet(r, herbivores);

  // Repaint every tile whose grass changed, plus every tile that had (or now
  // has) an animal on it -- otherwise a moved-off animal leaves a ghost glyph
  // behind on a tile whose grass color/height didn't itself change this tick.
  const repaint = new Set<number>();
  for (const d of dirty) repaint.add(d.i);
  for (const i of r.prevAnimalTiles) repaint.add(i);
  for (const i of currAnimalTiles) repaint.add(i);

  for (const i of repaint) paintGrassTile(r, i);
  drawAnimalSprites(r, herbivores);

  r.prevAnimalTiles = currAnimalTiles;
  return repaint.size;
}
