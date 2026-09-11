import { generateMap } from '../map/mapgen.js';
/**
 * Simulation barrel + system pipeline registration.
 *
 * `createSkirmishWorld` builds a fully playable world from a map JSON, so the
 * headless runner, tests and the browser app all share one bootstrap path.
 */
import { Fixed, ff, fi, fn } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import { makeStores } from './components.js';
import { PlayerState, type Race } from './player.js';
import { spawnUnit, spawnBuilding, spawnGoldMine, spawnTree, spawnItem } from './spawn.js';
import { moveSystem } from './movement.js';
import { combatSystem } from './combat.js';
import { economySystem } from './economy.js';
import { abilitySystem, timedDeathSystem } from './abilities.js';
import { heroSystem } from './hero.js';
import { installCommandHandler } from './commandApply.js';
import { getGameData, type GameData } from '../data/index.js';
import type { Command, TimedCommand } from './commandTypes.js';

export * from './world.js';
export * from './components.js';
export * from './commandTypes.js';
export * from './player.js';
export { spawnUnit, spawnBuilding, spawnGoldMine, spawnTree, spawnItem };
export { moveSystem } from './movement.js';
export { combatSystem, strike, applyHit, kill } from './combat.js';
export { economySystem } from './economy.js';
export { abilitySystem, timedDeathSystem } from './abilities.js';
export { heroSystem, HERO_XP_TABLE, addXp } from './hero.js';
export { resolveDamage, DAMAGE_MATRIX, armorMultiplier } from './damage.js';
export { installCommandHandler, placementOk } from './commandApply.js';

export interface SkirmishOptions {
  seed: number;
  mapJson: unknown;
  players?: { race: Race; name: string; startGold?: number; startLumber?: number }[];
  data?: GameData;
}

export interface SkirmishResult {
  world: World;
  commands: TimedCommand[];
}

/** Build an empty world with stores, systems and command handling installed. */
export function createWorld(seed: number): World {
  const w = new World(seed);
  w.stores = makeStores(w.registry);
  installCommandHandler(w);
  (w as unknown as { pendingAbilities: unknown[] }).pendingAbilities = [];
  (w as unknown as { pendingItems: unknown[] }).pendingItems = [];
  (w as unknown as { timedDeaths: Map<number, number> }).timedDeaths = new Map();
  (w as unknown as { heroGraveyard: Map<number, { eid: Eid; respawnTick: number; name: string }> })
    .heroGraveyard = new Map();
  (w as unknown as { goldMines: Eid[] }).goldMines = [];
  (w as unknown as { trees: Eid[] }).trees = [];
  (w as unknown as { dropoffs: Record<'gold' | 'wood', Eid[]> }).dropoffs = { gold: [], wood: [] };
  (w as unknown as { altarsOf: (p: number) => Eid[] }).altarsOf = (p: number) =>
    ((w as unknown as { altars: Eid[][] }).altars[p] ?? []);
  (w as unknown as { players: PlayerState[] }).players = [];
  for (let i = 0; i < 13; i++) (w as unknown as { players: PlayerState[] }).players[i] = new PlayerState(i, 'neutral', 0, 0);
  (w as unknown as { altars: Eid[][] }).altars = [];
  (w as unknown as { spawnItemLocal: (id: string, x: Fixed, y: Fixed) => void }).spawnItemLocal = (
    id: string,
    x: Fixed,
    y: Fixed,
  ) => {
    spawnItem(w, id, x, y);
  };
  return w;
}

/** System pipeline — order matters, see movement.ts header. */
export function installSystems(w: World): void {
  w.systems = [
    (ww) => ww.drainCommands(),
    startHarvestBootstrap,
    visionSystem,
    moveSystem,
    economySystem,
    combatSystem,
    abilitySystem,
    timedDeathSystem,
    heroSystem,
    winLossSystem,
  ];
}

/** Vision: push each live unit's sight radius into the fog layer. */
function visionSystem(w: World, tick: number): void {
  const fog = w.fog as unknown as { beginTick(): void; markSeen(tx: number, ty: number, r: number, p: number): void } | null;
  if (!fog) return;
  fog.beginTick();
  const st = w.stores;
  const tr = st.transform as unknown as { get(e: Eid): { x: Fixed; y: Fixed } | undefined };
  const ow = st.owner as unknown as { get(e: Eid): { player: number } | undefined };
  const he = st.health as unknown as { get(e: Eid): { dead: boolean } | undefined };
  const bd = st.building as unknown as { get(e: Eid): { built: boolean; buildingId: string } | undefined };
  for (const e of w.live) {
    const eid = e as Eid;
    if (he.get(eid)?.dead) continue;
    const p = ow.get(eid)?.player ?? 0;
    if (p === 0 || p >= 11) continue;
    const t = tr.get(eid);
    if (!t) continue;
    const built = bd.get(eid);
    if (built && !built.built) continue;
    const sight = (w as unknown as { sightOf: (id: string, isBuilding: boolean) => number }).sightOf;
    const r = sight ? sight(bd.get(eid)?.buildingId ?? '', !!bd.get(eid)) : 6;
    fog.markSeen(Math.floor(t.x / 65536), Math.floor(t.y / 65536), r, p);
    void tick;
  }
}

/** Victory by eliminating all opposing players (or timeout score). */
function winLossSystem(w: World, _tick: number): void {
  const ps = (w as unknown as { players: PlayerState[] }).players;
  const alivePlayers = new Set<number>();
  const st = w.stores;
  const ow = st.owner as unknown as { get(e: Eid): { player: number } | undefined };
  const bd = st.building as unknown as { get(e: Eid): unknown };
  for (const e of w.live) {
    const p = ow.get(e as Eid)?.player ?? 0;
    if (p > 0 && p < 11 && bd.get(e as Eid)) alivePlayers.add(p);
  }
  for (const p of ps) {
    if (p.active && !alivePlayers.has(p.id) && !p.defeated) p.defeated = true;
  }
  const survivors = ps.filter((p) => p.active && !p.defeated);
  if (survivors.length <= 1 && ps.length > 1) {
    const winner = survivors[0]?.id ?? 0;
    if (!(w as unknown as { over: boolean }).over) {
      (w as unknown as { over: boolean }).over = true;
      w.bus.emit('game:over', { winner, reason: survivors.length ? 'elimination' : 'draw' });
    }
  }
}

export function createSkirmishWorld(opts: SkirmishOptions): SkirmishResult {
  const gd = opts.data ?? getGameData();
  const w = createWorld(opts.seed);
  (w as unknown as { gameData: GameData }).gameData = gd;
  (w as unknown as { lootTable?: unknown }).lootTable = gd.lootTable;
  (w as unknown as { abilityDefs: Map<string, unknown> }).abilityDefs = gd.abilityDefs;
  (w as unknown as { buildingRoles: Record<string, 'gold' | 'wood' | 'town'> }).buildingRoles = gd.buildingRoles;
  (w as unknown as { over: boolean }).over = false;
  (w as unknown as { popOf: (id: string) => number }).popOf = (id: string) => gd.units.get(id)?.cost.popUpkeep ?? 1;
  (w as unknown as { sightOf: (id: string, b: boolean) => number }).sightOf = (id: string, b: boolean) =>
    b ? gd.buildings.get(id)?.sightRange ?? 8 : gd.units.get(id)?.sightRange ?? 6;
  (w as unknown as { abilityMaxLevel: (id: string) => number }).abilityMaxLevel = (id: string) =>
    gd.abilities.get(id)?.maxLevel ?? 3;

  const map = parseMap(opts.mapJson);
  attachMap(w, map, gd);
  installSystems(w);

  const spec = opts.players ?? [
    { race: 'human' as const, name: 'Player 1' },
    { race: 'orc' as const, name: 'Orc AI' },
  ];
  spec.forEach((p, i) => {
    const idx = i + 1;
    const ps = new PlayerState(idx, p.race, fi(p.startGold ?? 275), fi(p.startLumber ?? 50));
    ps.name = p.name;
    ps.ally.bits = 1 << idx;
    (w as unknown as { players: PlayerState[] }).players[idx] = ps;
    (w as unknown as { altars: Eid[][] }).altars[idx] = [];
    placeStart(w, gd, idx, p.race, map.spawns[i]);
  });
  // Training and summoning resolve unit ids through this hook (see economy.ts /
  // abilities.ts). Without it a finished train queue would silently vanish.
  (w as unknown as { spawnUnitById: (id: string, x: Fixed, y: Fixed, player: number) => Eid }).spawnUnitById = (
    id: string,
    x: Fixed,
    y: Fixed,
    player: number,
  ) => {
    const def = gd.units.get(id);
    if (!def) return 0xffffffff;
    return spawnUnit(w, unitSpec(def), x, y, player);
  };

  const cmds: TimedCommand[] = [];
  return { world: w, commands: cmds };
}

interface MapLike {
  width: number;
  height: number;
  tiles: Uint8Array;
  spawns: { x: Fixed; y: Fixed }[];
  mines: { x: Fixed; y: Fixed; capacity: number }[];
  trees: { x: Fixed; y: Fixed }[];
  creeps?: { unitId: string; x: Fixed; y: Fixed }[];
}

function parseMap(json: unknown): MapLike {
  const j = json as {
    name?: string;
    size: [number, number];
    tiles: number[][];
    spawns: [number, number][];
    mines: [number, number, number][];
    trees: [number, number][];
    creeps?: [string, number, number][];
  };
  const [width, height] = j.size;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles[y * width + x] = j.tiles[y]?.[x] ?? 1;
  return {
    width,
    height,
    tiles,
    spawns: (j.spawns ?? []).map(([x, y]) => ({ x: ff(x) + ff(0.5), y: ff(y) + ff(0.5) })),
    mines: (j.mines ?? []).map(([x, y, c]) => ({ x: ff(x) + ff(0.5), y: ff(y) + ff(0.5), capacity: c ?? 12500 })),
    trees: (j.trees ?? []).map(([x, y]) => ({ x: ff(x) + ff(0.5), y: ff(y) + ff(0.5) })),
    creeps: (j.creeps ?? []).map(([u, x, y]) => ({ unitId: u, x: ff(x) + ff(0.5), y: ff(y) + ff(0.5) })),
  };
}

function attachMap(w: World, map: MapLike, gd: GameData): void {
  const terr = (w as unknown as { terrain?: unknown }).terrain;
  void terr;
  (w as unknown as { mapW: number }).mapW = map.width;
  (w as unknown as { occupied: Uint8Array }).occupied = new Uint8Array(map.width * map.height);
  (w as unknown as { terrain: { width: number; height: number; isWalkable(x: number, y: number): boolean } }).terrain = {
    width: map.width,
    height: map.height,
    isWalkable: (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
      const t = map.tiles[y * map.width + x];
      return t !== 3 && t !== 4 && t !== 5 && t !== 8;
    },
  };
  for (const m of map.mines) {
    const e = spawnGoldMine(w, m.x, m.y, ff(m.capacity));
    (w as unknown as { goldMines: Eid[] }).goldMines.push(e);
  }
  for (const t of map.trees) {
    const e = spawnTree(w, t.x, t.y);
    // Give scenery a stable art key so the renderer does not have to invent one.
    // Kept in its own unregistered store: presentation never enters stateHash().
    (w.stores.decor as unknown as { add(eid: Eid): { decorationId: string } }).add(e).decorationId = treeVariant(
      t.x,
      t.y,
    );
    (w as unknown as { trees: Eid[] }).trees.push(e);
  }
  for (const c of map.creeps ?? []) {
    const def = gd.units.get(c.unitId);
    if (def) spawnUnit(w, unitSpec(def), c.x, c.y, 12);
  }
}

/** Turn a data-table row into a spawn spec. */
export function unitSpec(d: GameData['units'] extends Map<string, infer U> ? U : never) {
  const u = d as unknown as Record<string, any>;
  return {
    id: u.id,
    race: u.race,
    hp: u.stats.hp,
    hpRegen: u.stats.hpRegen ?? 0.5,
    mp: u.stats.mp ?? 0,
    mpRegen: u.stats.mpRegen ?? 0,
    str: u.str,
    agi: u.agi,
    int: u.int,
    primary: u.primary,
    dmgMin: u.damage.min,
    dmgMax: u.damage.max,
    attackType: u.damage.attackType,
    armor: u.armor.value,
    armorType: u.armor.type,
    range: u.damage.range,
    cooldown: u.damage.cooldown,
    attackPoint: u.damage.attackPoint,
    moveSpeed: u.moveSpeed,
    fly: u.fly,
    isHero: u.hero,
    level: u.level,
    abilities: (u.abilities ?? []).map((a: string) => ({ abilityId: a })),
    bonusVs: u.damage.bonusVs,
    splashRadius: u.damage.splashRadius,
    pierceCount: u.damage.pierceCount,
  };
}

function placeStart(w: World, gd: GameData, player: number, race: string, at: { x: Fixed; y: Fixed } | undefined): void {
  if (!at) return;
  const tx = Math.floor(at.x / 65536) - 2;
  const ty = Math.floor(at.y / 65536) - 2;
  const hallId = gd.races[race]?.townHall ?? 'town_hall';
  const workerId = gd.races[race]?.worker ?? 'peasant';
  const hallDef = gd.buildings.get(hallId);
  const workerDef = gd.units.get(workerId);
  if (!hallDef || !workerDef) return;
  const hall = spawnBuilding(w, { id: hallDef.id, hp: hallDef.stats.hp, armor: hallDef.stats.armor, armorType: hallDef.stats.armorType, w: hallDef.footprint[0], h: hallDef.footprint[1], supplyProvided: hallDef.supplyProvided, buildTime: hallDef.buildTime }, tx, ty, player);
  markOccupied(w, tx, ty, hallDef.footprint[0], hallDef.footprint[1]);
  (w as unknown as { dropoffs: Record<'gold' | 'wood', Eid[]> }).dropoffs.gold.push(hall);
  (w as unknown as { dropoffs: Record<'gold' | 'wood', Eid[]> }).dropoffs.wood.push(hall);
  const mine = nearest(w, (w as unknown as { goldMines: Eid[] }).goldMines, at.x, at.y);
  const workers: Eid[] = [];
  for (let i = 0; i < 4; i++) {
    const e = spawnUnit(w, unitSpec(workerDef), at.x + ff(i % 2) - ff(1), at.y + ff(Math.floor(i / 2)) + ff(2), player);
    workers.push(e);
    const cargo = (w.stores.cargo as unknown as { add(e: Eid): { capacity: Fixed } }).add(e);
    cargo.capacity = ff(gd.units.get(workerId)?.carryCapacity ?? 10);
  }
  // Record intent only; the real order is issued by startHarvestBootstrap at
  // tick 1, when every entity id exists.
  if (mine !== 0xffffffff) {
    const want = ((w as unknown as { pendingHarvest?: Map<number, Eid[]> }).pendingHarvest ??= new Map());
    want.set(player, workers.slice(0, 3));
  }
}

function nearest(w: World, list: Eid[], x: Fixed, y: Fixed): Eid {
  let best = 0xffffffff;
  let bd = 0x7fffffff;
  const tr = (w.stores.transform as unknown as { get(e: Eid): { x: Fixed; y: Fixed } | undefined });
  for (const e of list) {
    const t = tr.get(e);
    if (!t) continue;
    const d = (t.x - x) ** 2 + (t.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function markOccupied(w: World, tx: number, ty: number, fw: number, fh: number): void {
  const occ = (w as unknown as { occupied: Uint8Array }).occupied;
  const W = (w as unknown as { mapW: number }).mapW;
  for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) if (occ && y >= 0 && x >= 0) occ[y * W + x] = 1;
}

export { fi, ff };
export type { Command };

/**
 * Game facade used by the browser app, the headless runner and tests.
 * Wraps `createSkirmishWorld` with the map modules attached.
 */
import { PathGrid } from '../map/pathgrid.js';
import { Pathfinder } from '../map/pathfinding.js';
import { QuadTree } from '../map/quadtree.js';
import { FogOfWar } from '../map/fog.js';
import { Terrain } from '../map/terrain.js';
import type { GeneratedMap } from '../map/mapgen.js';

export interface GameOptions {
  seed: number;
  /** Omit to auto-generate a random map of this edge length (default 96). */
  size?: number;
  map?: GeneratedMap;
  players: { id: number; race: Race; name: string; startGold?: number; startLumber?: number }[];
}

export interface Game {
  world: World;
  terrain: Terrain;
  grid: PathGrid;
  pathfinder: Pathfinder;
  fog: FogOfWar;
  quad: QuadTree;
  players: PlayerState[];
  update(ticks: number): void;
  command(cmd: Command): void;
  stateHash(): number;
  snapshot(): Snapshot;
}

export interface Snapshot {
  tick: number;
  units: { eid: Eid; id: string; player: number; x: number; y: number; hp: number; hpMax: number; level: number }[];
  buildings: { eid: Eid; id: string; player: number; built: boolean; hp: number; hpMax: number }[];
  resources: { player: number; gold: number; lumber: number; supplyUsed: number; supplyCap: number; upkeep: number }[];
}

export function createGame(opts: GameOptions): Game {
  const gen = opts.map ?? generateMap({ seed: opts.seed, size: opts.size ?? 96, players: opts.players.length });
  const json = {
    name: 'generated',
    size: [gen.terrain.width, gen.terrain.height] as [number, number],
    tiles: tilesToArray(gen.terrain),
    spawns: gen.spawns.map((p) => [Math.floor(p.x / 65536), Math.floor(p.y / 65536)] as [number, number]),
    mines: gen.mines.map((m) => [Math.floor(m.x / 65536), Math.floor(m.y / 65536), m.capacity] as [number, number, number]),
    trees: gen.trees.map((t) => [Math.floor(t.x / 65536), Math.floor(t.y / 65536)] as [number, number]),
  };
  const spec = opts.players.map((p) => ({ race: p.race, name: p.name, startGold: p.startGold, startLumber: p.startLumber }));
  const w = createSkirmishWorld({ seed: opts.seed, mapJson: json, players: spec });
  const grid = new PathGrid(gen.terrain);
  const quad = new QuadTree(0, 0, ff(gen.terrain.width), ff(gen.terrain.height), 8);
  const fog = new FogOfWar(gen.terrain.width, gen.terrain.height, 13);
  w.world.terrain = gen.terrain;
  w.world.fog = fog;
  w.world.quad = quad;
  const game: Game = {
    world: w.world,
    terrain: gen.terrain,
    grid,
    pathfinder: new Pathfinder(grid),
    fog,
    quad,
    players: (w.world as unknown as { players: PlayerState[] }).players,
    update(ticks: number) {
      for (let i = 0; i < ticks; i++) {
        rebuildQuad(w.world, quad);
        w.world.tickOnce();
      }
    },
    command(cmd: Command) {
      w.world.queueCommand(cmd);
    },
    stateHash() {
      return w.world.stateHash();
    },
    snapshot() {
      return snapshotWorld(w.world);
    },
  };
  return game;
}

function tilesToArray(t: Terrain): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < t.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < t.width; x++) row.push(t.tile(x, y));
    out.push(row);
  }
  return out;
}

function rebuildQuad(w: World, quad: QuadTree): void {
  quad.clear();
  const tr = w.stores.transform as unknown as { get(e: Eid): { x: Fixed; y: Fixed; radius: Fixed } | undefined };
  for (const e of w.live) {
    const t = tr.get(e as Eid);
    if (t) quad.insert(e, t.x, t.y, t.radius + ff(0.4));
  }
}

function snapshotWorld(w: World): Snapshot {
  const tr = w.stores.transform as unknown as { get(e: Eid): { x: number; y: number } | undefined };
  const ow = w.stores.owner as unknown as { get(e: Eid): { player: number } | undefined };
  const he = w.stores.health as unknown as { get(e: Eid): { hp: number; hpMax: number; dead: boolean } | undefined };
  const st = w.stores.stats as unknown as { get(e: Eid): { id: string; level: number } | undefined };
  const bl = w.stores.building as unknown as { get(e: Eid): { buildingId: string; built: boolean } | undefined };
  const units: Snapshot['units'] = [];
  const buildings: Snapshot['buildings'] = [];
  for (const e of w.live) {
    const eid = e as Eid;
    if (he.get(eid)?.dead) continue;
    const t = tr.get(eid);
    if (!t) continue;
    const b = bl.get(eid);
    if (b) buildings.push({ eid, id: b.buildingId, player: ow.get(eid)?.player ?? 0, built: b.built, hp: he.get(eid)!.hp / 65536, hpMax: he.get(eid)!.hpMax / 65536 });
    else if (st.get(eid)) units.push({ eid, id: st.get(eid)!.id, player: ow.get(eid)?.player ?? 0, x: t.x / 65536, y: t.y / 65536, hp: he.get(eid)!.hp / 65536, hpMax: he.get(eid)!.hpMax / 65536, level: st.get(eid)!.level });
  }
  const ps = (w as unknown as { players: PlayerState[] }).players;
  return {
    tick: w.tick,
    units,
    buildings,
    // Only the two contested seats are reported; reporting all 13 would add a
    // constant tail of empty rows to every hash and every UI frame.
    resources: ps
      .slice(1, 3)
      .filter((p) => p !== undefined)
      .map((p) => ({ player: p.id, gold: p.gold / 65536, lumber: p.lumber / 65536, supplyUsed: p.supplyUsed, supplyCap: p.supplyCap, upkeep: p.upkeep })),
  };
}

export { generateMap };
export type { GeneratedMap };

/**
 * One-shot: send the idle starting workers to the nearest gold mine.
 * Runs every tick but self-disarms; the AI may retarget them later.
 */
/**
 * Tick-1 bootstrap: send the starting workers to the nearest gold mine and
 * keep them in a gather loop. Runs once per World.
 */
const bootstrapped = new WeakSet<object>();
function startHarvestBootstrap(w: World, _tick: number): void {
  if (w.tick < 1) return;
  if (bootstrapped.has(w)) return;
  (bootstrapped as WeakSet<object>).add(w);
  const st = w.stores;
  const tr = st.transform as unknown as { get(e: Eid): { x: Fixed; y: Fixed } | undefined };
  const sd = st.stats as unknown as { get(e: Eid): { id: string } | undefined };
  const ow = st.owner as unknown as { get(e: Eid): { player: number } | undefined };
  const ord = st.orders as unknown as {
    get(e: Eid): { current: { kind: string; targetEid: number; tx: Fixed; ty: Fixed; mode: number; param: string } } | undefined;
  };
  const mines = (w as unknown as { goldMines: Eid[] }).goldMines;
  for (const e of w.live) {
    const eid = e as Eid;
    const id = sd.get(eid)?.id ?? '';
    if (id !== 'peasant' && id !== 'peon') continue;
    const o = ord.get(eid);
    if (!o || o.current.kind !== 'none') continue;
    const t = tr.get(eid);
    if (!t) continue;
    let best = 0xffffffff;
    let bd = Infinity;
    for (const m of mines) {
      const mt = tr.get(m);
      if (!mt) continue;
      const d = (mt.x - t.x) ** 2 + (mt.y - t.y) ** 2;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best === 0xffffffff) continue;
    o.current = { kind: 'harvest', targetEid: best, tx: 0, ty: 0, mode: 0, param: 'gold' };
    (st.cargo as unknown as { get(e: Eid): { sourceEid: number } | undefined }).get(eid)!.sourceEid = best;
  }
  void ow;
}


/** Deterministic scenery variant from tile coords (no RNG — must not shift the stream). */
function treeVariant(x: Fixed, y: Fixed): string {
  const tx = Math.floor(fn(x));
  const ty = Math.floor(fn(y));
  let h = (tx * 73856093) ^ (ty * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return ['tree', 'pine', 'rock', 'shrub'][h & 3];
}
