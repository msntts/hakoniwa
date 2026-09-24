import { GRASS_PARAMS } from '../sim/params';
import { TILE_SIZE } from '../types';

const GRASS_HEIGHTS = 4; // 0 = bare soil .. 3 = lush, see grass.ts heightFor()
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
// Grass tile illustration: a handful of tapered blade shapes drawn per
// [height category] x [color bucket], replacing the old ascii glyph. Height 0
// (bare soil) draws no blades at all -- just a couple of dry flecks -- same
// as the old blank glyph. Baked once per bucket/height combination and
// reused across every tile sharing that combination (there is no per-tile
// variation, matching the old glyph's behavior).
// ============================================================

const BLADE_DRY: [number, number, number] = [0x9a, 0x8a, 0x4a];
const BLADE_LUSH: [number, number, number] = [0x2f, 0x9e, 0x3a];
const BLADE_HIGHLIGHT: [number, number, number] = [0xe6, 0xf5, 0xb0];
const BARE_SPECK_COLOR = '#241b12';

function bladeColor(t: number, highlight: boolean): string {
  const base = lerpTuple(BLADE_DRY, BLADE_LUSH, t);
  return highlight ? toCss(lerpTuple(base, BLADE_HIGHLIGHT, 0.4)) : toCss(base);
}

interface BladeSpec {
  dx: number; // base x offset, fraction of tileSize from tile center
  h: number; // blade height, fraction of tileSize
  lean: number; // tip x offset from base, fraction of tileSize
  w: number; // base width, fraction of tileSize
  highlight?: boolean;
}

// Indexed by height category (0..3). Heights/leans hand-picked so blades stay
// inside the tile even at the tallest (lush) category.
const GRASS_BLADE_SPECS: readonly (readonly BladeSpec[])[] = [
  [],
  [
    { dx: -0.18, h: 0.3, lean: 0.04, w: 0.1 },
    { dx: 0.02, h: 0.36, lean: -0.03, w: 0.1, highlight: true },
    { dx: 0.2, h: 0.28, lean: 0.05, w: 0.09 },
  ],
  [
    { dx: -0.3, h: 0.4, lean: 0.06, w: 0.1 },
    { dx: -0.12, h: 0.52, lean: -0.05, w: 0.11, highlight: true },
    { dx: 0.02, h: 0.46, lean: 0.04, w: 0.1 },
    { dx: 0.16, h: 0.56, lean: -0.06, w: 0.11, highlight: true },
    { dx: 0.32, h: 0.38, lean: 0.05, w: 0.09 },
  ],
  [
    { dx: -0.34, h: 0.55, lean: 0.08, w: 0.11 },
    { dx: -0.2, h: 0.68, lean: -0.06, w: 0.12, highlight: true },
    { dx: -0.06, h: 0.6, lean: 0.05, w: 0.11 },
    { dx: 0.06, h: 0.74, lean: -0.08, w: 0.12, highlight: true },
    { dx: 0.2, h: 0.62, lean: 0.06, w: 0.11 },
    { dx: 0.34, h: 0.52, lean: -0.05, w: 0.1 },
    { dx: 0.0, h: 0.7, lean: 0.0, w: 0.1, highlight: true },
  ],
];

// A single tapered blade: a base of `width`, curving via `lean` to a point at
// the top. Drawn base-up in tile-local pixel space.
function drawBlade(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, height: number, lean: number, width: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(baseX - width / 2, baseY);
  ctx.quadraticCurveTo(baseX + lean * 0.5, baseY - height * 0.55, baseX + lean, baseY - height);
  ctx.quadraticCurveTo(baseX + lean * 0.5 + width * 0.3, baseY - height * 0.55, baseX + width / 2, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawGrassTile(ctx: CanvasRenderingContext2D, x: number, y: number, tileSize: number, height: number, bucketT: number): void {
  if (height === 0) {
    ctx.fillStyle = BARE_SPECK_COLOR;
    ctx.beginPath();
    ctx.arc(x + tileSize * 0.35, y + tileSize * 0.65, tileSize * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + tileSize * 0.62, y + tileSize * 0.5, tileSize * 0.035, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const cx = x + tileSize / 2;
  const groundY = y + tileSize * 0.86;
  for (const s of GRASS_BLADE_SPECS[height] ?? []) {
    drawBlade(ctx, cx + s.dx * tileSize, groundY, s.h * tileSize, s.lean * tileSize, s.w * tileSize, bladeColor(bucketT, s.highlight ?? false));
  }
}

// ============================================================
// Animal shapes: a shared box-body + rectangular-mouth plan (see docs/design
// memo), differentiated per species only by proportions/markings. Baked as
// an [animation frame] x [hunger bucket] sprite strip per species, always
// drawn facing right -- left-facing individuals are mirrored at blit time in
// renderer.ts, not baked separately, since a horizontal flip is free.
// ============================================================

const HERBIVORE_HEALTHY: [number, number, number] = [0xc9, 0x8a, 0x3d];
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

// The 8 baked frames split into two loops: a calm walk/idle cycle and a
// distinct, more pronounced bite cycle (see HERBIVORE_POSES/TIGER_POSES
// below). The renderer picks which loop to play per individual per frame
// from HerbivoreState.rest/CarnivoreState.rest (>0 means "resting off a bite
// this tick" -- see sim/herbivore.ts, sim/carnivore.ts) instead of always
// playing the walk loop -- that used to be the only loop, so mouth motion
// was constant regardless of whether the individual had actually just eaten,
// which is exactly what made eating unreadable before this existed.
const WALK_FRAME_COUNT = 5;
const BITE_FRAME_COUNT = ANIMAL_ANIM_FRAMES - WALK_FRAME_COUNT;

export function pickAnimalFrame(counter: number, eating: boolean): number {
  if (eating) return WALK_FRAME_COUNT + (((counter % BITE_FRAME_COUNT) + BITE_FRAME_COUNT) % BITE_FRAME_COUNT);
  return ((counter % WALK_FRAME_COUNT) + WALK_FRAME_COUNT) % WALK_FRAME_COUNT;
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
// and body motion carry the whole read. Width is sized relative to the
// body's half-width (bw) rather than the overall radius, and reaches up to
// about half the body's full width at max openness, so it stays legible
// even when the sprite renders small.
function drawMouth(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  bw: number,
  r: number,
  mouthOpen: number,
  color: string,
  openAmount: number,
  baseWidth: number,
  widen: number,
): void {
  const mouthW = bw * (baseWidth + widen * mouthOpen);
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

  drawMouth(ctx, bw * 0.78, bh * 0.4, bw, r, pose.mouthOpen, toCss(MOUTH_COLOR), 0.3, 0.85, 0.3);

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

  drawMouth(ctx, bw * 0.82, bh * 0.4, bw, r, pose.mouthOpen, toCss(TIGER_MOUTH_COLOR), 0.55, 0.75, 0.25);

  ctx.restore();
}

// Frames 0..WALK_FRAME_COUNT-1: calm walk/idle loop -- mouth stays nearly
// closed, only a light bob/ear twitch, since this individual isn't actually
// eating right now. Frames WALK_FRAME_COUNT..: bite loop -- a pronounced,
// unmistakable chomp, played only while HerbivoreState.rest is counting down
// (i.e. exactly the tick(s) it's actually eating). See pickAnimalFrame above.
const HERBIVORE_POSES: readonly Pose[] = [
  { bob: 0.0, squash: 0.0, earAngle: 0.0, mouthOpen: 0.03 },
  { bob: 0.02, squash: 0.0, earAngle: 0.04, mouthOpen: 0.04 },
  { bob: 0.03, squash: 0.0, earAngle: 0.08, mouthOpen: 0.04 },
  { bob: 0.02, squash: 0.0, earAngle: 0.04, mouthOpen: 0.03 },
  { bob: 0.01, squash: 0.0, earAngle: 0.0, mouthOpen: 0.03 },
  { bob: 0.02, squash: 0.06, earAngle: 0.08, mouthOpen: 0.35 },
  { bob: -0.02, squash: 0.16, earAngle: -0.04, mouthOpen: 0.65 },
  { bob: 0.0, squash: 0.06, earAngle: 0.06, mouthOpen: 0.3 },
];

// Same split as HERBIVORE_POSES. The walk loop stays subtle (an apex
// predator on the prowl doesn't chomp while walking), but the bite loop is
// now a real, deliberate snap -- wide open then shut -- shown exactly on a
// successful kill (CarnivoreState.rest counting down), where previously
// there was no bite motion at all because there was no signal to trigger one.
const TIGER_POSES: readonly Pose[] = [
  { bob: 0.0, squash: 0.0, earAngle: 0.0, mouthOpen: 0.03 },
  { bob: 0.015, squash: 0.0, earAngle: 0.05, mouthOpen: 0.03 },
  { bob: 0.02, squash: 0.0, earAngle: 0.1, mouthOpen: 0.04 },
  { bob: 0.01, squash: 0.0, earAngle: 0.03, mouthOpen: 0.03 },
  { bob: 0.005, squash: 0.0, earAngle: -0.02, mouthOpen: 0.03 },
  { bob: 0.02, squash: -0.08, earAngle: 0.1, mouthOpen: 0.55 },
  { bob: -0.04, squash: 0.14, earAngle: -0.1, mouthOpen: 0.9 },
  { bob: 0.0, squash: 0.02, earAngle: 0.02, mouthOpen: 0.35 },
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
  const heights = GRASS_HEIGHTS;
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = heights * tileSize;
  grassCanvas.height = COLOR_BUCKETS * tileSize;
  const gctx = grassCanvas.getContext('2d')!;

  for (let bucket = 0; bucket < COLOR_BUCKETS; bucket++) {
    const bucketT = COLOR_BUCKETS <= 1 ? 0 : bucket / (COLOR_BUCKETS - 1);
    for (let h = 0; h < heights; h++) {
      const x = h * tileSize;
      const y = bucket * tileSize;
      gctx.fillStyle = bucketColor(bucket);
      gctx.fillRect(x, y, tileSize, tileSize);
      drawGrassTile(gctx, x, y, tileSize, h, bucketT);
    }
  }

  const herbivoreCanvas = bakeAnimalSheet(tileSize, HERBIVORE_POSES, drawHerbivoreShape);
  const carnivoreCanvas = bakeAnimalSheet(tileSize, TIGER_POSES, drawTigerShape);

  return { tileSize, grassCanvas, herbivoreCanvas, carnivoreCanvas, grassCols: heights, grassRows: COLOR_BUCKETS };
}

// Carcasses fade continuously rather than stepping through a handful of
// baked buckets, so (unlike grass/animal glyphs) they're drawn on demand
// each frame instead of blitted from a pre-baked sheet. Carcass counts are
// small even during a mass die-off, so per-frame path drawing is cheap here.
// Each species' fallen silhouette echoes its live shape (rounded vs.
// leaner+striped, see drawHerbivoreShape/drawTigerShape) so a carcass still
// reads as "that species", with legs splayed stiffly instead of tucked
// underneath. Kept in the same horizontal orientation as the live sprite --
// an earlier version rotated the whole body 90° to suggest "fallen onto its
// side", but in this top-down view that just turns the body's long axis
// vertical, which reads as the animal standing up on end, not lying down.
// Splayed legs + flopped ears + the color fade to soil already say "fallen"
// without needing a rotation that fights the top-down perspective.
function drawFallenLegs(ctx: CanvasRenderingContext2D, bw: number, bh: number, r: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = 'round';
  for (const t of [-0.55, -0.15, 0.25, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(t * bw, bh * 0.95);
    ctx.lineTo(t * bw + r * 0.22, bh * 1.35);
    ctx.stroke();
  }
}

function drawHerbivoreCarcass(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number): void {
  const r = size / 2;
  const bodyColor = lerpColor(CARCASS_FRESH_COLOR, CARCASS_DECAYED_COLOR, t);
  const limbColor = lerpColor(CARCASS_FRESH_COLOR, CARCASS_DECAYED_COLOR, Math.min(1, t + 0.15));

  ctx.save();
  ctx.translate(cx, cy);

  const bw = r * 0.72;
  const bh = r * 0.62; // slightly flattened vs. the standing 0.7

  drawFallenLegs(ctx, bw, bh, r, limbColor);

  // ears, flopped flat against the ground instead of upright -- same
  // attachment point as the live pose (see drawHerbivoreShape), just rotated
  // further down so they lie against the head instead of standing up.
  ctx.fillStyle = limbColor;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(-bw * 0.7, side * bh * 0.95);
    ctx.rotate(side * 1.4);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-r * 0.05, -side * r * 0.34);
    ctx.lineTo(r * 0.22, -side * r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = bodyColor;
  roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, r * 0.5);
  ctx.fill();

  ctx.restore();
}

function drawCarnivoreCarcass(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number): void {
  const r = size / 2;
  const bodyColor = lerpColor(CARCASS_FRESH_COLOR, CARCASS_DECAYED_COLOR, t);
  const limbColor = lerpColor(CARCASS_FRESH_COLOR, CARCASS_DECAYED_COLOR, Math.min(1, t + 0.15));
  const stripeColor = lerpColor(STRIPE_COLOR, CARCASS_DECAYED_COLOR, Math.min(1, t * 0.6 + 0.1));

  ctx.save();
  ctx.translate(cx, cy);

  const bw = r * 0.88;
  const bh = r * 0.5; // flatter than the standing 0.6

  drawFallenLegs(ctx, bw, bh, r, limbColor);

  ctx.fillStyle = bodyColor;
  roundRectPath(ctx, -bw, -bh, bw * 2, bh * 2, r * 0.22);
  ctx.fill();

  ctx.strokeStyle = stripeColor;
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = 'round';
  for (const sOff of [-0.5, -0.1, 0.3]) {
    ctx.beginPath();
    ctx.moveTo(sOff * bw, -bh * 0.7);
    ctx.lineTo(sOff * bw - r * 0.14, bh * 0.7);
    ctx.stroke();
  }

  ctx.restore();
}

// species: 0 = herbivore, 1 = carnivore (CARCASS_SPECIES in sim/carcass.ts).
// t: 0 = freshly dead, 1 = fully decayed.
export function drawCarcassSprite(
  ctx: CanvasRenderingContext2D,
  tileSize: number,
  x: number,
  y: number,
  species: number,
  t: number,
): void {
  const cx = x * tileSize + tileSize / 2;
  const cy = y * tileSize + tileSize / 2;
  const size = tileSize * 0.92;
  if (species === 1) drawCarnivoreCarcass(ctx, cx, cy, size, t);
  else drawHerbivoreCarcass(ctx, cx, cy, size, t);
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
