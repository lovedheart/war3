/**
 * Economy: worker harvest cycle, building construction assist, training and
 * research queues, supply bookkeeping, upkeep.
 *
 * Harvest cycle (WC3):
 *   move to source -> harvest tick (accumulate `rate` up to capacity) ->
 *   move to nearest drop-off of matching type -> deposit -> repeat.
 * Gold mines deplete; trees are felled when drained and vanish.
 */
import { Fixed, ff, fi, fn } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import { UPKEEP_LOW_GOLD_DRAIN, UPKEEP_HIGH_GOLD_DRAIN } from '../core/constants.js';
import { dist } from './movement.js';

const TICKS = 30;

interface S {
  transform: { get(e: Eid): { x: Fixed; y: Fixed; w: number; h: number } | undefined };
  owner: { get(e: Eid): { player: number } | undefined };
  kind: { get(e: Eid): { kind: number } | undefined };
  cargo: {
    get(e: Eid): { carrying: 'gold' | 'wood' | 'none'; amount: Fixed; capacity: Fixed; sourceEid: number; destEid: number; phase: number } | undefined;
  };
  orders: { get(e: Eid): { current: { kind: string; targetEid: number; tx: Fixed; ty: Fixed; mode: number; param: string }; queue: unknown[] } | undefined };
  mine: { get(e: Eid): { capacity: Fixed; rate: Fixed } | undefined };
  tree: { get(e: Eid): { capacity: Fixed; felled: boolean } | undefined };
  building: {
    get(
      e: Eid,
    ): { buildingId: string; built: boolean; progress: number; totalTicks: number; trainQueue: { unitId: string; remaining: number }[]; researchQueue: { techId: string; remaining: number }[]; supplyProvided: number; rallyX: Fixed; rallyY: Fixed; underConstructionBy: number } | undefined;
  };
  health: { get(e: Eid): { hp: Fixed; dead: boolean } | undefined };
  stats: { get(e: Eid): { id: string } | undefined };
}
const S = (w: World) => w.stores as unknown as S;

interface PlayerLike {
  id: number;
  gold: Fixed;
  lumber: Fixed;
  supplyUsed: number;
  supplyCap: number;
  upkeep: 0 | 1 | 2;
  computeUpkeep(): 0 | 1 | 2;
  earn(kind: 'gold' | 'lumber', amount: Fixed): void;
  addTech(id: string, tick: number): void;
  incomeFactor(): Fixed;
}

function players(w: World): PlayerLike[] {
  return (w as unknown as { players: PlayerLike[] }).players;
}

export function economySystem(w: World, tick: number): void {
  const s = S(w);
  for (const e of w.live) {
    const eid = e as Eid;
    const c = s.cargo.get(eid);
    if (!c) continue;
    const o = s.orders.get(eid);
    if (!o) continue;
    const t = s.transform.get(eid);
    if (!t) continue;
    if (s.health.get(eid)?.dead) continue;

    switch (o.current.kind) {
      case 'harvest':
        harvestTick(w, s, eid, c, o, t, tick);
        break;
      case 'build':
        buildTick(w, s, eid, o, t);
        break;
      case 'return':
        returnTick(w, s, eid, c, o, t);
        break;
      default:
        break;
    }
  }

  // buildings: construction, training, research -----------------------------
  for (const e of w.live) {
    const eid = e as Eid;
    const b = s.building.get(eid);
    if (!b) continue;
    if (!b.built) {
      // progress only advances while a worker is adjacent assisting
      if (b.progress > 0 && hasWorkerAssisting(w, s, eid)) b.progress--;
      if (b.progress <= 0) finishConstruction(w, eid, b);
      continue;
    }
    if (b.trainQueue.length) {
      const head = b.trainQueue[0];
      head.remaining--;
      if (head.remaining <= 0) {
        b.trainQueue.shift();
        spawnTrainedUnit(w, eid, head.unitId, tick);
      }
    }
    if (b.researchQueue.length) {
      const r = b.researchQueue[0];
      r.remaining--;
      if (r.remaining <= 0) {
        b.researchQueue.shift();
        const p = players(w)[s.owner.get(eid)?.player ?? 0];
        p?.addTech(r.techId, tick);
        applyTechEffects(w, r.techId);
      }
    }
  }

  // supply + upkeep ---------------------------------------------------------
  recomputeSupply(w, s);
  if (tick % TICKS === 0) upkeepTick(w);
}

function hasWorkerAssisting(w: World, s: S, site: Eid): boolean {
  const st = s.transform.get(site);
  if (!st) return false;
  const quad = w.quad;
  if (!quad) return true;
  const out: number[] = [];
  quad.query(st.x, st.y, ff(2.5), out);
  for (const o of out) {
    const oe = o as Eid;
    if (!s.cargo.get(oe)) continue;
    if ((s.owner.get(oe)?.player ?? 0) !== (s.owner.get(site)?.player ?? -1)) continue;
    const ord = s.orders.get(oe);
    if (ord && ord.current.kind === 'build' && ord.current.targetEid === site) return true;
  }
  return false;
}

function finishConstruction(w: World, eid: Eid, b: NonNullable<ReturnType<S['building']['get']>>): void {
  b.built = true;
  b.progress = 0;
  const id = b.buildingId;
  w.bus.emit('building:constructed', { eid, buildingId: id, player: 0 });
  const occ = (w as unknown as { occupied?: Uint8Array }).occupied;
  void occ;
}

function spawnTrainedUnit(w: World, site: Eid, unitId: string, _tick: number): void {
  const s = S(w);
  const factory = (w as unknown as { spawnUnitById: (id: string, x: Fixed, y: Fixed, player: number) => Eid })
    .spawnUnitById;
  if (!factory) return;
  const b = s.building.get(site)!;
  const t = s.transform.get(site)!;
  const player = s.owner.get(site)?.player ?? 0;
  const rx = b.rallyX || t.x;
  const ry = b.rallyY || t.y;
  const eid = factory(unitId, rx, ry, player);
  const nt = s.transform.get(eid);
  if (nt) {
    nt.x = rx;
    nt.y = ry;
  }
}

function harvestTick(
  w: World,
  s: S,
  eid: Eid,
  c: NonNullable<ReturnType<S['cargo']['get']>>,
  o: NonNullable<ReturnType<S['orders']['get']>>,
  t: NonNullable<ReturnType<S['transform']['get']>>,
  _tick: number,
): void {
  const src = o.current.targetEid;
  const st = s.transform.get(src);
  if (!st) {
    o.current.kind = 'none';
    return;
  }
  const mine = s.mine.get(src);
  const tree = s.tree.get(src);
  if (!mine && !tree) {
    o.current.kind = 'none';
    return;
  }
  const kind: 'gold' | 'wood' = mine ? 'gold' : 'wood';
  const near = dist(t.x, t.y, st.x, st.y) <= ff(1.6);
  if (!near) {
    o.current.tx = st.x;
    o.current.ty = st.y;
    return;
  }
  if (c.carrying === 'none') {
    const avail = mine ? mine.capacity : tree ? tree.capacity : 0;
    const take = Math.min(c.capacity, avail);
    if (take <= 0) {
      // source exhausted → find another or idle
      retargetHarvest(w, s, eid, c, o, kind);
      return;
    }
    if (mine) mine.capacity -= take;
    if (tree) {
      tree.capacity -= take;
      if (tree.capacity <= 0) {
        tree.felled = true;
        w.destroyEntity(src);
      }
    }
    c.carrying = kind;
    c.amount = take;
    c.sourceEid = src;
    return;
  }
  // carrying: go deposit
  const dest = findDropoff(w, s, s.owner.get(eid)?.player ?? 0, c.carrying, t);
  if (dest === 0xffffffff) return; // no drop-off: hold load
  const dt = s.transform.get(dest);
  if (!dt) return;
  if (dist(t.x, t.y, dt.x, dt.y) > ff(1.8)) {
    o.current.tx = dt.x;
    o.current.ty = dt.y;
    o.current.targetEid = src; // keep source for the next leg
    c.destEid = dest;
    return;
  }
  const p = players(w)[s.owner.get(eid)?.player ?? 0];
  if (p) p.earn(c.carrying === 'wood' ? 'lumber' : 'gold', c.amount);
  c.amount = 0;
  c.carrying = 'none';
}

function returnTick(
  w: World,
  s: S,
  eid: Eid,
  c: NonNullable<ReturnType<S['cargo']['get']>>,
  o: NonNullable<ReturnType<S['orders']['get']>>,
  t: NonNullable<ReturnType<S['transform']['get']>>,
): void {
  const dest = o.current.targetEid;
  const dt = s.transform.get(dest);
  if (!dt) {
    o.current.kind = 'none';
    return;
  }
  if (dist(t.x, t.y, dt.x, dt.y) > ff(1.8)) {
    o.current.tx = dt.x;
    o.current.ty = dt.y;
    return;
  }
  const p = players(w)[s.owner.get(eid)?.player ?? 0];
  if (p && c.carrying !== 'none') p.earn(c.carrying === 'wood' ? 'lumber' : 'gold', c.amount);
  c.amount = 0;
  c.carrying = 'none';
  o.current.kind = 'harvest';
}

function buildTick(
  _w: World,
  s: S,
  _eid: Eid,
  o: NonNullable<ReturnType<S['orders']['get']>>,
  t: NonNullable<ReturnType<S['transform']['get']>>,
): void {
  const site = o.current.targetEid;
  const b = s.building.get(site);
  const st = s.transform.get(site);
  if (!b || !st) {
    o.current.kind = 'none';
    return;
  }
  if (b.built) {
    o.current.kind = 'none';
    return;
  }
  if (dist(t.x, t.y, st.x, st.y) > ff(2.2)) {
    o.current.tx = st.x;
    o.current.ty = st.y;
  }
}

function retargetHarvest(
  w: World,
  s: S,
  _eid: Eid,
  _c: NonNullable<ReturnType<S['cargo']['get']>>,
  o: NonNullable<ReturnType<S['orders']['get']>>,
  kind: 'gold' | 'wood',
): void {
  const list = kind === 'gold' ? (w as unknown as { goldMines: Eid[] }).goldMines : (w as unknown as { trees: Eid[] }).trees;
  const t = s.transform.get(_eid);
  if (!t || !list) return;
  let best = 0xffffffff;
  let bestD = 0x7fffffff;
  for (const cand of list) {
    if (!w.alive(cand)) continue;
    if (kind === 'gold' && (s.mine.get(cand)?.capacity ?? 0) <= 0) continue;
    if (kind === 'wood' && (s.tree.get(cand)?.felled ?? true)) continue;
    const ct = s.transform.get(cand);
    if (!ct) continue;
    const d = dist(t.x, t.y, ct.x, ct.y);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  if (best !== 0xffffffff) o.current.targetEid = best;
  else o.current.kind = 'none';
}

function findDropoff(w: World, s: S, _player: number, kind: 'gold' | 'wood', t: { x: Fixed; y: Fixed }): Eid {
  const bmap = (w as unknown as { dropoffs: Record<'gold' | 'wood', Eid[]> }).dropoffs;
  const list = bmap?.[kind] ?? [];
  let best = 0xffffffff;
  let bestD = 0x7fffffff;
  for (const b of list) {
    if (!w.alive(b)) continue;
    const bt = s.transform.get(b);
    if (!bt) continue;
    const d = dist(t.x, t.y, bt.x, bt.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function recomputeSupply(w: World, s: S): void {
  const ps = players(w);
  for (const p of ps) {
    p.supplyUsed = 0;
    p.supplyCap = 0;
  }
  for (const e of w.live) {
    const eid = e as Eid;
    if (s.health.get(eid)?.dead) continue;
    const owner = s.owner.get(eid)?.player ?? 0;
    const p = ps[owner];
    if (!p) continue;
    const b = s.building.get(eid);
    if (b) {
      if (b.built) p.supplyCap += b.supplyProvided;
      continue;
    }
    if (!s.cargo.get(eid) && s.kind.get(eid)?.kind === 0) {
      const pop = (w as unknown as { popOf: (id: string) => number }).popOf?.(s.stats.get(eid)?.id ?? '') ?? 1;
      p.supplyUsed += pop;
    }
  }
  for (const p of ps) p.upkeep = p.computeUpkeep();
}

function upkeepTick(w: World): void {
  for (const p of players(w)) {
    if (p.upkeep === 1) p.gold -= fi(UPKEEP_LOW_GOLD_DRAIN);
    else if (p.upkeep === 2) p.gold -= fi(UPKEEP_HIGH_GOLD_DRAIN);
    if (p.gold < 0) p.gold = 0;
  }
}

function applyTechEffects(w: World, techId: string): void {
  const hook = (w as unknown as { onTechResearched?: (id: string) => void }).onTechResearched;
  hook?.(techId);
}

export { fn };
