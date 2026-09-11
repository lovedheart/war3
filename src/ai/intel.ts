/**
 * Fog-legal perception for the AI.
 *
 * The AI may only know what its own vision allows: live sightings plus a
 * fading memory of things last seen. Everything here is read-only against the
 * sim, and every entity query is gated on a `FogOfWar` tile test, so cheating
 * is structural rather than a matter of discipline. Stale entries are dropped
 * by eid (never by iterating an enemy list we are not allowed to read).
 */
import { Fixed, ff, fn } from '../core/fixed.js';
import type { Game } from '../sim/index.js';

export interface SeenUnit {
  eid: number;
  id: string;
  player: number;
  /** game units */
  x: Fixed;
  y: Fixed;
  hpFrac: number;
  lastSeen: number;
  hostile: boolean;
}

export interface ResourceSource {
  eid: number;
  x: Fixed;
  y: Fixed;
  tx: number;
  ty: number;
  kind: 'gold' | 'wood';
  /** remaining capacity in resource units (0 == exhausted) */
  capacity: number;
}

const STALE_EIDS = 4096;

interface Stores {
  transform: { get(e: number): { x: Fixed; y: Fixed } | undefined };
  owner: { get(e: number): { player: number } | undefined };
  kind: { get(e: number): { kind: number } | undefined };
  mine: { get(e: number): { capacity: Fixed } | undefined };
  tree: { get(e: number): { capacity: Fixed; felled: boolean } | undefined };
  stats: { get(e: number): { id: string } | undefined };
  health: { get(e: number): { dead: boolean } | undefined };
}

export class Intel {
  /** eid -> last sighting; survives loss of vision as stale memory */
  readonly remembered = new Map<number, SeenUnit>();
  private readonly scouted: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  private readonly st: Stores;

  constructor(
    private readonly game: Game,
    readonly me: number,
  ) {
    this.w = game.terrain.width;
    this.h = game.terrain.height;
    this.scouted = new Uint8Array(this.w * this.h);
    this.st = game.world.stores as unknown as Stores;
  }

  visible(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.game.fog.isVisibleTile(tx, ty, this.me);
  }

  explored(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.game.fog.exploredTile(tx, ty, this.me);
  }

  seesPoint(x: Fixed, y: Fixed): boolean {
    return this.visible(Math.floor(fn(x)), Math.floor(fn(y)));
  }

  /**
   * Refresh sightings from live vision only. An entity outside our visible
   * tiles is never even considered, so no hidden information can leak in.
   */
  observe(tick: number): void {
    const live = this.game.world.live as readonly number[];
    for (const eid of live) {
      const t = this.st.transform.get(eid);
      if (!t) continue;
      if (!this.seesPoint(t.x, t.y)) continue;
      const owner = this.st.owner.get(eid)?.player ?? 0;
      if (owner === this.me) continue; // own units tracked via snapshots
      if (this.st.mine.get(eid) || this.st.tree.get(eid)) continue; // scenery handled below
      if (this.st.kind.get(eid)?.kind !== 0) continue;
      if (this.st.health.get(eid)?.dead) continue;
      const id = this.st.stats.get(eid)?.id ?? '';
      const rec = this.remembered.get(eid);
      const hostile = owner !== 0 && owner !== 11 && !this.isAlly(owner);
      if (rec) {
        rec.x = t.x;
        rec.y = t.y;
        rec.lastSeen = tick;
        rec.hostile = hostile;
        rec.id = id;
        rec.player = owner;
      } else {
        this.remembered.set(eid, {
          eid,
          id,
          player: owner,
          x: t.x,
          y: t.y,
          hpFrac: 1,
          lastSeen: tick,
          hostile,
        });
      }
    }

    // Bound memory size deterministically: evict the oldest when oversized.
    if (this.remembered.size > STALE_EIDS) {
      let oldestEid = -1;
      let oldest = Infinity;
      for (const [eid, r] of this.remembered) {
        if (r.lastSeen < oldest) {
          oldest = r.lastSeen;
          oldestEid = eid;
        }
      }
      if (oldestEid >= 0) this.remembered.delete(oldestEid);
    }
  }

  private isAlly(other: number): boolean {
    const ps = (this.game.players as unknown as Array<{ ally?: { bits: number } } | undefined>)[this.me];
    return !!ps?.ally && ((ps.ally.bits >> other) & 1) === 1;
  }

  /** Hostile contacts whose memory has not expired. */
  hostiles(maxAgeTicks: number, tick: number): SeenUnit[] {
    const out: SeenUnit[] = [];
    for (const r of this.remembered.values()) {
      if (!r.hostile) continue;
      if (tick - r.lastSeen > maxAgeTicks) continue;
      out.push(r);
    }
    return out.sort((a, b) => b.lastSeen - a.lastSeen || a.eid - b.eid);
  }

  /** Resource sources we have physically seen, richest first. */
  sources(kind: 'gold' | 'wood'): ResourceSource[] {
    const out: ResourceSource[] = [];
    const live = this.game.world.live as readonly number[];
    for (const eid of live) {
      const store = kind === 'gold' ? this.st.mine.get(eid) : this.st.tree.get(eid);
      if (!store) continue;
      if (kind === 'wood' && this.st.tree.get(eid)?.felled) continue;
      const t = this.st.transform.get(eid);
      if (!t) continue;
      const tx = Math.floor(fn(t.x));
      const ty = Math.floor(fn(t.y));
      if (!this.explored(tx, ty)) continue; // never seen: does not exist for us
      // NB: mine.capacity is Fixed (gold), tree.capacity is a raw int count of
      // lumber — normalise both to whole resource units here.
      const cap = kind === 'gold' ? fn(store.capacity) : store.capacity;
      out.push({ eid, x: t.x, y: t.y, tx, ty, kind, capacity: cap });
    }
    return out.sort((a, b) => b.capacity - a.capacity || a.eid - b.eid);
  }

  nearestSource(kind: 'gold' | 'wood', x: Fixed, y: Fixed): ResourceSource | null {
    let best: ResourceSource | null = null;
    let bd = Infinity;
    for (const m of this.sources(kind)) {
      if (m.capacity <= 0) continue;
      const d = (fn(m.x) - fn(x)) ** 2 + (fn(m.y) - fn(y)) ** 2;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  markScouted(x: Fixed, y: Fixed): void {
    const tx = Math.floor(fn(x));
    const ty = Math.floor(fn(y));
    if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.scouted[ty * this.w + tx] = 1;
  }

  wasScouted(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h && this.scouted[ty * this.w + tx] === 1;
  }

  /** Furthest explored point from home — a sane "attack out there" fallback. */
  frontierTarget(myX: Fixed, myY: Fixed): { x: Fixed; y: Fixed } {
    let bx = Math.min(this.w - 1, Math.max(0, Math.floor(fn(myX))));
    let by = Math.min(this.h - 1, Math.max(0, Math.floor(fn(myY))));
    let bd = -1;
    for (let ty = 0; ty < this.h; ty += 2) {
      for (let tx = 0; tx < this.w; tx += 2) {
        if (!this.explored(tx, ty)) continue;
        const d = (tx - bx) ** 2 + (ty - by) ** 2;
        if (d > bd) {
          bd = d;
          bx = tx;
          by = ty;
        }
      }
    }
    return { x: ff(bx) + ff(0.5), y: ff(by) + ff(0.5) };
  }
}
