/**
 * Component definitions (Struct-of-Arrays tables).
 *
 * Every field is a plain JSON-safe value: Fixed numbers, strings, ids, arrays.
 * `stateHash()` walks these, so keep them free of functions and DOM refs.
 */
import { Fixed, ff, fi } from '../core/fixed.js';
import { Store } from '../ecs/store.js';
export type { Store };


export const ARMOR_TYPES = [
  'unarmored',
  'light',
  'medium',
  'heavy',
  'reinforced',
  'hero',
  'fortification',
  'ancient',
] as const;
export type ArmorType = (typeof ARMOR_TYPES)[number];

export const ATTACK_TYPES = ['normal', 'pierce', 'magic', 'chaos', 'hero', 'siege', 'spell'] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export const TARGET_FLAGS = ['ground', 'air', 'structure', 'ward', 'self', 'item', 'organic'] as const;

/* ------------------------------------------------------------------ */

export interface CTransform {
  x: Fixed;
  y: Fixed;
  /** heading in trig-steps (core/geom degToSteps space) */
  facing: number;
  /** collision radius, fixed game units */
  radius: Fixed;
  /** footprint for buildings, in tiles */
  w: number;
  h: number;
  /** terrain elevation layer (cliffs) */
  z: number;
}

export interface COwner {
  player: number;
}

export interface UnitKind {
  unit: 0;
  building: 1;
  item: 2;
  decoration: 3;
  missile: 4;
}
export const KIND_UNIT = 0;
export const KIND_BUILDING = 1;
export const KIND_ITEM = 2;
export const KIND_DECORATION = 3;
export const KIND_MISSILE = 4;

export interface CKind {
  kind: number;
}

export interface CDamage {
  min: Fixed;
  max: Fixed;
  attackType: AttackType;
  cooldown: Fixed;
  range: Fixed;
  attackPoint: Fixed;
  /** bonus damage vs specific armor types */
  bonusVsLight: Fixed;
  bonusVsMedium: Fixed;
  bonusVsHeavy: Fixed;
  bonusVsFortified: Fixed;
  bonusVsHero: Fixed;
  bonusVsAncient: Fixed;
  /** area of effect */
  splashRadius: Fixed;
  splashInnerPct: Fixed;
  pierceCount: number;
}

export interface CArmor {
  value: Fixed;
  type: ArmorType;
}

export interface CHealth {
  hp: Fixed;
  hpMax: Fixed;
  hpRegen: Fixed;
  mp: Fixed;
  mpMax: Fixed;
  mpRegen: Fixed;
  dead: boolean;
  deathTick: number;
}

export interface CUnitStats {
  str: number;
  agi: number;
  int: number;
  primary: 'str' | 'agi' | 'int';
  level: number;
  xp: number;
  isHero: boolean;
  /** unit id from units.json */
  id: string;
  race: string;
  upgradeTo: string | null;
  trainingDoneTick: number;
}

export interface CMovement {
  speed: Fixed;
  /** current desired velocity */
  vx: Fixed;
  vy: Fixed;
  turnRate: number;
  fly: boolean;
  /** separation mass factor (large units push more) */
  mass: Fixed;
  /** accumulated slide offset applied by collision resolution */
  ox: Fixed;
  oy: Fixed;
}

export type OrderKind =
  | 'none'
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'patrol'
  | 'follow'
  | 'harvest'
  | 'build'
  | 'return'
  | 'stop'
  | 'hold'
  | 'moveToBuilding'
  | 'dead';

export interface OrderSlot {
  kind: OrderKind;
  targetEid: number;
  tx: Fixed;
  ty: Fixed;
  mode: number; // harvest kind / build flag
  param: string;
}

export interface COrders {
  current: OrderSlot;
  queue: OrderSlot[];
  /** last position where an explicit order was given (return-to-anchor) */
  anchorX: Fixed;
  anchorY: Fixed;
  /** auto-acquire state */
  acquireTarget: number;
  engagedFrom: number;
  holdPosition: boolean;
}

export interface CAttackState {
  /** ticks until next swing allowed */
  cooldownLeft: number;
  /** fraction of the swing animation, in ticks */
  swing: number;
  target: number;
  /** true while walking into range */
  approaching: boolean;
}

export interface CAbilitySlot {
  abilityId: string;
  level: number;
  hotkey: string;
  /** tick at which the ability is usable again */
  readyAt: number;
  manaCost: Fixed;
  cooldown: Fixed;
}

export interface CAbilities {
  slots: CAbilitySlot[];
  /** point being targeted by an armed spell (UI state mirrored for AI) */
  arming: string | null;
}

export interface CBuffs {
  /** list, ordered by expiry then eid for determinism */
  list: {
    srcEid: number;
    kind: string;
    stat: string;
    amount: Fixed;
    pct: Fixed;
    untilTick: number;
    stacks: number;
  }[];
}

export interface CAura {
  auraId: string;
  radius: Fixed;
  /** applied to allies each tick */
  effect: string;
  amount: Fixed;
}

/** Scenery art key (tree / pine / rock / shrub). Render-only. */
export interface CDecor {
  decorationId: string;
}

/** Tick at which an entity last took damage — render-only, drives the hit flash. */
export interface CLastHit {
  tick: number;
  /** damage actually dealt, for floating combat text */
  amount: Fixed;
}

export interface CBuilding {
  buildingId: string;
  built: boolean; // false while under construction
  progress: number; // ticks remaining
  totalTicks: number;
  underConstructionBy: number;
  rallyX: Fixed;
  rallyY: Fixed;
  trainQueue: { unitId: string; remaining: number }[];
  researchQueue: { techId: string; remaining: number }[];
  supplyProvided: number;
  canAttack: boolean;
  upgradeTier: number;
}

export interface CCargo {
  carrying: 'gold' | 'wood' | 'none';
  amount: Fixed;
  capacity: Fixed;
  sourceEid: number;
  destEid: number;
  /** worker state machine */
  phase: number;
}

export interface CGoldMine {
  capacity: Fixed;
  rate: Fixed;
}

export interface CTree {
  capacity: Fixed;
  felled: boolean;
}

export interface CHero {
  respawnTick: number;
  altarEid: number;
  skillPoints: number;
  itemSlots: (string | null)[];
  itemCharges: number[];
  corpseEid: number;
}

export interface CItem {
  itemId: string;
  x: Fixed;
  y: Fixed;
  charges: number;
  ownerEid: number;
}

export interface CMissile {
  srcEid: number;
  targetEid: number;
  tx: Fixed;
  ty: Fixed;
  speed: Fixed;
  damage: Fixed;
  kind: string;
  ttl: number;
  pierceLeft: number;
}

export interface CSelection {
  group: number;
}

/* ------------------------------------------------------------------ */

export function makeStores(reg: {
  register<T extends object>(s: Store<T>): Store<T>;
}): Record<string, Store<object>> {
  const s = {
    transform: reg.register(new Store<CTransform>('transform', () => ({ x: 0, y: 0, facing: 0, radius: ff(0.5), w: 1, h: 1, z: 0 }))),
    owner: reg.register(new Store<COwner>('owner', () => ({ player: 0 }))),
    kind: reg.register(new Store<CKind>('kind', () => ({ kind: KIND_UNIT }))),
    health: reg.register(new Store<CHealth>('health', () => ({ hp: 0, hpMax: 0, hpRegen: 0, mp: 0, mpMax: 0, mpRegen: 0, dead: false, deathTick: 0 }))),
    damage: reg.register(new Store<CDamage>('damage', () => ({ min: fi(1), max: fi(1), attackType: 'normal', cooldown: ff(1), range: ff(1), attackPoint: ff(0.5), bonusVsLight: 0, bonusVsMedium: 0, bonusVsHeavy: 0, bonusVsFortified: 0, bonusVsHero: 0, bonusVsAncient: 0, splashRadius: 0, splashInnerPct: ff(0.5), pierceCount: 0 }))),
    armor: reg.register(new Store<CArmor>('armor', () => ({ value: 0, type: 'unarmored' }))),
    stats: reg.register(new Store<CUnitStats>('stats', () => ({ str: 10, agi: 10, int: 10, primary: 'str', level: 1, xp: 0, isHero: false, id: '', race: 'neutral', upgradeTo: null, trainingDoneTick: 0 }))),
    movement: reg.register(new Store<CMovement>('movement', () => ({ speed: ff(2.5), vx: 0, vy: 0, turnRate: 4096, fly: false, mass: ff(1), ox: 0, oy: 0 }))),
    orders: reg.register(new Store<COrders>('orders', () => ({ current: { kind: 'none', targetEid: 0xffffffff, tx: 0, ty: 0, mode: 0, param: '' }, queue: [], anchorX: 0, anchorY: 0, acquireTarget: 0xffffffff, engagedFrom: 0, holdPosition: false }))),
    attack: reg.register(new Store<CAttackState>('attack', () => ({ cooldownLeft: 0, swing: 0, target: 0xffffffff, approaching: false }))),
    abilities: reg.register(new Store<CAbilities>('abilities', () => ({ slots: [], arming: null }))),
    buffs: reg.register(new Store<CBuffs>('buffs', () => ({ list: [] }))),
    aura: reg.register(new Store<CAura>('aura', () => ({ auraId: '', radius: 0, effect: '', amount: 0 }))),
    building: reg.register(new Store<CBuilding>('building', () => ({ buildingId: '', built: true, progress: 0, totalTicks: 0, underConstructionBy: 0, rallyX: 0, rallyY: 0, trainQueue: [], researchQueue: [], supplyProvided: 0, canAttack: false, upgradeTier: 0 }))),
    cargo: reg.register(new Store<CCargo>('cargo', () => ({ carrying: 'none', amount: 0, capacity: ff(10), sourceEid: 0xffffffff, destEid: 0xffffffff, phase: 0 }))),
    mine: reg.register(new Store<CGoldMine>('mine', () => ({ capacity: ff(12500), rate: ff(10) }))),
    tree: reg.register(new Store<CTree>('tree', () => ({ capacity: ff(10000), felled: false }))),
    hero: reg.register(new Store<CHero>('hero', () => ({ respawnTick: 0, altarEid: 0xffffffff, skillPoints: 0, itemSlots: [null, null, null, null, null, null], itemCharges: [0, 0, 0, 0, 0, 0], corpseEid: 0xffffffff }))),
    item: reg.register(new Store<CItem>('item', () => ({ itemId: '', x: 0, y: 0, charges: 0, ownerEid: 0xffffffff }))),
    missile: reg.register(new Store<CMissile>('missile', () => ({ srcEid: 0, targetEid: 0xffffffff, tx: 0, ty: 0, speed: ff(12), damage: 0, kind: 'instant', ttl: 0, pierceLeft: 0 }))),
    // Render-only channels. Deliberately NOT registered with the registry so
    // they stay out of stateHash(): presentation must never perturb determinism.
    lastHit: new Store<CLastHit>('lastHit', () => ({ tick: -99999, amount: 0 })),
    decor: new Store<CDecor>('decor', () => ({ decorationId: '' })),
  };
  return s as unknown as Record<string, Store<object>>;
}
