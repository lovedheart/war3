/**
 * JSON -> GameData loader.
 *
 * HOW THE JSON REACHES US: static `import ... with { type: 'json' }`-free ESM
 * imports, enabled by tsconfig's `resolveJsonModule`. Chosen over `fs` because
 * the same module must run in the browser bundle (Vite inlines the JSON) and
 * under node/tsx for tests — one code path, no dual build, no async bootstrap.
 * Consequence: the tables are baked into the bundle; a data hot-reload would
 * need a fetch-based variant (not required today).
 *
 * All raw->sim field-name mapping lives here so the sim never has to know that
 * SLK calls vision "day/night x100" or that tech costs are per-level deltas.
 */
// Static ESM imports of real .json files (resolveJsonModule). Chosen over `fs`
// because the same module must run in the browser bundle (Vite inlines the
// JSON) and under node/tsx for tests — one code path, no dual build, no async
// bootstrap. Consequence: tables are baked into the bundle; hot-reloading data
// would need a fetch-based variant (not required today).
import unitsJson from '../../data/units.json';
import buildingsJson from '../../data/buildings.json';
import abilitiesJson from '../../data/abilities.json';
import itemsJson from '../../data/items.json';
import techJson from '../../data/tech.json';
import raceJson from '../../data/race.json';
import heroesJson from '../../data/heroes.json';
import lootJson from '../../data/loot.json';
import damageJson from '../../data/damage.json';

import type { ArmorType, AttackType } from '../sim/components.js';
import type {
  AbilityDef,
  BuildingDef,
  CreepCampDef,
  GameData,
  ItemDef,
  RaceDef,
  TechDef,
  UnitDef,
} from './index.js';
import { validateAll, type RawAbilityLevel, type RawTables, type RawUnit, type ValidationResult } from './schema.js';

/* ------------------------------------------------------------------ */
/* Field mapping table (raw JSON key -> GameData field)                */
/*                                                                     */
/*  units.json                                              index.ts   */
/*  ---------------------------------------------------------------  */
/*  .stats.hp                                    ->  stats.hp            */
/*  .stats.hpRegen (null)                        ->  stats.hpRegen  ?? 0 */
/*  .stats.mp / .mpRegen (null)                  ->  stats.mp/mpRegen??0  */
/*  .cost.gold / .cost.lumber                    ->  cost.gold / lumber   */
/*  .foodUsed                                    ->  cost.popUpkeep       */
/*  .damage.{min,max,attackType,cooldown,range}  ->  damage.*             */
/*  .damage.attackPoint (null)                   ->  damage.attackPoint??0.5*/
/*  .armor.value / .armor.type                   ->  armor.value/type     */
/*  .moveSpeed                                   ->  moveSpeed            */
/*  .moveType === 'fly'                          ->  fly                  */
/*  .collisionRadius                             ->  radius               */
/*  .vision.day / 100                            ->  sightRange           */
/*  .trainingTime                                ->  trainTime            */
/*  .category === 'hero'                         ->  isHero + hero        */
/*  .attributes.{strength,agility,intelligence}  ->  attributes.str/agi/int*/
/*  .attributes.primary ('INT'|'AGI'|'STR')      ->  attributes.primary   */
/*  .abilities[]                                 ->  abilities[]          */
/*  .prereq                                      ->  prereq               */
/*  buildings.json                                                    */
/*  .footprint[w,h]                              ->  footprint            */
/*  .providesSupply                              ->  supplyProvided       */
/*  .vision.day / 100                            ->  sightRange           */
/*  .trains[] / .upgradeTo / .requiresTech       ->  same names           */
/*  .requiresBuildings[0]                        ->  requiresBuilding     */
/*  .attack.{min,max,range,cooldown}             ->  attack{}             */
/*  .upkeepCategory==='hall' | id==='farm'       ->  role                 */
/*  tech.json                                                         */
/*  .cost.goldBase/lumberBase                    ->  cost.gold/lumber     */
/*  .time.base                                   ->  researchTime         */
/*  .prereqTech                                  ->  requires             */
/*  .researchBuilding                            ->  requiresBuilding     */
/*  .effects[kind:attackDamage|armor|...]        ->  statBonus[]          */
/*  race.json                                                         */
/*  .worker / .startHall                         ->  worker / townHall    */
/*  .startUnits.length                           ->  workers              */
/*  .supplyBuildings.length                       ->  farmCount            */
/*  .colors['0xRRGGBB']                          ->  colors[int]          */
/* ------------------------------------------------------------------ */

// Every table goes through `unknown` before reaching its Raw* shape: the JSON
// files carry heterogeneous, SLK-shaped literals (e.g. an item's statBonuses is
// sometimes a nested object), and a direct cast would be rejected as
// non-comparable. The Raw* types remain the authoritative documentation.
const raw: RawTables = {
  units: (unitsJson as { units: unknown }).units as RawTables['units'],
  buildings: (buildingsJson as { buildings: unknown }).buildings as RawTables['buildings'],
  abilities: (abilitiesJson as { items: unknown }).items as RawTables['abilities'],
  items: (itemsJson as { items: unknown }).items as RawTables['items'],
  recipes: (itemsJson as { recipes: unknown }).recipes as RawTables['recipes'],
  tech: (techJson as { items: unknown }).items as RawTables['tech'],
  races: (raceJson as { races: unknown }).races as RawTables['races'],
  damage: damageJson as unknown as RawTables['damage'],
  loot: lootJson as unknown as RawTables['loot'],
  heroes: heroesJson as unknown as RawTables['heroes'],
};

/** Numeric fallback for SLK `null` fields. */
const nz = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const nz0 = (v: unknown): number => nz(v, 0);
const meta = (o: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (!k.startsWith('_')) out[k] = o[k];
  return out;
};

function sightFromVision(v: { day?: number | null } | null | undefined, dflt: number): number {
  const day = v?.day;
  if (typeof day !== 'number' || !Number.isFinite(day)) return dflt;
  // SLK stores vision in hundredths of a game unit; 1 tile == 64 units, but
  // WC3 vision numbers are already ~"pixels at 100/unit": 1400 -> 14 tiles.
  return Math.max(1, Math.round(day / 100));
}

export interface LoadReport {
  data: GameData;
  validation: ValidationResult;
  usedFallback: boolean;
}

/* ------------------------------------------------------------------ */
/* Converters                                                          */
/* ------------------------------------------------------------------ */

function toUnit(id: string, u: RawUnit): UnitDef {
  const cat = u.category ?? 'unit';
  const attrs = u.attributes ?? null;
  const primaryRaw = (attrs?.primary ?? u.hero?.primaryAttribute ?? 'STR') as string;
  const primary = primaryRaw === 'INT' ? 'int' : primaryRaw === 'AGI' ? 'agi' : 'str';
  const splash = (u.damage as { splash?: { halfArea?: number } } | null | undefined)?.splash;
  const def: UnitDef = {
    id,
    name: u.name ?? id,
    race: u.race ?? 'neutral',
    level: nz(u.level, 1),
    isHero: cat === 'hero',
    hero: cat === 'hero',
    fly: u.moveType === 'fly',
    radius: nz(u.collisionRadius, 0.5),
    sightRange: sightFromVision(u.vision, cat === 'building' ? 8 : 7),
    moveSpeed: nz(u.moveSpeed, 2.5),
    trainTime: nz(u.trainingTime, nz(u.buildTime, 25)),
    cost: {
      gold: nz0(u.cost?.gold),
      lumber: nz0(u.cost?.lumber),
      popUpkeep: nz(u.foodUsed, 1),
      popRequired: nz(u.foodRequired, 0),
    },
    stats: {
      hp: nz(u.stats?.hp, 250),
      hpRegen: nz(u.stats?.hpRegen, 0.5),
      mp: nz0(u.stats?.mp),
      mpRegen: nz(u.stats?.mpRegen, 0),
    },
    attributes: {
      str: nz(attrs?.strength, 10),
      agi: nz(attrs?.agility, 10),
      int: nz(attrs?.intelligence, 10),
      primary,
    },
    damage: {
      min: nz(u.damage?.min, 1),
      max: nz(u.damage?.max, nz(u.damage?.min, 1)),
      attackType: (u.damage?.attackType ?? 'normal') as AttackType,
      range: nz(u.damage?.range, 1),
      cooldown: nz(u.damage?.cooldown, 1.4),
      attackPoint: nz(u.damage?.attackPoint, 0.5),
      splashRadius: nz(splash?.halfArea, 0),
      bonusVs: undefined,
    },
    armor: { value: nz(u.armor?.value, 0), type: (u.armor?.type ?? 'unarmored') as ArmorType },
    icon: u.icon ?? id,
  };
  const abis = (u.abilities ?? []).filter((a) => typeof a === 'string');
  if (abis.length) def.abilities = abis;
  if (typeof u.prereq === 'string' && u.prereq) def.prereq = u.prereq;
  return def;
}

function roleOf(b: RawTables['buildings'][string], id: string): 'gold' | 'wood' | 'town' | 'other' {
  if (b.upkeepCategory === 'hall') return 'town';
  if (id === 'farm' || id === 'burrow' || id === 'ziggurat' || id === 'moon_well') return 'other';
  if (/lumber|mill|tree/.test(id)) return 'wood';
  return 'other';
}

function toBuilding(id: string, b: RawTables['buildings'][string]): BuildingDef {
  const fp = Array.isArray(b.footprint) && b.footprint.length === 2 ? b.footprint : [3, 3];
  const def: BuildingDef = {
    id,
    name: b.name ?? id,
    race: b.race ?? 'neutral',
    role: roleOf(b, id),
    footprint: [Math.max(1, fp[0] | 0), Math.max(1, fp[1] | 0)],
    buildTime: nz(b.buildTime, 60),
    supplyProvided: nz(b.providesSupply, nz(b.supplies, 0)),
    sightRange: sightFromVision(b.vision, 8),
    cost: { gold: nz0(b.cost?.gold), lumber: nz0(b.cost?.lumber), popUpkeep: 0 },
    stats: { hp: nz(b.stats?.hp, 1200), armor: nz(b.armor?.value, 0), armorType: (b.armor?.type ?? 'fortification') as ArmorType },
  };
  if (b.trains?.length) def.trains = [...b.trains];
  if (typeof b.upgradeTo === 'string' && b.upgradeTo) def.upgradeTo = b.upgradeTo;
  if (b.requiresTech?.length) def.requiresTech = [...b.requiresTech];
  if (b.requiresBuildings?.length) def.requiresBuilding = b.requiresBuildings[0];
  if (b.attack) {
    def.attack = {
      min: nz(b.attack.min, 0),
      max: nz(b.attack.max, nz(b.attack.min, 0)),
      range: nz(b.attack.range, 6),
      cooldown: nz(b.attack.cooldown, 1),
    };
  }
  return def;
}

/** Flatten SLK per-level arrays into the single-level shape the sim reads. */
function toAbility(id: string, a: RawTables['abilities'][string]): AbilityDef {
  const levels = Array.isArray(a.levels) && a.levels.length ? a.levels : [a as (RawTables['abilities'][string] & { effects?: RawAbilityLevel['effects'] })];
  const l0 = levels[0] ?? {};
  const top = a as RawTables['abilities'][string] & { aoeRadius?: number };
  const effects = (l0.effects ?? []).map(meta) as AbilityDef['effects'];
  const summon = effects.find((e) => e.kind === 'summon') as { unitId?: string; count?: number; life?: number } | undefined;
  const def: AbilityDef = {
    id,
    name: a.name ?? id,
    type: (a.type ?? (a.ultimate ? 'ultimate' : 'active')) as AbilityDef['type'],
    manaCost: nz(l0.manaCost, nz(top.manaCost, 0)),
    cooldown: nz(l0.cooldown, nz(top.cooldown, 10)),
    castPoint: nz(l0.castPoint, nz(top.castPoint, 0.5)),
    maxLevel: nz(a.slkLevels, nz(a.maxLevel, levels.length || 1)),
    effects,
  };
  const r = nz(l0.castRange, nz(top.castRange, -1));
  if (r >= 0) def.range = r;
  const rad = nz(l0.aoeRadius, nz(top.aoeRadius, -1));
  if (rad >= 0) def.radius = rad;
  const dur = nz(l0.duration, nz(top.duration, -1));
  if (dur > 0) def.duration = dur;
  const dmgEff = effects.find((e) => e.kind === 'damage') as { amount?: number; min?: number; max?: number } | undefined;
  if (dmgEff) {
    const lo = nz(dmgEff.min, nz(dmgEff.amount, 0));
    def.damage = { min: lo, max: nz(dmgEff.max, lo) };
  }
  if (summon?.unitId) def.summon = { unitId: summon.unitId, count: nz(summon.count, 1), life: nz(summon.life, 60) };
  const scale = nz(levels[1]?.manaCost, 0) !== def.manaCost || nz(levels[1]?.cooldown, 0) !== def.cooldown;
  if (scale) def.levelScale = 1;
  return def;
}

function toTech(id: string, t: RawTables['tech'][string]): TechDef {
  const def: TechDef = {
    id,
    name: t.name ?? id,
    cost: { gold: nz0(t.cost?.goldBase), lumber: nz0(t.cost?.lumberBase) },
    researchTime: nz(t.time?.base, 60),
    requires: [...(t.prereqTech ?? [])],
  };
  if (typeof t.researchBuilding === 'string' && t.researchBuilding) def.requiresBuilding = t.researchBuilding;
  const bonuses: { scope: string; stat: string; amount: number }[] = [];
  const targets = (t.appliesTo ?? []).filter((x) => typeof x === 'string' && x !== '__structures');
  const scope = targets.length === 1 ? `unit:${targets[0]}` : targets.length > 1 ? `units:${targets.join(',')}` : 'all';
  for (const e of t.effects ?? []) {
    const kind = String(e.kind ?? '');
    const amount = nz(e.perLevel, nz(e.base, 1));
    if (kind === 'attackDamage') bonuses.push({ scope, stat: 'damage', amount });
    else if (kind === 'armor' || kind === 'defend' || kind === 'structureArmor') bonuses.push({ scope, stat: 'armor', amount });
    else if (kind === 'hp' || kind === 'health') bonuses.push({ scope, stat: 'hp', amount });
    else if (kind) bonuses.push({ scope, stat: kind, amount });
  }
  if (bonuses.length) def.statBonus = bonuses;
  // A tech whose only effect is "unit X becomes unit Y" is an upgrade chain;
  // units.json carries no upgrade links, so derive them from appliesTo pairs
  // where the tech name matches a target unit (see unitUpgrade derivation).
  return def;
}

function toItem(id: string, it: RawTables['items'][string]): ItemDef {
  const q = it.quality ?? 'common';
  const quality = (q === 'artifact' ? 'epic' : q) as ItemDef['quality'];
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(it.statBonuses ?? {})) if (typeof v === 'number') stats[k] = v;
  const def: ItemDef = {
    id,
    name: it.name ?? id,
    quality,
    cost: nz0(it.cost?.gold),
    stackable: !!it.stackable,
    charges: nz0(it.charges),
  };
  if (Object.keys(stats).length) def.stats = stats;
  if (it.components?.length) def.components = [...it.components];
  if (it.abilities?.length) def.ability = it.abilities[0];
  return def;
}

function toRace(id: string, r: RawTables['races'][string]): RaceDef {
  const startUnits = (r.startUnits ?? []).filter((x) => typeof x === 'string');
  const supplyBuildings = (r.supplyBuildings ?? []).filter((x) => typeof x === 'string');
  return {
    id,
    worker: typeof r.worker === 'string' ? r.worker : '',
    townHall: typeof r.startHall === 'string' ? r.startHall : '',
    workers: startUnits.length || 4,
    farmCount: supplyBuildings.length || undefined,
    colors: (r.colors ?? []).map((c) => (typeof c === 'number' ? c : parseInt(String(c).replace(/^0x/i, ''), 16) || 0)),
  };
}

/* ------------------------------------------------------------------ */
/* Derivations not expressible as a straight field rename              */
/* ------------------------------------------------------------------ */

/**
 * buildingRoles: the sim routes worker drop-offs through this map.
 * Derivation: a building is a `town` drop-off when it is the race hall chain
 * head or declares upkeepCategory 'hall' (both are the "can receive returned
 * resources" buildings in TFT). Farms/burrows are pure supply, so they are
 * `other` and never a drop-off target. Gold mines are entities, not buildings.
 */
function deriveBuildingRoles(
  buildings: Map<string, BuildingDef>,
  races: Record<string, RaceDef>,
  rawBuildings: RawTables['buildings'],
): Record<string, 'gold' | 'wood' | 'town'> {
  const roles: Record<string, 'gold' | 'wood' | 'town'> = {};
  for (const [id, b] of buildings) roles[id] = b.role === 'wood' ? 'wood' : 'town';
  // A night elf moon well is a lumber drop-off, never a town drop-off.
  for (const id of Object.keys(rawBuildings)) if (/moon_well|lumber/.test(id)) roles[id] = 'wood';
  // Every race hall chain head accepts both resource types => town. Undead and
  // night elf halls are absent from buildings.json (only human+orc are
  // authored), so register them here to keep the map total over race.townHall.
  for (const r of Object.values(races)) if (r.townHall) roles[r.townHall] = 'town';
  return roles;
}

/**
 * creepCamps: loot.json/units.json carry no camp grouping, so camps are built
 * from the creep population itself: creeps are bucketed by their authoritative
 * `level`, and each bucket contributes one camp of 2-3 members chosen by a
 * deterministic walk over ascending ids (no RNG, so mapgen placement stays the
 * only random factor). Camp size grows with level, matching TFT camp sizing.
 */
function deriveCreepCamps(units: Map<string, UnitDef>): CreepCampDef[] {
  const byLevel = new Map<number, string[]>();
  for (const [id, u] of units) {
    if (u.race !== 'creep' || u.isHero) continue;
    const lvl = Math.max(1, Math.min(7, Math.round(u.level) || 1));
    const list = byLevel.get(lvl);
    if (list) list.push(id);
    else byLevel.set(lvl, [id]);
  }
  const camps: CreepCampDef[] = [];
  for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
    const pool = byLevel.get(lvl)!.slice().sort();
    const size = Math.min(pool.length, Math.max(2, Math.min(3, 1 + Math.floor(lvl / 3))));
    const picked: string[] = [];
    // stride through the sorted pool so adjacent alphabetically-named variants
    // (e.g. lava_spawn_1/2/3) do not stack into one camp
    const stride = Math.max(1, Math.floor(pool.length / size));
    for (let i = 0; picked.length < size; i++) {
      const pick = pool[(i * stride) % pool.length];
      if (pick && !picked.includes(pick)) picked.push(pick);
      if (i > pool.length * 2) break;
    }
    camps.push({ id: `camp_l${lvl}_${camps.length}`, level: lvl, units: picked.map((id) => ({ id, count: 1 })) });
  }
  return camps;
}

/**
 * lootTable.roll: weights come from loot.json byMonsterLevel (green/blue/gold/
 * artifact percentages) and the item ids from pools. The signature stays
 * `(level, rng) => itemId|null` and consumes rng deterministically: exactly one
 * int(100) roll plus one int(poolSize) pick, so sim RNG order is unchanged.
 */
function makeLootTable(raw: RawTables): GameData['lootTable'] {
  const tiers = new Map<number, { weights: number[]; pools: string[][] }>();
  for (const [lvlStr, w] of Object.entries(raw.loot.byMonsterLevel ?? {})) {
    const lvl = Number(lvlStr);
    if (!Number.isFinite(lvl)) continue;
    tiers.set(lvl, {
      weights: [nz0(w.green), nz0(w.blue), nz0(w.gold), nz0(w.artifact)],
      pools: [raw.loot.pools.green ?? [], raw.loot.pools.blue ?? [], raw.loot.pools.gold ?? [], raw.loot.pools.chest ?? []],
    });
  }
  return {
    roll(level: number, rng: { int(n: number): number }): string | null {
      const lvl = Math.max(1, Math.min(10, Math.round(level) || 1));
      const tier = tiers.get(lvl) ?? tiers.get(Math.min(10, Math.max(1, lvl)));
      if (!tier) return null;
      let total = 0;
      for (const w of tier.weights) total += w > 0 ? w : 0;
      if (total <= 0) return null;
      const r = rng.int(total === 100 ? 100 : total);
      let acc = 0;
      let bucket = -1;
      for (let i = 0; i < tier.weights.length; i++) {
        acc += tier.weights[i];
        if (r < acc) {
          bucket = i;
          break;
        }
      }
      if (bucket < 0) return null;
      const pool = tier.pools[bucket];
      if (!pool || !pool.length) return null;
      return pool[rng.int(pool.length)] ?? null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function loadRawTables(): RawTables {
  return raw;
}

/** Build GameData from data/*.json. Throws on structural validation errors. */
export function loadGameData(strict = true): GameData {
  const validation = validateAll(raw);
  if (strict && validation.errors.length) {
    throw new Error(`data validation failed:\n${validation.errors.slice(0, 40).join('\n')}`);
  }
  const units = new Map<string, UnitDef>();
  for (const [id, u] of Object.entries(raw.units)) units.set(id, toUnit(id, u));
  const buildings = new Map<string, BuildingDef>();
  for (const [id, b] of Object.entries(raw.buildings)) buildings.set(id, toBuilding(id, b));
  const abilities = new Map<string, AbilityDef>();
  for (const [id, a] of Object.entries(raw.abilities)) abilities.set(id, toAbility(id, a));
  const tech = new Map<string, TechDef>();
  for (const [id, t] of Object.entries(raw.tech)) tech.set(id, toTech(id, t));
  const items = new Map<string, ItemDef>();
  for (const [id, it] of Object.entries(raw.items)) items.set(id, toItem(id, it));
  // Recipes become composite items keyed by recipe id, so item.crafting can
  // look up `components` without a second table.
  for (const [id, r] of Object.entries(raw.recipes)) {
    items.set(id, {
      id,
      name: r.name ?? id,
      quality: 'rare',
      cost: nz0(r.gold),
      stackable: false,
      charges: 0,
      components: [...(r.components ?? [])],
    });
  }
  const races: Record<string, RaceDef> = {};
  for (const [id, r] of Object.entries(raw.races)) races[id] = toRace(id, r);
  for (const id of ['undead', 'night_elf', 'neutral']) if (!races[id]) races[id] = { id, worker: '', townHall: '', workers: 0, colors: [] };

  // Town halls in TFT also train their worker; units.json/buildings.json omit
  // it for the human chain, so patch the hall chain heads here (documented in
  // the report rather than silently mutating the JSON).
  for (const r of Object.values(races)) {
    if (!r.townHall || !r.worker) continue;
    const hall = buildings.get(r.townHall);
    if (hall && !hall.trains?.includes(r.worker)) hall.trains = [...(hall.trains ?? []), r.worker];
  }

  const data: GameData = {
    units,
    buildings,
    abilities,
    tech,
    items,
    races,
    creepCamps: deriveCreepCamps(units),
    lootTable: makeLootTable(raw),
    abilityDefs: abilities as unknown as GameData['abilityDefs'],
    buildingRoles: deriveBuildingRoles(buildings, races, raw.buildings),
    heroXp: raw.heroes.experienceCurve.slice(),
  };
  return data;
}

