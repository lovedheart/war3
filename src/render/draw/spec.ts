/**
 * Shared vocabulary for the procedural art layer.
 *
 * A `DrawSpec` is the neutral description a draw function needs: which sprite
 * key to bake, how big it is in pixels and which palette to use. Draw functions
 * must be pure Canvas-2D (no DOM access at import time) so they can be baked
 * into an offscreen atlas or replayed directly.
 */
import type { RacePalette } from '../palette.js';

export type Ctx2D = CanvasRenderingContext2D;

export type ArtCategory = 'unit' | 'building' | 'item' | 'decoration' | 'missile';

export interface DrawSpec {
  /** atlas key, e.g. `unit:footman` */
  key: string;
  /** logical category (picks the atlas page) */
  cat: ArtCategory;
  /** stable id from the data tables (`footman`, `barracks_al`, ...) */
  id: string;
  /** display name, debug only */
  name?: string;
  /** silhouette recipe */
  shape: string;
  race: string;
  pal: RacePalette;
  /** slot box size in px (square); sprite is drawn centred inside it */
  size: number;
  /** true for heroes (bigger + gold badge) */
  hero?: boolean;
  /** flying unit — shadow is offset further down */
  fly?: boolean;
}

export type DrawFn = (ctx: Ctx2D, spec: DrawSpec, size: number) => void;

/* ------------------------------------------------------------------ */
/* Shape registry                                                     */
/* ------------------------------------------------------------------ */

export const UNIT_SHAPES = [
  'worker', 'footman', 'marksman', 'rider', 'mortar', 'knight', 'wizard', 'cleric',
  'grunt', 'axethrower', 'raider', 'shaman', 'wolf_rider', 'catapult',
  'ghoul', 'crypt_fiend', 'bone_archer', 'meat_wagon', 'frost_wyrm', 'abom',
  'sentinel', 'archer_ne', 'dryad', 'bear', 'mountain_giant', 'hippo',
  'dread', 'warden', 'tinker', 'pit', 'naga', 'golem', 'sprite', 'bat',
  'hero_human', 'hero_orc', 'hero_undead', 'hero_ne', 'hero_neutral',
] as const;

export const BUILDING_SHAPES = [
  'keep', 'barracks', 'farm', 'church', 'forge', 'tower', 'arcane',
  'great_hall', 'strength', 'shop_orc', 'altar_orc', 'spirit_lodge', 'watchtower',
  'crypt', 'ziggurat', 'tomb', 'slaughter', 'temple_dark', 'neruban',
  'tree_life', 'moonwell', 'hunter_moon', 'ancient_protector', 'chimera_across',
  'goldmine', 'neutral_altar', 'market', 'watchtower_orc',
] as const;

export const ITEM_SHAPES = [
  'potion_hp', 'potion_mp', 'scroll_tp', 'scroll_regen', 'claymore', 'shield',
  'ring', 'gem', 'wand', 'tome', 'boots', 'orb', 'crown', 'hammer_itm',
  'recipe', 'permanent_str', 'permanent_agi', 'permanent_int',
] as const;

export const DECORATION_SHAPES = [
  'tree', 'tree_dead', 'tree_blight', 'pine', 'shrub', 'rock', 'ruins',
  'crystal', 'torch', 'bridge', 'wall', 'stump',
] as const;

export const MISSILE_SHAPES = [
  'arrow', 'bolt', 'cannon', 'fireball', 'magic_missile', 'spear', 'ice_shard',
  'acid', 'green_ball', 'whirlwind', 'flame_strike', 'blizzard',
] as const;

/** Sprite is drawn centred on (0,0) inside a box of `size` px. */
export function spriteKey(cat: ArtCategory, id: string): string {
  return `${cat}:${id}`;
}

export function parseSpriteKey(key: string): { cat: ArtCategory; id: string } | null {
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const cat = key.slice(0, i) as ArtCategory;
  if (cat !== 'unit' && cat !== 'building' && cat !== 'item' && cat !== 'decoration' && cat !== 'missile') return null;
  return { cat, id: key.slice(i + 1) };
}

/* ------------------------------------------------------------------ */
/* Shape inference from data ids                                      */
/* ------------------------------------------------------------------ */

const SHAPE_BY_ID: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const put = (shape: string, ...ids: string[]): void => { for (const i of ids) m[i] = shape; };

  put('worker', 'peasant', 'peon', 'corrupt_worker', 'acolyte', 'worker_ne', 'wisp', 'shadow_of_necrominus');
  put('footman', 'footman', 'knight_foot', 'skeleton_warrior', 'gnoll_assassin', 'brigand', 'mercenary_footman');
  put('marksman', 'rifleman', 'musket', 'headhunter', 'headhunter_axe', 'berserker_head', 'dark_troll_axe');
  put('rider', 'raider_wolfrider', 'crow', 'dragonhawk_rider', 'windrider');
  put('mortar', 'morta', 'mortar_team', 'steam_tank');
  put('knight', 'knight', 'templar_knight', 'siege_giant_mounted');
  put('wizard', 'archmage', 'sorceress', 'red_dragon', 'dragon_whelp', 'ice_dragon', 'faerie_dragon');
  put('cleric', 'priest', 'paladin_light', 'profane', 'druid_claw', 'druid_storm');
  put('grunt', 'grunt', 'ogre', 'ogre_bruiser', 'tauren', 'tauren_shaman', 'banshee', 'peninsula_ogre');
  put('axethrower', 'axe_throws', 'throwing_axe_unit', 'troll_axethrower');
  put('raider', 'raider', 'wolf_raider', 'kodo_beast_rider', 'troll_shaman');
  put('shaman', 'shaman', 'shadow_hunter', 'witch_doctor', 'spellbreak', 'alchemist');
  put('wolf_rider', 'wolf', 'dire_wolf', 'hundred_arrow', 'rocs');
  put('catapult', 'catapult', 'flaming_catapult', 'gyrocopter', 'siege_engine');
  put('ghoul', 'ghoul', 'ghoul_fiend', 'fel_orc_ghoul', 'gargoyle');
  put('crypt_fiend', 'crypt_fiend', 'nerubian', 'nerubian_weaver', 'obsidian_statue');
  put('bone_archer', 'skeleton', 'skeleton_archer', 'bone_warrior', 'burning_skeleton');
  put('meat_wagon', 'meat_wagon', 'cart', 'wagon');
  put('frost_wyrm', 'frost_wyrm', 'wyvern', 'wyvern_rider', 'cold_one');
  put('abom', 'abomination', 'abominator', 'plague_animal');
  put('sentinel', 'huntress', 'sentinel', 'avenger', 'wardress');
  put('archer_ne', 'archer', 'archer_moon', 'moon_priestess', 'glave_thrown');
  put('dryad', 'dryad', 'deer', 'starter_deer', 'hippogryph_corrupted');
  put('bear', 'bear', 'panda', 'treant', 'treant_ent', 'mountain_giant_root');
  put('mountain_giant', 'mountain_giant', 'giant', 'titan_guardian');
  put('hippo', 'hippogryph', 'hippogryph_rider', 'mount_hippogryph');
  put('dread', 'dread_lord_body', 'necrolord', 'shade', 'spirit_walker');
  put('warden', 'warden_body', 'keeper_body', 'vengeance_body');
  put('tinker', 'tinker_body', 'robot_flyer', 'mini_juggernaught');
  put('pit', 'pit_lord_body', 'defiler_body', 'flame_lord', 'pandaren_brewmaster');
  put('naga', 'naga_myrmidon', 'naga_royal', 'naga_siren', 'naga_guardian', 'sea_witch', 'cyclone');
  put('golem', 'stone_golem', 'golem', 'fire_pendant_golem', 'obsidian_golem');
  put('sprite', 'sprite', 'wisp_sprite', 'spirit_of_vengeance', 'stagh');
  put('bat', 'bat', 'bats', 'screecher', 'vampire_bat');
  put('hero_human', 'archmage', 'blood_mage', 'paladin', 'mountain_king');
  put('hero_orc', 'blademaster', 'far_seer', 'tauren_chieftain', 'shadow_hunter');
  put('hero_undead', 'death_knight', 'dread_lord', 'lich', 'crypt_lord');
  put('hero_ne', 'warden', 'keeper_of_the_grove', 'priestess_of_the_moon');
  put('hero_neutral', 'brewmaster', 'tinker', 'beastmaster', 'garona', 'dark_ranger', 'gorilla', 'pandaren');

  put('keep', 'town_hall', 'keep', 'castle', 'fortified_wall_tower');
  put('barracks', 'barracks', 'barracks_al', 'workshop_al', 'gnomish_workshop');
  put('farm', 'farm', 'granary', 'lumber_mill_al');
  put('church', 'church', 'altar_of_kings', 'arcane_vault_al', 'mystic_pond_al');
  put('forge', 'blacksmith', 'forge', 'ironworks', 'gunsmith');
  put('tower', 'guard_tower', 'cannon_tower', 'arcane_tower', 'watchtower_al', 'spotter_tower');
  put('arcane', 'mage_tower', 'arcane_sanctum', 'enchanters_sanctum', 'aviary_al');
  put('great_hall', 'great_hall', 'stronghold', 'fortress_orc');
  put('strength', 'orc_barracks', 'strength', 'war_mill', 'beast_caves');
  put('shop_orc', 'shadow_market', 'shop_orc', 'merchant_house');
  put('altar_orc', 'altar_of_truth', 'altar_orc', 'altar_of_frost');
  put('spirit_lodge', 'spirit_lodge', 'spirit_hall', 'roost_orc');
  put('watchtower', 'watchtower', 'guard_tower_orc', 'coast_watchtower');
  put('crypt', 'crypt', 'crypt_of_the_damned', 'ghoul_den');
  put('ziggurat', 'ziggurat', 'ziggurat_of_eternity', 'twisted_emporium');
  put('tomb', 'tomb_of_stolen_kings', 'tomb', 'mausoleum', 'sacrificial_altar_ud');
  put('slaughter', 'slaughterhouse', 'meat_wagon_works', 'gargoyle_spire');
  put('temple_dark', 'temple_of_the_damned', 'necropolis', 'black_cathedral');
  put('neruban', 'nerubian_ziggurat', 'demon_gate', 'broken_sea');
  put('tree_life', 'tree_of_life', 'tree_of_eternity', 'tree_of_wonders');
  put('moonwell', 'moon_well', 'circle_of_power', 'ancient_of_war');
  put('hunter_moon', 'hunter_s_moon', 'ancient_of_moon', 'chimaera_across_roost');
  put('ancient_protector', 'ancient_protector', 'ancient_of_war2', 'ancient_loss');
  put('chimera_across', 'chimaera_across', 'hippogryph_den', 'moonglow_cauldron');
  put('goldmine', 'gold_mine', 'goldmine', 'deep_gem_mine');
  put('neutral_altar', 'altar_of_departure', 'mercenary_camp', 'panda_liquor');
  put('market', 'marketplace', 'trading_post', 'general_store');
  put('watchtower_orc', 'orc_watchtower', 'bulwark', 'stone_wall_orc');

  put('potion_hp', 'itm_potion_healing', 'potion_hp', 'potion_greater_healing');
  put('potion_mp', 'itm_potion_mana', 'potion_mp');
  put('scroll_tp', 'itm_scroll_town_portal', 'scroll_tp');
  put('scroll_regen', 'itm_scroll_of_healing', 'scroll_regen');
  put('claymore', 'itm_claymore', 'claymore', 'blade_of_the_maiden');
  put('shield', 'itm_shield', 'shield', 'shield_of_light', 'dragon_scale_shield');
  put('ring', 'itm_ring', 'ring', 'ring_of_protection', 'ring_of_health');
  put('gem', 'itm_gem', 'gem', 'gem_of_health', 'pearl');
  put('wand', 'itm_wand', 'wand', 'wand_of_negation', 'staff_of_silence');
  put('tome', 'itm_tome', 'tome', 'tome_of_strength', 'book_of_protection');
  put('boots', 'itm_boots', 'boots', 'boots_of_speed', 'sabaton');
  put('orb', 'itm_orb', 'orb', 'orb_of_venom', 'orb_of_death');
  put('crown', 'itm_crown', 'crown', 'crown_of_mastery');
  put('hammer_itm', 'itm_hammer', 'hammer_itm', 'war_banners');
  put('recipe', 'itm_recipe', 'recipe', 'manual');
  put('permanent_str', 'itm_perma_str', 'permanent_str');
  put('permanent_agi', 'itm_perma_agi', 'permanent_agi');
  put('permanent_int', 'itm_perma_int', 'permanent_int');

  put('tree', 'tree', 'tree_eversong', 'tree_elwynn', 'tree_jungle');
  put('tree_dead', 'tree_dead', 'tree_winterfall');
  put('tree_blight', 'tree_blight', 'tree_teldrassil');
  put('pine', 'pine', 'tree_conifer');
  put('shrub', 'shrub', 'bush', 'flower');
  put('rock', 'rock', 'boulder', 'monolith');
  put('ruins', 'ruins', 'ruin', 'pillar');
  put('crystal', 'crystal', 'crystal_core');
  put('torch', 'torch', 'lamp', 'bonfire');
  put('bridge', 'bridge', 'bridge_segment');
  put('wall', 'wall', 'dirt_wall', 'brick_wall');
  put('stump', 'stump', 'log');

  put('arrow', 'arrow', 'missile_arrow');
  put('bolt', 'bolt', 'crossbow_bolt');
  put('cannon', 'cannon', 'cannonball');
  put('fireball', 'fireball', 'flame_strike_m', 'red_ball');
  put('magic_missile', 'magic_missile', 'arcane_missile', 'star');
  put('spear', 'spear', 'javelin', 'harpoon');
  put('ice_shard', 'ice_shard', 'frost_shard');
  put('acid', 'acid', 'spittle', 'web');
  put('green_ball', 'green_ball', 'plague_cloud_m');
  put('whirlwind', 'whirlwind', 'tornado');
  put('flame_strike', 'flame_strike', 'rain_of_fire');
  put('blizzard', 'blizzard', 'snowflake');
  return m;
})();

const SHAPE_SETS: Record<ArtCategory, Set<string>> = {
  unit: new Set<string>(UNIT_SHAPES),
  building: new Set<string>(BUILDING_SHAPES),
  item: new Set<string>(ITEM_SHAPES),
  decoration: new Set<string>(DECORATION_SHAPES),
  missile: new Set<string>(MISSILE_SHAPES),
};

/** Fallback silhouettes per category when nothing can be inferred. */
const FALLBACK: Record<ArtCategory, string> = {
  unit: 'footman',
  building: 'keep',
  item: 'gem',
  decoration: 'tree',
  missile: 'magic_missile',
};

function inferFromId(id: string, cat: ArtCategory): string | undefined {
  const exact = SHAPE_BY_ID[id];
  if (exact && SHAPE_SETS[cat].has(exact)) return exact;
  // token-wise fuzzy match against registered shapes of this category
  let best: string | undefined;
  let bestScore = 0;
  for (const s of SHAPE_SETS[cat]) {
    const score = commonTokens(id, s);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 1 ? best : undefined;
}

function commonTokens(a: string, b: string): number {
  const ta = new Set(a.split(/[_\-.]+/));
  let n = 0;
  for (const t of b.split(/[_\-.]+/)) if (ta.has(t)) n++;
  return n;
}

/** Pick a silhouette recipe for a data id. Deterministic, no side effects. */
export function shapeFor(id: string, cat: ArtCategory, hint?: string): string {
  if (hint && SHAPE_SETS[cat].has(hint)) return hint;
  const inferred = inferFromId(id, cat);
  if (inferred) return inferred;
  // units whose id mentions a hero word still get the generic humanoid
  return FALLBACK[cat];
}

export function isHeroId(id: string): boolean {
  return /^(hero|abl_hero|npc_hero)/.test(id) || /_hero$/.test(id) || HERO_IDS.has(id);
}

const HERO_IDS = new Set([
  'archmage', 'paladin', 'mountain_king', 'blood_mage', 'blademaster', 'far_seer',
  'tauren_chieftain', 'shadow_hunter', 'death_knight', 'dread_lord',
  'lich', 'crypt_lord', 'warden', 'keeper_of_the_grove', 'priestess_of_the_moon',
  'brewmaster', 'tinker', 'beastmaster', 'garona', 'dark_ranger',
]);

/* ------------------------------------------------------------------ */
/* Slot sizing                                                        */
/* ------------------------------------------------------------------ */

/** Atlas slot box per category, px. Heroes get their own larger box. */
export const SLOT_PX: Record<ArtCategory, number> = {
  unit: 64,
  building: 128,
  item: 32,
  decoration: 96,
  missile: 32,
};

export const HERO_SLOT_PX = 88;

/** On-screen footprint width in px at zoom 1 (1 tile == TILE_SIZE_PX). */
export function footprintPx(wTiles: number, hTiles: number, tileSizePx: number): number {
  const w = wTiles > 0 ? wTiles : 1;
  const h = hTiles > 0 ? hTiles : 1;
  return Math.max(tileSizePx * 0.6, Math.min(tileSizePx * 4, tileSizePx * Math.max(w, h)));
}
