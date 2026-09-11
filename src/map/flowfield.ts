/**
 * FlowField: distance field + gradient descent, shared by large groups moving
 * to the same target (WC3-style "many units, one order").
 *
 * `build()` runs a Dijkstra wavefront from the goal over the PathGrid with a
 * deterministic bucketed FIFO queue (no heap, no floating point on state):
 * integer cost accumulation, so the field is identical on every run.
 */
import { Fixed } from '../core/fixed.js';
import { Hasher } from '../core/hash.js';
import { fsinSteps, fcosSteps } from '../core/geom.js';
import { PathGrid } from './pathgrid.js';

/** Full-circle resolution of core/geom's trig tables (0.087890625 deg/step). */
const TRIG_N = 4096;

/** The 8 neighbour offsets. */
const FX = [1, -1, 0, 0, 1, 1, -1, -1];
const FY = [0, 0, 1, -1, 1, -1, 1, -1];
/** Heading in trig-steps for each direction (deterministic table build). */
const FSTEP = FX.map((dx, i) => {
  const s = Math.round((Math.atan2(FY[i], dx) * TRIG_N) / (Math.PI * 2));
  return ((s % TRIG_N) + TRIG_N) % TRIG_N;
});

/**
 * Wavefront step cost is `tileCost * (1 | 2)`; the max single step is
 * `250 * 2 = 500`, which bounds the field at 254 tiles across (a 128x128 map's
 * diagonal is 180 tiles == 36,000 cost — ample headroom before overflow).
 */
export class FlowField {
  private dist: Int32Array;
  private stamp: Int32Array;
  private epoch = 0;
  /** scratch FIFO buffers reused across builds, grown on demand */
  private qx: Int32Array;
  private qy: Int32Array;
  private ok = false;
  /** goal tile of the last successful build */
  goalTx = -1;
  goalTy = -1;
  /** number of tiles reached by the last wavefront (diagnostics) */
  reached = 0;

  constructor(private grid: PathGrid) {
    const n = Math.max(1, grid.width * grid.height);
    this.dist = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.qx = new Int32Array(n);
    this.qy = new Int32Array(n);
  }

  get width(): number {
    return this.grid.width;
  }

  get height(): number {
    return this.grid.height;
  }

  /**
   * Wavefront out from tile (targetTx, targetTy). `radiusTiles` bounds the
   * field in Chebyshev distance so long marches stay cheap; pass a large value
   * for a global field.
   */
  build(targetTx: number, targetTy: number, radiusTiles: number): void {
    const g = this.grid;
    const w = g.width;
    const h = g.height;
    this.ok = false;
    this.reached = 0;
    if (targetTx < 0 || targetTy < 0 || targetTx >= w || targetTy >= h) return;

    if (!g.passable(targetTx, targetTy)) {
      // Rallying onto a building footprint / tree: snap to nearest free tile.
      let best = -1;
      let bestD = Infinity;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const tx = targetTx + dx;
          const ty = targetTy + dy;
          if (!g.passable(tx, ty)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = ty * w + tx;
          }
        }
      }
      if (best < 0) return;
      targetTx = best % w;
      targetTy = (best / w) | 0;
    }

    const epoch = ++this.epoch;
    const start = targetTy * w + targetTx;
    const rad = Math.max(0, radiusTiles | 0);
    const qx = this.qx;
    const qy = this.qy;
    let head = 0;
    let tail = 0;

    this.dist[start] = 0;
    this.stamp[start] = epoch;
    qx[tail] = targetTx;
    qy[tail] = targetTy;
    tail++;
    this.reached = 1;

    while (head < tail) {
      const cx = qx[head];
      const cy = qy[head];
      head++;
      const idx = cy * w + cx;
      const d = this.dist[idx];
      for (let k = 0; k < 8; k++) {
        const nx = cx + FX[k];
        const ny = cy + FY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (Math.max(Math.abs(nx - targetTx), Math.abs(ny - targetTy)) > rad) continue;
        const c = g.cost(nx, ny);
        if (c === 255) continue;
        const ni = ny * w + nx;
        if (this.stamp[ni] === epoch) continue; // first settle wins == uniform-cost BFS
        const nd = d + c * (k >= 4 ? 2 : 1);
        this.stamp[ni] = epoch;
        this.dist[ni] = nd;
        qx[tail] = nx;
        qy[tail] = ny;
        tail++;
        this.reached++;
      }
    }

    this.goalTx = targetTx;
    this.goalTy = targetTy;
    this.ok = true;
  }

  /** Cost distance from a tile to the goal, or -1 when unreachable. */
  distAt(tx: number, ty: number): number {
    if (!this.ok) return -1;
    const w = this.grid.width;
    const h = this.grid.height;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return -1;
    const i = ty * w + tx;
    return this.stamp[i] === this.epoch ? this.dist[i] : -1;
  }

  /** Heading (trig steps, see core/geom) pointing downhill; 0 when none. */
  direction(x: Fixed, y: Fixed): Fixed {
    if (!this.ok) return 0;
    const w = this.grid.width;
    const h = this.grid.height;
    const tx = x >> 16;
    const ty = y >> 16;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return 0;
    const here = ty * w + tx;
    if (this.stamp[here] !== this.epoch) return 0;
    const hereD = this.dist[here];
    if (hereD === 0) return 0; // at the goal

    let bestDir = -1;
    let bestD = hereD;
    for (let k = 0; k < 8; k++) {
      const nx = tx + FX[k];
      const ny = ty + FY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (this.stamp[ni] !== this.epoch) continue;
      const d = this.dist[ni];
      if (d < bestD) {
        bestD = d;
        bestDir = k;
      }
    }
    if (bestDir >= 0) return FSTEP[bestDir];

    // Plateau / dead end: aim straight at the goal centre as a fallback.
    const gx = this.goalTx * 65536 + 32768;
    const gy = this.goalTy * 65536 + 32768;
    const dx = gx - x;
    const dy = gy - y;
    if (dx === 0 && dy === 0) return 0;
    const s = Math.round((Math.atan2(dy, dx) * TRIG_N) / (Math.PI * 2));
    return ((s % TRIG_N) + TRIG_N) % TRIG_N;
  }

  /** Unit vector of `direction()` — convenience for steering systems. */
  vector(x: Fixed, y: Fixed): { x: Fixed; y: Fixed } {
    const s = this.direction(x, y);
    const atGoal = (x >> 16) === this.goalTx && (y >> 16) === this.goalTy;
    if (s === 0 && !atGoal) return { x: 0, y: 0 };
    return { x: fcosSteps(s), y: fsinSteps(s) };
  }

  valid(): boolean {
    return this.ok;
  }

  hash(h: Hasher): void {
    h.int(this.epoch >>> 0);
    h.int(this.ok ? 1 : 0);
    h.int(this.goalTx);
    h.int(this.goalTy);
    if (!this.ok) return;
    for (let i = 0; i < this.stamp.length; i++) {
      h.int(this.stamp[i] === this.epoch ? this.dist[i] : -1);
    }
  }
}
