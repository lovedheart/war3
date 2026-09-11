/**
 * 8-directional A* over the PathGrid with a binary heap and a hard node cap.
 *
 * - Corner cutting is forbidden: a diagonal move requires both adjacent
 *   cardinal tiles to be passable (WC3 units cannot squeeze through diagonal
 *   gaps).
 * - When `maxNodes` is exhausted the search returns the best-effort partial
 *   path towards the goal (`partial: true`) instead of throwing.
 * - Fully deterministic: neighbour expansion order is fixed, heap ties break on
 *   insertion order.
 */
import { Fixed } from '../core/fixed.js';
import { PathGrid } from './pathgrid.js';

export interface PathRequest {
  fromX: Fixed;
  fromY: Fixed;
  toX: Fixed;
  toY: Fixed;
  /** unit collision radius; >1 tile inflates obstacles */
  radius: Fixed;
  maxNodes: number;
}

export interface PathResult {
  ok: boolean;
  /** tile centres, x/y interleaved, first entry == start centre */
  nodes: Fixed[];
  /** true when the search hit its node cap (path is best-effort) */
  partial: boolean;
}

/** dx, dy, cost×10 (straight 10, diagonal 14). */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DCOST = [10, 10, 10, 10, 14, 14, 14, 14];
/** For diagonal k: the two orthogonal tiles that must also be free. */
const CORNER_A = [2, 3, 0, 1, 0, 1, 0, 1];
const CORNER_B = [2, 3, 1, 0, 1, 0, 0, 1];

const DEFAULT_MAX_NODES = 4096;

function toTile(v: Fixed): number {
  return v >> 16;
}

function center(tx: number): Fixed {
  return tx * 65536 + 32768;
}

export class Pathfinder {
  private gScore: Float64Array;
  private cameFrom: Int32Array;
  private state: Uint8Array; // 0 unvisited, 1 open, 2 closed
  private stamp: Int32Array;
  private epoch = 0;
  private heapNode: Int32Array;
  private heapKey: Float64Array;
  private heapOrder: Int32Array;
  private heapSize = 0;
  /** last search statistics, handy for profiling / AI tuning */
  lastExpansions = 0;

  constructor(private grid: PathGrid) {
    const n = grid.width * grid.height;
    this.gScore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.state = new Uint8Array(n);
    this.stamp = new Int32Array(n);
    this.heapNode = new Int32Array(n + 8);
    this.heapKey = new Float64Array(n + 8);
    this.heapOrder = new Int32Array(n + 8);
  }

  get gridRef(): PathGrid {
    return this.grid;
  }

  /** Drop all cached search state (after a map change of a different size). */
  clear(): void {
    this.epoch++;
    this.heapSize = 0;
    this.lastExpansions = 0;
  }

  private heapLess(a: number, b: number): boolean {
    if (this.heapKey[a] !== this.heapKey[b]) return this.heapKey[a] < this.heapKey[b];
    return this.heapOrder[a] < this.heapOrder[b];
  }

  private heapSwap(a: number, b: number): void {
    let t = this.heapNode[a];
    this.heapNode[a] = this.heapNode[b];
    this.heapNode[b] = t;
    let k = this.heapKey[a];
    this.heapKey[a] = this.heapKey[b];
    this.heapKey[b] = k;
    let o = this.heapOrder[a];
    this.heapOrder[a] = this.heapOrder[b];
    this.heapOrder[b] = o;
  }

  private heapPush(node: number, key: number, order: number): void {
    let i = this.heapSize++;
    this.heapNode[i] = node;
    this.heapKey[i] = key;
    this.heapOrder[i] = order;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.heapLess(i, p)) break;
      this.heapSwap(i, p);
      i = p;
    }
  }

  private heapPop(): number {
    if (this.heapSize === 0) return -1;
    const top = this.heapNode[0];
    const n = --this.heapSize;
    if (n > 0) {
      this.heapNode[0] = this.heapNode[n];
      this.heapKey[0] = this.heapKey[n];
      this.heapOrder[0] = this.heapOrder[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heapSize && this.heapLess(l, m)) m = l;
        if (r < this.heapSize && this.heapLess(r, m)) m = r;
        if (m === i) break;
        this.heapSwap(i, m);
        i = m;
      }
    }
    return top;
  }

  /** Chebyshev-scaled octile heuristic ×10, in cost-byte units. */
  private heuristic(i: number, gi: number): number {
    const w = this.grid.width;
    const ax = i % w;
    const ay = (i / w) | 0;
    const bx = gi % w;
    const by = (gi / w) | 0;
    const dx = ax > bx ? ax - bx : bx - ax;
    const dy = ay > by ? ay - by : by - ay;
    return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
  }

  find(req: PathRequest): PathResult {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    const sx = toTile(req.fromX);
    const sy = toTile(req.fromY);
    const gx = toTile(req.toX);
    const gy = toTile(req.toY);
    const maxNodes = req.maxNodes > 0 ? req.maxNodes | 0 : DEFAULT_MAX_NODES;

    const fail = (partial: boolean, endIdx: number): PathResult => ({
      ok: false,
      nodes: this.trace(partial ? endIdx : -1, sx, sy, gx, gy, partial),
      partial,
    });

    if (!g.inside(sx, sy) || !g.inside(gx, gy)) return fail(false, -1);
    const start = sy * w + sx;
    const goal = gy * w + gx;
    if (start === goal) return { ok: true, nodes: [center(sx), center(sy)], partial: false };
    if (!g.passable(gx, gy)) {
      // Target tile itself is blocked (building / tree): aim at the nearest
      // passable neighbour so "move to that tree" still resolves.
      let near = -1;
      let bestD = Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const tx = gx + dx;
          const ty = gy + dy;
          if (!g.passable(tx, ty)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            near = ty * w + tx;
          }
        }
      }
      if (near < 0) return { ok: false, nodes: [], partial: false };
      return this.find({
        fromX: req.fromX,
        fromY: req.fromY,
        toX: (near % w) * 65536 + 32768,
        toY: (((near / w) | 0) << 16) + 32768,
        radius: 0,
        maxNodes,
      });
    }

    const epoch = ++this.epoch;
    let heapOrder = 0;
    this.heapSize = 0;
    this.gScore[start] = 0;
    this.cameFrom[start] = -1;
    this.state[start] = 1;
    this.stamp[start] = epoch;
    this.heapPush(start, this.heuristic(start, goal), heapOrder++);

    const inflate = req.radius > 65536 ? Math.min(3, Math.ceil(req.radius / 65536)) : 0;
    let expanded = 0;
    let bestIdx = start;
    let bestH = this.heuristic(start, goal);

    while (this.heapSize > 0) {
      const cur = this.heapPop();
      if (this.stamp[cur] !== epoch || this.state[cur] === 2) continue;
      this.state[cur] = 2;
      expanded++;
      const hcand = this.heuristic(cur, goal);
      if (hcand < bestH) {
        bestH = hcand;
        bestIdx = cur;
      }
      if (cur === goal) {
        this.lastExpansions = expanded;
        return { ok: true, nodes: this.trace(goal, sx, sy, gx, gy, false), partial: false };
      }
      if (expanded >= maxNodes) {
        this.lastExpansions = expanded;
        return { ok: false, nodes: this.trace(bestIdx, sx, sy, gx, gy, true), partial: true };
      }

      const cx = cur % w;
      const cy = (cur / w) | 0;
      const cg = this.gScore[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (k >= 4) {
          // no diagonal squeeze through two blocked diagonals
          const a = CORNER_A[k];
          const b = CORNER_B[k];
          if (!g.passable(cx + DX[a], cy + DY[a])) continue;
          if (!g.passable(cx + DX[b], cy + DY[b])) continue;
        }
        const ni = ny * w + nx;
        let c = g.cost(nx, ny);
        if (c === 255) continue;
        if (inflate > 0 && c < 250) c = Math.min(250, c + inflate * 40);
        const step = (DCOST[k] * c) / 10;
        const ng = cg + step;
        const seen = this.stamp[ni] === epoch;
        if (seen && this.state[ni] === 2) continue;
        if (!seen || ng < this.gScore[ni]) {
          this.gScore[ni] = ng;
          this.cameFrom[ni] = cur;
          this.state[ni] = 1;
          this.stamp[ni] = epoch;
          this.heapPush(ni, ng + this.heuristic(ni, goal), heapOrder++);
        }
      }
    }

    this.lastExpansions = expanded;
    return { ok: false, nodes: this.trace(bestIdx, sx, sy, gx, gy, false), partial: false };
  }

  /** Rebuild the node list; when partial and no path exists, walk greedily. */
  private trace(
    endIdx: number,
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    partial: boolean,
  ): Fixed[] {
    if (endIdx >= 0) {
      const w = this.grid.width;
      const rev: number[] = [];
      let cur = endIdx;
      let guard = 0;
      const limit = w * this.grid.height + 1;
      while (cur >= 0 && guard++ < limit) {
        rev.push(cur);
        cur = this.stamp[cur] === this.epoch ? this.cameFrom[cur] : -1;
      }
      const out: Fixed[] = [];
      for (let i = rev.length - 1; i >= 0; i--) {
        const idx = rev[i];
        out.push((idx % w) * 65536 + 32768, (((idx / w) | 0) * 65536 + 32768));
      }
      return out;
    }
    if (!partial) return [];
    // Greedy fallback: one step from the start toward the goal, preferring the
    // axis with the larger remaining distance, then either axis, then any.
    const cand: number[][] = [];
    const adx = gx - sx;
    const ady = gy - sy;
    const sxStep = Math.sign(adx);
    const syStep = Math.sign(ady);
    if (Math.abs(adx) >= Math.abs(ady)) {
      if (sxStep) cand.push([sx + sxStep, sy]);
      if (syStep) cand.push([sx, sy + syStep]);
      if (sxStep && syStep) cand.push([sx + sxStep, sy + syStep]);
    } else {
      if (syStep) cand.push([sx, sy + syStep]);
      if (sxStep) cand.push([sx + sxStep, sy]);
      if (sxStep && syStep) cand.push([sx + sxStep, sy + syStep]);
    }
    for (let k = 0; k < 8 && cand.length < 8; k++) {
      const p = [sx + DX[k], sy + DY[k]];
      if (!cand.some((c) => c[0] === p[0] && c[1] === p[1])) cand.push(p);
    }
    for (const [tx, ty] of cand) {
      if (!this.grid.passable(tx, ty)) continue;
      if (tx === sx && ty === sy) continue;
      return [tx * 65536 + 32768, ty * 65536 + 32768];
    }
    return [];
  }
}
