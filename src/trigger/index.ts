/**
 * Trigger runtime: declarative, deterministic game scripts.
 *
 * A trigger is `condition -> action` evaluated against the sim. It NEVER mutates
 * state directly — every effect that changes the world goes out as a Command (or
 * through an explicit, documented sim hook), so replays stay valid.
 *
 * Determinism rules:
 *  - conditions read only (snapshot / stores), never write;
 *  - timers are tick-based, so the same seed + same commands fire in the same order;
 *  - no Math.random / Date.now.
 */
import type { Command } from '../sim/commandTypes.js';
import type { Game } from '../sim/index.js';
import { ff, fn } from '../core/fixed.js';

export interface TriggerCtx {
  game: Game;
  /** enqueue player/AI intent; the ONLY mutation path available to actions */
  command(cmd: Command): void;
  /** fire-and-forget log line for the UI console */
  say(text: string): void;
}

export interface Condition {
  /** human-readable form, surfaced by the debug overlay */
  describe(): string;
  eval(ctx: TriggerCtx): boolean;
}

export interface Action {
  describe(): string;
  run(ctx: TriggerCtx): void;
}

export interface Trigger {
  id: string;
  once?: boolean;
  /** evaluate at most every N ticks (default 15 = twice a second) */
  period?: number;
  enabled?: boolean;
  when: Condition[];
  then: Action[];
}

/* ------------------------------------------------------------------ */
/* conditions                                                          */
/* ------------------------------------------------------------------ */

export function elapsed(ticks: number): Condition {
  return {
    describe: () => `elapsed >= ${ticks}t`,
    eval: (c) => c.game.world.tick >= ticks,
  };
}

export function goldAtLeast(player: number, amount: number): Condition {
  return {
    describe: () => `p${player}.gold >= ${amount}`,
    eval: (c) => (c.game.players[player]?.gold ?? 0) >= ff(amount),
  };
}

export function unitCount(player: number, min: number, unitId?: string): Condition {
  return {
    describe: () => `p${player}.units(${unitId ?? 'any'}) >= ${min}`,
    eval: (c) => {
      const s = c.game.snapshot();
      const n = s.units.filter((u) => u.player === player && (!unitId || u.id === unitId)).length;
      return n >= min;
    },
  };
}

export function buildingsLost(player: number, max: number): Condition {
  return {
    describe: () => `p${player}.buildings <= ${max}`,
    eval: (c) => c.game.snapshot().buildings.filter((b) => b.player === player).length <= max,
  };
}

export function enemyNear(x: number, y: number, radius: number, viewer: number): Condition {
  return {
    describe: () => `enemy within ${radius} of (${x},${y})`,
    eval: (c) => {
      const r2 = radius * radius;
      for (const u of c.game.snapshot().units) {
        if (u.player === viewer || u.player === 0) continue;
        // Only count what the viewer can actually see — triggers must not leak
        // information the fog says is hidden.
        if (!c.game.fog.isVisibleTile(Math.floor(u.x), Math.floor(u.y), viewer)) continue;
        const dx = u.x - x;
        const dy = u.y - y;
        if (dx * dx + dy * dy <= r2) return true;
      }
      return false;
    },
  };
}

export function allOf(...cs: Condition[]): Condition {
  return { describe: () => cs.map((c) => c.describe()).join(' AND '), eval: (x) => cs.every((c) => c.eval(x)) };
}

export function anyOf(...cs: Condition[]): Condition {
  return { describe: () => cs.map((c) => c.describe()).join(' OR '), eval: (x) => cs.some((c) => c.eval(x)) };
}

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

export function doCommand(make: () => Command): Action {
  return { describe: () => `command`, run: (c) => c.command(make()) };
}

export function announce(text: string): Action {
  return { describe: () => `say "${text}"`, run: (c) => c.say(text) };
}

/** Order every owned living unit of a player to attack-move somewhere. */
export function attackMoveAll(
  player: number,
  to: { x: number; y: number },
  opts: { includeWorkers?: boolean } = {},
): Action {
  return {
    describe: () => `p${player} attack-move -> (${to.x},${to.y})`,
    run: (c) => {
      const units = c.game
        .snapshot()
        .units.filter((u) => u.player === player && (opts.includeWorkers || (u.id !== 'peasant' && u.id !== 'peon')))
        .map((u) => u.eid);
      if (!units.length) return;
      c.command({ k: 'move', player, units, to: { x: ff(to.x), y: ff(to.y) }, mode: 'attackMove' });
    },
  };
}

/* ------------------------------------------------------------------ */
/* engine                                                              */
/* ------------------------------------------------------------------ */

export interface TriggerEngine {
  add(t: Trigger): void;
  remove(id: string): void;
  /** call once per tick, after the world has advanced */
  step(ctx: TriggerCtx): string[];
  readonly fired: string[];
  list(): Trigger[];
}

export function createTriggerEngine(): TriggerEngine {
  const triggers = new Map<string, Trigger>();
  const lastEval = new Map<string, number>();
  const fired: string[] = [];

  return {
    add(t) {
      triggers.set(t.id, t);
      lastEval.set(t.id, -1);
    },
    remove(id) {
      triggers.delete(id);
      lastEval.delete(id);
    },
    list: () => [...triggers.values()],
    get fired() {
      return fired;
    },
    step(ctx) {
      const tick = ctx.game.world.tick;
      const justFired: string[] = [];
      // Stable iteration order: insertion order of the Map, which is identical
      // on every client because levels declare triggers statically.
      for (const t of [...triggers.values()]) {
        if (t.enabled === false) continue;
        const prev = lastEval.get(t.id) ?? -1;
        const period = t.period ?? 15;
        if (tick - prev < period) continue;
        lastEval.set(t.id, tick);
        if (!t.when.every((cond) => cond.eval(ctx))) continue;
        for (const a of t.then) a.run(ctx);
        justFired.push(t.id);
        fired.push(t.id);
        if (t.once) triggers.delete(t.id);
      }
      return justFired;
    },
  };
}

/** Debug helper: render the whole script as text for the overlay. */
export function describeTriggers(eng: TriggerEngine): string[] {
  return eng.list().map((t) => `${t.id}: ${t.when.map((c) => c.describe()).join(' & ')} -> ${t.then.map((a) => a.describe()).join('; ')}`);
}

export { ff as toFixed, fn as toNumber };
