/**
 * Offline fallback tables.
 *
 * Verbatim copy of the interim shim that predates the JSON loader, kept so the
 * game always boots: if data/*.json fail structural validation, `getGameData()`
 * warns and serves these instead. They are intentionally compact (human + orc
 * core roster, representative creeps) — NOT authoritative for balance work;
 * prefer fixing the JSON over extending this file.
 */
import type { AbilityDef, AttackType, BuildingDef, CreepCampDef, GameData, ItemDef, RaceDef, TechDef, UnitDef } from './index.js';

export function fallbackData(): GameData {
  const units = new Map<string, UnitDef>();
  const U = (u: Partial<Omit<UnitDef, 'stats' | 'damage' | 'armor' | 'attributes'>> & { id: string; hp?: number; stats?: Partial<UnitDef['stats']>; damage?: Partial<UnitDef['damage']>; armor?: Partial<UnitDef['armor']>; attributes?: Partial<UnitDef['attributes']> } & Record<string, unknown>): UnitDef => ({
    name: u.id,
    race: 'neutral',
    level: 1,
    isHero: false,
    fly: false,
    radius: 0.4,
    sightRange: 6,
    moveSpeed: 2.5,
    trainTime: 25,
    cost: { gold: 0, lumber: 0, popUpkeep: 1 },
    stats: { hp: 250, hpRegen: 0.5, mp: 0, mpRegen: 0 },
    attributes: { str: 10, agi: 10, int: 10, primary: 'str' },
    damage: { min: 5, max: 7, attackType: 'normal', range: 1, cooldown: 1.35, attackPoint: 0.5 },
    armor: { value: 0, type: 'unarmored' },
    ...u,
  } as UnitDef);

  // --- Human (TFT values) -----------------------------------------------
  units.set('peasant', U({ id: 'peasant', name: 'Peasant', race: 'human', hp: 0, cost: { gold: 80, lumber: 0, popUpkeep: 1 }, stats: { hp: 250, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 2, max: 3, attackType: 'normal', range: 1, cooldown: 1.35, attackPoint: 0.5 }, armor: { value: 0, type: 'light' }, moveSpeed: 2.2, trainTime: 14, carryCapacity: 10, attributes: { str: 10, agi: 10, int: 10, primary: 'str' } }));
  units.set('footman', U({ id: 'footman', name: 'Footman', race: 'human', cost: { gold: 90, lumber: 0, popUpkeep: 2 }, stats: { hp: 440, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 7, max: 9, attackType: 'normal', range: 1.2, cooldown: 1.35, attackPoint: 0.5 }, armor: { value: 3, type: 'heavy' }, moveSpeed: 2.5, trainTime: 20, prereq: 'barracks', attributes: { str: 13, agi: 14, int: 12, primary: 'str' } }));
  units.set('rifleman', U({ id: 'rifleman', name: 'Rifleman', race: 'human', cost: { gold: 135, lumber: 0, popUpkeep: 2 }, stats: { hp: 310, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 17, max: 19, attackType: 'pierce', range: 5, cooldown: 1.5, attackPoint: 0.4 }, armor: { value: 0, type: 'medium' }, moveSpeed: 2.5, trainTime: 22, prereq: 'barracks', attributes: { str: 10, agi: 17, int: 10, primary: 'agi' } }));
  units.set('knight', U({ id: 'knight', name: 'Knight', race: 'human', cost: { gold: 245, lumber: 90, popUpkeep: 4 }, stats: { hp: 850, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 21, max: 27, attackType: 'normal', range: 1.2, cooldown: 1.5, attackPoint: 0.6 }, armor: { value: 6, type: 'heavy' }, moveSpeed: 3.2, trainTime: 35, prereq: 'blacksmith', upgradeTo: undefined, attributes: { str: 22, agi: 15, int: 12, primary: 'str' } }));
  units.set('mortar_team', U({ id: 'mortar_team', name: 'Mortar Team', race: 'human', cost: { gold: 155, lumber: 205, popUpkeep: 4 }, stats: { hp: 325, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 31, max: 41, attackType: 'siege', range: 9, cooldown: 3, attackPoint: 0.7, splashRadius: 2.5 }, armor: { value: 2, type: 'heavy' }, moveSpeed: 2.5, trainTime: 30, prereq: 'workshop' }));
  units.set('priest', U({ id: 'priest', name: 'Priest', race: 'human', cost: { gold: 140, lumber: 60, popUpkeep: 2 }, stats: { hp: 375, hpRegen: 0.5, mp: 260, mpRegen: 0.8 }, damage: { min: 11, max: 15, attackType: 'magic', range: 4.5, cooldown: 1.85, attackPoint: 0.5 }, armor: { value: 0, type: 'light' }, moveSpeed: 2.5, trainTime: 26, prereq: 'church', abilities: ['heal'] }));
  units.set('archmage', U({ id: 'archmage', name: 'Archmage', race: 'human', isHero: true, hero: true, level: 1, cost: { gold: 275, lumber: 0, popUpkeep: 3 }, stats: { hp: 525, hpRegen: 0.5, mp: 375, mpRegen: 1.2 }, damage: { min: 13, max: 15, attackType: 'hero', range: 1.5, cooldown: 1.7, attackPoint: 0.5 }, armor: { value: 0, type: 'hero' }, moveSpeed: 2.9, trainTime: 55, prereq: 'altar_human', abilities: ['frost_nova', 'summon_water_elemental', 'blizzard', 'mass_teleport'], attributes: { str: 15, agi: 14, int: 28, primary: 'int' } }));
  units.set('paladin', U({ id: 'paladin', name: 'Paladin', race: 'human', isHero: true, hero: true, cost: { gold: 350, lumber: 0, popUpkeep: 3 }, stats: { hp: 650, hpRegen: 0.75, mp: 300, mpRegen: 1 }, damage: { min: 17, max: 19, attackType: 'hero', range: 1.5, cooldown: 1.7, attackPoint: 0.5 }, armor: { value: 3, type: 'hero' }, moveSpeed: 2.9, trainTime: 55, prereq: 'altar_human', abilities: ['holy_light', 'divine_shield', 'devotion_aura', 'resurrection'], attributes: { str: 21, agi: 12, int: 14, primary: 'str' } }));

  // --- Orc -------------------------------------------------------------
  units.set('peon', U({ id: 'peon', name: 'Peon', race: 'orc', cost: { gold: 80, lumber: 0, popUpkeep: 1 }, stats: { hp: 300, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 3, max: 5, attackType: 'normal', range: 1, cooldown: 1.35, attackPoint: 0.5 }, armor: { value: 0, type: 'light' }, moveSpeed: 2.2, trainTime: 14, carryCapacity: 10 }));
  units.set('grunt', U({ id: 'grunt', name: 'Grunt', race: 'orc', cost: { gold: 200, lumber: 0, popUpkeep: 3 }, stats: { hp: 700, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 14, max: 18, attackType: 'normal', range: 1.2, cooldown: 1.4, attackPoint: 0.55 }, armor: { value: 3, type: 'heavy' }, moveSpeed: 2.6, trainTime: 24, prereq: 'barracks_orc', attributes: { str: 20, agi: 10, int: 12, primary: 'str' } }));
  units.set('shaman', U({ id: 'shaman', name: 'Shaman', race: 'orc', cost: { gold: 150, lumber: 50, popUpkeep: 2 }, stats: { hp: 375, hpRegen: 0.5, mp: 260, mpRegen: 0.8 }, damage: { min: 12, max: 16, attackType: 'magic', range: 5, cooldown: 1.7, attackPoint: 0.5 }, armor: { value: 0, type: 'light' }, moveSpeed: 2.5, trainTime: 26, prereq: 'temple' }));
  units.set('raider', U({ id: 'raider', name: 'Raider', race: 'orc', cost: { gold: 215, lumber: 35, popUpkeep: 3 }, stats: { hp: 640, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 16, max: 22, attackType: 'normal', range: 1.2, cooldown: 1.4, attackPoint: 0.55 }, armor: { value: 4, type: 'heavy' }, moveSpeed: 3.6, trainTime: 30, prereq: 'beastiary' }));
  units.set('demolisher', U({ id: 'demolisher', name: 'Demolisher', race: 'orc', cost: { gold: 155, lumber: 205, popUpkeep: 4 }, stats: { hp: 325, hpRegen: 0.5, mp: 0, mpRegen: 0 }, damage: { min: 31, max: 41, attackType: 'siege', range: 8, cooldown: 3, attackPoint: 0.7, splashRadius: 2.5 }, armor: { value: 2, type: 'heavy' }, moveSpeed: 2.5, trainTime: 30, prereq: 'vc' }));
  units.set('blademaster', U({ id: 'blademaster', name: 'Blademaster', race: 'orc', isHero: true, hero: true, cost: { gold: 325, lumber: 0, popUpkeep: 3 }, stats: { hp: 575, hpRegen: 0.5, mp: 225, mpRegen: 0.9 }, damage: { min: 21, max: 23, attackType: 'hero', range: 1.5, cooldown: 1.7, attackPoint: 0.5 }, armor: { value: 0, type: 'hero' }, moveSpeed: 3.2, trainTime: 55, prereq: 'altar_orc', abilities: ['mirror_image', 'critical_strike', 'wind_walk', 'blade_storm'], attributes: { str: 20, agi: 22, int: 15, primary: 'agi' } }));
  units.set('far_seer', U({ id: 'far_seer', name: 'Far Seer', race: 'orc', isHero: true, hero: true, cost: { gold: 325, lumber: 0, popUpkeep: 3 }, stats: { hp: 600, hpRegen: 0.5, mp: 330, mpRegen: 1.1 }, damage: { min: 15, max: 17, attackType: 'hero', range: 1.5, cooldown: 1.7, attackPoint: 0.5 }, armor: { value: 0, type: 'hero' }, moveSpeed: 2.9, trainTime: 55, prereq: 'altar_orc', abilities: ['chain_lightning', 'feral_spirit', 'far_sight', 'ancestral_guardian'], attributes: { str: 18, agi: 12, int: 24, primary: 'int' } }));

  // --- Creeps ----------------------------------------------------------
  const creep = (id: string, hp: number, dmg: [number, number], lvl: number, at: AttackType = 'normal'): void => {
    units.set(id, U({ id, name: id.replace(/_/g, ' '), race: 'creep', level: lvl, stats: { hp, hpRegen: 0, mp: 0, mpRegen: 0 }, damage: { min: dmg[0], max: dmg[1], attackType: at, range: at === 'pierce' ? 5 : 1.2, cooldown: 1.5, attackPoint: 0.5 }, armor: { value: lvl - 1, type: lvl >= 4 ? 'heavy' : 'medium' }, moveSpeed: 2.6 }));
  };
  creep('mud_golem', 480, [13, 17], 1);
  creep('gnoll_archer', 330, [11, 15], 2, 'pierce');
  creep('forest_troll', 450, [15, 19], 2);
  creep('dark_troll_shadow_weaver', 475, [19, 23], 3, 'magic');
  creep('firebat', 300, [13, 17], 2, 'spell');
  creep('harpy', 320, [13, 17], 2, 'pierce');
  creep('husk', 400, [11, 15], 1);
  creep('skeleton_warrior', 260, [9, 13], 1);
  creep('naga_guardian', 550, [17, 21], 3, 'magic');
  creep('blue_dragoon_whelp', 600, [21, 27], 4, 'spell');
  creep('ice_troll_trapper', 450, [19, 23], 3, 'pierce');
  creep('satyr_satyr', 480, [17, 21], 2);
  creep('ogre_mauler', 850, [21, 27], 3);
  creep('pit_lord', 900, [28, 34], 5, 'chaos');
  creep('green_dragoon', 1200, [31, 39], 5, 'spell');

  // --- Buildings --------------------------------------------------------
  const buildings = new Map<string, BuildingDef>();
  const B = (b: Partial<BuildingDef> & { id: string }): BuildingDef => ({
    name: b.id,
    race: 'neutral',
    role: 'other',
    footprint: [3, 3],
    buildTime: 60,
    supplyProvided: 0,
    sightRange: 8,
    cost: { gold: 0, lumber: 0, popUpkeep: 0 },
    stats: { hp: 1200, armor: 2, armorType: 'fortification' },
    ...b,
  } as BuildingDef);
  buildings.set('town_hall', B({ id: 'town_hall', name: 'Town Hall', race: 'human', role: 'town', footprint: [4, 4], cost: { gold: 400, lumber: 135, popUpkeep: 0 }, stats: { hp: 1600, armor: 2, armorType: 'fortification' }, supplyProvided: 6, trains: ['peasant'], sightRange: 6, upgradeTo: 'keep' }));
  buildings.set('keep', B({ id: 'keep', name: 'Keep', race: 'human', role: 'town', footprint: [4, 4], cost: { gold: 800, lumber: 205, popUpkeep: 0 }, stats: { hp: 1900, armor: 3, armorType: 'fortification' }, supplyProvided: 6, trains: ['peasant'], upgradeTo: 'castle' }));
  buildings.set('castle', B({ id: 'castle', name: 'Castle', race: 'human', role: 'town', footprint: [4, 4], cost: { gold: 800, lumber: 205, popUpkeep: 0 }, stats: { hp: 2200, armor: 4, armorType: 'fortification' }, supplyProvided: 6 }));
  buildings.set('farm', B({ id: 'farm', name: 'Farm', race: 'human', footprint: [3, 3], cost: { gold: 80, lumber: 20, popUpkeep: 0 }, supplyProvided: 6, stats: { hp: 450, armor: 1, armorType: 'fortification' }, buildTime: 25 }));
  buildings.set('barracks', B({ id: 'barracks', name: 'Barracks', race: 'human', footprint: [4, 4], cost: { gold: 335, lumber: 135, popUpkeep: 0 }, stats: { hp: 1100, armor: 2, armorType: 'fortification' }, trains: ['footman', 'rifleman'], buildTime: 55 }));
  buildings.set('blacksmith', B({ id: 'blacksmith', name: 'Blacksmith', race: 'human', footprint: [4, 4], cost: { gold: 190, lumber: 135, popUpkeep: 0 }, stats: { hp: 1000, armor: 2, armorType: 'fortification' }, researches: ['knight', 'defender_upg1'], buildTime: 45 }));
  buildings.set('church', B({ id: 'church', name: 'Church', race: 'human', footprint: [4, 4], cost: { gold: 155, lumber: 185, popUpkeep: 0 }, stats: { hp: 1000, armor: 2, armorType: 'fortification' }, trains: ['priest'], buildTime: 50 }));
  buildings.set('workshop', B({ id: 'workshop', name: 'Gnomish Workshop', race: 'human', footprint: [4, 4], cost: { gold: 165, lumber: 145, popUpkeep: 0 }, stats: { hp: 1000, armor: 2, armorType: 'fortification' }, trains: ['mortar_team'], buildTime: 45 }));
  buildings.set('altartmp', B({ id: 'altartmp', name: 'Altar', footprint: [4, 4] }));
  buildings.set('altar_human', B({ id: 'altar_human', name: 'Altar of Kings', race: 'human', footprint: [4, 4], cost: { gold: 150, lumber: 135, popUpkeep: 0 }, stats: { hp: 900, armor: 2, armorType: 'fortification' }, trains: ['archmage', 'paladin'], buildTime: 45 }));
  buildings.set('guard_tower', B({ id: 'guard_tower', name: 'Guard Tower', race: 'human', footprint: [2, 2], cost: { gold: 50, lumber: 100, popUpkeep: 0 }, stats: { hp: 420, armor: 2, armorType: 'fortification' }, attack: { min: 26, max: 32, range: 6, cooldown: 1.5 }, buildTime: 30 }));
  buildings.set('great_hall', B({ id: 'great_hall', name: 'Great Hall', race: 'orc', role: 'town', footprint: [4, 4], cost: { gold: 400, lumber: 135, popUpkeep: 0 }, stats: { hp: 1600, armor: 2, armorType: 'fortification' }, supplyProvided: 6, trains: ['peon'], upgradeTo: 'stronghold' }));
  buildings.set('stronghold', B({ id: 'stronghold', name: 'Stronghold', race: 'orc', role: 'town', footprint: [4, 4], cost: { gold: 800, lumber: 205, popUpkeep: 0 }, stats: { hp: 1900, armor: 3, armorType: 'fortification' }, supplyProvided: 6, trains: ['peon'] }));
  buildings.set('burrow', B({ id: 'burrow', name: 'Burrow', race: 'orc', footprint: [3, 3], cost: { gold: 68, lumber: 20, popUpkeep: 0 }, supplyProvided: 6, stats: { hp: 450, armor: 1, armorType: 'fortification' }, buildTime: 25 }));
  buildings.set('barracks_orc', B({ id: 'barracks_orc', name: 'Barracks', race: 'orc', footprint: [4, 4], cost: { gold: 335, lumber: 135, popUpkeep: 0 }, stats: { hp: 1100, armor: 2, armorType: 'fortification' }, trains: ['grunt'], buildTime: 55 }));
  buildings.set('temple', B({ id: 'temple', name: 'Temple of the Damned?', race: 'orc', footprint: [4, 4], cost: { gold: 130, lumber: 140, popUpkeep: 0 }, stats: { hp: 1000, armor: 2, armorType: 'fortification' }, trains: ['shaman'], buildTime: 50 }));
  buildings.set('beastiary', B({ id: 'beastiary', name: 'Beastiary', race: 'orc', footprint: [4, 4], cost: { gold: 165, lumber: 135, popUpkeep: 0 }, stats: { hp: 1000, armor: 2, armorType: 'fortification' }, trains: ['raider'], buildTime: 50 }));
  buildings.set('vc', B({ id: 'vc', name: 'War Chime', race: 'orc', footprint: [3, 3], cost: { gold: 155, lumber: 145, popUpkeep: 0 }, stats: { hp: 900, armor: 2, armorType: 'fortification' }, trains: ['demolisher'], buildTime: 45 }));
  buildings.set('altar_orc', B({ id: 'altar_orc', name: 'Altar of Storms', race: 'orc', footprint: [4, 4], cost: { gold: 150, lumber: 135, popUpkeep: 0 }, stats: { hp: 900, armor: 2, armorType: 'fortification' }, trains: ['blademaster', 'far_seer'], buildTime: 45 }));

  // --- Abilities -------------------------------------------------------
  const abilities = new Map<string, AbilityDef>();
  const A = (a: Partial<AbilityDef> & { id: string }): AbilityDef => ({
    name: a.id,
    type: 'active',
    manaCost: 30,
    cooldown: 10,
    castPoint: 0.5,
    maxLevel: 3,
    effects: [],
    ...a,
  } as AbilityDef);
  abilities.set('frost_nova', A({ id: 'frost_nova', name: 'Frost Nova', manaCost: 35, cooldown: 8, radius: 5, damage: { min: 100, max: 150 }, effects: [{ kind: 'aoeDamage', radius: 5, amount: 120 }, { kind: 'slow', pct: 0.5, dur: 6 }] }));
  abilities.set('blizzard', A({ id: 'blizzard', name: 'Blizzard', manaCost: 125, cooldown: 12, radius: 6, damage: { min: 200, max: 300 }, effects: [{ kind: 'aoeDamage', radius: 6, amount: 250 }] }));
  abilities.set('summon_water_elemental', A({ id: 'summon_water_elemental', name: 'Summon Water Elemental', manaCost: 110, cooldown: 10, summon: { unitId: 'water_elemental', count: 1, life: 60 }, effects: [{ kind: 'summon', unitId: 'water_elemental', count: 1, life: 60 }] }));
  abilities.set('mass_teleport', A({ id: 'mass_teleport', name: 'Mass Teleport', type: 'ultimate', maxLevel: 1, manaCost: 175, cooldown: 180, effects: [{ kind: 'teleport' }] }));
  abilities.set('holy_light', A({ id: 'holy_light', name: 'Holy Light', manaCost: 40, cooldown: 6, effects: [{ kind: 'damage', amount: 100 }, { kind: 'heal', amount: 130 }] }));
  abilities.set('divine_shield', A({ id: 'divine_shield', name: 'Divine Shield', manaCost: 50, cooldown: 45, duration: 20, effects: [{ kind: 'buff', stat: 'invulnerable', amount: 1, dur: 20 }] }));
  abilities.set('devotion_aura', A({ id: 'devotion_aura', name: 'Devotion Aura', type: 'aura', maxLevel: 4, manaCost: 0, cooldown: 0, effects: [{ kind: 'aura', effect: 'armor', amount: 3 }] }));
  abilities.set('resurrection', A({ id: 'resurrection', name: 'Resurrection', type: 'ultimate', maxLevel: 1, manaCost: 200, cooldown: 180, effects: [{ kind: 'buff', stat: 'revive', amount: 1, dur: 1 }] }));
  abilities.set('mirror_image', A({ id: 'mirror_image', name: 'Mirror Image', manaCost: 55, cooldown: 6, effects: [{ kind: 'summon', unitId: 'mirror_image_unit', count: 6, life: 30 }] }));
  abilities.set('critical_strike', A({ id: 'critical_strike', name: 'Critical Strike', type: 'passive', manaCost: 0, cooldown: 0, effects: [{ kind: 'crit', pct: 0.25, mult: 2 }] }));
  abilities.set('wind_walk', A({ id: 'wind_walk', name: 'Wind Walk', manaCost: 75, cooldown: 30, duration: 30, effects: [{ kind: 'invisibility', dur: 30 }] }));
  abilities.set('blade_storm', A({ id: 'blade_storm', name: 'Blade Storm', type: 'ultimate', maxLevel: 1, manaCost: 170, cooldown: 120, radius: 5, effects: [{ kind: 'aoeDamage', radius: 5, amount: 330 }] }));
  abilities.set('chain_lightning', A({ id: 'chain_lightning', name: 'Chain Lightning', manaCost: 125, cooldown: 9, effects: [{ kind: 'chainlightning', jumps: 5, amount: 100 }] }));
  abilities.set('feral_spirit', A({ id: 'feral_spirit', name: 'Feral Spirit', manaCost: 75, cooldown: 12, effects: [{ kind: 'buff', stat: 'attackSpeed', amount: 0.3, dur: 30 }] }));
  abilities.set('far_sight', A({ id: 'far_sight', name: 'Far Sight', manaCost: 50, cooldown: 12, effects: [{ kind: 'buff', stat: 'sight', amount: 1, dur: 60 }] }));
  abilities.set('ancestral_guardian', A({ id: 'ancestral_guardian', name: 'Ancestral Guardian', type: 'ultimate', maxLevel: 1, manaCost: 150, cooldown: 150, effects: [{ kind: 'summon', unitId: 'ancestral_guardian_unit', count: 1, life: 60 }] }));
  abilities.set('heal', A({ id: 'heal', name: 'Heal', manaCost: 55, cooldown: 1, effects: [{ kind: 'heal', amount: 135 }] }));

  // --- Tech ------------------------------------------------------------
  const tech = new Map<string, TechDef>();
  tech.set('defender_upg1', { id: 'defender_upg1', name: 'Animal War Training', cost: { gold: 100, lumber: 0 }, researchTime: 60, requires: [], statBonus: [{ scope: 'unit:footman', stat: 'armor', amount: 1 }] });
  tech.set('knight', { id: 'knight', name: 'Knights', cost: { gold: 275, lumber: 90 }, researchTime: 90, requires: [], unitUpgrade: { footman: 'knight' }, requiresBuilding: 'blacksmith' });
  tech.set('def_upg1', { id: 'def_upg1', name: 'Armor Upgrade I', cost: { gold: 150, lumber: 0 }, researchTime: 90, requires: [], statBonus: [{ scope: 'all', stat: 'armor', amount: 1 }] });
  tech.set('def_upg2', { id: 'def_upg2', name: 'Armor Upgrade II', cost: { gold: 250, lumber: 100 }, researchTime: 120, requires: ['def_upg1'], statBonus: [{ scope: 'all', stat: 'armor', amount: 1 }] });
  tech.set('atk_upg1', { id: 'atk_upg1', name: 'Attack Upgrade I', cost: { gold: 150, lumber: 0 }, researchTime: 90, requires: [], statBonus: [{ scope: 'all', stat: 'damage', amount: 2 }] });
  tech.set('orc_def_upg1', { id: 'orc_def_upg1', name: 'Braced Armour? Disenchant?', cost: { gold: 150, lumber: 0 }, researchTime: 90, requires: [], statBonus: [{ scope: 'all', stat: 'armor', amount: 1 }] });

  // --- Items -----------------------------------------------------------
  const items = new Map<string, ItemDef>();
  const I = (id: string, name: string, quality: ItemDef['quality'], stats: Record<string, number>, cost = 0, components?: string[]): void => {
    items.set(id, { id, name, quality, cost, stackable: false, charges: 0, stats, components });
  };
  I('claymore', 'Claymore', 'uncommon', { damage: 10 }, 600);
  I('gauntlets_of_strength', 'Gauntlets of Strength', 'uncommon', { str: 5 }, 500);
  I('belt_of_strength', 'Belt of Strength', 'uncommon', { str: 7 }, 650);
  I('crystal_mace', 'Crystal Mace', 'uncommon', { damage: 16 }, 700);
  I('ring_of_protection', 'Ring of Protection', 'common', { armor: 2 }, 375);
  I('cloak_of_shadows', 'Cloak of Shadows', 'common', { armor: 1 }, 250);
  I('slippers_of_fleetness', 'Slippers of Fleetness', 'uncommon', { agi: 5 }, 500);
  I('tome_of_strength', 'Tome of Strength', 'uncommon', { str: 6 }, 600);
  I('manual_of_health', 'Manual of Health', 'uncommon', { hp: 250 }, 600);
  I('orb_of_venom', 'Orb of Venom', 'uncommon', { poison: 1 }, 350);
  I('scroll_of_tp', 'Scroll of Town Portal', 'common', { tp: 1 }, 150);
  I('healing_salve', 'Healing Salve', 'common', { heal: 150 }, 100);
  I('gladiators_shield', "Gladiator's Shield", 'rare', { armor: 4, hp: 250 }, 1400, ['claymore', 'gauntlets_of_strength', 'belt_of_strength']);
  I('bloodmanes_claws', "Bloodmaul's Claws", 'rare', { damage: 20, crit: 10 }, 1500, ['claymore', 'claws_of_attack']);
  I('claws_of_attack', 'Claws of Attack', 'common', { damage: 6 }, 300);
  I('sphinx_statue', 'Sphinx Statue', 'epic', { armor: 5, str: 5 }, 2000);

  const races: Record<string, RaceDef> = {
    human: { id: 'human', worker: 'peasant', townHall: 'town_hall', workers: 4, farmCount: 2, colors: [0x3277ff, 0x1f4ccf] },
    orc: { id: 'orc', worker: 'peon', townHall: 'great_hall', workers: 4, farmCount: 0, colors: [0xff5f2e, 0xb03a10] },
    undead: { id: 'undead', worker: 'acolyte', townHall: 'necropolis', workers: 4, farmCount: 0, colors: [0x8f6dff, 0x4a2fa0] },
    night_elf: { id: 'night_elf', worker: 'worker', townHall: 'tree_of_life', workers: 4, farmCount: 0, colors: [0x4de0b0, 0x1f8f6a] },
    neutral: { id: 'neutral', worker: '', townHall: '', workers: 0, farmCount: 0, colors: [0x9a9a9a, 0x5a5a5a] },
  };

  const creepCamps: CreepCampDef[] = [
    { id: 'camp1', level: 1, units: [{ id: 'mud_golem', count: 2 }] },
    { id: 'camp2', level: 2, units: [{ id: 'gnoll_archer', count: 2 }, { id: 'forest_troll', count: 1 }] },
    { id: 'camp3', level: 3, units: [{ id: 'husk', count: 3 }, { id: 'dark_troll_shadow_weaver', count: 1 }] },
    { id: 'camp4', level: 4, units: [{ id: 'naga_guardian', count: 2 }, { id: 'firebat', count: 2 }] },
    { id: 'camp5', level: 5, units: [{ id: 'ogre_mauler', count: 2 }, { id: 'blue_dragoon_whelp', count: 1 }] },
    { id: 'camp6', level: 6, units: [{ id: 'pit_lord', count: 1 }, { id: 'ice_troll_trapper', count: 2 }] },
    { id: 'camp7', level: 7, units: [{ id: 'green_dragoon', count: 1 }, { id: 'satyr_satyr', count: 2 }] },
  ];

  const poolCommon = ['ring_of_protection', 'cloak_of_shadows', 'claws_of_attack', 'healing_salve', 'scroll_of_tp'];
  const poolUncommon = ['claymore', 'gauntlets_of_strength', 'slippers_of_fleetness', 'tome_of_strength', 'manual_of_health', 'orb_of_venom'];
  const poolRare = ['gladiators_shield', 'bloodmanes_claws', 'belt_of_strength', 'crystal_mace'];
  const poolEpic = ['sphinx_statue'];

  const lootTable = {
    roll(level: number, rng: { int(n: number): number }): string | null {
      const r = rng.int(100);
      let pool: string[];
      if (level <= 2) {
        if (r > 35) return null;
        pool = r < 28 ? poolCommon : poolUncommon;
      } else if (level <= 4) {
        if (r > 55) return null;
        pool = r < 30 ? poolCommon : r < 48 ? poolUncommon : poolRare;
      } else if (level <= 6) {
        if (r > 75) return null;
        pool = r < 20 ? poolCommon : r < 45 ? poolUncommon : r < 70 ? poolRare : poolEpic;
      } else {
        pool = r < 15 ? poolUncommon : r < 55 ? poolRare : poolEpic;
      }
      const i = rng.int(pool.length);
      return pool[i] ?? null;
    },
  };

  const buildingRoles: Record<string, 'gold' | 'wood' | 'town'> = {};
  for (const [, b] of buildings) buildingRoles[b.id] = b.role === 'other' ? 'town' : b.role;

  const gd: GameData = {
    units,
    buildings,
    abilities,
    tech,
    items,
    races,
    creepCamps,
    lootTable,
    abilityDefs: abilities as unknown as GameData['abilityDefs'],
    buildingRoles,
    heroXp: [0, 350, 750, 1250, 1850, 2600, 3550, 4700, 6100, 7900],
  };
  return gd;
}
