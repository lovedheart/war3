/**
 * FogOfWar: per-player explored + visible bitmaps.
 *
 * WC3 semantics (ARCHITECTURE.md, constants FOG_*):
 *   0 UNEXPLORED  never seen — rendered black
 *   1 EXPIRED     explored but no live vision — terrain shown, units hidden
 *   2 VISIBLE     live vision this tick
 *
 * `beginTick()` clears the visible layer; every vision source then calls
 * `markSeen()` (which also permanently explores). Circular brushes use the
 * midpoint circle walk so the shape is identical on every platform.
 */
import { Hasher } from '../core/hash.js';
import { FOG_EXPIRED, FOG_UNEXPLORED, FOG_VISIBLE } from '../core/constants.js';

/** Fog states, re-exported so `src/map` consumers need only one import. */
export { FOG_UNEXPLORED, FOG_EXPIRED, FOG_VISIBLE };

export class FogOfWar {
  readonly width: number;
  readonly height: number;
  readonly players: number;
  private explored: Uint8Array[];
  private visible: Uint8Array[];
  /** tiles currently granting vision per player (diagnostics / minimap) */
  private sources: number[];
  private tick = 0;

  constructor(width: number, height: number, players: number) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.players = Math.max(1, players | 0);
    const bytes = ((this.width * this.height + 7) >> 3) >>> 0;
    this.explored = [];
    this.visible = [];
    this.sources = [];
    for (let p = 0; p < this.players; p++) {
      const e = new Uint8Array(bytes);
      e.fill(255); // everything starts unexplored (all bits set == 0 explored)
      this.explored.push(e);
      this.visible.push(new Uint8Array(bytes));
      this.sources.push(0);
    }
  }

  private valid(p: number): boolean {
    return p >= 0 && p < this.players;
  }

  /** Permanently reveal a disc. Does not affect the current-tick visibility. */
  explore(tx: number, ty: number, r: number, player: number): void {
    if (!this.valid(player)) return;
    const bits = this.explored[player];
    this.eachInCircle(tx, ty, r, (i) => {
      bits[i >> 3] &= ~(1 << (i & 7));
    });
  }

  /** explore() + mark the disc visible for the current tick. */
  markSeen(tx: number, ty: number, r: number, player: number): void {
    if (!this.valid(player)) return;
    const bits = this.explored[player];
    const vis = this.visible[player];
    this.eachInCircle(tx, ty, r, (i) => {
      bits[i >> 3] &= ~(1 << (i & 7));
      vis[i >> 3] |= 1 << (i & 7);
    });
    this.sources[player]++;
  }

  /** Start of a logic tick: drop last tick's live vision, keep exploration. */
  beginTick(): void {
    this.tick++;
    for (let p = 0; p < this.players; p++) {
      this.visible[p].fill(0);
      this.sources[p] = 0;
    }
  }

  isVisibleTile(tx: number, ty: number, player: number): boolean {
    if (!this.valid(player) || !this.inside(tx, ty)) return false;
    const i = ty * this.width + tx;
    return (this.visible[player][i >> 3] & (1 << (i & 7))) !== 0;
  }

  exploredTile(tx: number, ty: number, player: number): boolean {
    if (!this.valid(player)) return false;
    if (!this.inside(tx, ty)) return false;
    const i = ty * this.width + tx;
    return (this.explored[player][i >> 3] & (1 << (i & 7))) === 0;
  }

  /** 0 unexplored / 1 explored-not-visible / 2 visible. */
  state(tx: number, ty: number, player: number): 0 | 1 | 2 {
    if (!this.valid(player) || !this.inside(tx, ty)) return FOG_UNEXPLORED;
    const i = ty * this.width + tx;
    const v = (this.visible[player][i >> 3] & (1 << (i & 7))) !== 0;
    if (v) return FOG_VISIBLE as 0 | 1 | 2;
    const e = (this.explored[player][i >> 3] & (1 << (i & 7))) === 0;
    return (e ? FOG_EXPIRED : FOG_UNEXPLORED) as 0 | 1 | 2;
  }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  /** Tiles revealed so far by player (for AI map-knowledge scoring). */
  exploredCount(player: number): number {
    if (!this.valid(player)) return 0;
    const bits = this.explored[player];
    let n = 0;
    for (let i = 0; i < this.width * this.height; i++) {
      if ((bits[i >> 3] & (1 << (i & 7))) === 0) n++;
    }
    return n;
  }

  /** Copy another player's knowledge (allies share vision in WC3). */
  shareVision(from: number, to: number): void {
    if (!this.valid(from) || !this.valid(to)) return;
    const a = this.explored[from];
    const b = this.explored[to];
    for (let i = 0; i < a.length; i++) b[i] &= a[i];
    const va = this.visible[from];
    const vb = this.visible[to];
    for (let i = 0; i < va.length; i++) vb[i] |= va[i];
  }

  /** Whole-map reveal for one player (dev/cheat/replay end). */
  revealAll(player: number): void {
    this.explore(0, 0, this.width + this.height, player);
  }

  /**
   * Walk tile indices inside the disc of radius `r` (tile units, integer).
   * Midpoint circle scanline: deterministic and free of floating point.
   */
  private eachInCircle(cx: number, cy: number, r: number, fn: (i: number) => void): void {
    const rad = r | 0;
    if (rad < 0) return;
    if (rad === 0) {
      if (this.inside(cx, cy)) fn(cy * this.width + cx);
      return;
    }
    const r2 = rad * rad;
    for (let dy = -rad; dy <= rad; dy++) {
      const ty = cy + dy;
      if (ty < 0 || ty >= this.height) continue;
      // largest dx with dx*dx + dy*dy <= r2
      let dx = 0;
      while (dx + 1 <= rad && (dx + 1) * (dx + 1) + dy * dy <= r2) dx++;
      const row = ty * this.width;
      const x0 = Math.max(0, cx - dx);
      const x1 = Math.min(this.width - 1, cx + dx);
      for (let tx = x0; tx <= x1; tx++) fn(row + tx);
    }
  }

  hash(h: Hasher, player: number): void {
    h.int(this.width).int(this.height).int(player);
    if (!this.valid(player)) return;
    const e = this.explored[player];
    const v = this.visible[player];
    for (let i = 0; i < e.length; i++) h.int(e[i]).int(v[i]);
  }

  hashAll(h: Hasher): void {
    for (let p = 0; p < this.players; p++) this.hash(h, p);
  }
}
