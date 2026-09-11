/**
 * Entity factories. The single place that turns a data-table row into live
 * components, so unit/building invariants are established once.
 */
import { Fixed, ff } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import type { Store } from '../ecs/store.js';
import { World } from './world.js';
import {

  KIND_UNIT,
  KIND_BUILDING,
  KIND_ITEM,
  KIND_DECORATION,
  type ArmorType,
  type CTransform,
  type COwner,
  type CKind,
  type CHealth,
  type CDamage,
  type CArmor,
  type CUnitStats,
  type CMovement,
  type COrders,
  type CAttackState,
  type CAbilities,
  type CBuffs,
  type CBuilding,
  type CGoldMine,
  type CTree,
  type CHero,
  type CItem,
} from './components.js';

/** typed handle over World.stores (which is erased to Store<object>) */
function typedStores(w: World) {
  return w.stores as unknown as {
    transform: Store<CTransform>;
    owner: Store<COwner>;
    kind: Store<CKind>;
    health: Store<CHealth>;
    damage: Store<CDamage>;
    armor: Store<CArmor>;
    stats: Store<CUnitStats>;
    movement: Store<CMovement>;
    orders: Store<COrders>;
    attack: Store<CAttackState>;
    abilities: Store<CAbilities>;
    buffs: Store<CBuffs>;
    building: Store<CBuilding>;
    mine: Store<CGoldMine>;
    tree: Store<CTree>;
    hero: Store<CHero>;
    item: Store<CItem>;
  };
}

export interface UnitSpec {
  id: string;
  race?: string;
  name?: string;
  hp: number;
  hpRegen?: number;
  mp?: number;
  mpRegen?: number;
  str?: number;
  agi?: number;
  int?: number;
  primary?: 'str' | 'agi' | 'int';
  dmgMin: number;
  dmgMax: number;
  attackType?: string;
  armor: number;
  armorType: ArmorType;
  range?: number;
  cooldown?: number;
  attackPoint?: number;
  moveSpeed?: number;
  radius?: number;
  fly?: boolean;
  isHero?: boolean;
  level?: number;
  popUpkeep?: number;
  sightRange?: number;
  abilities?: { abilityId: string; level?: number; hotkey?: string; manaCost?: number; cooldown?: number }[];
  bonusVs?: Record<string, number>;
  splashRadius?: number;
  pierceCount?: number;
}

export interface BuildingSpec {
  id: string;
  race?: string;
  hp: number;
  armor: number;
  armorType: ArmorType;
  w: number;
  h: number;
  supplyProvided?: number;
  buildTime?: number;
  sightRange?: number;
  canAttack?: boolean;
  dmgMin?: number;
  dmgMax?: number;
  range?: number;
  cooldown?: number;
  rallyDefault?: boolean;
}

const ATTACK_TYPES = new Set(['normal', 'pierce', 'magic', 'chaos', 'hero', 'siege', 'spell']);
const ARMOR_TYPES = new Set(['unarmored', 'light', 'medium', 'heavy', 'reinforced', 'hero', 'ancient', 'work']);

function attackTypeOf(s: string | undefined): never | string {
  return s && ATTACK_TYPES.has(s) ? s : 'normal';
}
function armorTypeOf(s: string | undefined): ArmorType {
  return (s && ARMOR_TYPES.has(s) ? s : 'unarmored') as ArmorType;
}

export function spawnUnit(w: World, spec: UnitSpec, x: Fixed, y: Fixed, player: number): Eid {
  const e = w.createEntity();
  const st = typedStores(w);
  const t = st.transform.add(e);
  t.x = x;
  t.y = y;
  t.radius = ff(spec.radius ?? 0.4);
  t.w = 1;
  t.h = 1;
  st.owner.add(e).player = player;
  st.kind.add(e).kind = KIND_UNIT;

  const h = st.health.add(e);
  h.hp = h.hpMax = ff(spec.hp);
  h.hpRegen = ff(spec.hpRegen ?? 0.5);
  h.mpMax = ff(spec.mp ?? 0);
  h.mp = h.mpMax;
  h.mpRegen = ff(spec.mpRegen ?? 0);

  const s = st.stats.add(e);
  s.id = spec.id;
  s.race = spec.race ?? 'neutral';
  s.str = spec.str ?? 10;
  s.agi = spec.agi ?? 10;
  s.int = spec.int ?? 10;
  s.primary = spec.primary ?? 'str';
  s.isHero = !!spec.isHero;
  s.level = spec.level ?? 1;

  const d = st.damage.add(e);
  d.min = ff(spec.dmgMin);
  d.max = ff(spec.dmgMax);
  d.attackType = attackTypeOf(spec.attackType) as never;
  d.range = ff(spec.range ?? 1.0);
  d.cooldown = ff(spec.cooldown ?? 1.4);
  d.attackPoint = ff(spec.attackPoint ?? 0.5);
  d.splashRadius = ff(spec.splashRadius ?? 0);
  d.pierceCount = spec.pierceCount ?? 0;
  if (spec.bonusVs) {
    d.bonusVsLight = ff(spec.bonusVs.light ?? 0);
    d.bonusVsMedium = ff(spec.bonusVs.medium ?? 0);
    d.bonusVsHeavy = ff(spec.bonusVs.heavy ?? 0);
    d.bonusVsHero = ff(spec.bonusVs.hero ?? 0);
    d.bonusVsAncient = ff(spec.bonusVs.ancient ?? 0);
    d.bonusVsFortified = ff(spec.bonusVs.fortified ?? 0);
  }

  st.armor.add(e).value = ff(spec.armor);
  st.armor.get(e)!.type = armorTypeOf(spec.armorType);

  const m = st.movement.add(e);
  m.speed = ff(spec.moveSpeed ?? 2.5);
  m.fly = !!spec.fly;
  m.mass = ff(1);

  st.orders.add(e);
  st.attack.add(e);
  st.buffs.add(e);
  const ab = st.abilities.add(e);
  for (const a of spec.abilities ?? []) {
    ab.slots.push({
      abilityId: a.abilityId,
      level: a.level ?? 1,
      hotkey: a.hotkey ?? '',
      readyAt: 0,
      manaCost: ff(a.manaCost ?? 0),
      cooldown: ff(a.cooldown ?? 10),
    });
  }
  if (spec.isHero) {
    st.hero.add(e);
  }
  return e;
}

export function spawnBuilding(
  w: World,
  spec: BuildingSpec,
  tx: number,
  ty: number,
  player: number,
  built = true,
): Eid {
  const e = w.createEntity();
  const st = typedStores(w);
  const t = st.transform.add(e);
  // building anchor = centre of footprint
  t.x = ff(tx) + ff(spec.w / 2);
  t.y = ff(ty) + ff(spec.h / 2);
  t.w = spec.w;
  t.h = spec.h;
  t.radius = ff(Math.max(spec.w, spec.h) / 2);
  st.owner.add(e).player = player;
  st.kind.add(e).kind = KIND_BUILDING;

  const h = st.health.add(e);
  h.hp = h.hpMax = ff(spec.hp);
  h.hpRegen = 0;
  h.mpMax = 0;

  st.armor.add(e).value = ff(spec.armor);
  st.armor.get(e)!.type = armorTypeOf(spec.armorType);

  const b = st.building.add(e);
  b.buildingId = spec.id;
  b.built = built;
  b.supplyProvided = spec.supplyProvided ?? 0;
  b.canAttack = !!spec.canAttack;
  b.totalTicks = Math.round((spec.buildTime ?? 60) * 30);
  b.progress = built ? 0 : b.totalTicks;
  b.rallyX = t.x;
  b.rallyY = ff(t.y + ff(3));

  if (spec.canAttack) {
    const d = st.damage.add(e);
    d.min = ff(spec.dmgMin ?? 0);
    d.max = ff(spec.dmgMax ?? 0);
    d.attackType = 'hero';
    d.range = ff(spec.range ?? 6);
    d.cooldown = ff(spec.cooldown ?? 1.0);
    d.attackPoint = ff(0.6);
    st.attack.add(e);
    st.orders.add(e);
  }
  st.orders.add(e);
  st.buffs.add(e);
  st.abilities.add(e);
  return e;
}

export function spawnGoldMine(w: World, x: Fixed, y: Fixed, capacity: Fixed): Eid {
  const e = w.createEntity();
  const st = typedStores(w);
  const t = st.transform.add(e);
  t.x = x;
  t.y = y;
  t.radius = ff(1.2);
  st.owner.add(e).player = 11; // neutral passive
  st.kind.add(e).kind = KIND_DECORATION;
  st.mine.add(e).capacity = capacity;
  return e;
}

export function spawnTree(w: World, x: Fixed, y: Fixed): Eid {
  const e = w.createEntity();
  const st = typedStores(w);
  const t = st.transform.add(e);
  t.x = x;
  t.y = y;
  t.radius = ff(0.5);
  st.owner.add(e).player = 11;
  st.kind.add(e).kind = KIND_DECORATION;
  st.tree.add(e);
  return e;
}

export function spawnItem(w: World, itemId: string, x: Fixed, y: Fixed, charges = 0): Eid {
  const e = w.createEntity();
  const st = typedStores(w);
  const t = st.transform.add(e);
  t.x = x;
  t.y = y;
  t.radius = ff(0.25);
  st.owner.add(e).player = 11;
  st.kind.add(e).kind = KIND_ITEM;
  const it = st.item.add(e);
  it.itemId = itemId;
  it.x = x;
  it.y = y;
  it.charges = charges;
  return e;
}
