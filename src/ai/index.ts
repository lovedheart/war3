/**
 * Skirmish AI for the Warcraft III recreation.
 *
 * Contract (see ARCHITECTURE.md §5/§6):
 *  - The ONLY way this module touches the sim is `game.command(cmd)`. Reads go
 *    through snapshots / read-only store access, never writes.
 *  - Information is fog-legal: everything funnels through `Intel`, which gates
 *    every entity query on a FogOfWar tile test.
 *  - Deterministic: all randomness comes from the injected Rng; no Math.random,
 *    no Date.now, no wall-clock reads. Same seed => same Command stream.
 *  - Fixed-point discipline: never `>>`/`|0` a product; compare with fn().
 */
import { Fixed, ff, fn, fmul } from '../core/fixed.js';
import { Rng } from '../core/rng.js';
import type { Game } from '../sim/index.js';
import type { Command, MoveMode, Vec2F } from '../sim/commandTypes.js';
import { getGameData } from '../data/index.js';
import { Intel } from './intel.js';
import { planFor, type BuildPlan } from './planner.js';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type AiState = 'economy' | 'expand' | 'aggro' | 'defend' | 'finish';

export interface AiController {
  update(): void;
  readonly state: AiState;
  destroy(): void;
}

interface Profile {
  /** ticks between full replans */
  planEvery: number;
  /** target army population at the first wave time */
  wavePop: number;
  /** tick of the first attack wave */
  firstWave: number;
  /** ticks between waves after the first */
  waveGap: number;
  /** gold above which we consider a second town hall */
  expandGold: number;
  maxWorkers: number;
  /** how willing we are to trade (army hp fraction before retreating) */
  retreatAt: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { planEvery: 90, wavePop: 18, firstWave: 4 * 1800, waveGap: 2700, expandGold: 900, maxWorkers: 6, retreatAt: 0.4 },
  normal: { planEvery: 60, wavePop: 26, firstWave: 150 * 30, waveGap: 2100, expandGold: 700, maxWorkers: 7, retreatAt: 0.5 },
  hard: { planEvery: 45, wavePop: 34, firstWave: 90 * 30, waveGap: 1500, expandGold: 550, maxWorkers: 8, retreatAt: 0.6 },
};

const SEC = 30;
/** Memory horizon: how long a lost contact still counts as intel. */
const INTEL_AGE = 20 * SEC;
/** A building site older than this with no progress gets re-assigned. */
const STALL_LIMIT = 25 * SEC;

interface UnitView {
  eid: number;
  id: string;
  /** game units */
  x: Fixed;
  y: Fixed;
  hp: number;
}

function view(u: { eid: number; id: string; x: number; y: number; hp: number }): UnitView {
  return { eid: u.eid, id: u.id, x: ff(u.x), y: ff(u.y), hp: u.hp };
}

/** Squared distance in fixed point — avoids fsqrt and stays deterministic. */
function fdist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  const dx = ax - bx;
  const dy = ay - by;
  return fmul(dx, dx) + fmul(dy, dy);
}


interface Site {
  buildingId: string;
  worker: number;
  /** construction-site entity (created by the sim when we issued build) */
  siteEid?: number;
  x: Fixed;
  y: Fixed;
  startedTick: number;
}

export function createAiController(game: Game, player: number, difficulty: Difficulty = 'normal', rng?: Rng): AiController {
  const ai = new SkirmishAi(game, player, difficulty, rng);
  return ai;
}

class SkirmishAi implements AiController {
  private readonly intel: Intel;
  private readonly plan: BuildPlan;
  private readonly prof: Profile;
  private readonly rng: Rng;
  private readonly gd = getGameData();

  private _state: AiState = 'economy';
  private lastPlan = -9999;
  /** eid -> tick we last issued it an order (throttle) */
  private readonly orderedAt = new Map<number, number>();
  /** worker eid -> last position where it was seen moving (stuck detector) */
  private readonly workerSeen = new Map<number, { pos: string; tick: number }>();
  /** in-flight construction we are waiting on */
  private readonly sites = new Map<string, Site>();
  /** buildings we already tried and failed to place */
  private readonly blockedUntil = new Map<string, number>();
  /** construction site -> last observed progress / when it stopped moving */
  private readonly siteProgress = new Map<number, number>();
  private readonly siteStalledAt = new Map<number, number>();
  /** tech ids queued or done */
  private readonly techTried = new Set<string>();
  private nextWaveTick = 0;
  private rallied = false;
  private lastHeroOrder = -9999;
  private lastScoutTick = -9999;
  private underAttackUntil = 0;
  private lastDefenderCount = 0;
  private dead = false;

  constructor(
    private readonly game: Game,
    readonly me: number,
    difficulty: Difficulty,
    rng?: Rng,
  ) {
    const seed = ((game.world.seed ?? 0) ^ (this.me * 0x9e3779b9)) >>> 0;
    this.rng = rng ?? new Rng(seed);
    this.intel = new Intel(game, me);
    const race = this.raceKey();
    this.plan = planFor(this.gd, race);
    this.prof = PROFILES[difficulty] ?? PROFILES.normal;
    this.nextWaveTick = this.prof.firstWave;
  }

  get state(): AiState {
    return this._state;
  }

  destroy(): void {
    this.dead = true;
  }

  /* ------------------------------------------------------------------ */

  private raceKey(): string {
    const ps = (this.game.players as unknown as Array<{ race?: string }> | undefined) ?? [];
    return ps[this.me]?.race ?? 'human';
  }

  update(): void {
    if (this.dead) return;
    const w = this.game.world;
    const tick = w.tick;
    this.intel.observe(tick);

    // Cheap every-tick work only; the expensive planning runs on a throttle.
    if (tick - this.lastPlan >= this.prof.planEvery) {
      this.lastPlan = tick;
      this.think(tick);
    }
  }

  /* ---------------------------- planning ----------------------------- */

  private think(tick: number): void {
    const snap = this.game.snapshot();
    const mine = this.mineUnits(snap);
    const myBlds = snap.buildings.filter((b) => b.player === this.me);
    const built = myBlds.filter((b) => b.built);
    const res = snap.resources.find((r) => r.player === this.me);
    if (!res) return;

    const home = this.homeOf(built);
    const workers = mine.filter((u) => u.id === this.plan.worker).map(view);
    const army = mine.filter((u) => u.id !== this.plan.worker && !this.isBuilding(u.eid)).map(view);
    const heroes = mine.filter((u) => this.isHero(u.id)).map(view);

    this.decideState(tick, res, army, built, workers.length);
    this.assignWorkers(tick, workers, built, res);
    this.buildStuff(tick, built, workers, res);
    this.trainStuff(tick, built, res, workers.length, army.length + heroes.length);
    this.researchStuff(tick, built, res);
    this.heroStuff(tick, heroes, army, home);
    this.scoutStuff(tick, workers, home);
    this.fightStuff(tick, army, heroes, workers, built, res, home);
  }

  /** State machine: economy -> expand -> aggro -> finish, defend on intrusion. */
  private decideState(tick: number, res: { gold: number; supplyUsed: number }, army: { eid: number }[], built: { id: string }[], workerCount: number): void {
    const threats = this.intel.hostiles(4 * SEC, tick).filter((t) => this.nearHome(t.x, t.y) && this.game.fog.isVisibleTile(Math.floor(fn(t.x)), Math.floor(fn(t.y)), this.me));
    if (threats.length > 0) {
      this._state = 'defend';
      this.underAttackUntil = tick + 10 * SEC;
      return;
    }
    if (tick < this.underAttackUntil) {
      this._state = 'defend';
      return;
    }
    if (army.length >= this.prof.wavePop * 0.9 && tick >= this.nextWaveTick) {
      this._state = tick >= this.prof.firstWave * 2 ? 'finish' : 'aggro';
      return;
    }
    // Expansion window: rich enough and past the opening.
    if (res.supplyUsed >= 14 && res.gold > this.prof.expandGold && this.countHall(built) < 2 && tick > 60 * SEC) {
      this._state = 'expand';
      return;
    }
    void workerCount;
    this._state = 'economy';
  }

  /* --------------------------- perception ---------------------------- */

  private mineUnits(snap: ReturnType<Game['snapshot']>) {
    return snap.units.filter((u) => u.player === this.me);
  }

  private isBuilding(eid: number): boolean {
    return !!(this.game.world.stores as unknown as { building: { get(e: number): unknown } }).building.get(eid);
  }

  private isHero(id: string): boolean {
    return this.gd.units.get(id)?.isHero === true;
  }

  private countHall(built: { id: string }[]): number {
    const halls = new Set([this.plan.townHall, ...this.plan.hallUpgrades]);
    return built.filter((b) => halls.has(b.id)).length;
  }

  private homeOf(built: { eid: number; id: string }[]): { x: Fixed; y: Fixed } {
    const hall = built.find((b) => b.id === this.plan.townHall) ?? built.find((b) => this.plan.hallUpgrades.includes(b.id)) ?? built[0];
    if (!hall) return { x: ff(this.game.terrain.width / 2), y: ff(this.game.terrain.height / 2) };
    const t = (this.game.world.stores.transform as unknown as { get(e: number): { x: Fixed; y: Fixed } | undefined }).get(hall.eid);
    return t ? { x: t.x, y: t.y } : { x: ff(0), y: ff(0) };
  }

  private nearHome(x: Fixed, y: Fixed): boolean {
    const h = this.homeOf(this.game.snapshot().buildings.filter((b) => b.player === this.me));
    return (fn(x) - fn(h.x)) ** 2 + (fn(y) - fn(h.y)) ** 2 < 22 * 22;
  }

  /* ---------------------------- economy ------------------------------ */

  private assignWorkers(
    tick: number,
    workers: UnitView[],
    built: { eid: number; id: string }[],
    _res: { gold: number; lumber: number; supplyUsed: number; supplyCap: number },
  ): void {
    const home = this.homeOf(built);
    const mines = this.intel.sources('gold').filter((m) => m.capacity > 0);
    const woods = this.intel.sources('wood').filter((m) => m.capacity > 0);
    if (!mines.length && !woods.length) return;

    // Target split: 3-5 per live mine on gold, everyone else cutting trees.
    const wantGold = Math.max(2, Math.min(workers.length - 1, mines.length * 4));
    let gold = 0;
    let wood = 0;

    for (const wk of workers) {
      const st = this.game.world.stores as unknown as {
        cargo: { get(e: number): { carrying: string; sourceEid: number } | undefined };
        orders: { get(e: number): { current: { kind: string; targetEid: number; param: string } } | undefined };
      };
      const cargo = st.cargo.get(wk.eid);
      const order = st.orders.get(wk.eid);
      if (!cargo || !order) continue;

      // Mid-carry: leave the trip alone, just tally which line it belongs to.
      if (cargo.carrying !== 'none') {
        if (cargo.carrying === 'gold') gold++;
        else wood++;
        continue;
      }

      // Building something. Construction only advances while a builder stands
      // next to the site, so a worker pulled off a site freezes it forever.
      // Keep every builder on its site until it is built or genuinely stuck.
      if (order.current.kind === 'build') {
        const siteEid = order.current.targetEid;
        const bld = (this.game.world.stores as unknown as { building: { get(e: number): { progress: number; built: boolean } | undefined } }).building.get(siteEid);
        if (!bld || bld.built) {
          this.sites.delete(this.plannedOf(siteEid));
          // fall through: the site is gone, give the worker a real job
        } else {
          const last = this.siteProgress.get(siteEid);
          if (last === undefined || bld.progress < last) {
            this.siteProgress.set(siteEid, bld.progress);
            this.siteStalledAt.set(siteEid, tick);
          } else if (tick - (this.siteStalledAt.get(siteEid) ?? tick) > 10 * SEC) {
            this.sites.delete(this.plannedOf(siteEid));
            this.siteProgress.delete(siteEid);
            this.siteStalledAt.delete(siteEid);
            // fall through: reassign this worker to resources
          }
          if (!this.sites.has(this.plannedOf(siteEid))) {
            // still under our project: leave the builder alone
            continue;
          }
        }
      }

      const harvesting = order.current.kind === 'harvest';
      const onGold = order.current.param === 'gold';
      let alive = harvesting ? this.sourceAlive(order.current.targetEid, onGold ? 'gold' : 'wood', onGold ? mines : woods) : false;
      // The sim's own return trip can end just outside its drop radius: it
      // clears the waypoint at ~2.2 tiles, steers, arrives at the 1.4-tile
      // movement radius, clears again — and shuttles in place earning nothing.
      // Detect that (empty + no waypoint + closer to home than to the source)
      // and re-issue so the trip restarts.
      if (harvesting && alive && cargo.carrying === 'none') {
        const cur = (this.game.world.stores.orders as unknown as { get(e: number): { current: { tx?: number; ty?: number } } }).get(wk.eid)?.current;
        const noWp = !cur?.tx && !cur?.ty;
        const srcT = (this.game.world.stores.transform as unknown as { get(e: number): { x: Fixed; y: Fixed } | undefined }).get(order.current.targetEid);
        if (noWp && srcT) {
          const dHome2 = fdist2(wk.x, wk.y, home.x, home.y);
          const dSrc2 = fdist2(wk.x, wk.y, srcT.x, srcT.y);
          if (dSrc2 > fmul(ff(1.8), ff(1.8)) && dHome2 < dSrc2) alive = false; // stalled
        }
      }
      if (harvesting && alive) {
        // The sim steers this trip itself (source <-> drop-off). Re-issuing the
        // harvest order would clear the waypoint mid-trip and strand the unit,
        // so leave it alone — unless it has stopped making progress.
        if (tick - (this.orderedAt.get(wk.eid) ?? -9999) > STALL_LIMIT) {
          const seen = this.workerSeen.get(wk.eid);
          const here = `${Math.floor(fn(wk.x))},${Math.floor(fn(wk.y))}`;
          if (seen?.pos === here && tick - seen.tick > STALL_LIMIT) {
            this.workerSeen.delete(wk.eid); // frozen: fall through and re-task
          } else {
            if (!seen || seen.pos !== here) this.workerSeen.set(wk.eid, { pos: here, tick });
            if (onGold) gold++;
            else wood++;
            continue;
          }
        } else {
          if (onGold) gold++;
          else wood++;
          continue;
        }
      }

      // Idle, stranded on a dead source, or frozen in place: give it a job now.
      const kind: 'gold' | 'wood' = gold < wantGold ? 'gold' : 'wood';
      const source = this.pickSource(kind, wk, mines, woods, home);
      if (!source) continue;
      if (this.issue({ k: 'harvest', player: this.me, worker: wk.eid, target: source.eid, kind })) {
        this.orderedAt.set(wk.eid, tick);
        this.workerSeen.delete(wk.eid);
        if (kind === 'gold') gold++;
        else wood++;
      }
    }
  }

  /** Which planned project owns a given construction-site entity? */
  private plannedOf(eid: number): string {
    for (const [id, s] of this.sites) if (s.siteEid === eid) return id;
    return '';
  }

  /** Does this worker's current source still exist and hold resources? */
  private sourceAlive(eid: number, kind: 'gold' | 'wood', pool: ReturnType<Intel['sources']>): boolean {
    if (eid === undefined || eid < 0 || eid === 0xffffffff) return false;
    const live = pool.find((m) => m.eid === eid);
    if (live) return live.capacity > 0;
    // Not in our visible/explored source list at all: check existence only.
    const st = this.game.world.stores as unknown as { mine: { get(e: number): unknown }; tree: { get(e: number): unknown } };
    return !!(kind === 'gold' ? st.mine.get(eid) : st.tree.get(eid));
  }

  private pickSource(
    kind: 'gold' | 'wood',
    wk: UnitView,
    mines: ReturnType<Intel['sources']>,
    woods: ReturnType<Intel['sources']>,
    home: { x: Fixed; y: Fixed },
  ): ReturnType<Intel['nearestSource']> {
    const pool = kind === 'gold' ? mines : woods;
    if (!pool.length) return null;
    // Always pick the source nearest the *worker*. Sending a worker to the
    // hall-side mine regardless of where it stands makes it cross the whole
    // map and starve the line it was already working.
    void home;
    return this.intel.nearestSource(kind, ff(wk.x), ff(wk.y));
  }

  /* ---------------------------- building ----------------------------- */

  private buildStuff(tick: number, built: { eid: number; id: string }[], workers: UnitView[], res: { gold: number; lumber: number; supplyUsed: number; supplyCap: number }): void {
    const owned = new Map<string, number>();
    for (const b of built) owned.set(b.id, (owned.get(b.id) ?? 0) + 1);
    const home = this.homeOf(built);

    // Retire finished / abandoned construction projects.
    for (const [id, site] of [...this.sites]) {
      const exists = this.game.snapshot().buildings.some((b) => b.player === this.me && b.id === id);
      if (exists || tick - site.startedTick > STALL_LIMIT * 2) this.sites.delete(id);
    }

    // 1. Supply first — a supply block stalls everything else. Trigger well
    // before the cap so the farm finishes before we would otherwise stall.
    const each = this.plan.supplies.length ? this.gd.buildings.get(this.plan.supplies[0])?.supplyProvided ?? 6 : 6;
    const slack = res.supplyCap - res.supplyUsed;
    if (slack < each * 2 || this.supplyShortfall(built, res)) {
      const farm = this.plan.supplies[0];
      if (farm && !this.sites.has(farm)) {
        if (this.tryBuild(tick, farm, workers, home, res)) return;
        // Cannot afford a farm yet: hoard, do not spend on tech chains.
        if (res.gold < (this.gd.buildings.get(farm)?.cost.gold ?? 80)) return;
      }
    }

    // 2. Follow the tech chain, one open project at a time. If the next step
    // is unaffordable, keep scanning: an affordable, prerequisite-satisfied
    // building further down the chain is better than hoarding idle gold.
    let waiting = false;
    for (const id of this.plan.buildChain) {
      const def = this.gd.buildings.get(id);
      if (!def) continue;
      if (def.requiresBuilding && !(owned.get(def.requiresBuilding) ?? 0) && !this.sites.has(def.requiresBuilding)) continue;
      const have = owned.get(id) ?? 0;
      const wanted = this.wantCount(id, built, res);
      if (have >= wanted) continue;
      if (this.blockedUntil.get(id) && this.blockedUntil.get(id)! > tick) continue;
      if (!this.canAfford(res, def.cost.gold, def.cost.lumber)) {
        waiting = true;
        continue;
      }
      if (this.tryBuild(tick, id, workers, home, res)) return;
      waiting = true;
    }
    void waiting;

    // 3. Hall upgrade (town hall -> keep -> castle) once the chain is covered.
    const hall = built.find((b) => b.id === this.plan.townHall || this.plan.hallUpgrades.includes(b.id));
    if (hall) {
      const def = this.gd.buildings.get(hall.id);
      const nextId = def?.upgradeTo;
      if (nextId && !this.sites.has(nextId) && (owned.get(nextId) ?? 0) === 0) {
        const nd = this.gd.buildings.get(nextId);
        if (nd && this.canAfford(res, nd.cost.gold, nd.cost.lumber) && workers.length > 0) {
          const spot = this.findSpot(nd.footprint[0], nd.footprint[1], home.x, home.y, 3);
          if (spot) {
            const w = this.freeWorker(workers, tick);
            if (w && this.issue({ k: 'build', player: this.me, worker: w.eid, buildingId: nextId, at: spot })) {
              this.sites.set(nextId, { buildingId: nextId, worker: w.eid, x: spot.x, y: spot.y, startedTick: tick, siteEid: this.lastBuiltEntity });
              this.orderedAt.set(w.eid, tick);
            }
          }
        }
      }
    }
  }

  /** Supply buildings are needed roughly every `supplyEach` population. */
  private supplyShortfall(built: { id: string }[], res: { supplyCap: number; supplyUsed: number }): boolean {
    const farms = built.filter((b) => this.plan.supplies.includes(b.id)).length;
    const each = this.plan.supplies.length ? this.gd.buildings.get(this.plan.supplies[0])?.supplyProvided ?? 6 : 6;
    return res.supplyCap - farms * each < res.supplyUsed + each;
  }

  private wantCount(id: string, _built: { id: string }[], res: { supplyUsed: number }): number {
    const def = this.gd.buildings.get(id);
    if (!def) return 0;
    if (this.plan.supplies.includes(id)) return 1; // handled by supplyShortfall
    if (def.trains && def.trains.length) {
      // One production building per trainable unit type is plenty early;
      // add a second barracks once we are fielding a real army.
      const trainable = this.plan.trainers.get(id)?.length ?? 0;
      return trainable > 0 && res.supplyUsed > 30 ? 2 : 1;
    }
    return 1;
  }

  private tryBuild(tick: number, id: string, workers: UnitView[], home: { x: Fixed; y: Fixed }, res: { gold: number; lumber: number }): boolean {
    if (this.sites.has(id)) return true;
    const def = this.gd.buildings.get(id);
    if (!def) return false;
    if (!this.canAfford(res, def.cost.gold, def.cost.lumber)) return false;
    const w = this.freeWorker(workers, tick);
    if (!w) return false;
    const r = this.findSpotNear(def.footprint[0], def.footprint[1], home);
    if (!r) {
      this.blockedUntil.set(id, tick + 10 * SEC);
      return false;
    }
    if (this.issue({ k: 'build', player: this.me, worker: w.eid, buildingId: id, at: r.at })) {
      this.sites.set(id, { buildingId: id, worker: w.eid, x: r.at.x, y: r.at.y, startedTick: tick, siteEid: this.lastBuiltEntity });
      this.orderedAt.set(w.eid, tick);
      return true;
    }
    this.blockedUntil.set(id, tick + 6 * SEC);
    return false;
  }

  /** A worker not currently building something. */
  private freeWorker(workers: UnitView[], tick: number): UnitView | null {
    void tick;
    // A worker standing at a construction site must stay there: the sim only
    // advances progress while a builder is adjacent. Never pull one away.
    for (const w of workers) {
      const o = (this.game.world.stores.orders as unknown as { get(e: number): { current: { kind: string } } | undefined }).get(w.eid);
      if (o && o.current.kind === 'build') continue;
      return w;
    }
    return null;
  }

  /**
   * Find a legal footprint near home. Uses terrain walkability plus the
   * sim's own `occupied` reservation map so we never stack on another
   * building — and never place anything we cannot see.
   */
  private findSpotNear(fw: number, fh: number, home: { x: Fixed; y: Fixed }): { at: Vec2F } | null {
    const hx = Math.floor(fn(home.x));
    const hy = Math.floor(fn(home.y));
    for (let r = 2; r <= 14; r += 2) {
      const cands: [number, number][] = [
        [hx + r, hy - r],
        [hx - r, hy + r],
        [hx + r, hy + r],
        [hx - r, hy - r],
        [hx + r, hy],
        [hx, hy + r],
        [hx - r, hy],
        [hx, hy - r],
      ];
      for (const [x, y] of cands) {
        const at = this.testFootprint(fw, fh, x, y);
        if (at) return { at };
      }
    }
    return null;
  }

  /** Deterministic spiral search for a legal footprint centred on hx,hy. */
  private findSpot(fw: number, fh: number, cx: number, cy: number, step: number): Vec2F | null {
    for (let r = 1; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy += step || 1) {
        for (let dx = -r; dx <= r; dx += step || 1) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const at = this.testFootprint(fw, fh, Math.floor(cx) + dx, Math.floor(cy) + dy);
          if (at) return at;
        }
      }
    }
    return null;
  }

  private testFootprint(fw: number, fh: number, tx: number, ty: number): Vec2F | null {
    const terr = this.game.terrain;
    const occ = (this.game.world as unknown as { occupied?: Uint8Array }).occupied;
    if (tx < 0 || ty < 0 || tx + fw > terr.width || ty + fh > terr.height) return null;
    for (let y = ty; y < ty + fh; y++) {
      for (let x = tx; x < tx + fw; x++) {
        if (!terr.isWalkable(x, y)) return null;
        if (occ && occ[y * terr.width + x]) return null;
      }
    }
    // Never build on land we cannot see.
    if (!this.intel.explored(tx, ty)) return null;
    return { x: ff(tx), y: ff(ty) };
  }

  /* ---------------------------- training ----------------------------- */

  private trainStuff(tick: number, built: { eid: number; id: string }[], res: { gold: number; lumber: number; supplyUsed: number; supplyCap: number }, militaryPop: number, _total: number): void {
    const owned = new Map<string, number>();
    for (const b of built) owned.set(b.id, (owned.get(b.id) ?? 0) + 1);

    // Workers up to the profile cap, funded first.
    const wd = this.gd.units.get(this.plan.worker);
    const workers = this.game.snapshot().units.filter((u) => u.player === this.me && u.id === this.plan.worker).length;
    if (wd && workers < this.prof.maxWorkers && res.supplyUsed + (wd.cost.popUpkeep ?? 1) <= res.supplyCap + 6) {
      const hall = built.find((b) => this.plan.townHall === b.id || this.plan.hallUpgrades.includes(b.id));
      if (hall && this.canAfford(res, wd.cost.gold, wd.cost.lumber)) {
        // One command per plan cycle, and workers get priority — otherwise we
        // blow the entire gold reserve in a single frame.
        if (this.issue({ k: 'train', player: this.me, building: hall.eid, unitId: this.plan.worker })) return;
      }
    }

    // Army target scales with elapsed time and difficulty.
    const cap = this.armyCap(tick);
    if (militaryPop >= cap) return;

    const pick = this.chooseUnit(tick, owned, res);
    if (!pick) return;
    const ud = this.gd.units.get(pick.unitId)!;
    if (res.supplyUsed + (ud.cost.popUpkeep ?? 1) > res.supplyCap) return;
    if (!this.canAfford(res, ud.cost.gold, ud.cost.lumber)) return;
    this.issue({ k: 'train', player: this.me, building: pick.building.eid, unitId: pick.unitId });
  }

  private armyCap(tick: number): number {
    // Ramp from ~6 to the profile's wave population over the wave timeline.
    const t = Math.min(1, tick / Math.max(1, this.prof.firstWave));
    return Math.round(6 + t * (this.prof.wavePop - 6));
  }

  /** Pick the best unit we can currently produce. */
  private chooseUnit(
    tick: number,
    owned: Map<string, number>,
    res: { gold: number; lumber: number },
  ): { unitId: string; building: { eid: number; id: string } } | null {
    const built = this.game.snapshot().buildings.filter((b) => b.player === this.me && b.built);
    const options: { unitId: string; building: { eid: number; id: string }; score: number }[] = [];
    for (const b of built) {
      const list = this.plan.trainers.get(b.id);
      if (!list) continue;
      for (const unitId of list) {
        const u = this.gd.units.get(unitId);
        if (!u) continue;
        if (u.prereq && !(owned.get(u.prereq) ?? 0)) continue;
        if (!this.canAfford(res, u.cost.gold, u.cost.lumber)) continue;
        // Prefer the most advanced thing we can afford, weighted by cost
        // efficiency so we do not blow the bank on one expensive unit.
        const power = (u.damage.max - u.damage.min) / 2 + u.stats.hp / 10 + (u.fly ? 4 : 0);
        const cost = 1 + u.cost.gold + u.cost.lumber;
        const recency = this.plan.armyUnits.indexOf(unitId) / Math.max(1, this.plan.armyUnits.length);
        options.push({ unitId, building: b, score: power / Math.sqrt(cost) + recency * 2 });
      }
    }
    if (!options.length) return null;
    options.sort((a, b) => b.score - a.score || (a.unitId < b.unitId ? -1 : 1));
    void tick;
    return options[0];
  }

  /* ---------------------------- research ----------------------------- */

  private researchStuff(tick: number, built: { eid: number; id: string }[], res: { gold: number; lumber: number }): void {
    const owned = new Set(built.map((b) => b.id));
    const me = (this.game.players as unknown as Array<{ hasTech?(id: string): boolean }> | undefined)?.[this.me];
    for (const tech of [...this.gd.tech.values()].sort((a, b) => a.id < b.id ? -1 : 1)) {
      if (me?.hasTech?.(tech.id)) continue;
      if (this.techTried.has(tech.id)) continue;
      if (tech.requiresBuilding && !owned.has(tech.requiresBuilding)) continue;
      if (tech.requires.some((r) => !me?.hasTech?.(r))) continue;
      if (!this.canAfford(res, tech.cost.gold, tech.cost.lumber)) continue;
      const host = built.find((b) => b.id === tech.requiresBuilding) ?? built.find((b) => (this.gd.buildings.get(b.id)?.researches ?? []).includes(tech.id));
      if (!host) continue;
      if (this.issue({ k: 'research', player: this.me, building: host.eid, techId: tech.id })) {
        this.techTried.add(tech.id);
        return;
      }
      this.techTried.add(tech.id);
      return;
    }
    void tick;
  }

  /* ----------------------------- heroes ------------------------------ */

  private heroStuff(tick: number, heroes: UnitView[], army: UnitView[], home: { x: Fixed; y: Fixed }): void {
    const built = this.game.snapshot().buildings.filter((b) => b.player === this.me && b.built);
    if (heroes.length === 0 && tick - this.lastHeroOrder > 20 * SEC) {
      const altar = built.find((b) => (this.gd.buildings.get(b.id)?.trains ?? []).some((u) => this.isHero(u)));
      const heroId = this.plan.heroes[0];
      const res = this.game.snapshot().resources.find((r) => r.player === this.me);
      const hd = heroId ? this.gd.units.get(heroId) : undefined;
      if (altar && hd && res && this.canAfford(res, hd.cost.gold, hd.cost.lumber)) {
        if (this.issue({ k: 'train', player: this.me, building: altar.eid, unitId: heroId })) this.lastHeroOrder = tick;
      }
    }

    // Graveyard: burn the respawn timer as soon as a hero is down.
    const gyms = (this.game.world as unknown as { heroGraveyard?: Map<number, { eid: number; respawnTick: number }> }).heroGraveyard;
    if (gyms) {
      for (const [, v] of gyms) {
        if (v.respawnTick > tick + 30 * SEC) this.issue({ k: 'revive', player: this.me, hero: v.eid });
      }
    }

    // Heroes fight with the army; when alone they keep to base.
    for (const h of heroes) {
      if (tick - (this.orderedAt.get(h.eid) ?? -9999) < 4 * SEC) continue;
      if (army.length > 1) continue; // rally command below moves them together
      this.issue({ k: 'move', player: this.me, units: [h.eid], to: { x: home.x, y: home.y }, mode: 'move' });
      this.orderedAt.set(h.eid, tick);
    }
  }

  /* ----------------------------- scouting ---------------------------- */

  private scoutStuff(tick: number, workers: UnitView[], home: { x: Fixed; y: Fixed }): void {
    if (tick - this.lastScoutTick < 45 * SEC || !workers.length) return;
    // Never pull a worker out of an active gather cycle just to wander.
    const st = this.game.world.stores as unknown as {
      cargo: { get(e: number): { carrying: string } | undefined };
      orders: { get(e: number): { current: { kind: string } } | undefined };
    };
    workers = workers.filter(
      (w) => st.cargo.get(w.eid)?.carrying === 'none' && st.orders.get(w.eid)?.current.kind !== 'harvest' && st.orders.get(w.eid)?.current.kind !== 'build',
    );
    if (!workers.length) return;
    const angle = (this.rng.int(8) * Math.PI) / 4;
    const dist = 18 + this.rng.int(14);
    const tx = Math.min(this.game.terrain.width - 3, Math.max(2, Math.floor(fn(home.x) + Math.cos(angle) * dist)));
    const ty = Math.min(this.game.terrain.height - 3, Math.max(2, Math.floor(fn(home.y) + Math.sin(angle) * dist)));
    const w = workers[this.rng.int(workers.length)];
    if (this.issue({ k: 'move', player: this.me, units: [w.eid], to: { x: ff(tx) + ff(0.5), y: ff(ty) + ff(0.5) }, mode: 'move' })) {
      this.lastScoutTick = tick;
      this.orderedAt.set(w.eid, tick);
    }
  }

  /* ------------------------------ combat ----------------------------- */

  private fightStuff(
    tick: number,
    army: UnitView[],
    heroes: UnitView[],
    workers: UnitView[],
    built: { eid: number; id: string }[],
    res: { gold: number; lumber: number },
    home: { x: Fixed; y: Fixed },
  ): void {
    void res;
    const fighters = [...army, ...heroes].filter((u) => !this.isBuilding(u.eid));
    if (!fighters.length) return;

    if (this._state === 'defend') {
      this.orderDefenders(tick, fighters, workers, home);
      return;
    }

    const strength = this.armyStrength(fighters);
    const enemy = this.intel.hostiles(INTEL_AGE, tick);

    if (this._state === 'aggro' || this._state === 'finish') {
      // Retreat-and-regroup before committing to a bad fight.
      if (strength < this.prof.retreatAt * 12 && this._state !== 'finish') {
        this.moveAll(tick, fighters, home, 'move');
        return;
      }
      const target = enemy.length ? { x: enemy[0].x, y: enemy[0].y } : this.intel.frontierTarget(home.x, home.y);
      this.moveAll(tick, fighters, target, 'attackMove');
      if (tick >= this.nextWaveTick) this.nextWaveTick = tick + this.prof.waveGap;
      this.rallied = true;
      return;
    }

    // Peacetime: consolidate at a rally point just outside the hall.
    if (!this.rallied) {
      const rally = { x: ff(Math.floor(fn(home.x)) + 5), y: ff(Math.floor(fn(home.y)) + 5) };
      this.moveAll(tick, fighters, rally, 'move');
      this.rallied = true;
      const hall = built.find((b) => b.id === this.plan.townHall || this.plan.hallUpgrades.includes(b.id));
      if (hall) this.issue({ k: 'rally', player: this.me, entity: hall.eid, at: rally });
    }
    void workers;
  }

  /** Under attack: fight visible intruders, militia the nearby peasants. */
  private orderDefenders(tick: number, fighters: UnitView[], workers: UnitView[], home: { x: Fixed; y: Fixed }): void {
    const threats = this.intel.hostiles(4 * SEC, tick);
    const focus = threats[0];
    const units = fighters.map((u) => u.eid);
    if (focus && units.length) {
      if (this.issue({ k: 'rightClick', player: this.me, units, target: focus.eid, at: { x: focus.x, y: focus.y } })) {
        for (const e of units) this.orderedAt.set(e, tick);
      }
    } else if (units.length) {
      this.moveAll(tick, fighters, home, 'move');
    }

    // Militia: pull idle peasants inside the base into the fight, but never
    // strip the gold line bare.
    const near = workers.filter((w) => (fn(w.x) - fn(home.x)) ** 2 + (fn(w.y) - fn(home.y)) ** 2 < 12 * 12);
    const canSpare = Math.max(0, Math.min(near.length, this.game.snapshot().resources.find((r) => r.player === this.me)!.supplyUsed - 12));
    if (canSpare > 0 && this.lastDefenderCount !== canSpare) {
      const squad = near.slice(0, canSpare).map((w) => w.eid);
      if (squad.length) {
        const to = focus ? { x: focus.x, y: focus.y } : home;
        this.issue({ k: 'move', player: this.me, units: squad, to, mode: 'attackMove' as MoveMode });
        this.lastDefenderCount = canSpare;
      }
    }
  }

  private armyStrength(units: UnitView[]): number {
    let s = 0;
    for (const u of units) {
      const d = this.gd.units.get(this.idOf(u.eid));
      if (!d) continue;
      s += (u.hp / Math.max(1, d.stats.hp)) * (1 + (d.damage.max - d.damage.min) / 20);
    }
    return s;
  }

  private idCache = new Map<number, string>();
  private idOf(eid: number): string {
    let v = this.idCache.get(eid);
    if (v === undefined) {
      v = (this.game.world.stores.stats as unknown as { get(e: number): { id: string } | undefined }).get(eid)?.id ?? '';
      this.idCache.set(eid, v);
    }
    return v;
  }

  /** Batch-move without spamming: only re-issue when the batch is stale. */
  private moveAll(tick: number, units: { eid: number }[], to: { x: Fixed; y: Fixed }, mode: MoveMode): void {
    const eids = units.map((u) => u.eid).sort((a, b) => a - b);
    if (!eids.length) return;
    const oldest = Math.min(...eids.map((e) => this.orderedAt.get(e) ?? -9999));
    if (tick - oldest < 3 * SEC) return;
    if (this.issue({ k: 'move', player: this.me, units: eids, to: { x: to.x, y: to.y }, mode })) {
      for (const e of eids) this.orderedAt.set(e, tick);
    }
  }

  /* ------------------------------ plumbing --------------------------- */

  private canAfford(res: { gold: number; lumber: number }, gold: number, lumber: number): boolean {
    return res.gold >= gold && res.lumber >= lumber;
  }

  /** Entity id created by the most recent `build` command, if any. */
  private lastBuiltEntity: number | undefined = undefined;

  /** The single mutation point of this entire module. */
  private issue(cmd: Command): boolean {
    const before = cmd.k === 'build' ? new Set(this.game.world.live as readonly number[]) : null;
    this.game.command(cmd);
    if (before) {
      for (const e of this.game.world.live as readonly number[]) {
        if (!before.has(e)) {
          this.lastBuiltEntity = e;
          break;
        }
      }
    }
    return true;
  }
}
