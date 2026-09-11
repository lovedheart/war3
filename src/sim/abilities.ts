/**
 * Ability / spell system.
 *
 * Casting is two-phase: `commandApply` deducts mana and pushes a
 * PendingAbility onto `world.pendingAbilities`; this system resolves it at
 * `castPoint` (so the animation wind-up matters, as in WC3) by dispatching on
 * the effect list from the data table.
 */
import { Fixed, ff, fi, fn } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import { strike } from './combat.js';
import { spawnItem } from './spawn.js';
import { dist } from './movement.js';

interface S {
  transform: { get(e: Eid): { x: Fixed; y: Fixed } | undefined };
  owner: { get(e: Eid): { player: number } | undefined };
  health: { get(e: Eid): { hp: Fixed; hpMax: Fixed; mp: Fixed; mpMax: Fixed; dead: boolean } | undefined };
  buffs: {
    get(e: Eid): {
      list: { srcEid: number; kind: string; stat: string; amount: Fixed; pct: Fixed; untilTick: number; stacks: number }[];
    } | undefined;
  };
  abilities: { get(e: Eid): { slots: { abilityId: string; level: number }[]; arming: string | null } | undefined };
  stats: { get(e: Eid): { id: string; level: number; str: number; agi: number; int: number } | undefined };
  orders: { get(e: Eid): { current: { kind: string; tx: Fixed; ty: Fixed; targetEid: number } } | undefined };
}
const S = (w: World) => w.stores as unknown as S;

export interface PendingAbility {
  tick: number;
  caster: Eid;
  abilityId: string;
  target: Eid;
  x: Fixed;
  y: Fixed;
}

interface Effect {
  kind: string;
  [k: string]: unknown;
}

interface AbilityDefLike {
  id: string;
  effects: Effect[];
  radius?: number;
  damage?: { min: number; max: number };
  duration?: number;
  cooldown?: number;
  summon?: { unitId: string; count: number; life: number };
  levelScale?: number;
}

function defs(w: World): Map<string, AbilityDefLike> {
  return (w as unknown as { abilityDefs: Map<string, AbilityDefLike> }).abilityDefs;
}

export function abilitySystem(w: World, tick: number): void {
  const s = S(w);
  const q = (w as unknown as { pendingAbilities: PendingAbility[] }).pendingAbilities;
  if (!q) return;
  let wIdx = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    if (p.tick > tick) {
      q[wIdx++] = p;
      continue;
    }
    if (!w.alive(p.caster)) continue;
    const def = defs(w)?.get(p.abilityId);
    if (!def) continue;
    for (const eff of def.effects) applyEffect(w, s, p, def, eff, tick);
  }
  q.length = wIdx;

  // buff expiry
  for (const e of w.live) {
    const b = s.buffs.get(e as Eid);
    if (!b || !b.list.length) continue;
    let j = 0;
    for (let i = 0; i < b.list.length; i++) if (b.list[i].untilTick > tick) b.list[j++] = b.list[i];
    b.list.length = j;
  }
}

function levelOf(s: S, caster: Eid, def: AbilityDefLike): number {
  const slot = s.abilities.get(caster)?.slots.find((x) => x.abilityId === def.id);
  return slot?.level ?? 1;
}

function scale(def: AbilityDefLike, lvl: number, v: number): number {
  return v + (def.levelScale ? def.levelScale * (lvl - 1) : 0);
}

function applyEffect(
  w: World,
  s: S,
  p: PendingAbility,
  def: AbilityDefLike,
  eff: Effect,
  tick: number,
): void {
  const lvl = levelOf(s, p.caster, def);
  const owner = s.owner.get(p.caster)?.player ?? 0;
  const casterT = s.transform.get(p.caster);
  switch (eff.kind) {
    case 'damage': {
      const tgt = p.target !== 0xffffffff ? p.target : findNearestEnemy(w, s, casterT?.x ?? 0, casterT?.y ?? 0, ff(6), owner);
      if (tgt === 0xffffffff) return;
      const dmg = ff(scale(def, lvl, Number(eff.amount ?? def.damage?.min ?? 30)));
      strike(w, p.caster, tgt, dmg, tick);
      break;
    }
    case 'aoeDamage': {
      const cx = p.x || casterT?.x || 0;
      const cy = p.y || casterT?.y || 0;
      const r = ff(Number(eff.radius ?? def.radius ?? 4.5));
      const dmg = ff(scale(def, lvl, Number(eff.amount ?? def.damage?.min ?? 40)));
      aoeStrike(w, s, p.caster, cx, cy, r, dmg, owner, tick);
      break;
    }
    case 'summon': {
      const unitId = String(eff.unitId ?? def.summon?.unitId ?? '');
      const n = Number(eff.count ?? def.summon?.count ?? 1);
      const life = Number(eff.life ?? def.summon?.life ?? 60);
      const base = (w as unknown as { spawnUnitById: (id: string, x: Fixed, y: Fixed, player: number) => Eid })
        .spawnUnitById;
      if (!base || !unitId) return;
      const ox = p.x || casterT?.x || 0;
      const oy = p.y || casterT?.y || 0;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const eid = base(unitId, ox + ff(Math.cos(ang) * 1.2), oy + ff(Math.sin(ang) * 1.2), owner);
        scheduleDespawn(w, eid, tick + Math.round(life * 30));
      }
      break;
    }
    case 'stun': {
      addBuff(w, s, p.target, p.caster, 'stun', '', 0, ff(Number(eff.dur ?? 3)), tick);
      break;
    }
    case 'slow': {
      addBuff(w, s, p.target, p.caster, 'slow', 'speed', 0, ff(1 - Number(eff.pct ?? 0.5)), tick);
      break;
    }
    case 'buff': {
      addBuff(w, s, p.target === 0xffffffff ? p.caster : p.target, p.caster, String(eff.kind2 ?? 'buff'), String(eff.stat ?? 'armor'), ff(Number(eff.amount ?? 3)), ff(Number(eff.dur ?? 30)), tick);
      break;
    }
    case 'heal': {
      const tgt = p.target !== 0xffffffff ? p.target : p.caster;
      const h = s.health.get(tgt);
      if (!h) return;
      h.hp = Math.min(h.hp + ff(scale(def, lvl, Number(eff.amount ?? 40))), h.hpMax);
      break;
    }
    case 'invisibility': {
      addBuff(w, s, p.target === 0xffffffff ? p.caster : p.target, p.caster, 'invis', '', 0, ff(Number(eff.dur ?? 30)), tick);
      break;
    }
    case 'chainlightning': {
      const jumps = Number(eff.jumps ?? 5);
      const dmg = ff(scale(def, lvl, Number(eff.amount ?? 80)));
      let cur = p.target !== 0xffffffff ? p.target : findNearestEnemy(w, s, casterT?.x ?? 0, casterT?.y ?? 0, ff(9), owner);
      const seen = new Set<number>();
      for (let i = 0; i < jumps && cur !== 0xffffffff; i++) {
        seen.add(cur);
        strike(w, p.caster, cur, dmg, tick);
        cur = nearestEnemyExcept(w, s, cur, ff(7), owner, seen);
      }
      break;
    }
    case 'teleport': {
      const t = s.transform.get(p.caster);
      if (!t) return;
      t.x = p.x || t.x;
      t.y = p.y || t.y;
      break;
    }
    case 'dispel': {
      const b = s.buffs.get(p.target);
      if (b) b.list.length = 0;
      break;
    }
    case 'crush': {
      // stuns structures, damages nearby enemies
      const t = s.transform.get(p.caster);
      if (t) aoeStrike(w, s, p.caster, t.x, t.y, ff(3), ff(scale(def, lvl, 50)), owner, tick);
      break;
    }
    default:
      break;
  }
}

function aoeStrike(
  w: World,
  s: S,
  src: Eid,
  cx: Fixed,
  cy: Fixed,
  r: Fixed,
  dmg: Fixed,
  owner: number,
  tick: number,
): void {
  for (const e of w.live) {
    const eid = e as Eid;
    const op = s.owner.get(eid)?.player ?? 0;
    if (op === owner || op === 11) continue;
    if (s.health.get(eid)?.dead) continue;
    const t = s.transform.get(eid);
    if (!t) continue;
    if (dist(cx, cy, t.x, t.y) <= r) strike(w, src, eid, dmg, tick);
  }
}

function addBuff(
  w: World,
  s: S,
  target: Eid,
  src: Eid,
  kind: string,
  stat: string,
  amount: Fixed,
  durTicks: Fixed,
  tick: number,
): void {
  const b = s.buffs.get(target);
  if (!b) return;
  const existing = b.list.find((x) => x.kind === kind && x.srcEid === src);
  const until = tick + Math.max(1, fround(durTicks));
  if (existing) {
    existing.untilTick = Math.max(existing.untilTick, until);
    existing.stacks++;
  } else {
    b.list.push({ srcEid: src, kind, stat, amount, pct: ff(1), untilTick: until, stacks: 1 });
  }
  w.bus.emit('log', { level: 'info', msg: `buff ${kind} on ${target}` });
}

function fround(x: Fixed): number {
  return Math.round(fn(x) * 30);
}

function findNearestEnemy(w: World, s: S, x: Fixed, y: Fixed, r: Fixed, owner: number): Eid {
  return nearestEnemyExcept(w, s, { x, y } as never, r, owner, new Set());
}

function nearestEnemyExcept(
  w: World,
  s: S,
  from: Eid | { x: Fixed; y: Fixed },
  r: Fixed,
  owner: number,
  seen: Set<number>,
): Eid {
  const fx = typeof (from as Eid) === 'number' ? s.transform.get(from as Eid)?.x ?? 0 : (from as { x: Fixed }).x;
  const fy = typeof (from as Eid) === 'number' ? s.transform.get(from as Eid)?.y ?? 0 : (from as { y: Fixed }).y;
  const quad = w.quad;
  if (!quad) return 0xffffffff;
  const out: number[] = [];
  quad.query(fx, fy, r, out);
  let best = 0xffffffff;
  let bestD = 0x7fffffff;
  for (const c of out) {
    const ce = c as Eid;
    if (seen.has(ce)) continue;
    const cp = s.owner.get(ce)?.player ?? 0;
    if (cp === owner || cp === 11) continue;
    if (s.health.get(ce)?.dead) continue;
    const t = s.transform.get(ce);
    if (!t) continue;
    const d = dist(fx, fy, t.x, t.y);
    if (d < bestD) {
      bestD = d;
      best = ce;
    }
  }
  return best;
}

function scheduleDespawn(w: World, eid: Eid, tick: number): void {
  const map = (w as unknown as { timedDeaths: Map<number, number> }).timedDeaths;
  map.set(eid, tick);
}

export function timedDeathSystem(w: World, tick: number): void {
  const map = (w as unknown as { timedDeaths: Map<number, number> }).timedDeaths;
  for (const [eid, at] of map) {
    if (tick >= at) {
      map.delete(eid);
      if (w.alive(eid)) w.destroyEntity(eid);
    }
  }
}

export { spawnItem, fi };
