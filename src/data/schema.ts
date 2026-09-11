/**
 * Data-layer schema + hand-written validator (zero third-party deps).
 *
 * Two jobs:
 *  1. Type the RAW JSON shapes that `data/*.json` actually contain (SLK-derived,
 *     heavily nested, `null`-heavy). These are NOT the sim-facing types.
 *  2. Validate them: required fields, primitive types, enum membership against
 *     the sim's ArmorType/AttackType unions, and cross-table referential
 *     integrity. Ids that live in a different id-space than our tables (raw SLK
 *     codes, item aliases) become warnings, not errors, so a data refresh
 *     cannot brick the game.
 */
import { ARMOR_TYPES, ATTACK_TYPES } from '../sim/components.js';

/* ------------------------------------------------------------------ */
/* Raw shapes                                                          */
/* ------------------------------------------------------------------ */

export interface RawCost {
  gold?: number | null;
  lumber?: number | null;
}

export interface RawDamage {
  min?: number | null;
  max?: number | null;
  average?: number | null;
  attackType?: string | null;
  cooldown?: number | null;
  attackPoint?: number | null;
  backswing?: number | null;
  range?: number | null;
  acquireRange?: number | null;
  dice?: number | null;
  sides?: number | null;
  plus?: number | null;
}

export interface RawAttributes {
  strength?: number | null;
  agility?: number | null;
  intelligence?: number | null;
  primary?: string | null;
  strengthPerLevel?: number | null;
}

export interface RawUnit {
  id: string;
  slkId?: string;
  name?: string;
  race?: string | null;
  category?: string | null;
  level?: number | null;
  foodUsed?: number | null;
  foodRequired?: number | null;
  cost?: RawCost | null;
  stats?: { hp?: number | null; hpRegen?: number | null; mp?: number | null; mpRegen?: number | null } | null;
  attributes?: RawAttributes | null;
  damage?: RawDamage | null;
  damageSecondary?: RawDamage | null;
  armor?: { value?: number | null; type?: string | null } | null;
  moveSpeed?: number | null;
  moveType?: string | null;
  collisionRadius?: number | null;
  vision?: { day?: number | null; night?: number | null } | null;
  buildTime?: number | null;
  trainingTime?: number | null;
  targets?: string[] | null;
  abilities?: string[] | null;
  prereq?: string | null;
  prereqUnits?: string[] | null;
  prereqTech?: string[] | null;
  upgrades?: unknown[] | null;
  bounty?: { dice?: number; sides?: number; plus?: number } | null;
  classification?: string[] | null;
  icon?: string | null;
  hero?: { primaryAttribute?: string; reviveBuilding?: string } | null;
  notes?: unknown;
  _note?: string;
}

export interface RawBuilding {
  id: string;
  slkId?: string;
  name?: string;
  race?: string | null;
  category?: string | null;
  footprint?: number[] | null;
  cost?: RawCost | null;
  stats?: { hp?: number | null; hpRegen?: number | null } | null;
  armor?: { value?: number | null; type?: string | null } | null;
  vision?: { day?: number | null; night?: number | null } | null;
  buildTime?: number | null;
  supplies?: number | null;
  providesSupply?: number | null;
  abilities?: string[] | null;
  trains?: string[] | null;
  upgradeTo?: string | null;
  requiresTech?: string[] | null;
  requiresBuildings?: string[] | null;
  attack?: { min?: number; max?: number; range?: number; cooldown?: number; attackType?: string } | null;
  upkeepCategory?: string | null;
  rallyPoint?: boolean | null;
  notes?: unknown;
  _note?: string;
}

export interface RawAbilityLevel {
  manaCost?: number | null;
  cooldown?: number | null;
  castRange?: number | null;
  aoeRadius?: number | null;
  duration?: number | null;
  castPoint?: number | null;
  targets?: string[] | null;
  effects?: ({ kind?: string } & Record<string, unknown>)[] | null;
  slkData?: Record<string, unknown> | null;
  _note?: string;
}

export interface RawAbility {
  id: string;
  slkCode?: string | null;
  slkAlias?: string | null;
  name?: string;
  type?: string | null;
  hero?: boolean | null;
  ultimate?: boolean | null;
  race?: string | null;
  requiredHeroLevel?: number | null;
  slkLevels?: number | null;
  levels?: RawAbilityLevel[] | null;
  manaCost?: number | null;
  cooldown?: number | null;
  castRange?: number | null;
  aoeRadius?: number | null;
  duration?: number | null;
  castPoint?: number | null;
  effects?: ({ kind?: string } & Record<string, unknown>)[] | null;
  maxLevel?: number | null;
  _note?: string;
}

export interface RawItem {
  id: string;
  slkId?: string;
  name?: string;
  quality?: string | null;
  level?: number | null;
  cost?: RawCost | null;
  charges?: number | null;
  stackable?: boolean | null;
  slotUsable?: boolean | null;
  statBonuses?: Record<string, number | null> | null;
  abilities?: string[] | null;
  components?: string[] | null;
  _note?: string;
}

export interface RawRecipe {
  name?: string;
  components?: string[] | null;
  gold?: number | null;
  lumber?: number | null;
  result?: string | null;
  _note?: string;
}

export interface RawTech {
  id: string;
  slkId?: string;
  name?: string;
  race?: string | null;
  maxLevel?: number | null;
  cost?: { goldBase?: number; goldPerLevel?: number; lumberBase?: number; lumberPerLevel?: number } | null;
  time?: { base?: number; perLevel?: number } | null;
  effects?: ({ kind?: string; code?: string } & Record<string, unknown>)[] | null;
  researchBuilding?: string | null;
  prereqTech?: string[] | null;
  prereqUnits?: string[] | null;
  appliesTo?: string[] | null;
  _note?: string;
}

export interface RawRace {
  id: string;
  name?: string;
  worker?: string | null;
  startUnits?: string[] | null;
  startHall?: string | null;
  hallChain?: string[] | null;
  supplyBuildings?: string[] | null;
  supplyEach?: number | null;
  colors?: (string | number)[] | null;
}

export interface RawDamageTable {
  attackTypes: { id: string }[] | string[];
  armorTypes: { id: string }[] | string[];
  matrix: Record<string, Record<string, number>>;
  armorCurve?: Record<string, unknown>;
}

export interface RawLoot {
  byMonsterLevel: Record<string, Record<string, number>>;
  pools: Record<string, string[]>;
  chests?: Record<string, unknown>;
}

export interface RawHeroes {
  experienceCurve: number[];
  maxLevel?: number;
  revival?: { timeBaseSeconds?: number; timePerLevelSeconds?: number } & Record<string, unknown>;
  sharedExperience?: Record<string, unknown>;
  skillPoints?: Record<string, unknown>;
}

/** Everything the validator looks at in one shot. */
export interface RawTables {
  units: Record<string, RawUnit>;
  buildings: Record<string, RawBuilding>;
  abilities: Record<string, RawAbility>;
  items: Record<string, RawItem>;
  recipes: Record<string, RawRecipe>;
  tech: Record<string, RawTech>;
  races: Record<string, RawRace>;
  damage: RawDamageTable;
  loot: RawLoot;
  heroes: RawHeroes;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

const ARMOR_SET = new Set<string>(ARMOR_TYPES as readonly string[]);
const ATTACK_SET = new Set<string>(ATTACK_TYPES as readonly string[]);
export const ABILITY_TYPES = ['active', 'passive', 'aura', 'ultimate'] as const;
export const ITEM_QUALITIES = ['common', 'uncommon', 'rare', 'epic', 'artifact'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/* ------------------------------------------------------------------ */
/* Validator                                                           */
/* ------------------------------------------------------------------ */

export function validateAll(raw: Partial<RawTables>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  /* ---- units ---- */
  const units = raw.units ?? {};
  for (const [key, u] of Object.entries(units)) {
    const at = `units.${key}`;
    if (!isObj(u)) {
      err(`${at}: not an object`);
      continue;
    }
    if (!isStr(u.id)) err(`${at}.id missing/non-string`);
    else if (u.id !== key) err(`${at}.id "${u.id}" != key "${key}"`);
    if (!isStr(u.category)) err(`${at}.category missing`);
    if (u.race !== undefined && u.race !== null && !isStr(u.race)) err(`${at}.race must be string|null`);

    const hp = u.stats?.hp;
    if (!isNum(hp) || hp <= 0) err(`${at}.stats.hp must be a positive number (got ${JSON.stringify(hp)})`);
    if (!isNum(u.cost?.gold ?? 0)) err(`${at}.cost.gold non-numeric`);
    if (!isNum(u.foodUsed ?? 1) || (u.foodUsed as number) < 0) err(`${at}.foodUsed invalid`);

    const d = u.damage;
    if (d) {
      if (!isNum(d.min) || !isNum(d.max)) err(`${at}.damage.min/max must be numbers`);
      else if (d.min > d.max) err(`${at}.damage.min (${d.min}) > max (${d.max})`);
      if (isStr(d.attackType)) {
        if (!ATTACK_SET.has(d.attackType))
          err(`${at}.damage.attackType "${d.attackType}" not in ${[...ATTACK_SET].join('|')}`);
      } else if (u.category !== 'creep') err(`${at}.damage.attackType missing`);
      else warn(`${at}.damage.attackType missing (defaulted to normal)`);
      if (d.range !== undefined && d.range !== null && !isNum(d.range)) err(`${at}.damage.range non-numeric`);
      if (d.cooldown !== undefined && d.cooldown !== null && (!isNum(d.cooldown) || d.cooldown <= 0))
        err(`${at}.damage.cooldown must be > 0`);
    } else if (u.category === 'unit' || u.category === 'hero') {
      warn(`${at}: no damage block`);
    }

    const ar = u.armor;
    if (ar) {
      if (isStr(ar.type)) {
        if (!ARMOR_SET.has(ar.type)) err(`${at}.armor.type "${ar.type}" not in ${[...ARMOR_SET].join('|')}`);
      } else err(`${at}.armor.type missing`);
      if (ar.value !== undefined && ar.value !== null && !isNum(ar.value)) err(`${at}.armor.value non-numeric`);
    } else warn(`${at}: no armor block`);

    if (u.moveSpeed !== undefined && u.moveSpeed !== null && !isNum(u.moveSpeed)) err(`${at}.moveSpeed non-numeric`);
    if (u.collisionRadius !== undefined && u.collisionRadius !== null && !isNum(u.collisionRadius))
      err(`${at}.collisionRadius non-numeric`);
    if (u.level !== undefined && u.level !== null && !isNum(u.level)) err(`${at}.level non-numeric`);
    if (u.hero && !isStr(u.hero.primaryAttribute)) warn(`${at}.hero.primaryAttribute missing`);
    if (u._note) warn(`${at}._note: ${u._note}`);
  }

  /* ---- buildings ---- */
  const buildings = raw.buildings ?? {};
  for (const [key, b] of Object.entries(buildings)) {
    const at = `buildings.${key}`;
    if (!isObj(b)) {
      err(`${at}: not an object`);
      continue;
    }
    if (!isStr(b.id)) err(`${at}.id missing`);
    else if (b.id !== key) err(`${at}.id "${b.id}" != key "${key}"`);
    const fp = b.footprint;
    if (!Array.isArray(fp) || fp.length !== 2 || !fp.every((n) => isNum(n) && n >= 1))
      err(`${at}.footprint must be [w,h] of positive numbers (got ${JSON.stringify(fp)})`);
    if (!isNum(b.stats?.hp) || (b.stats?.hp as number) <= 0) err(`${at}.stats.hp must be positive`);
    const bt = b.armor?.type;
    if (isStr(bt)) {
      if (!ARMOR_SET.has(bt)) err(`${at}.armor.type "${bt}" not in ${[...ARMOR_SET].join('|')}`);
    } else err(`${at}.armor.type missing`);
    if (b.buildTime !== undefined && b.buildTime !== null && (!isNum(b.buildTime) || b.buildTime < 0))
      err(`${at}.buildTime invalid`);
    if (b.providesSupply !== undefined && b.providesSupply !== null && !isNum(b.providesSupply))
      err(`${at}.providesSupply non-numeric`);
    if (b.attack) {
      for (const f of ['min', 'max', 'range', 'cooldown'] as const)
        if (b.attack[f] !== undefined && b.attack[f] !== null && !isNum(b.attack[f]))
          err(`${at}.attack.${f} non-numeric`);
    }
    if (b._note) warn(`${at}._note: ${b._note}`);
  }

  /* ---- abilities ---- */
  const abilities = raw.abilities ?? {};
  for (const [key, a] of Object.entries(abilities)) {
    const at = `abilities.${key}`;
    if (!isObj(a)) {
      err(`${at}: not an object`);
      continue;
    }
    if (!isStr(a.id)) err(`${at}.id missing`);
    if (isStr(a.type)) {
      if (!(ABILITY_TYPES as readonly string[]).includes(a.type))
        err(`${at}.type "${a.type}" not in ${ABILITY_TYPES.join('|')}`);
    } else err(`${at}.type missing`);
    const lv = a.levels;
    if (Array.isArray(lv)) {
      if (lv.length === 0) err(`${at}.levels empty`);
      lv.forEach((l, i) => {
        if (!isObj(l)) {
          err(`${at}.levels[${i}] not an object`);
          return;
        }
        if (l.manaCost !== undefined && l.manaCost !== null && !isNum(l.manaCost))
          err(`${at}.levels[${i}].manaCost non-numeric`);
        if (l.cooldown !== undefined && l.cooldown !== null && (!isNum(l.cooldown) || l.cooldown < 0))
          err(`${at}.levels[${i}].cooldown invalid`);
        ((l.effects ?? []) as ({ kind?: string } & Record<string, unknown>)[]).forEach((e, j) => {
          if (!isStr(e.kind)) err(`${at}.levels[${i}].effects[${j}].kind missing`);
        });
        if (l._note) warn(`${at}.levels[${i}]._note: ${l._note}`);
      });
    } else if (Array.isArray(a.effects)) {
      const flat = a.effects as ({ kind?: string } & Record<string, unknown>)[];
      flat.forEach((e, j) => {
        if (!isStr(e.kind)) err(`${at}.effects[${j}].kind missing`);
      });
    } else {
      err(`${at}: needs levels[] or effects[]`);
    }
    if (a._note) warn(`${at}._note: ${a._note}`);
  }

  /* ---- items ---- */
  const items = raw.items ?? {};
  for (const [key, it] of Object.entries(items)) {
    const at = `items.${key}`;
    if (!isObj(it)) {
      err(`${at}: not an object`);
      continue;
    }
    if (!isStr(it.id)) err(`${at}.id missing`);
    if (isStr(it.quality)) {
      if (!(ITEM_QUALITIES as readonly string[]).includes(it.quality))
        err(`${at}.quality "${it.quality}" not in ${ITEM_QUALITIES.join('|')}`);
    } else err(`${at}.quality missing`);
    if (it.cost && !isNum(it.cost.gold ?? 0)) err(`${at}.cost.gold non-numeric`);
    if (it.components !== undefined && it.components !== null && !Array.isArray(it.components))
      err(`${at}.components must be array|null`);
    if (it._note) warn(`${at}._note: ${it._note}`);
  }

  /* ---- recipes ---- */
  const recipes = raw.recipes ?? {};
  for (const [key, r] of Object.entries(recipes)) {
    const at = `recipes.${key}`;
    if (!isObj(r)) {
      err(`${at}: not an object`);
      continue;
    }
    if (!Array.isArray(r.components) || r.components.length === 0) err(`${at}.components must be a non-empty array`);
    else
      for (const c of r.components) {
        if (!isStr(c)) err(`${at}.components has non-string entry`);
        else if (!(c in items)) warn(`${at}.components "${c}" not found in items.json (alias space)`);
      }
    if (r._note) warn(`${at}._note: ${r._note}`);
  }

  /* ---- tech ---- */
  const tech = raw.tech ?? {};
  for (const [key, t] of Object.entries(tech)) {
    const at = `tech.${key}`;
    if (!isObj(t)) {
      err(`${at}: not an object`);
      continue;
    }
    if (!isStr(t.id)) err(`${at}.id missing`);
    if (t.cost && !isNum(t.cost.goldBase ?? 0)) err(`${at}.cost.goldBase non-numeric`);
    if (t.time && !isNum(t.time.base ?? 0)) err(`${at}.time.base non-numeric`);
    for (const p of t.prereqTech ?? []) {
      if (!isStr(p)) err(`${at}.prereqTech has non-string`);
      else if (!(p in tech)) err(`${at}.prereqTech "${p}" not found in tech.json`);
    }
    if (isStr(t.researchBuilding) && !(t.researchBuilding in buildings))
      warn(`${at}.researchBuilding "${t.researchBuilding}" not found in buildings.json`);
    for (const a of t.appliesTo ?? []) {
      if (!isStr(a)) err(`${at}.appliesTo has non-string`);
      else if (!(a in units) && !(a in buildings) && a !== '__structures')
        warn(`${at}.appliesTo "${a}" matches no unit/building`);
    }
    if (t._note) warn(`${at}._note: ${t._note}`);
  }

  /* ---- races ---- */
  const races = raw.races ?? {};
  for (const [key, r] of Object.entries(races)) {
    const at = `races.${key}`;
    if (!isObj(r)) {
      err(`${at}: not an object`);
      continue;
    }
    if (r.worker !== undefined && r.worker !== null && !isStr(r.worker)) err(`${at}.worker must be string|null`);
    if (isStr(r.worker) && !(r.worker in units)) warn(`${at}.worker "${r.worker}" not found in units.json`);
    if (r.startHall !== undefined && r.startHall !== null && !isStr(r.startHall))
      err(`${at}.startHall must be string|null`);
    if (isStr(r.startHall) && !(r.startHall in buildings))
      warn(`${at}.startHall "${r.startHall}" not found in buildings.json`);
    for (const s of r.startUnits ?? []) if (!isStr(s)) err(`${at}.startUnits has non-string`);
    for (const h of r.hallChain ?? []) if (!isStr(h)) err(`${at}.hallChain has non-string`);
  }

  /* ---- damage matrix ---- */
  const dmg = raw.damage;
  if (!dmg) err('damage.json missing entirely');
  else {
    const atkIds = (dmg.attackTypes ?? []).map((x) => (typeof x === 'string' ? x : x.id));
    const armIds = (dmg.armorTypes ?? []).map((x) => (typeof x === 'string' ? x : x.id));
    for (const a of atkIds) if (!ATTACK_SET.has(a)) err(`damage.attackTypes "${a}" not in sim AttackType union`);
    for (const a of armIds) if (!ARMOR_SET.has(a)) err(`damage.armorTypes "${a}" not in sim ArmorType union`);
    for (const a of ATTACK_TYPES) if (!atkIds.includes(a)) err(`damage.attackTypes missing row "${a}"`);
    for (const a of ARMOR_TYPES) if (!armIds.includes(a)) err(`damage.armorTypes missing column "${a}"`);
    if (!isObj(dmg.matrix)) err('damage.matrix missing');
    else
      for (const atk of ATTACK_TYPES) {
        const row = dmg.matrix[atk];
        if (!isObj(row)) {
          err(`damage.matrix.${atk} missing`);
          continue;
        }
        for (const arm of ARMOR_TYPES) {
          const v = row[arm];
          if (!isNum(v)) err(`damage.matrix.${atk}.${arm} missing/non-numeric`);
          else if (v < 0 || v > 4) err(`damage.matrix.${atk}.${arm} = ${v} outside sane 0..4 band`);
        }
      }
  }

  /* ---- loot ---- */
  const loot = raw.loot;
  if (!loot) err('loot.json missing entirely');
  else {
    if (!isObj(loot.byMonsterLevel)) err('loot.byMonsterLevel missing');
    else
      for (const [lvl, w] of Object.entries(loot.byMonsterLevel)) {
        if (!isObj(w)) err(`loot.byMonsterLevel.${lvl} not an object`);
        else if (!isNum(w.green)) err(`loot.byMonsterLevel.${lvl}.green missing`);
      }
    if (!isObj(loot.pools)) err('loot.pools missing');
    else for (const [k, pool] of Object.entries(loot.pools)) if (!Array.isArray(pool)) err(`loot.pools.${k} must be array`);
  }

  /* ---- heroes ---- */
  const heroes = raw.heroes;
  if (!heroes) err('heroes.json missing entirely');
  else if (!Array.isArray(heroes.experienceCurve) || heroes.experienceCurve.length < 2)
    err('heroes.experienceCurve must be a non-empty numeric array');
  else {
    if (heroes.experienceCurve[0] !== 0) err('heroes.experienceCurve[0] must be 0');
    for (let i = 1; i < heroes.experienceCurve.length; i++)
      if ((heroes.experienceCurve[i] ?? 0) <= (heroes.experienceCurve[i - 1] ?? 0))
        err(`heroes.experienceCurve not strictly increasing at index ${i}`);
  }

  /* ---- cross-table: unit -> building / ability ---- */
  for (const [key, u] of Object.entries(units)) {
    const at = `units.${key}`;
    if (isStr(u.prereq) && !(u.prereq in buildings)) err(`${at}.prereq "${u.prereq}" not found in buildings.json`);
    for (const p of u.prereqUnits ?? [])
      if (isStr(p) && !(p in units)) err(`${at}.prereqUnits "${p}" not found in units.json`);
    for (const p of u.prereqTech ?? [])
      if (isStr(p) && !(p in tech)) err(`${at}.prereqTech "${p}" not found in tech.json`);
    for (const a of u.abilities ?? []) {
      if (!isStr(a)) {
        err(`${at}.abilities has non-string entry`);
        continue;
      }
      if (a in abilities) continue;
      // units.json lists RAW SLK ability codes (ahar = harvest, aihn = smart,
      // adef = defend); abilities.json is keyed by readable data ids and only
      // carries the curated hero/spell subset. An unmatched 4-char code is an
      // id-space mismatch, not a broken reference -> warning only.
      // Any other 4-char lowercase token is also raw-SLK space (creep/neutral
      // codes like sbsk, srtt) — warn, do not block the game on it.
      if (/^[a-z][a-z0-9]{3}$/.test(a)) warn(`${at}.abilities "${a}" is a raw SLK code with no curated entry`);
      else err(`${at}.abilities "${a}" not found in abilities.json`);
    }
  }

  for (const [key, b] of Object.entries(buildings)) {
    const at = `buildings.${key}`;
    for (const t of b.trains ?? []) {
      if (!isStr(t)) err(`${at}.trains has non-string`);
      else if (!(t in units)) err(`${at}.trains "${t}" not found in units.json`);
    }
    if (isStr(b.upgradeTo) && !(b.upgradeTo in buildings))
      err(`${at}.upgradeTo "${b.upgradeTo}" not found in buildings.json`);
    for (const rb of b.requiresBuildings ?? [])
      if (isStr(rb) && !(rb in buildings)) err(`${at}.requiresBuildings "${rb}" not found in buildings.json`);
    for (const rt of b.requiresTech ?? [])
      if (isStr(rt) && !(rt in tech)) err(`${at}.requiresTech "${rt}" not found in tech.json`);
  }

  for (const [key, it] of Object.entries(items)) {
    for (const c of it.components ?? [])
      if (isStr(c) && !(c in items)) warn(`items.${key}.components "${c}" not found in items.json (alias space)`);
  }

  return { errors, warnings };
}
