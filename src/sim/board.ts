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

export const NEIGHBOR_OFFSETS_8: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];
