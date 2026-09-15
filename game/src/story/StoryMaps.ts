import { Random } from "../core/Random.ts";
import type { Chapter, Point } from "./StoryData.ts";

export const MAZE_SIZE = 15;
export const CELL = 4;
export const MAZE_START = cellPoint(1, 13);
export const MAZE_EXIT = cellPoint(13, 1);
export const MAZE_PEN = cellPoint(7, 7);
export const MAZE_CRATES = [cellPoint(3, 11), cellPoint(11, 9), cellPoint(9, 3)];
export const HILL_LAUNCH = spiralPoint(1);
export const HOME_LENGTH = 115;
export const SPIRAL_JUMP = 0.5; // One complete turn on the two-turn hill.
export function cellPoint(col: number, row: number): Point { return { x: (col - 7) * CELL, z: (row - 7) * CELL }; }
export function mazeCell(p: Point): number { return Math.round(p.z / CELL + 7) * MAZE_SIZE + Math.round(p.x / CELL + 7); }
export function spiralPoint(t: number): Point {
  const p = Math.max(0, Math.min(1, t));
  const angle = (1 - p) * Math.PI * 4;
  const radius = 9 + (1 - p) * 25;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
export function groundHeight(chapter: Chapter, x: number, z: number): number {
  return chapter === 1 ? Math.max(0, Math.min(6, (34 - Math.hypot(x, z)) * 0.25)) : 0;
}
export function homePoint(distance: number): Point {
  const d = Math.max(0, Math.min(HOME_LENGTH, distance));
  return { x: Math.sin(d / HOME_LENGTH * Math.PI * 2) * 7, z: 28 - d };
}
export function makeMaze(): Uint8Array {
  const cells = new Uint8Array(MAZE_SIZE * MAZE_SIZE).fill(1);
  const random = new Random(71309);
  const stack = [13 * MAZE_SIZE + 1];
  cells[stack[0]] = 0;
  while (stack.length) {
    const at = stack[stack.length - 1], col = at % MAZE_SIZE, row = Math.floor(at / MAZE_SIZE);
    const choices: number[] = [];
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const x = col + dx, z = row + dz;
      if (x > 0 && z > 0 && x < MAZE_SIZE - 1 && z < MAZE_SIZE - 1 && cells[z * MAZE_SIZE + x]) choices.push(z * MAZE_SIZE + x);
    }
    if (!choices.length) { stack.pop(); continue; }
    const next = choices[Math.floor(random.next() * choices.length)];
    cells[(at + next) / 2] = 0; cells[next] = 0; stack.push(next);
  }
  // Add loops, never remove connectivity. Border walls remain intact.
  for (let z = 2; z < 13; z += 2) for (let x = 1; x < 14; x += 4) cells[z * MAZE_SIZE + x] = 0;
  return cells;
}
export const MAZE = makeMaze();
export function blocked(chapter: Chapter, x: number, z: number, radius = 0.5): boolean {
  if (chapter !== 2) return chapter === 4 ? x < -42 || x > 42 || z < -98 || z > 43 : Math.abs(x) > 46 || Math.abs(z) > 46;
  for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) {
    const col = Math.round((x + dx) / CELL + 7), row = Math.round((z + dz) / CELL + 7);
    if (col < 0 || row < 0 || col >= MAZE_SIZE || row >= MAZE_SIZE || MAZE[row * MAZE_SIZE + col]) return true;
  }
  return false;
}
export function clearLine(chapter: Chapter, a: Point, b: Point): boolean {
  if (chapter !== 2) return true;
  const count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.4);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    if (blocked(chapter, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.04)) return false;
  }
  return true;
}
/** A shared BFS flow map, rebuilt only when the target changes cell. */
export function mazeDistances(target: Point): Int16Array {
  const distances = new Int16Array(MAZE.length).fill(-1);
  const start = mazeCell(target);
  if (start < 0 || start >= MAZE.length || MAZE[start]) return distances;
  const queue = [start]; distances[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const next of [at - MAZE_SIZE, at + MAZE_SIZE, at - 1, at + 1]) {
      if (next < 0 || next >= MAZE.length || MAZE[next] || distances[next] >= 0) continue;
      distances[next] = distances[at] + 1; queue.push(next);
    }
  }
  return distances;
}
export function mazeWaypoint(p: Point, distances: Int16Array): Point {
  const at = mazeCell(p);
  let best = at;
  for (const next of [at - MAZE_SIZE, at + MAZE_SIZE, at - 1, at + 1]) {
    if (next < 0 || next >= MAZE.length || distances[next] < 0) continue;
    if (distances[best] < 0 || distances[next] < distances[best]) best = next;
  }
  const center = cellPoint(at % MAZE_SIZE, Math.floor(at / MAZE_SIZE));
  const next = cellPoint(best % MAZE_SIZE, Math.floor(best / MAZE_SIZE));
  // Center before turning a corner, so a diagonal never cuts through a wall.
  return clearLine(2, p, next) ? next : center;
}
