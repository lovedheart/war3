/**
 * Central simulation world. Owns entity lifecycle, the ordered system pipeline
 * and the deterministic tick.
 *
 * ⚠ COORDINATION CONTRACT (other agents implement systems against this file):
 *   - Systems are plain functions `(w: World, tick: number) => void`, registered
 *     in `WORLD.systems` in execution order. Do NOT reorder existing entries.
 *   - Structural changes (create/destroy) are deferred: call `world.createEntity`
 *     / `world.destroyEntity`; they apply at the START of the next tick, so no
 *     system may assume the entity set is stable mid-tick.
 *   - All randomness MUST come from `world.rng`. All time from `tick`.
 */
import { Fixed, ff } from '../core/fixed.js';
import { Rng } from '../core/rng.js';
import { Hasher } from '../core/hash.js';
import { EventBus } from '../core/eventbus.js';
import { EntityPool, Eid } from '../core/pool.js';
import { ComponentRegistry, Store } from '../ecs/store.js';
import type { Command } from './commandTypes.js';
import type { ViewState } from './view.js';

export type SystemFn = (w: World, tick: number) => void;

export interface WorldEvents extends Record<string, unknown> {
  'unit:died': { eid: Eid; killer: Eid | null; tick: number };
  'unit:created': { eid: Eid; unitId: string; player: number };
  'building:constructed': { eid: Eid; buildingId: string; player: number };
  'damage': { src: Eid; dst: Eid; amount: Fixed; tick: number };
  'ability:cast': { caster: Eid; abilityId: string; tick: number };
  'item:picked': { unit: Eid; itemId: string; slot: number };
  'creep:campCleared': { player: number; x: number; y: number };
  'game:over': { winner: number; reason: string };
  'log': { level: 'info' | 'warn' | 'error'; msg: string };
}

/** Minimal structural contracts so this file compiles without the subsystems. */
export interface SimTerrainLike {
  isWalkable(tx: number, ty: number): boolean;
  width: number;
  height: number;
}
export interface SimFogLike {
  markSeen(tx: number, ty: number, r: number, player: number): void;
  isVisibleTile(tx: number, ty: number, player: number): boolean;
}

export class World {
  readonly pool = new EntityPool();
  readonly registry = new ComponentRegistry();
  readonly bus = new EventBus<WorldEvents>();
  readonly rng: Rng;
  readonly dead: Eid[] = [];

  /** live entity ids, ascending index order — canonical iteration order */
  readonly live: number[] = [];
  private pendingCreate: Eid[] = [];
  private pendingDestroy: Set<number> = new Set();

  tick = 0;
  readonly seed: number;

  /** populated by app wiring; typed loosely to avoid a hard map dependency */
  terrain: SimTerrainLike | null = null;
  fog: SimFogLike | null = null;
  quad: { query(x: Fixed, y: Fixed, r: Fixed, out: number[]): number[] } | null = null;
  view: ViewState = { cameraX: 0, cameraY: 0, zoom: ff(1), selection: [], hoverEid: 0xffffffff };

  /** filled in by src/sim/index.ts wiring */
  stores!: Record<string, Store<object>>;
  systems: SystemFn[] = [];

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new Rng(seed);
  }

  createEntity(): Eid {
    const eid = this.pool.acquire();
    this.pendingCreate.push(eid);
    return eid;
  }

  destroyEntity(eid: Eid): void {
    if (!this.pool.valid(eid)) return;
    this.pendingDestroy.add(eid);
  }

  alive(eid: Eid): boolean {
    return this.pool.valid(eid) && !this.pendingDestroy.has(eid);
  }

  /** Apply deferred creations. Called once per tick before systems. */
  private flushCreations(): void {
    for (const eid of this.pendingCreate) this.live.push(eid);
    // ascending eid order; eids are unsigned so comparison is exact
    this.live.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    this.pendingCreate.length = 0;
  }

  private flushDestructions(): void {
    if (this.pendingDestroy.size === 0) return;
    let w = 0;
    for (let i = 0; i < this.live.length; i++) {
      const e = this.live[i];
      if (!this.pendingDestroy.has(e)) this.live[w++] = e;
      else {
        for (const s of this.registry.all()) s.clear(e >>> 20);
        this.pool.release(e);
      }
    }
    this.live.length = w;
    this.pendingDestroy.clear();
  }

  tickOnce(): void {
    this.tick++;
    this.flushDestructions();
    this.flushCreations();
    for (const sys of this.systems) sys(this, this.tick);
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tickOnce();
  }

  queueCommand(cmd: Command): void {
    const q = { tick: this.tick + 1, cmd };
    this.commandQueue.push(q);
    // Append-only record of everything that entered the queue, for replays.
    // Pure bookkeeping (never read by systems), so stateHash is untouched.
    this.commandLog.push(q);
  }

  /** Commands applied at the start of the next tick (before systems). */
  readonly commandQueue: { tick: number; cmd: Command }[] = [];
  /** Every command ever queued, in order — the replay recording. */
  readonly commandLog: { tick: number; cmd: Command }[] = [];
  /** Handler installed by src/sim/command.ts */
  applyCommand: ((w: World, cmd: Command) => void) | null = null;

  drainCommands(): void {
    let w = 0;
    for (let i = 0; i < this.commandQueue.length; i++) {
      const q = this.commandQueue[i];
      if (q.tick <= this.tick) {
        if (this.applyCommand) this.applyCommand(this, q.cmd);
      } else this.commandQueue[w++] = q;
    }
    this.commandQueue.length = w;
  }

  /** Canonical state hash for determinism tests / replay divergence checks. */
  stateHash(): number {
    const h = new Hasher();
    h.int(this.seed).int(this.tick).int(this.live.length);
    for (const e of this.live) {
      h.int(e);
      for (const s of this.registry.all()) {
        const c = s.get(e as Eid);
        if (!c) continue;
        h.str(s.name);
        hashValue(h, c);
      }
    }
    h.int(this.rng.save()[0]);
    h.int(this.rng.save()[1]);
    return h.digest();
  }
}

function hashValue(h: Hasher, v: unknown): void {
  if (typeof v === 'number') h.int(v);
  else if (typeof v === 'string') h.str(v);
  else if (typeof v === 'boolean') h.int(v ? 1 : 0);
  else if (Array.isArray(v)) {
    h.int(v.length);
    for (const x of v) hashValue(h, x);
  } else if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    h.int(keys.length);
    for (const k of keys) {
      h.str(k);
      hashValue(h, (v as Record<string, unknown>)[k]);
    }
  } else h.int(0);
}

export const WORLD_TIME_STEP = ff(1) / 30; // convenience for docs only
