/**
 * Data layer facade — the frozen contract the simulation codes against.
 *
 * `getGameData()` now serves the authoritative tables in `data/*.json` (TFT
 * 1.20.x SLK extracts) through `load.ts`; if those fail structural validation
 * it warns and falls back to the compact built-in set in `fallback.ts` so the
 * game always boots. Export names and shapes below are FROZEN — src/sim reads
 * them directly and performs no adaptation.
 */

import type { ArmorType, AttackType } from '../sim/components.js';
import { loadGameData } from './load.js';
import { fallbackData } from './fallback.js';

export interface Cost {
  gold: number;
  lumber: number;
  popUpkeep: number;
  popRequired?: number;
}

export interface UnitDef {
  id: string;
  name: string;
  race: string;
  level: number;
  isHero: boolean;
  hero?: boolean;
  fly: boolean;
  radius: number;
  sightRange: number;
  moveSpeed: number;
  trainTime: number;
  cost: Cost;
  stats: { hp: number; hpRegen: number; mp: number; mpRegen: number };
  attributes: { str: number; agi: number; int: number; primary: 'str' | 'agi' | 'int' };
  damage: {
    min: number;
    max: number;
    attackType: AttackType;
    range: number;
    cooldown: number;
    attackPoint: number;
    splashRadius?: number;
    pierceCount?: number;
    bonusVs?: Record<string, number>;
  };
  armor: { value: number; type: ArmorType };
  abilities?: string[];
  prereq?: string;
  upgradeTo?: string;
  carryCapacity?: number;
  icon?: string;
}

export interface BuildingDef {
  id: string;
  name: string;
  race: string;
  role: 'gold' | 'wood' | 'town' | 'other';
  footprint: [number, number];
  buildTime: number;
  supplyProvided: number;
  sightRange: number;
  cost: Cost;
  stats: { hp: number; armor: number; armorType: ArmorType };
  trains?: string[];
  researches?: string[];
  upgradeTo?: string;
  requiresTech?: string[];
  requiresBuilding?: string;
  attack?: { min: number; max: number; range: number; cooldown: number };
}

export interface AbilityDef {
  id: string;
  name: string;
  type: 'active' | 'passive' | 'aura' | 'ultimate';
  manaCost: number;
  cooldown: number;
  castPoint: number;
  range?: number;
  radius?: number;
  duration?: number;
  maxLevel: number;
  levelScale?: number;
  damage?: { min: number; max: number };
  summon?: { unitId: string; count: number; life: number };
  effects: ({ kind: string } & Record<string, unknown>)[];
}

export interface TechDef {
  id: string;
  name: string;
  cost: { gold: number; lumber: number };
  researchTime: number;
  requires: string[];
  requiresBuilding?: string;
  /** unit id -> upgraded unit id */
  unitUpgrade?: Record<string, string>;
  statBonus?: { scope: string; stat: string; amount: number }[];
}

export interface ItemDef {
  id: string;
  name: string;
  quality: 'common' | 'uncommon' | 'rare' | 'epic';
  cost: number;
  stackable: boolean;
  charges: number;
  components?: string[];
  stats?: Record<string, number>;
  ability?: string;
}

export interface RaceDef {
  id: string;
  worker: string;
  townHall: string;
  workers: number;
  farmCount?: number;
  colors: number[];
}

export interface LootTier {
  level: number;
  weights: number[];
  pools: string[][];
}

export interface CreepCampDef {
  id: string;
  level: number;
  units: { id: string; count: number }[];
  drop?: string;
}

export interface GameData {
  units: Map<string, UnitDef>;
  buildings: Map<string, BuildingDef>;
  abilities: Map<string, AbilityDef>;
  tech: Map<string, TechDef>;
  items: Map<string, ItemDef>;
  races: Record<string, RaceDef>;
  creepCamps: CreepCampDef[];
  lootTable: { roll(level: number, rng: { int(n: number): number }): string | null };
  abilityDefs: Map<string, AbilityDef>;
  buildingRoles: Record<string, 'gold' | 'wood' | 'town'>;
  heroXp: number[];
}

/** True once the real tables are cached; used by tests/diagnostics. */
let loaded = false;

let cached: GameData | null = null;

export function getGameData(): GameData {
  if (cached) return cached;
  // Static ESM imports only — `require` does not exist under "type": "module".
  // The tables themselves are also statically imported (see load.ts), so a
  // malformed JSON is a parse error at module evaluation, and a schema failure
  // is a throw we can still catch here and degrade from.
  try {
    cached = loadGameData(true);
    loaded = true;
  } catch (e) {
    console.warn('[war3:data] data/*.json unusable, using built-in fallback tables:', (e as Error).message);
    cached = fallbackData();
    loaded = false;
  }
  return cached;
}

/** Replace the cached tables (used by the real loader and by tests). */
export function setGameData(g: GameData): void {
  cached = g;
  loaded = true;
}

/** Whether the currently cached tables came from data/*.json (vs fallback). */
export function isLoadedFromJson(): boolean {
  return loaded;
}

export type { AttackType, ArmorType };
