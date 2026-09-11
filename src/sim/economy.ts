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
/** WC3: filling one load at a gold source takes ~1.05 s of gathering. */
const HARVEST_TICKS = 31;

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
  // ---- carrying: deliver to the drop-off, then resume harvesting ----------
  if (c.carrying !== 'none') {
    const dest = findDropoff(w, s, players(w), c.carrying, t);
    if (dest === 0xffffffff) return; // no drop-off yet: hold the load
    const dt = s.transform.get(dest);
    if (!dt) return;
    c.destEid = dest;
    if (dist(t.x, t.y, dt.x, dt.y) > ff(2.2)) {
      steer(o, dt.x, dt.y);
      return;
    }
    const p = players(w)[s.owner.get(eid)?.player ?? 0];
    if (p) p.earn(c.carrying === 'wood' ? 'lumber' : 'gold', c.amount);
    c.amount = 0;
    c.carrying = 'none';
    c.phase = 0;
    o.current.kind = 'harvest';
    // Head straight back to the source we harvested from. Leaving the waypoint
    // clear would idle the worker at the drop-off until its next think tick.
    const back = c.sourceEid !== 0xffffffff ? s.transform.get(c.sourceEid) : undefined;
    if (back && (s.mine.get(c.sourceEid) || s.tree.get(c.sourceEid))) {
      o.current.targetEid = c.sourceEid;
      const wp = s.tree.get(c.sourceEid) ? treeStandSpot(w, back.x, back.y) : { x: back.x, y: back.y };
      steer(o, wp.x, wp.y);
    } else {
      clearWaypoint(o);
    }
    return;
  }

  // ---- empty: work at the source ----------------------------------------
  let src = o.current.targetEid;
  if ((src === 0xffffffff || !s.transform.get(src)) && c.sourceEid !== 0xffffffff) src = c.sourceEid;
  let st = src !== 0xffffffff ? s.transform.get(src) : undefined;
  if (!st || (!s.mine.get(src) && !s.tree.get(src))) {
    // Dead target (felled tree / removed mine): re-acquire a live source once.
    retargetHarvest(w, s, eid, c, o, o.current.param === 'wood' ? 'wood' : 'gold');
    src = o.current.targetEid;
    st = src !== 0xffffffff ? s.transform.get(src) : undefined;
    if (!st) return;
  }
  const mine = s.mine.get(src);
  const tree = s.tree.get(src);
  if (!mine && !tree) return;

  const reach = tree ? ff(2.6) : ff(1.8);
  if (dist(t.x, t.y, st.x, st.y) > reach) {
    c.phase = 0; // walking: the gather timer only runs at the source
    // Trees sit on reserved (non-walkable) tiles, so steering straight at the
    // centre pins the worker against the trunk; aim at a standable neighbour.
    const wp = tree ? treeStandSpot(w, st.x, st.y) : { x: st.x, y: st.y };
    steer(o, wp.x, wp.y);
    return;
  }
  if (tree && dist(t.x, t.y, st.x, st.y) > ff(1.8)) {
    // Within chopping reach but not at the centre: stop nudging and work.
    clearWaypoint(o);
  }
  if (c.phase > 0) {
    c.phase--; // still filling this load
    clearWaypoint(o);
    return;
  }
  const take = Math.min(c.capacity, (mine ? mine.capacity : tree ? tree.capacity : 0));
  if (take <= 0) {
    retargetHarvest(w, s, eid, c, o, mine ? 'gold' : 'wood');
    return;
  }
  if (mine) {
    mine.capacity -= take;
    c.phase = HARVEST_TICKS;
  }
  if (tree) {
    tree.capacity -= take;
    if (tree.capacity <= 0) {
      tree.felled = true;
      w.destroyEntity(src);
    }
  }
  c.carrying = mine ? 'gold' : 'wood';
  c.amount = take;
  c.sourceEid = src;
}

/** Point a worker's waypoint at a target unless it is already there. */
function steer(o: NonNullable<ReturnType<S['orders']['get']>>, x: Fixed, y: Fixed): void {
  o.current.tx = x;
  o.current.ty = y;
}

function clearWaypoint(o: NonNullable<ReturnType<S['orders']['get']>>): void {
  o.current.tx = 0;
  o.current.ty = 0;
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

let retargetCursor = 0;

function retargetHarvest(
  w: World,
  s: S,
  _eid: Eid,
  _c: NonNullable<ReturnType<S['cargo']['get']>>,
  o: NonNullable<ReturnType<S['orders']['get']>>,
  kind: 'gold' | 'wood',
): void {
  const all = kind === 'gold' ? (w as unknown as { goldMines: Eid[] }).goldMines : (w as unknown as { trees: Eid[] }).trees;
  const t = s.transform.get(_eid);
  if (!t || !all) return;
  // Candidate cap keeps this O(k) instead of O(all trees on the map).
  const CAP = 48;
  const start = retargetCursor % Math.max(1, all.length);
  let best = 0xffffffff;
  let bestD = 0x7fffffff;
  for (let n = 0; n < CAP; n++) {
    const cand = all[(start + n) % all.length];
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
  retargetCursor = (retargetCursor + 1) % Math.max(1, all.length);
  if (best !== 0xffffffff) {
    o.current.targetEid = best;
    o.current.kind = 'harvest';
    o.current.tx = 0;
    o.current.ty = 0;
  } else {
    // Nothing left to harvest: idle rather than spin, but do not lose cargo.
    o.current.kind = 'none';
  }
}

function findDropoff(w: World, s: S, _players: unknown, kind: 'gold' | 'wood', t: { x: Fixed; y: Fixed }): Eid {
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
    if (s.kind.get(eid)?.kind === 0 && !s.building.get(eid)) {
      // Every unit counts its food cost — workers included.
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

/**
 * A walkable tile adjacent to a harvesting target. Trees occupy a reserved
 * (non-walkable) tile, so steering straight at their centre would pin the
 * worker against it. Deterministic: candidates are scanned in fixed order.
 */
function treeStandSpot(w: World, tx: Fixed, ty: Fixed): { x: Fixed; y: Fixed } {
  const terr = w.terrain;
  if (terr && !terr.isWalkable(Math.floor(fn(tx)), Math.floor(fn(ty)))) {
    const cand: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of cand) {
      const x = Math.floor(fn(tx)) + dx;
      const y = Math.floor(fn(ty)) + dy;
      if (terr.isWalkable(x, y)) return { x: ff(x) + ff(0.5), y: ff(y) + ff(0.5) };
    }
  }
  return { x: tx, y: ty };
}
