import { GRASS_PARAMS } from '../sim/params';
import { TILE_SIZE } from '../types';

const HEIGHT_GLYPHS = [' ', '.', 'w', 'W'];
const COLOR_BUCKETS = GRASS_PARAMS.colorBuckets;

// bucket 0 = bare/dry soil, bucket max = lush green.
const SOIL_COLOR: [number, number, number] = [0x3b, 0x2f, 0x22];
const LUSH_COLOR: [number, number, number] = [0x3f, 0xbf, 0x3f];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function lerpColor(a: readonly [number, number, number], b: readonly [number, number, number], t: number): string {
  return `rgb(${lerp(a[0], b[0], t)},${lerp(a[1], b[1], t)},${lerp(a[2], b[2], t)})`;
}

function bucketColor(bucket: number): string {
  const t = COLOR_BUCKETS <= 1 ? 0 : bucket / (COLOR_BUCKETS - 1);
  return lerpColor(SOIL_COLOR, LUSH_COLOR, t);
}

// A carcass starts a fresh, visceral red and fades toward the same dull soil
// tone grass grows from -- the color drains out of it as it decomposes.
export const CARCASS_FRESH_COLOR: readonly [number, number, number] = [0xb2, 0x3a, 0x3a];
export const CARCASS_DECAYED_COLOR: readonly [number, number, number] = SOIL_COLOR;

export interface SpriteSheet {
  tileSize: number;
  grassCanvas: HTMLCanvasElement;
  animalCanvas: HTMLCanvasElement;
  grassCols: number;
  grassRows: number;
}

export function bakeSprites(tileSize: number = TILE_SIZE): SpriteSheet {
  const heights = HEIGHT_GLYPHS.length;
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = heights * tileSize;
  grassCanvas.height = COLOR_BUCKETS * tileSize;
  const gctx = grassCanvas.getContext('2d')!;
  gctx.textAlign = 'center';
  gctx.textBaseline = 'middle';
  gctx.font = `bold ${Math.floor(tileSize * 0.85)}px monospace`;

  for (let bucket = 0; bucket < COLOR_BUCKETS; bucket++) {
    for (let h = 0; h < heights; h++) {
      const x = h * tileSize;
      const y = bucket * tileSize;
      gctx.fillStyle = bucketColor(bucket);
      gctx.fillRect(x, y, tileSize, tileSize);
      const glyph = HEIGHT_GLYPHS[h];
      if (glyph && glyph !== ' ') {
        gctx.fillStyle = '#e8e8d8';
        gctx.fillText(glyph, x + tileSize / 2, y + tileSize / 2 + 1, tileSize);
      }
    }
  }

  const animalCanvas = document.createElement('canvas');
  animalCanvas.width = tileSize;
  animalCanvas.height = tileSize;
  const actx = animalCanvas.getContext('2d')!;
  actx.clearRect(0, 0, tileSize, tileSize);
  actx.fillStyle = '#f2c400';
  actx.beginPath();
  const r = tileSize * 0.32;
  actx.arc(tileSize / 2, tileSize / 2, r, 0, Math.PI * 2);
  actx.fill();

  return { tileSize, grassCanvas, animalCanvas, grassCols: heights, grassRows: COLOR_BUCKETS };
}

// Carcasses fade continuously rather than stepping through a handful of
// baked buckets, so (unlike grass/animal glyphs) they're drawn on demand
// each frame instead of blitted from a pre-baked sheet. Carcass counts are
// small even during a mass die-off, so per-frame fillText is cheap here.
export function drawCarcassGlyph(ctx: CanvasRenderingContext2D, tileSize: number, x: number, y: number, color: string): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.floor(tileSize * 0.85)}px monospace`;
  ctx.fillStyle = color;
  ctx.fillText('x', x * tileSize + tileSize / 2, y * tileSize + tileSize / 2 + 1, tileSize);
}

export function grassSpriteRect(sheet: SpriteSheet, colorBucket: number, height: number) {
  return {
    sx: height * sheet.tileSize,
    sy: colorBucket * sheet.tileSize,
    sw: sheet.tileSize,
    sh: sheet.tileSize,
  };
}
