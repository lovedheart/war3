/**
 * Selection helpers: hit-testing and box-select culling.
 *
 * Pure functions over a `SelectionSource` so tests can feed plain arrays with
 * no DOM and no live World.
 */
import type { Fixed } from '../core/fixed.js';
import { fn } from '../core/fixed.js';

export interface SelectableEntity {
  eid: number;
  /** world position, fixed */
  x: Fixed;
  y: Fixed;
  /** collision radius, fixed */
  radius: Fixed;
  player: number;
  kind: number;
  unitId: string;
  isHero: boolean;
  isWorker: boolean;
  alive: boolean;
}

export interface RectF {
  x0: Fixed;
  y0: Fixed;
  x1: Fixed;
  y1: Fixed;
}

/** WC3 caps a control group / box select at 12 units. */
export const MAX_SELECTION = 12;

/**
 * Pick the single entity under a point. Preference order mirrors WC3: the
 * closest centre wins, with buildings losing ties to units so you can click a
 * unit standing in front of a wall.
 */
export function pickAt(entities: readonly SelectableEntity[], x: Fixed, y: Fixed, player: number): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const e of entities) {
    if (!e.alive || e.player !== player) continue;
    const dx = fn(x) - fn(e.x);
    const dy = fn(y) - fn(e.y);
    const d = Math.hypot(dx, dy);
    const reach = Math.max(0.45, fn(e.radius));
    if (d > reach + 0.35) continue;
    // units beat buildings on near-ties
    const bias = e.kind === 1 ? 1.15 : 1;
    const score = d * bias;
    if (score < bestScore) {
      bestScore = score;
      best = e.eid;
    }
  }
  return best;
}

/** Entities whose centre lies inside the drag rectangle (own units only). */
export function boxSelect(
  entities: readonly SelectableEntity[],
  rect: RectF,
  player: number,
  cap: number = MAX_SELECTION,
): number[] {
  const lo = (a: Fixed, b: Fixed) => (a < b ? a : b);
  const hi = (a: Fixed, b: Fixed) => (a > b ? a : b);
  const x0 = lo(rect.x0, rect.x1);
  const x1 = hi(rect.x0, rect.x1);
  const y0 = lo(rect.y0, rect.y1);
  const y1 = hi(rect.y0, rect.y1);

  const hits: SelectableEntity[] = [];
  for (const e of entities) {
    if (!e.alive || e.player !== player) continue;
    if (e.kind !== 0) continue; // box select takes units, not buildings
    if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
    hits.push(e);
  }
  return cullBoxSelection(hits, cap);
}

/**
 * Reduce a box-selection to `cap` entries the way WC3 does: prefer combat
 * units, then workers, and never auto-select heroes (they are clicked
 * individually). Ties break on ascending eid so the result is deterministic.
 */
export function cullBoxSelection(entities: readonly SelectableEntity[], cap: number = MAX_SELECTION): number[] {
  const rank = (e: SelectableEntity): number => (e.isHero ? 3 : e.isWorker ? 2 : 1);
  const sorted = entities
    .filter((e) => !e.isHero)
    .slice()
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.eid - b.eid;
    });
  const picked = sorted.slice(0, cap).map((e) => e.eid);
  // keep the reported order canonical regardless of the priority sort
  return picked.sort((a, b) => a - b);
}

/** Merge `add` into `base` without duplicates, ascending order (Ctrl+click). */
export function mergeSelection(base: readonly number[], add: readonly number[], cap: number = MAX_SELECTION): number[] {
  const set = new Set<number>(base);
  for (const e of add) set.add(e >>> 0);
  return [...set].sort((a, b) => a - b).slice(0, cap);
}
