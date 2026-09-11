/**
 * Combat system: auto-acquire, attack timing (attack point), damage application,
 * splash, death, XP award, corpse decay.
 *
 * Attack timing follows WC3: a swing starts when cooldownLeft hits 0 and lands
 * `attackPoint` of the way through the cycle; melee resolves instantly at that
 * moment, ranged spawns a missile entity.
 */
import { Fixed, ff, fmul, fi } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import { resolveDamage } from './damage.js';
import { ACQUIRE_EXTRA, CORPSE_DECAY } from '../core/constants.js';
import { advance } from './orders.js';
import { dist } from './movement.js';
import { grantXp } from './hero.js';

interface S {
  transform: { get(e: Eid): { x: Fixed; y: Fixed; radius: Fixed } | undefined };
  owner: { get(e: Eid): { player: number } | undefined };
  kind: { get(e: Eid): { kind: number } | undefined };
  health: {
    get(e: Eid): { hp: Fixed; hpMax: Fixed; dead: boolean; deathTick: number; mp: Fixed } | undefined;
  };
  damage: {
    get(
      e: Eid,
    ): {
      min: Fixed;
      max: Fixed;
      attackType: import('./components.js').AttackType;
      cooldown: Fixed;
      range: Fixed;
      attackPoint: Fixed;
      bonusVsLight: Fixed;
      bonusVsMedium: Fixed;
      bonusVsHeavy: Fixed;
      bonusVsHero: Fixed;
      bonusVsAncient: Fixed;
      bonusVsFortified: Fixed;
      splashRadius: Fixed;
      splashInnerPct: Fixed;
      pierceCount: number;
    } & Record<string, Fixed | string | number> | undefined;
  };
  armor: { get(e: Eid): { value: Fixed; type: import('./components.js').ArmorType } | undefined };
  attack: { get(e: Eid): { cooldownLeft: number; swing: number; target: number; approaching: boolean } | undefined };
  stats: { get(e: Eid): { id: string; isHero: boolean; level: number; xp: number } | undefined };
  building: { get(e: Eid): { built: boolean; buildingId: string } | undefined };
  hero: { get(e: Eid): { itemSlots: (string | null)[]; respawnTick: number } | undefined };
  movement: { get(e: Eid): { fly: boolean } | undefined };
}
const S = (w: World) => w.stores as unknown as S;

const TICKS_PER_SEC = 30;

export function combatSystem(w: World, tick: number): void {
  const s = S(w);
  const players = (w as unknown as { players: { id: number; kills: number; losses: number }[] }).players;

  for (const e of w.live) {
    const eid = e as Eid;
    const d = s.damage.get(eid);
    const atk = s.attack.get(eid);
    if (!d || !atk) continue;
    if (s.health.get(eid)?.dead) continue;
    const t = s.transform.get(eid);
    if (!t) continue;

    if (atk.cooldownLeft > 0) atk.cooldownLeft--;

    // pick / validate target -------------------------------------------------
    let target = atk.target;
    if (target === 0xffffffff || !alive(s, target)) {
      target = acquire(w, eid);
      atk.target = target;
    }
    if (target === 0xffffffff) continue;
    const tt = s.transform.get(target);
    if (!tt) continue;

    const reach = fmul(d.range as Fixed, fi(1)) + t.radius + (s.transform.get(target)?.radius ?? 0);
    const inRange = dist(t.x, t.y, tt.x, tt.y) <= reach + ff(0.05);
    if (!inRange) continue;

    // swing timing -----------------------------------------------------------
    const cycleTicks = Math.max(1, Math.round(fnum(d.cooldown as Fixed) * TICKS_PER_SEC));
    if (atk.cooldownLeft > 0) continue;
    const apTick = Math.max(1, Math.round((d.attackPoint as Fixed) / cycleTicks / 65536 * cycleTicks));
    if (atk.swing === 0) {
      atk.swing = cycleTicks;
      atk.cooldownLeft = cycleTicks;
      continue;
    }
    atk.swing--;
    if (atk.swing < cycleTicks - apTick - 1) continue;
    atk.swing = 0;

    applyHit(w, eid, target, tick, players);
  }

  // death bookkeeping + corpse decay ----------------------------------------
  for (const e of w.live) {
    const eid = e as Eid;
    const h = s.health.get(eid);
    if (!h || !h.dead || !h.deathTick) continue;
    if (tick - h.deathTick >= Math.round(CORPSE_DECAY * TICKS_PER_SEC)) w.destroyEntity(eid);
  }
}

function fnum(x: Fixed): number {
  return x / 65536;
}

function alive(s: S, e: Eid): boolean {
  const h = s.health.get(e);
  return !!h && !h.dead;
}

/** Auto-acquire: nearest visible enemy within range + ACQUIRE_EXTRA. */
function acquire(w: World, eid: Eid): Eid {
  const s = S(w);
  const me = s.owner.get(eid)?.player ?? 0;
  const t = s.transform.get(eid);
  const d = s.damage.get(eid);
  if (!t || !d) return 0xffffffff;
  const reach = (d.range as Fixed) + ff(ACQUIRE_EXTRA) + t.radius;
  const quad = w.quad;
  if (!quad) return 0xffffffff;
  const out: number[] = [];
  quad.query(t.x, t.y, reach, out);
  let best = 0xffffffff;
  let bestD = 0x7fffffff;
  for (const cand of out) {
    const c = cand as Eid;
    if (c === eid) continue;
    const cp = s.owner.get(c)?.player ?? 0;
    if (cp === me || cp === 11) continue;
    if (!alive(s, c)) continue;
    if (isAlliedPlayer(w, me, cp)) continue;
    const ct = s.transform.get(c);
    if (!ct) continue;
    const dd = dist(t.x, t.y, ct.x, ct.y);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return best;
}

export function isAlliedPlayer(w: World, a: number, b: number): boolean {
  const ps = (w as unknown as { players: { ally: { bits: number } }[] }).players;
  if (a === b) return true;
  if (a === 11 || b === 11) return false;
  return ((ps[a]?.ally.bits ?? 0) & (1 << b)) !== 0;
}

/** Resolve one attack hit (also used by abilities that deal "attack" damage). */
export function applyHit(
  w: World,
  src: Eid,
  dst: Eid,
  tick: number,
  players?: { id: number; kills: number; losses: number }[],
): Fixed {
  const s = S(w);
  const d = s.damage.get(src);
  const st = s.transform.get(src);
  const dt = s.transform.get(dst);
  if (!d || !st || !dt) return 0;
  const dmg = d.min + (((d.max - d.min) * w.rng.int(65537)) >> 16);
  const amount = strike(w, src, dst, dmg, tick);
  if (amount > 0) {
    // splash to nearby enemies of the target
    const sr = d.splashRadius as Fixed;
    if (sr > 0) {
      const quad = w.quad;
      if (quad) {
        const out: number[] = [];
        quad.query(dt.x, dt.y, sr, out);
        const ownerOfTarget = s.owner.get(dst)?.player ?? 0;
        for (const o of out) {
          const oe = o as Eid;
          if (oe === dst || oe === src) continue;
          if ((s.owner.get(oe)?.player ?? 0) !== ownerOfTarget) continue;
          if (!alive(s, oe)) continue;
          const dd = dist(dt.x, dt.y, s.transform.get(oe)!.x, s.transform.get(oe)!.y);
          const pct = dd <= fmul(sr, d.splashInnerPct as Fixed) ? fi(1) : ff(0.5);
          strike(w, src, oe, fmul(amount, pct), tick);
        }
      }
    }
  }
  void players;
  return amount;
}

/** Apply raw damage to one entity, handle death + XP. Returns dealt damage. */
export function strike(w: World, src: Eid, dst: Eid, raw: Fixed, tick: number): Fixed {
  const s = S(w);
  const dh = s.health.get(dst);
  if (!dh || dh.dead) return 0;
  const sa = s.armor.get(dst);
  const sd = s.damage.get(src);
  const res = resolveDamage({
    min: raw,
    max: raw,
    attackType: (sd?.attackType ?? 'normal') as never,
    bonusVsLight: sd?.bonusVsLight ?? 0,
    bonusVsMedium: sd?.bonusVsMedium ?? 0,
    bonusVsHeavy: sd?.bonusVsHeavy ?? 0,
    bonusVsHero: sd?.bonusVsHero ?? 0,
    bonusVsAncient: sd?.bonusVsAncient ?? 0,
    bonusVsFortified: sd?.bonusVsFortified ?? 0,
    targetArmorValue: sa?.value ?? 0,
    targetArmorType: sa?.type ?? 'unarmored',
    targetIsStructure: s.kind.get(dst)?.kind === 1,
    roll: 0,
  });
  dh.hp -= res.amount;
  w.bus.emit('damage', { src, dst, amount: res.amount, tick });
  if (dh.hp <= 0) {
    dh.hp = 0;
    kill(w, dst, src, tick);
  }
  return res.amount;
}

export function kill(w: World, victim: Eid, killer: Eid | null, tick: number): void {
  const s = S(w);
  const h = s.health.get(victim);
  if (!h || h.dead) return;
  h.dead = true;
  h.deathTick = tick;
  const kp = killer !== null ? s.owner.get(killer)?.player ?? 0 : 0;
  const vp = s.owner.get(victim)?.player ?? 0;
  const players = (w as unknown as { players: { kills: number; losses: number }[] }).players;
  if (players[kp]) players[kp].kills++;
  if (players[vp]) players[vp].losses++;
  grantXp(w, victim, killer);
  w.bus.emit('unit:died', { eid: victim, killer, tick });
  dropLoot(w, victim);
  if (s.hero.get(victim)) heroDie(w, victim, tick);
  else w.destroyEntity(victim);
}

function heroDie(w: World, hero: Eid, tick: number): void {
  const s = S(w);
  const hs = s.hero.get(hero)!;
  const lvl = s.stats.get(hero)?.level ?? 1;
  hs.respawnTick = tick + Math.round((45 + lvl * 5) * 30);
  // hero body becomes a corpse decoration; items drop
  for (let i = 0; i < hs.itemSlots.length; i++) {
    const it = hs.itemSlots[i];
    if (!it) continue;
    hs.itemSlots[i] = null;
    const t = s.transform.get(hero);
    if (t) (w as unknown as { spawnItemLocal: (id: string, x: Fixed, y: Fixed) => void }).spawnItemLocal(it, t.x, t.y);
  }
}

function dropLoot(w: World, victim: Eid): void {
  const s = S(w);
  const owner = s.owner.get(victim)?.player ?? 0;
  if (owner !== 11 && owner !== 12) return; // only creeps drop
  const lvl = s.stats.get(victim)?.level ?? 1;
  const loot = (w as unknown as { lootTable?: { roll(level: number, rng: { int(n: number): number }): string | null } }).lootTable;
  const itemId = loot ? loot.roll(lvl, w.rng) : null;
  if (!itemId) return;
  const t = s.transform.get(victim);
  if (t) (w as unknown as { spawnItemLocal: (id: string, x: Fixed, y: Fixed) => void }).spawnItemLocal(itemId, t.x, t.y);
}

export { advance };
