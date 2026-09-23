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

function lerpTuple(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function toCss(c: readonly [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function lerpColor(a: readonly [number, number, number], b: readonly [number, number, number], t: number): string {
  return toCss(lerpTuple(a, b, t));
}

function bucketColor(bucket: number): string {
  const t = COLOR_BUCKETS <= 1 ? 0 : bucket / (COLOR_BUCKETS - 1);
  return lerpColor(SOIL_COLOR, LUSH_COLOR, t);
}

// A carcass starts a fresh, visceral red and fades toward the same dull soil
// tone grass grows from -- the color drains out of it as it decomposes.
export const CARCASS_FRESH_COLOR: readonly [number, number, number] = [0xb2, 0x3a, 0x3a];
export const CARCASS_DECAYED_COLOR: readonly [number, number, number] = SOIL_COLOR;

// ============================================================
// Animal shapes: a shared box-body + rectangular-mouth plan (see docs/design
// memo), differentiated per species only by proportions/markings. Baked as
// an [animation frame] x [hunger bucket] sprite strip per species, always
// drawn facing right -- left-facing individuals are mirrored at blit time in
// renderer.ts, not baked separately, since a horizontal flip is free.
// ============================================================

const HERBIVORE_HEALTHY: [number, number, number] = [0xff, 0xd8, 0x3d];
const HERBIVORE_HUNGRY: [number, number, number] = [0x8f, 0x7d, 0x52];
const CARNIVORE_HEALTHY: [number, number, number] = [0xf2, 0xa3, 0x3a];
const CARNIVORE_HUNGRY: [number, number, number] = [0x8a, 0x5a, 0x3a];
const MOUTH_COLOR: [number, number, number] = [0x9c, 0x5c, 0x4f]; // dusty rose-brown, not black
const TIGER_MOUTH_COLOR: [number, number, number] = [0xc2, 0x3b, 0x3b]; // red
const STRIPE_COLOR: [number, number, number] = [0x33, 0x1c, 0x12]; // warm near-black brown, not flat black

export const ANIMAL_ANIM_FRAMES = 8;
export const ANIMAL_HUNGER_BUCKETS = 5;

// hunger: 0 = just ate, 1 = starving (see HerbivoreState/CarnivoreState).
export function hungerToBucket(hunger: number): number {
  const clamped = Math.max(0, Math.min(1, hunger));
  return Math.round(clamped * (ANIMAL_HUNGER_BUCKETS - 1));
}

interface Pose {
  bob: number;
  squash: number;
  earAngle: number;
  mouthOpen: number;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawFeet(ctx: CanvasRenderingContext2D, bw: number, bh: number, r: number, color: string, radiusFactor: number): void {
  ctx.fillStyle = color;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(-bw * 0.55, side * bh * 0.85, r * radiusFactor, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Rectangular mouth: the short side (height) stretches open to read as
// eating. No teeth and no eyes anywhere in this visual language -- the mouth
// and body motion carry the whole read.
function drawMouth(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  r: number,
  mouthOpen: number,
  color: string,
  openAmount: number,
  widen: number,
): void {
  const mouthW = r * (0.36 + widen * mouthOpen);
  const mouthH = r * (0.07 + openAmount * mouthOpen);
  ctx.fillStyle = color;
  roundRectPath(ctx, mx - mouthW / 2, my - mouthH / 2, mouthW, mouthH, mouthH * 0.4);
  ctx.fill();
}

// Local space: forward = +x, "down" (mouth side) = +y. Always drawn facing
// +x -- the renderer mirrors left-facing individuals at blit time.
function drawHerbivoreShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, pose: Pose, tint: number): void {
  const r = size / 2;
  const bodyTuple = lerpTuple(HERBIVORE_HEALTHY, HERBIVORE_HUNGRY, tint);
  const earColor = toCss(lerpTuple(bodyTuple, SOIL_COLOR, 0.18));
  const footColor = toCss(lerpTuple(bodyTuple, SOIL_COLOR, 0.35));

  ctx.save();
  ctx.translate(cx, cy + pose.bob * r);
  const sx = 1 + pose.squash;
  const sy = 1 - pose.squash * 0.8;
  ctx.scale(sx, sy);

  // Rounder than the tiger -- soft, no sharp edges, reads as easy to eat.
  const bw = r * 0.72;
  const bh = r * 0.7;
  const cr = r * 0.5;

  drawFeet(ctx, bw, bh, r, footColor, 0.16);

  ctx.fillStyle = earColor;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(-bw * 0.7, side * bh * 0.95);
    ctx.rotate(side * 0.5 + pose.earAngle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.05, -side * r * 0.34);
    ctx.lineTo(r * 0.22, -side * r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = toCss(bodyTuple);
  roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, cr);
  ctx.fill();

  drawMouth(ctx, bw * 0.78, bh * 0.4, r, pose.mouthOpen, toCss(MOUTH_COLOR), 0.3, 0);

  ctx.restore();
}

function drawTigerShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, pose: Pose, tint: number): void {
  const r = size / 2;
  const bodyTuple = lerpTuple(CARNIVORE_HEALTHY, CARNIVORE_HUNGRY, tint);
  const earColor = toCss(lerpTuple(bodyTuple, SOIL_COLOR, 0.25));
  const footColor = toCss(lerpTuple(bodyTuple, SOIL_COLOR, 0.35));

  ctx.save();
  ctx.translate(cx, cy + pose.bob * r);
  const sx = 1 + pose.squash;
  const sy = 1 - pose.squash * 0.8;
  ctx.scale(sx, sy);

  // Leaner and less rounded than the herbivore -- a sharper silhouette.
  const bw = r * 0.88;
  const bh = r * 0.6;
  const cr = r * 0.22;

  drawFeet(ctx, bw, bh, r, footColor, 0.18);

  ctx.fillStyle = earColor;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(-bw * 0.62, side * bh * 0.85);
    ctx.rotate(side * 0.4 + pose.earAngle);
    ctx.beginPath();
    ctx.moveTo(-r * 0.16, side * r * 0.14);
    ctx.lineTo(0, -side * r * 0.32);
    ctx.lineTo(r * 0.16, side * r * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = toCss(bodyTuple);
  roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, cr);
  ctx.fill();

  // stripes: short diagonal marks, warm dark brown, not flat black
  ctx.strokeStyle = toCss(STRIPE_COLOR);
  ctx.lineWidth = r * 0.1;
  ctx.lineCap = 'round';
  for (const sOff of [-0.5, -0.1, 0.3]) {
    ctx.beginPath();
    ctx.moveTo(sOff * bw, -bh * 0.75);
    ctx.lineTo(sOff * bw - r * 0.16, bh * 0.75);
    ctx.stroke();
  }

  drawMouth(ctx, bw * 0.82, bh * 0.4, r, pose.mouthOpen, toCss(TIGER_MOUTH_COLOR), 0.55, 0.18);

  ctx.restore();
}

// Herbivores are almost always foraging in this sim, so the ambient loop
// bakes in one visible nibble per cycle. Carnivores only actually bite on a
// predation event we don't get a signal for (see renderer.ts), so their loop
// stays a subtler idle/alert posture rather than faking a constant chomp.
const HERBIVORE_POSES: readonly Pose[] = [
  { bob: 0.0, squash: 0.0, earAngle: 0.0, mouthOpen: 0.06 },
  { bob: 0.02, squash: 0.0, earAngle: 0.04, mouthOpen: 0.06 },
  { bob: 0.03, squash: 0.0, earAngle: 0.08, mouthOpen: 0.08 },
  { bob: 0.02, squash: 0.05, earAngle: 0.04, mouthOpen: 0.3 },
  { bob: -0.01, squash: 0.12, earAngle: -0.02, mouthOpen: 0.55 },
  { bob: 0.0, squash: 0.05, earAngle: 0.02, mouthOpen: 0.3 },
  { bob: 0.02, squash: 0.0, earAngle: 0.06, mouthOpen: 0.08 },
  { bob: 0.01, squash: 0.0, earAngle: 0.02, mouthOpen: 0.06 },
];

const TIGER_POSES: readonly Pose[] = [
  { bob: 0.0, squash: 0.0, earAngle: 0.0, mouthOpen: 0.04 },
  { bob: 0.015, squash: 0.0, earAngle: 0.05, mouthOpen: 0.04 },
  { bob: 0.02, squash: 0.0, earAngle: 0.1, mouthOpen: 0.05 },
  { bob: 0.01, squash: -0.03, earAngle: 0.05, mouthOpen: 0.08 },
  { bob: -0.01, squash: 0.04, earAngle: -0.05, mouthOpen: 0.12 },
  { bob: 0.0, squash: 0.0, earAngle: -0.02, mouthOpen: 0.06 },
  { bob: 0.015, squash: 0.0, earAngle: 0.03, mouthOpen: 0.05 },
  { bob: 0.01, squash: 0.0, earAngle: 0.01, mouthOpen: 0.04 },
];

function bakeAnimalSheet(
  tileSize: number,
  poses: readonly Pose[],
  drawShape: (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, pose: Pose, tint: number) => void,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ANIMAL_ANIM_FRAMES * tileSize;
  canvas.height = ANIMAL_HUNGER_BUCKETS * tileSize;
  const ctx = canvas.getContext('2d')!;
  for (let b = 0; b < ANIMAL_HUNGER_BUCKETS; b++) {
    const tint = ANIMAL_HUNGER_BUCKETS <= 1 ? 0 : b / (ANIMAL_HUNGER_BUCKETS - 1);
    for (let f = 0; f < ANIMAL_ANIM_FRAMES; f++) {
      const pose = poses[f] ?? poses[0]!;
      const cx = f * tileSize + tileSize / 2;
      const cy = b * tileSize + tileSize / 2;
      drawShape(ctx, cx, cy, tileSize * 0.92, pose, tint);
    }
  }
  return canvas;
}

export interface SpriteSheet {
  tileSize: number;
  grassCanvas: HTMLCanvasElement;
  herbivoreCanvas: HTMLCanvasElement; // [frame] x [hunger bucket] strip, always facing +x
  carnivoreCanvas: HTMLCanvasElement; // same layout
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

  const herbivoreCanvas = bakeAnimalSheet(tileSize, HERBIVORE_POSES, drawHerbivoreShape);
  const carnivoreCanvas = bakeAnimalSheet(tileSize, TIGER_POSES, drawTigerShape);

  return { tileSize, grassCanvas, herbivoreCanvas, carnivoreCanvas, grassCols: heights, grassRows: COLOR_BUCKETS };
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

export function animalSpriteRect(sheet: SpriteSheet, frame: number, hungerBucket: number) {
  return {
    sx: frame * sheet.tileSize,
    sy: hungerBucket * sheet.tileSize,
    sw: sheet.tileSize,
    sh: sheet.tileSize,
  };
}
