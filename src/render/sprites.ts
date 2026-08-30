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

function bucketColor(bucket: number): string {
  const t = COLOR_BUCKETS <= 1 ? 0 : bucket / (COLOR_BUCKETS - 1);
  const r = lerp(SOIL_COLOR[0], LUSH_COLOR[0], t);
  const g = lerp(SOIL_COLOR[1], LUSH_COLOR[1], t);
  const b = lerp(SOIL_COLOR[2], LUSH_COLOR[2], t);
  return `rgb(${r},${g},${b})`;
}

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
  gctx.font = `${Math.floor(tileSize * 0.85)}px monospace`;

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

export function grassSpriteRect(sheet: SpriteSheet, colorBucket: number, height: number) {
  return {
    sx: height * sheet.tileSize,
    sy: colorBucket * sheet.tileSize,
    sw: sheet.tileSize,
    sh: sheet.tileSize,
  };
}
