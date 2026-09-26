export interface Board {
  width: number;
  height: number;
}

export function idx(board: Board, x: number, y: number): number {
  return y * board.width + x;
}

export function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

// Shortest signed distance from a to b along one axis of a wrapping board --
// e.g. on a width-80 board, from x=78 to x=2 is +4 (via the seam), not -76.
// Mirrors the same shortest-path-around-the-seam logic the renderer already
// uses for glide interpolation and facing (render/renderer.ts's interpAxis/
// facingFromDelta), just on the sim side, for anything that needs a real
// distance on the torus rather than a raw coordinate difference (e.g. how
// far a tile is from a grass patch's center, see grass.ts's seedGrass).
export function torusDelta(a: number, b: number, max: number): number {
  let d = b - a;
  if (d > max / 2) d -= max;
  else if (d < -max / 2) d += max;
  return d;
}

export const NEIGHBOR_OFFSETS_8: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];
