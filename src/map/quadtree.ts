/**
 * QuadTree: broad-phase for unit queries (target acquisition, AoE, selection).
 *
 * Points only (each entry is a circle centre). Entries are stored in the deepest
 * node that fully contains them, so a query must test every node whose bounds
 * touch the query circle. Duplicate hits are possible when an entity is
 * re-inserted after moving without `remove()`; `query()` therefore dedupes and
 * returns ids in ascending order (canonical, deterministic).
 */
import { Fixed } from '../core/fixed.js';

interface QEntry {
  eid: number;
  x: Fixed;
  y: Fixed;
  r: Fixed;
}

const MAX_DEPTH = 8;

export class QuadTree {
  readonly minX: Fixed;
  readonly minY: Fixed;
  readonly maxX: Fixed;
  readonly maxY: Fixed;
  private entries: QEntry[] = [];
  private children: QuadTree[] | null = null;
  private parent: QuadTree | null = null;
  private count = 0;
  /** total insert() calls since the last clear(), for profiling */
  inserts = 0;

  constructor(
    minX: Fixed,
    minY: Fixed,
    maxX: Fixed,
    maxY: Fixed,
    private capacity: number = 8,
    private depth: number = 0,
    parent: QuadTree | null = null,
  ) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
    this.parent = parent;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.entries.length = 0;
    if (this.children) {
      for (const c of this.children) c.clear();
      this.children = null;
    }
    this.count = 0;
    this.inserts = 0;
  }

  /** Drop everything but keep the tree shape (cheaper than clear+rebuild). */
  clearEntries(): void {
    if (this.children) {
      for (const c of this.children) c.clearEntries();
    } else {
      this.entries.length = 0;
    }
    this.count = 0;
  }

  insert(eid: number, x: Fixed, y: Fixed, r: Fixed): void {
    this.inserts++;
    // Out-of-bounds points are clamped into the root rather than dropped.
    const px = x < this.minX ? this.minX + r : x > this.maxX ? this.maxX - r : x;
    const py = y < this.minY ? this.minY + r : y > this.maxY ? this.maxY - r : y;
    if (this.children) {
      const child = this.childHolding(px, py, r);
      if (child) {
        child.insert(eid, px, py, r);
      } else {
        this.entries.push({ eid, x: px, y: py, r });
      }
      this.count++;
      return;
    }
    this.entries.push({ eid, x: px, y: py, r });
    this.count++;
    if (this.entries.length > this.capacity && this.depth < MAX_DEPTH) this.subdivide();
  }

  /** The unique child that fully contains this circle, or null (straddler). */
  private childHolding(x: Fixed, y: Fixed, r: Fixed): QuadTree | null {
    if (!this.children) return null;
    let found: QuadTree | null = null;
    for (const c of this.children) {
      if (c.containsCircle(x, y, r)) {
        if (found) return null; // on a boundary: keep it at this level
        found = c;
      }
    }
    return found;
  }

  remove(eid: number): void {
    if (!this.removeOne(eid)) return;
    // Keep the cached subtree counts consistent.
    this.count--;
    let node: QuadTree | null = this.parent;
    while (node) {
      node.count--;
      node = node.parent;
    }
  }

  /** Remove one entry with this eid anywhere below; true if found. */
  private removeOne(eid: number): boolean {
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].eid === eid) {
        this.entries.splice(i, 1);
        return true;
      }
    }
    if (this.children) {
      for (const c of this.children) if (c.removeOne(eid)) return true;
    }
    return false;
  }

  /**
   * Collect every entry whose circle overlaps the query circle.
   * `out` is appended to, then the appended range is sorted ascending and
   * de-duplicated (an eid can appear twice after re-inserts without `remove`).
   */
  query(x: Fixed, y: Fixed, r: Fixed, out: number[]): number[] {
    const start = out.length;
    this.collect(x, y, r, out);
    const slice = out.slice(start);
    slice.sort((a, b) => a - b);
    out.length = start;
    let last = -1;
    for (const e of slice) {
      if (e === last) continue;
      last = e;
      out.push(e);
    }
    return out;
  }

  /** Variant returning a fresh array (allocation-heavy; prefer `query`). */
  queryNew(x: Fixed, y: Fixed, r: Fixed): number[] {
    return this.query(x, y, r, []);
  }

  private collect(x: Fixed, y: Fixed, r: Fixed, out: number[]): void {
    if (!this.circleTouchesRect(x, y, r)) return;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const rr = e.r + r;
      if (dx * dx + dy * dy <= rr * rr) out.push(e.eid);
    }
    if (this.children) for (const c of this.children) c.collect(x, y, r, out);
  }

  private circleTouchesRect(x: Fixed, y: Fixed, r: Fixed): boolean {
    if (x + r < this.minX || x - r > this.maxX) return false;
    if (y + r < this.minY || y - r > this.maxY) return false;
    return true;
  }

  private containsCircle(x: Fixed, y: Fixed, r: Fixed): boolean {
    return (
      x - r >= this.minX && x + r <= this.maxX && y - r >= this.minY && y + r <= this.maxY
    );
  }

  private subdivide(): void {
    const mx = ((this.minX + this.maxX) / 2) | 0;
    const my = ((this.minY + this.maxY) / 2) | 0;
    const d = this.depth + 1;
    this.children = [
      new QuadTree(this.minX, this.minY, mx, my, this.capacity, d, this),
      new QuadTree(mx, this.minY, this.maxX, my, this.capacity, d, this),
      new QuadTree(this.minX, my, mx, this.maxY, this.capacity, d, this),
      new QuadTree(mx, my, this.maxX, this.maxY, this.capacity, d, this),
    ];
    // Re-home existing entries so leaves stay shallow.
    const moved: QEntry[] = [];
    for (const e of this.entries) {
      const child = this.childHolding(e.x, e.y, e.r);
      if (child) child.insertRaw(e);
      else moved.push(e);
    }
    this.entries = moved;
    this.count = this.entries.length;
    for (const c of this.children) this.count += c.count;
  }

  private insertRaw(e: QEntry): void {
    this.entries.push(e);
    this.count++;
    if (this.entries.length > this.capacity && this.depth < MAX_DEPTH) this.subdivide();
  }

  /** Every live entry id, ascending — used by save/load and hash checks. */
  all(out: number[]): number[] {
    if (this.children) for (const c of this.children) c.all(out);
    for (const e of this.entries) out.push(e.eid);
    out.sort((a, b) => a - b);
    return out;
  }
}
