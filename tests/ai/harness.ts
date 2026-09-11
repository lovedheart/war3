/**
 * Shared harness for the AI test suite.
 *
 * Wraps a Game so every Command the AI issues is captured (by hooking the
 * public `game.command` seam — the AI's single mutation point) without poking
 * at any private field of src/ai. Commands are validated against the shape of
 * the `Command` union in src/sim/commandTypes.ts: JSON-safe and referencing
 * only legal players / entities.
 */
import { createGame, type Game, type Command } from '../../src/sim/index.js';
import { createAiController, type AiController, type Difficulty } from '../../src/ai/index.js';
import { Rng } from '../../src/core/rng.js';

export const PLAYERS = [
  { id: 1, race: 'human' as const, name: 'P1' },
  { id: 2, race: 'orc' as const, name: 'P2' },
];

export interface Cap {
  tick: number;
  cmd: Command;
}

export interface Sim {
  game: Game;
  ais: Map<number, AiController>;
  /** all commands ever issued by any attached AI, in issue order */
  caps: Cap[];
  commandsFor(player: number): Command[];
  run(ticks: number): void;
}

export interface SimOpts {
  seed: number;
  difficulties?: Partial<Record<number, Difficulty>>; // player -> difficulty (default 'normal')
  attach?: number[]; // player ids driven by AI (default [1,2])
  size?: number;
}

const MOVE_MODES = new Set(['move', 'attack', 'attackMove', 'patrol', 'follow']);
const KINDS = new Set(['gold', 'wood']);

/** Deep JSON-safety check: no functions / undefined / NaN / non-plain containers. */
export function jsonSafe(v: unknown, path = '$'): string | null {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) return `${path}: non-finite number`;
    return null;
  }
  if (t === 'string' || t === 'boolean') return null;
  if (t === 'function' || t === 'symbol' || t === 'bigint' || v === undefined) return `${path}: ${t}`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const e = jsonSafe(v[i], `${path}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return `${path}: non-plain object (${proto?.constructor?.name ?? 'null-proto'})`;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined) return `${path}.${k}: undefined value`;
      const e = jsonSafe(x, `${path}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return `${path}: ${t}`;
}

function checkCmd(cmd: Command): string | null {
  const bad = jsonSafe(cmd);
  if (bad) return bad;
  const c = cmd as unknown as Record<string, unknown>;
  switch (c.k) {
    case 'move':
      if (!MOVE_MODES.has(c.mode as string)) return `bad mode ${String(c.mode)}`;
      break;
    case 'harvest':
      if (!KINDS.has(c.kind as string)) return `bad kind ${String(c.kind)}`;
      break;
    case 'upkeep':
      if (c.mode !== 0 && c.mode !== 1 && c.mode !== 2) return `bad upkeep mode`;
      break;
  }
  return null;
}

export function makeSim(opts: SimOpts): Sim {
  const game = createGame({ seed: opts.seed, size: opts.size ?? 96, players: PLAYERS });
  const attach = opts.attach ?? [1, 2];
  const caps: Cap[] = [] as Cap[];
  const sim: Sim = {
    game,
    ais: new Map(),
    caps,
    commandsFor(player: number) {
      return caps.filter((c) => (c.cmd as { player?: number }).player === player).map((c) => c.cmd);
    },
    run(ticks: number) {
      for (let i = 0; i < ticks; i++) {
        for (const ai of sim.ais.values()) ai.update();
        game.update(1);
      }
    },
  };
  // Hook the public command seam BEFORE any AI is attached. The hook validates
  // each command eagerly (issue-time world state), then defers legality re-use
  // checks to `run` boundaries via live() at drain time — close enough since
  // drains happen on the very next update(1).
  const origCommand = game.command.bind(game);
  game.command = (cmd: Command) => {
    const err = checkCmd(cmd);
    if (err) throw new Error(`illegal command payload at t=${game.world.tick}: ${err} :: ${JSON.stringify(summarize(cmd))}`);
    caps.push({ tick: game.world.tick, cmd });
    origCommand(cmd);
  };
  for (const p of attach) {
    const diff = opts.difficulties?.[p] ?? 'normal';
    sim.ais.set(p, createAiController(game, p, diff, new Rng(opts.seed * 7 + p)));
  }
  return sim;
}

function summarize(cmd: Command): Record<string, unknown> {
  const c = { ...(cmd as unknown as Record<string, unknown>) };
  for (const k of ['to', 'at']) if (c[k]) c[k] = `<${(c[k] as { x: number }).x},${(c[k] as { y: number }).y}>`;
  return c;
}

/**
 * Legality audit over captured commands against the CURRENT world:
 * every referenced eid must be (or have been) alive and owned by the issuing
 * player where ownership matters; player must be one of the seats.
 * Pass `liveAt(tick)` snapshots if you need strict per-tick checks; here we
 * allow "alive now OR seen alive at any earlier snapshot" to avoid flagging
 * legitimately-then-dead targets.
 */
export function auditLegality(sim: Sim, everSeenEids: Set<number>): string[] {
  const problems: string[] = [];
  const seats = new Set([1, 2]);
  for (const { tick, cmd } of sim.caps) {
    const c = cmd as unknown as Record<string, unknown>;
    const p = c.player as number;
    if (!seats.has(p)) problems.push(`t=${tick}: command for illegal player ${p}`);
    const eids: number[] = [];
    if (Array.isArray(c.units)) eids.push(...(c.units as number[]));
    for (const f of ['worker', 'building', 'entity', 'target', 'caster', 'unit', 'hero', 'from', 'to']) {
      const v = c[f];
      if (typeof v === 'number' && v !== 0xffffffff) eids.push(v);
    }
    for (const e of eids) {
      if (!Number.isInteger(e) || e <= 0) problems.push(`t=${tick} ${String(c.k)}: illegal eid ${e}`);
      else if (!everSeenEids.has(e)) problems.push(`t=${tick} ${String(c.k)}: eid ${e} never existed`);
    }
  }
  return problems;
}

/** Snapshot helper: resources row for a player. */
export function resOf(sim: Sim, player: number) {
  return sim.game.snapshot().resources.find((r) => r.player === player)!;
}
