/** Deterministic geometry helpers in fixed point. */
import { Fixed, FP_SCALE, fmul, fsqrt, fdiv } from './fixed.js';

export interface Vec2 {
  x: Fixed;
  y: Fixed;
}

export interface Rect {
  x: Fixed;
  y: Fixed;
  w: Fixed;
  h: Fixed;
}

export function vec(x: Fixed, y: Fixed): Vec2 {
  return { x, y };
}

/** Deterministic sin/cos via a 1024-entry table (integer degrees -> fixed). */
const TRIG_N = 4096; // full circle resolution: 0.087890625 deg per step
const SIN_TABLE: Fixed[] = new Array(TRIG_N);
for (let i = 0; i < TRIG_N; i++) {
  SIN_TABLE[i] = Math.round(Math.sin((i / TRIG_N) * Math.PI * 2) * FP_SCALE) | 0;
}

function wrap(steps: number): number {
  const m = steps % TRIG_N;
  return m < 0 ? m + TRIG_N : m;
}

/** angleSteps: integer steps around the circle (0..4095 == 0..360deg). */
export function fsinSteps(steps: number): Fixed {
  return SIN_TABLE[wrap(steps)];
}

export function fcosSteps(steps: number): Fixed {
  return SIN_TABLE[wrap(steps + TRIG_N / 4)];
}

/** Degrees (integer) to trig steps. */
export function degToSteps(deg: number): number {
  return Math.round((deg * TRIG_N) / 360) | 0;
}

export function stepsToDeg(steps: number): number {
  return (steps * 360) / TRIG_N;
}

/** Unit direction vector for a degree heading (deterministic). */
export function dirFromDeg(deg: number): Vec2 {
  const s = degToSteps(deg);
  return { x: fcosSteps(s), y: fsinSteps(s) };
}

export function normalize(v: Vec2): Vec2 {
  const l = fsqrt(fmul(v.x, v.x) + fmul(v.y, v.y));
  if (l === 0) return { x: 0, y: 0 };
  return { x: fdiv(v.x, l), y: fdiv(v.y, l) };
}

export function length(v: Vec2): Fixed {
  return fsqrt(fmul(v.x, v.x) + fmul(v.y, v.y));
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Circle-vs-circle using squared distance; radii are fixed. */
export function circlesOverlap(
  ax: Fixed,
  ay: Fixed,
  ar: Fixed,
  bx: Fixed,
  by: Fixed,
  br: Fixed,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return fmul(dx, dx) + fmul(dy, dy) <= fmul(r, r);
}

/** Point-in-rect with tile-aligned rect. */
export function pointInRect(px: Fixed, py: Fixed, r: Rect): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

export const ZERO_VEC: Vec2 = { x: 0, y: 0 };
