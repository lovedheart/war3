/**
 * Hero progression: XP curve, sharing radius, level-ups, skill points, respawn.
 *
 * TFT hero XP thresholds (cumulative):
 *   L1 0 · L2 350 · L3 750 · L4 1250 · L5 1850 · L6 2600 · L7 3550 ·
 *   L8 4700 · L9 6100 · L10 7900 (cap)
 * Creep XP is shared among heroes within HERO_XP_RANGE of the kill site; a lone
 * hero gets the full amount, N heroes split it evenly (WC3 splits by count).
 */
import { Fixed, ff, fn } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import { HERO_MAX_LEVEL } from '../core/constants.js';

export const HERO_XP_TABLE = [0, 350, 750, 1250, 1850, 2600, 3550, 4700, 6100, 7900];
export const HERO_XP_RANGE = ff(24);

interface S {
  transform: { get(e: Eid): { x: Fixed; y: Fixed } | undefined };
  owner: { get(e: Eid): { player: number } | undefined };
  stats: { get(e: Eid): { id: string; isHero: boolean; level: number; xp: number; str: number; agi: number; int: number } | undefined };
  health: { get(e: Eid): { hpMax: Fixed; mpMax: Fixed; hp: Fixed; mp: Fixed; dead: boolean; deathTick: number } | undefined };
  hero: { get(e: Eid): { respawnTick: number; skillPoints: number; altarEid: number } | undefined };
}
const S = (w: World) => w.stores as unknown as S;

/** XP value of a killed unit (approximation of WC3's formula). */
export function xpValue(level: number): number {
  return 10 + level * level * 20;
}

export function grantXp(w: World, victim: Eid, killer: Eid | null): void {
  const s = S(w);
  const vlvl = s.stats.get(victim)?.level ?? 1;
  if ((s.stats.get(victim)?.isHero ?? false)) {
    // killing a hero awards its accumulated XP share
  }
  const total = xpValue(vlvl);
  const vt = s.transform.get(victim);
  if (!vt) return;
  const kp = killer !== null ? s.owner.get(killer)?.player ?? 0 : 0;
  const heroes: Eid[] = [];
  for (const e of w.live) {
    const eid = e as Eid;
    const st = s.stats.get(eid);
    if (!st?.isHero) continue;
    if ((s.owner.get(eid)?.player ?? 0) !== kp) continue;
    const t = s.transform.get(eid);
    if (!t) continue;
    if (Math.abs(t.x - vt.x) > HERO_XP_RANGE || Math.abs(t.y - vt.y) > HERO_XP_RANGE) continue;
    heroes.push(eid);
  }
  if (heroes.length === 0) return;
  const share = Math.floor(total / heroes.length);
  for (const h of heroes) addXp(w, h, share);
}

export function addXp(w: World, hero: Eid, amount: number): void {
  const s = S(w);
  const st = s.stats.get(hero);
  if (!st || st.level >= HERO_MAX_LEVEL) return;
  st.xp += amount;
  while (st.level < HERO_MAX_LEVEL && st.xp >= HERO_XP_TABLE[st.level]) {
    st.level++;
    st.str++;
    st.agi++;
    st.int++;
    const hs = s.hero.get(hero);
    if (hs) hs.skillPoints++;
    const h = s.health.get(hero);
    if (h) {
      h.hpMax += ff(10);
      h.hp = Math.min(h.hp + ff(10), h.hpMax);
      h.mpMax += ff(6);
    }
  }
}

/** Auto-allocate a skill point into the first upgradeable slot (AI convenience). */
export function autoLevelAbility(w: World, hero: Eid): boolean {
  const s = S(w);
  const hs = s.hero.get(hero);
  if (!hs || hs.skillPoints <= 0) return false;
  const ab = (w.stores.abilities as unknown as {
    get(e: Eid): { slots: { abilityId: string; level: number; manaCost: Fixed; cooldown: Fixed }[] } | undefined;
  }).get(hero);
  if (!ab) return false;
  const maxLevel = (w as unknown as { abilityMaxLevel?: (id: string) => number }).abilityMaxLevel;
  for (const slot of ab.slots) {
    const cap = maxLevel ? maxLevel(slot.abilityId) : Math.min(3, 1 + Math.floor((s.stats.get(hero)?.level ?? 1) / 2));
    if (slot.level < cap) {
      slot.level++;
      hs.skillPoints--;
      return true;
    }
  }
  return false;
}

/** Hero system: respawn timers and passive regen for heroes. */
export function heroSystem(w: World, tick: number): void {

  const gyms = (w as unknown as { heroGraveyard: Map<number, { eid: Eid; respawnTick: number; name: string }> })
    .heroGraveyard;
  if (!gyms) return;
  for (const [k, v] of gyms) {
    if (tick >= v.respawnTick) {
      reviveHero(w, v.eid);
      gyms.delete(k);
    }
  }
}

export function registerHeroCorpse(w: World, hero: Eid, tick: number): void {
  const s = S(w);
  const hs = s.hero.get(hero);
  const lvl = s.stats.get(hero)?.level ?? 1;
  const gyms = (w as unknown as { heroGraveyard: Map<number, { eid: Eid; respawnTick: number; name: string }> })
    .heroGraveyard;
  if (hs) hs.respawnTick = tick + Math.round((45 + lvl * 5) * 30);
  gyms.set(hero, { eid: hero, respawnTick: hs ? hs.respawnTick : tick + 1350, name: s.stats.get(hero)?.id ?? 'hero' });
}

function reviveHero(w: World, hero: Eid): void {
  const s = S(w);
  const h = s.health.get(hero);
  if (!h) return;
  h.dead = false;
  h.deathTick = 0;
  h.hp = h.hpMax;
  h.mp = h.mpMax;
  // teleport to owning town hall / altar
  const altars = (w as unknown as { altarsOf: (player: number) => Eid[] }).altarsOf?.(s.owner.get(hero)?.player ?? 0) ?? [];
  const dest = altars[0];
  const dt = dest ? s.transform.get(dest) : undefined;
  const t = s.transform.get(hero);
  if (t && dt) {
    t.x = dt.x;
    t.y = dt.y + ff(1.5);
  }
}

export { fn };
