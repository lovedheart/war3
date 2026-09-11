/**
 * Campaign levels: hand-authored fixed maps plus win/lose conditions.
 *
 * Everything a level does to the world after it starts goes out as a serialised
 * `Command` (see `CampaignLevel.script`), so levels replay and record exactly
 * like skirmish matches. The only direct sim call is the initial布置 through
 * `spawnUnit` / `spawnBuilding`, which happen before tick 0 on every client.
 */
import type { Command, Vec2F } from '../sim/commandTypes.js';
import { createGame, unitSpec, type Game, type GameOptions } from '../sim/index.js';
import type { Race } from '../sim/player.js';
import { spawnUnit } from '../sim/spawn.js';
import { loadMapJson } from '../map/mapgen.js';
import { getGameData } from '../data/index.js';
import { ff, fn } from '../core/fixed.js';

import human01 from '../../data/maps/human-01.json';
import human02 from '../../data/maps/human-02.json';
import human03 from '../../data/maps/human-03.json';
import human04 from '../../data/maps/human-04.json';

export interface LevelPlayer {
  id: number;
  race: Race | 'neutral';
  name: string;
  startGold?: number;
  startLumber?: number;
  /** driven by `script`, never by a local controller */
  computer?: boolean;
}

export type WinCondition =
  | { kind: 'killAll'; enemy: number[] }
  | { kind: 'survive'; ticks: number }
  | { kind: 'reach'; x: number; y: number; radius?: number }
  | { kind: 'build'; buildingId: string };

export type LoseCondition = { kind: 'lossUnit'; unitId: string } | { kind: 'lossAnyBuilding' } | { kind: 'timeout'; ticks: number };

export interface CampaignLevel {
  id: string;
  title: string;
  /** opening briefing shown before the first tick */
  brief: string;
  /** persistent HUD objective line */
  objective: string;
  map: unknown;
  players: LevelPlayer[];
  /** starting roster placed at load time through the sim's own spawn API */
  startUnits?: { unitId: string; player: number; x: number; y: number }[];
  /** scripted intents, applied in tick order — the only in-match mutation path */
  script?: [tick: number, Command][];
  win: WinCondition;
  lose: LoseCondition;
  parSeconds: number;
}

/* ------------------------------------------------------------------ */
/* level table                                                         */
/* ------------------------------------------------------------------ */

const LEVELS: Record<string, CampaignLevel> = {
  'human-01': {
    id: 'human-01',
    title: '初醒的营地',
    brief: '你们的船在风暴里散了。眼下只有四名伐木工和一座勉强立起来的厅堂——先把金矿挖开，再竖起兵营，天黑前必须有人能握剑。',
    objective: '采集黄金并建成一座人类兵营',
    map: human01,
    players: [
      { id: 1, race: 'human', name: '营地指挥官' },
      { id: 2, race: 'orc', name: '游荡劫掠队', computer: true },
    ],
    win: { kind: 'build', buildingId: 'barracks_human' },
    lose: { kind: 'timeout', ticks: 30 * 60 * 6 },
    parSeconds: 300,
  },
  'human-02': {
    id: 'human-02',
    title: '双桥渡口',
    brief: '河只在这里让出两条浅滩。兽人知道这一点，所以每个时辰都会再压上来一次。守住渡口，撑到援军的号角响起。',
    objective: '守住基地，坚持到敌军攻势结束',
    map: human02,
    players: [
      { id: 1, race: 'human', name: '渡口守备官' },
      { id: 2, race: 'orc', name: '渡口围攻军', computer: true },
    ],
    win: { kind: 'survive', ticks: 30 * 60 * 5 },
    lose: { kind: 'lossAnyBuilding' },
    parSeconds: 300,
  },
  'human-03': {
    id: 'human-03',
    title: '佣兵哨垒',
    brief: '东去的唯一通路被一伙豺狼人哨垒卡住。他们不效忠任何人，只认钱和刀。清掉哨垒，把旗帜插到山口另一侧。',
    objective: '铲除豺狼人哨垒，并把部队带到东侧山口',
    map: human03,
    players: [
      { id: 1, race: 'human', name: '山口远征队' },
      { id: 2, race: 'orc', name: '豺狼人雇佣兵', computer: true },
    ],
    win: { kind: 'reach', x: 38, y: 22, radius: 4 },
    lose: { kind: 'timeout', ticks: 30 * 60 * 9 },
    parSeconds: 480,
  },
  'human-04': {
    id: 'human-04',
    title: '终局平原',
    brief: '没有退路了。平原对面是他们全部的营帐——把每一条会走路的兵力都推上去，让他们的营地不再存在。',
    objective: '摧毁敌方全部营地',
    map: human04,
    players: [
      { id: 1, race: 'human', name: '联军统帅' },
      { id: 2, race: 'orc', name: '平原大营', computer: true },
    ],
    win: { kind: 'killAll', enemy: [2] },
    lose: { kind: 'lossAnyBuilding' },
    parSeconds: 720,
  },
};

export function listLevels(): { id: string; title: string }[] {
  return Object.values(LEVELS).map((l) => ({ id: l.id, title: l.title }));
}

export function loadLevel(id: string): CampaignLevel {
  const l = LEVELS[id];
  if (!l) throw new Error(`unknown level: ${id}`);
  return l;
}

/* ------------------------------------------------------------------ */
/* boot a level                                                        */
/* ------------------------------------------------------------------ */

interface LevelRuntime {
  script: [tick: number, Command][];
  cursor: number;
  level: CampaignLevel;
}

const runtimes = new WeakMap<Game, LevelRuntime>();

/** Build a `Game` for the level and attach its scripted track. */
export function startLevel(id: string, seed: number): Game {
  const level = loadLevel(id);
  const gen = loadMapJson(level.map);
  const opts: GameOptions = {
    seed,
    map: gen,
    players: level.players.map((p) => ({
      id: p.id,
      race: p.race as Race,
      name: p.name,
      startGold: p.startGold,
      startLumber: p.startLumber,
    })),
  };
  const game = createGame(opts);

  // Extra spawns beyond the first are used by levels that need a second base or
  // a creep camp; place them for every player that declared one.
  const gd = getGameData();
  for (const u of level.startUnits ?? []) {
    const def = gd.units.get(u.unitId);
    if (!def) throw new Error(`${level.id}: unknown unitId ${u.unitId}`);
    spawnUnit(game.world as never, unitSpec(def) as never, ff(u.x + 0.5), ff(u.y + 0.5), u.player);
  }

  runtimes.set(game, { script: [...(level.script ?? [])], cursor: 0, level });
  return game;
}

/**
 * Advance the game by `ticks`, injecting scripted Commands at their tick.
 * Use this instead of `game.update()` inside levels so the enemy waves stay
 * data-driven (and therefore replayable).
 */
export function updateLevel(game: Game, ticks = 1): 'win' | 'lose' | null {
  const rt = runtimes.get(game);
  if (!rt) {
    game.update(ticks);
    return null;
  }
  let outcome: 'win' | 'lose' | null = null;
  for (let i = 0; i < ticks && !outcome; i++) {
    while (rt.cursor < rt.script.length && rt.script[rt.cursor][0] <= game.world.tick) {
      game.command(rt.script[rt.cursor][1]);
      rt.cursor++;
    }
    game.update(1);
    outcome = checkOutcome(game, rt.level);
  }
  return outcome;
}

/** Evaluate win/lose. Returns null while the level is still running. */
export function checkOutcome(game: Game, level: CampaignLevel): 'win' | 'lose' | null {
  const snap = game.snapshot();
  const tick = game.world.tick;

  if (level.win.kind === 'survive' && tick >= level.win.ticks) return 'win';
  if (level.lose.kind === 'timeout' && tick >= level.lose.ticks) return 'lose';

  switch (level.win.kind) {
    case 'killAll': {
      const alive = level.win.enemy.filter((p) => snap.units.some((u) => u.player === p) || snap.buildings.some((b) => b.player === p));
      if (!alive.length) return 'win';
      break;
    }
    case 'build': {
      const want = level.win.buildingId;
      if (snap.buildings.some((b) => b.built && b.id === want && b.player === 1)) return 'win';
      break;
    }
    case 'reach': {
      const w = level.win;
      const r = w.radius ?? 2;
      const hit = snap.units.some((u) => u.player === 1 && Math.abs(u.x - w.x) <= r && Math.abs(u.y - w.y) <= r);
      if (hit) return 'win';
      break;
    }
    case 'survive':
      break;
  }

  switch (level.lose.kind) {
    case 'lossUnit': {
      const want = level.lose.unitId;
      if (!snap.units.some((u) => u.player === 1 && u.id === want)) return 'lose';
      break;
    }
    case 'lossAnyBuilding': {
      if (!snap.buildings.some((b) => b.player === 1)) return 'lose';
      break;
    }
    case 'timeout':
      break;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* helpers for authoring scripts and tests                             */
/* ------------------------------------------------------------------ */

export function atTile(x: number, y: number): Vec2F {
  return { x: ff(x) + ff(0.5), y: ff(y) + ff(0.5) };
}

/** Every eid owned by `player` matching `id` (or all units when omitted). */
export function eidsOf(game: Game, player: number, id?: string): number[] {
  return game.snapshot().units.filter((u) => u.player === player && (!id || u.id === id)).map((u) => u.eid);
}

/** First built building of this player with the given id. */
export function buildingOf(game: Game, player: number, id: string): number {
  return game.snapshot().buildings.find((b) => b.player === player && b.id === id && b.built)?.eid ?? 0xffffffff;
}

export { ff as fixedFromNumber, fn as numberFromFixed };
