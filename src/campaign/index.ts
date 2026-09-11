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
import { spawnBuilding, spawnUnit } from '../sim/spawn.js';
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
  /** bases settled at extra spawn points beyond the per-player ones */
  extraStarts?: { id: number; race: Race; workers?: number }[];
  /**
   * Declarative build/train policy for the scripted enemy. Emitted as ordinary
   * Commands, so it stays deterministic and recordable.
   */
  ai?: EnemyPolicy;
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
    ai: {
      player: 2,
      workerId: 'peon',
      home: { x: 25, y: 8 },
      farms: [{ at: { x: 27, y: 11 }, every: 900 }],
      buildings: [{ buildingId: 'baracks_orc', at: { x: 22, y: 11 }, after: 1200 }],
      army: [{ unitId: 'grunt', cap: 4, from: 3600 }],
      // A tutorial raid: late and small, so a player who built a barracks wins first.
      wave: { to: { x: 9, y: 17 }, every: 4800, start: 9000, minUnits: 3 },
    },
    win: { kind: 'build', buildingId: 'barracks_human' },
    lose: { kind: 'timeout', ticks: 30 * 60 * 12 },
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
    ai: {
      workerId: 'peon',
      home: { x: 31, y: 8 },
      farms: [
        { at: { x: 34, y: 11 }, every: 900 },
        { at: { x: 36, y: 13 }, every: 900 },
      ],
      buildings: [{ buildingId: 'baracks_orc', at: { x: 28, y: 12 }, after: 600 }],
      army: [{ unitId: 'grunt', cap: 8, from: 1800 }],
      wave: { to: { x: 12, y: 29 }, every: 2400, start: 3000, minUnits: 3 },
    },
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
    extraStarts: [{ id: 2, race: 'orc', workers: 4 }],
    ai: {
      player: 2,
      workerId: 'peon',
      home: { x: 38, y: 7 },
      farms: [
        { at: { x: 41, y: 9 }, every: 900 },
        { at: { x: 40, y: 12 }, every: 900 },
      ],
      buildings: [{ buildingId: 'baracks_orc', at: { x: 35, y: 10 }, after: 600 }],
      army: [{ unitId: 'grunt', cap: 10, from: 1500 }],
      wave: { to: { x: 24, y: 22 }, every: 2100, start: 2700, minUnits: 4 },
    },
    win: { kind: 'reach', x: 38, y: 22, radius: 4 },
    lose: { kind: 'timeout', ticks: 30 * 60 * 12 },
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
    extraStarts: [{ id: 2, race: 'orc', workers: 4 }],
    ai: {
      player: 2,
      workerId: 'peon',
      home: { x: 40, y: 9 },
      farms: [
        { at: { x: 43, y: 12 }, every: 800 },
        { at: { x: 41, y: 14 }, every: 800 },
        { at: { x: 44, y: 15 }, every: 800 },
      ],
      buildings: [{ buildingId: 'baracks_orc', at: { x: 37, y: 12 }, after: 450 }],
      army: [{ unitId: 'grunt', cap: 14, from: 1200 }],
      wave: { to: { x: 14, y: 38 }, every: 2700, start: 3300, minUnits: 6 },
    },
    win: { kind: 'killAll', enemy: [2] },
    lose: { kind: 'timeout', ticks: 30 * 60 * 20 },
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

  runtimes.set(game, { script: [...(level.script ?? [])], cursor: 0, level });
  attachPolicy(game, level);

  // A level may claim more of the map's spawn points than it has players for
  // (a forward camp, an enemy base that must exist from tick 0). `createGame`
  // only settles the first N, so settle the rest through the same data path.
  const gd0 = getGameData();
  for (let i = level.players.length; i < gen.spawns.length; i++) {
    const lp = level.extraStarts?.[i - level.players.length];
    if (!lp) break;
    const sp = gen.spawns[i];
    const hall = gd0.buildings.get(gd0.races[lp.race]?.townHall ?? '');
    const worker = gd0.units.get(gd0.races[lp.race]?.worker ?? '');
    if (!hall || !worker) continue;
    const tx = Math.floor(fn(sp.x)) - 2;
    const ty = Math.floor(fn(sp.y)) - 2;
    spawnBuilding(game.world as never, buildingSpec(hall) as never, tx, ty, lp.id, true);
    for (let k = 0; k < (lp.workers ?? 4); k++) {
      const e = spawnUnit(
        game.world as never,
        unitSpec(worker) as never,
        sp.x + ff(k % 2) - ff(1),
        sp.y + ff(Math.floor(k / 2)) + ff(2),
        lp.id,
      );
      // placeStart() sets this; without it a worker cannot carry anything.
      const cargo = (game.world.stores as unknown as { cargo: { add(x: number): { capacity: number } } }).cargo.add(e);
      cargo.capacity = ff((worker as unknown as { carryCapacity?: number }).carryCapacity ?? 10);
    }
  }

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
  for (let i = 0; i < ticks; i++) {
    while (rt.cursor < rt.script.length && rt.script[rt.cursor][0] <= game.world.tick) {
      game.command(rt.script[rt.cursor][1]);
      rt.cursor++;
    }
    stepPolicy(game);
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



/** Turn a data-table building row into a spawn spec (mirrors sim internals). */
export function buildingSpec(d: { id: string; race?: string; stats: { hp: number; armor: number; armorType: string }; footprint: [number, number]; supplies?: number; providesSupply?: number; buildTime?: number }) {
  return {
    id: d.id,
    race: d.race,
    hp: d.stats.hp,
    armor: d.stats.armor,
    armorType: d.stats.armorType,
    w: d.footprint[0],
    h: d.footprint[1],
    supplyProvided: d.providesSupply ?? d.supplies ?? 0,
    buildTime: d.buildTime,
  };
}


/* ------------------------------------------------------------------ */
/* declarative enemy policy                                            */
/* ------------------------------------------------------------------ */

/** What a scripted (non-AI) player should be doing over time. */
export interface EnemyPolicy {
  workerId: string;
  home: { x: number; y: number };
  farms: { at: { x: number; y: number }; every: number }[];
  buildings: { buildingId: string; at: { x: number; y: number }; after: number }[];
  army: { unitId: string; cap: number; from: number }[];
  /** which seat the policy drives (default 2) */
  player?: number;
  /** waves: attack-move the whole army here, once every `every` ticks */
  wave: { to: { x: number; y: number }; every: number; start: number; minUnits: number };
}


function orders(game: Game, eid: number): { current: { kind: string } } | undefined {
  return (game.world.stores as unknown as { orders?: { get(e: number): { current: { kind: string } } | undefined } })
    .orders?.get(eid);
}

const IDLE_ORDERS = new Set(['none', 'move']);

interface PolicyRuntime {
  policy: EnemyPolicy;
  workers: number[];
  nextFarm: number;
  tick: number;
  built: Set<string>;
  lastTrain: number;
  lastWave: number;
  done: boolean;
}

const policies = new WeakMap<Game, PolicyRuntime>();

/** Arm a level's enemy policy on a game returned by `startLevel`. */
export function attachPolicy(game: Game, level: CampaignLevel): void {
  if (!level.ai) return;
  policies.set(game, {
    policy: level.ai,
    workers: [],
    nextFarm: 0,
    tick: -1,
    built: new Set(),
    lastTrain: -99999,
    lastWave: -99999,
    done: false,
  });
}

/**
 * eids owned by `player` whose type id passes `pred`. Reads the live stores
 * rather than a snapshot: entities spawned during level setup only enter the
 * snapshot after the first tick, and a policy that fires at tick 0 would
 * otherwise see an empty world and send `undefined` as its worker.
 */
function ownerEids(game: Game, player: number, pred: (id: string) => boolean): number[] {
  const w = game.world as unknown as {
    live: number[];
    stores: {
      owner?: { get(e: number): { player: number } | undefined };
      stats?: { get(e: number): { id: string } | undefined };
    };
  };
  const out: number[] = [];
  for (const e of w.live) {
    if ((w.stores.owner?.get(e)?.player ?? 0) !== player) continue;
    const id = w.stores.stats?.get(e)?.id ?? '';
    if (pred(id)) out.push(e);
  }
  if (out.length) return out;
  // Pre-tick fallback: entity ids are allocated in spawn order, so read them
  // straight out of the owner store.
  const st = w.stores.owner;
  if (!st) return [];
  for (let i = 1; i < 4096; i++) {
    const c = i << 16;
    if (st.get(c)?.player === player && pred(w.stores.stats?.get(c)?.id ?? '')) out.push(c);
  }
  return out;
}
 
/** Run one tick of a level's enemy policy. Call right before `game.update`. */
export function stepPolicy(game: Game): void {
  const rt = policies.get(game);
  if (!rt || rt.done) return;
  const p = rt.policy;
  const tick = game.world.tick;
  const snap = game.snapshot();
  const who = p.player ?? 2;
  const me = snap.resources.find((r) => r.player === who);
  if (!me) return;

  rt.workers = ownerEids(game, who, (id) => id === p.workerId);
  // Workers do the economy: two on gold, one on the nearest trees, and any
  // worker left with no order walks back to the patch so it re-acquires one.
  // Workers do the economy: two on gold, one on the nearest trees. A worker
  // whose order fell through (felled tree, dead mine) is re-tasked; one that is
  // walking to a construction site or raising it is left alone.
  if (rt.tick === tick) return;
  rt.tick = tick;
  const tr = game.world.stores.transform as unknown as { get(e: number): { x: number; y: number } | undefined };
  const near = (from: number, list: number[], pred: (e: number) => boolean): number => {
    let best = 0, bd = Infinity;
    const t0 = tr.get(from);
    if (!t0) return list[0] ?? 0;
    for (const e of list) {
      if (!pred(e)) continue;
      const t = tr.get(e);
      if (!t) continue;
      const d = (t.x - t0.x) ** 2 + (t.y - t0.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };
  const mines = (game.world as unknown as { goldMines?: number[] }).goldMines ?? [];
  const trees = (game.world as unknown as { trees?: number[] }).trees ?? [];
  const treeAlive = (e: number) => !(game.world.stores as unknown as { tree?: { get(x: number): { felled?: boolean } | undefined } }).tree?.get(e)?.felled;
  rt.workers.forEach((w, i) => {
    const ord = orders(game, w);
    if (ord && !IDLE_ORDERS.has(ord.current.kind)) return;
    if (i % 3 === 2 && trees.length) {
      const t = near(w, trees, treeAlive);
      if (t) game.command({ k: 'harvest', player: who, worker: w, target: t, kind: 'wood' });
    } else if (mines.length) {
      game.command({ k: 'harvest', player: who, worker: w, target: mines[i % mines.length], kind: 'gold' });
    } else {
      game.command({ k: 'move', player: who, units: [w], to: atTile(p.home.x, p.home.y), mode: 'move' });
    }
  });

  for (let i = rt.nextFarm; i < p.farms.length; i++) {
    if (me.gold < 90 || me.lumber < 25) break;
    game.command({ k: 'build', player: who, worker: rt.workers[i % Math.max(1, rt.workers.length)], buildingId: 'burrow', at: atTile(p.farms[i].at.x, p.farms[i].at.y) });
    rt.nextFarm = i + 1;
  }
  for (const b of p.buildings) {
    if (rt.built.has(b.buildingId) || tick < b.after || me.gold < 200 || me.lumber < 70) continue;
    game.command({ k: 'build', player: who, worker: rt.workers[0], buildingId: b.buildingId, at: atTile(b.at.x, b.at.y) });
    rt.built.add(b.buildingId);
  }

  {
    const stores = game.world.stores as unknown as { building?: { get(e: number): { built: boolean; trainQueue: unknown[]; buildingId: string } | undefined } };
    // Military producers are exactly the buildings whose `trains` list mentions
    // one of the requested unit ids (town halls only train workers).
    const wanted = new Set(p.army.map((a) => a.unitId));
    const gd = getGameData();
    const millIds = new Set(
      [...gd.buildings.entries()]
        .filter(([, b]) => ((b as unknown as { trains?: string[] }).trains ?? []).some((u) => wanted.has(u)))
        .map(([id]) => id),
    );
    const mine = snap.buildings.filter((b) => b.player === who);
    const free = mine.find(
      (b) => b.built && (stores.building?.get(b.eid)?.trainQueue.length ?? 1) === 0 && millIds.has(b.id),
    );
    if (free && me.gold > 220) {
      const bar = free.eid;
      for (const req of p.army) {
        if (tick < req.from) continue;
        const have = snap.units.filter((u) => u.player === who && u.id === req.unitId).length;
        if (have >= req.cap) continue;
        game.command({ k: 'train', player: who, building: bar, unitId: req.unitId });
        rt.lastTrain = tick;
        break;
      }
    }
  }

  const w = rt.policy.wave;
  if (tick >= w.start && tick - rt.lastWave >= w.every) {
    const army = ownerEids(game, who, (id) => id !== p.workerId);
    if (army.length >= w.minUnits) {
      game.command({ k: 'move', player: who, units: army, to: atTile(w.to.x, w.to.y), mode: 'attackMove' });
      rt.lastWave = tick;
    }
  }
}

/** Centre of a tile as a world point (Fixed components). */
export function atTile(x: number, y: number): Vec2F {
  return { x: Math.round((x + 0.5) * 65536), y: Math.round((y + 0.5) * 65536) };
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
