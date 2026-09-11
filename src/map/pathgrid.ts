/**
 * PathGrid: per-tile traversal cost for A* / flow fields.
 *
 * `cost` is a byte: 0..254, where 255 (BLOCKED) means impassable. Costs are
 * *relative* weights (grass/snow cost more than ground) so paths prefer roads;
 * dynamic blockers (units, buildings under construction) are reference counted
 * on top of the static terrain so overlapping blockers are safe.
 */
import { Fixed } from '../core/fixed.js';
import { Hasher } from '../core/hash.js';
import { Terrain } from './terrain.js';

export const BLOCKED = 255;

/** Static cost per tile id (index == tile id). Impassable tiles get 255. */
const STATIC_COST: number[] = [
  10, // GROUND
  14, // GRASS
  11, // DIRT
  BLOCKED, // CLIFF
  BLOCKED, // WATER
  BLOCKED, // ROCK
  12, // BLIGHT
  18, // SNOW
  BLOCKED, // WALL
];

export class PathGrid {
  readonly width: number;
  readonly height: number;
  /** combined cost bytes, row-major, length width*height */
  readonly costs: Uint8Array;
  /** how many dynamic blockers currently cover each tile */
  private refs: Uint16Array;
  /** terrain-derived cost, kept so rebuild()/refresh can recompute cheaply */
  private base: Uint8Array;

  constructor(readonly terrain: Terrain) {
    this.width = terrain.width;
    this.height = terrain.height;
    const n = this.width * this.height;
    this.costs = new Uint8Array(n);
    this.refs = new Uint16Array(n);
    this.base = new Uint8Array(n);
    this.rebuild();
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  /** Recompute costs from terrain; drops all dynamic blockers. */
  rebuild(): void {
    const n = this.refs.length;
    for (let i = 0; i < n; i++) this.refs[i] = 0;
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const i = ty * this.width + tx;
        const t = this.terrain.tile(tx, ty);
        let c = t >= 0 && t < STATIC_COST.length ? STATIC_COST[t] : BLOCKED;
        if (c !== BLOCKED && !this.terrain.walkable(tx, ty)) c = BLOCKED;
        this.base[i] = c;
        this.costs[i] = c;
      }
    }
  }

  /** Refresh the static part of one tile after a terrain edit. */
  refreshTile(tx: number, ty: number): void {
    if (!this.inside(tx, ty)) return;
    const i = ty * this.width + tx;
    const t = this.terrain.tile(tx, ty);
    let c = t >= 0 && t < STATIC_COST.length ? STATIC_COST[t] : BLOCKED;
    if (c !== BLOCKED && !this.terrain.walkable(tx, ty)) c = BLOCKED;
    this.base[i] = c;
    this.applyCost(i);
  }

  private applyCost(i: number): void {
    const b = this.base[i];
    if (b === BLOCKED) {
      this.costs[i] = BLOCKED;
      return;
    }
    const r = this.refs[i];
    if (r === 0) {
      this.costs[i] = b;
      return;
    }
    const c = b + r * 64; // stacked blockers saturate toward blocked
    this.costs[i] = c > 250 ? 250 : c;
  }

  /** Add `add` to every tile whose centre lies within `r` of (cx, cy). */
  blockCircle(cx: Fixed, cy: Fixed, r: Fixed, add: number): void {
    this.eachCircle(cx, cy, r, (i) => {
      const v = this.refs[i] + add;
      this.refs[i] = v < 0 ? 0 : v > 65535 ? 65535 : v;
      this.applyCost(i);
    });
  }

  unblockCircle(cx: Fixed, cy: Fixed, r: Fixed, sub: number): void {
    this.blockCircle(cx, cy, r, -sub);
  }

  private eachCircle(cx: Fixed, cy: Fixed, r: Fixed, fn: (i: number) => void): void {
    const rad = Math.max(0, r >> 16);
    const cxT = Math.floor(cx / 65536);
    const cyT = Math.floor(cy / 65536);
    const x0 = Math.max(0, cxT - rad - 1);
    const x1 = Math.min(this.width - 1, cxT + rad + 1);
    const y0 = Math.max(0, cyT - rad - 1);
    const y1 = Math.min(this.height - 1, cyT + rad + 1);
    const r2 = r * r; // tile^2, fixed point
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx * 65536 + 32768 - cx;
        const dy = ty * 65536 + 32768 - cy;
        if (dx * dx + dy * dy <= r2) fn(ty * this.width + tx);
      }
    }
  }

  passable(tx: number, ty: number): boolean {
    if (!this.inside(tx, ty)) return false;
    return this.costs[ty * this.width + tx] !== BLOCKED;
  }

  /** Cost byte of a tile; 255 when out of bounds or impassable. */
  cost(tx: number, ty: number): number {
    if (!this.inside(tx, ty)) return BLOCKED;
    return this.costs[ty * this.width + tx];
  }

  hash(h: Hasher): void {
    h.int(this.width).int(this.height);
    let prev = -1;
    let run = 0;
    for (let i = 0; i < this.costs.length; i++) {
      const c = this.costs[i];
      if (c === prev) run++;
      else {
        if (prev >= 0) h.int(prev).int(run);
        prev = c;
        run = 1;
      }
    }
    if (prev >= 0) h.int(prev).int(run);
  }

  /** True when no dynamic blocker is active anywhere. */
  clean(): boolean {
    for (let i = 0; i < this.refs.length; i++) if (this.refs[i] !== 0) return false;
    return true;
  }

  clone(): PathGrid {
    const g = new PathGrid(this.terrain);
    g.costs.set(this.costs);
    g.refs.set(this.refs);
    g.base.set(this.base);
    return g;
  }
}
