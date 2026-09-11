/**
 * Build order knowledge, derived entirely from the data tables.
 *
 * Nothing here hard-codes a building or unit name: the tech tree is walked
 * from `BuildingDef.requiresBuilding` / `.trains` / `.upgradeTo` and
 * `RaceDef.hallChain`-equivalents (the town-hall upgradeTo chain), so adding a
 * race to data/*.json extends the AI with no code change.
 */
import type { BuildingDef, GameData, UnitDef } from '../data/index.js';

export interface BuildPlan {
  race: string;
  worker: string;
  townHall: string;
  /** supply-providing buildings (farm / burrow) */
  supplies: string[];
  /** every trainable non-worker unit of this race, in dependency order */
  armyUnits: string[];
  heroes: string[];
  /** ordered build chain: prerequisites first */
  buildChain: string[];
  /** town hall -> keep/stronghold -> castle/fortress */
  hallUpgrades: string[];
  /** building id -> the units it can train (own race only) */
  trainers: Map<string, string[]>;
}

const HALL_SUPPLY = 15;

export function planFor(gd: GameData, race: string): BuildPlan {
  const rd = gd.races[race];
  const worker = rd?.worker ?? '';
  const townHall = rd?.townHall ?? '';

  const mine = [...gd.buildings.values()].filter((b) => b.race === race);
  const byId = new Map(mine.map((b) => [b.id, b]));

  const supplies = mine.filter((b) => b.supplyProvided > 0 && b.supplyProvided < HALL_SUPPLY).map((b) => b.id);

  // ---- trainable units, grouped by the building that trains them ----------
  const trainers = new Map<string, string[]>();
  for (const b of mine) {
    const list = (b.trains ?? []).filter((id) => {
      const u = gd.units.get(id);
      return !!u && u.race === race && !u.isHero && u.id !== worker && trainCostOk(u);
    });
    if (list.length) trainers.set(b.id, list);
  }

  const heroes = [...gd.units.values()]
    .filter((u) => u.race === race && u.isHero)
    .map((u) => u.id)
    .sort();

  // ---- build chain: topological by requiresBuilding, then cost -------------
  const order: string[] = [];
  const placed = new Set<string>([townHall]);
  // Only keep buildings that actually do something for us: train, research,
  // supply, upgrade a hall, or attack. Shipyards on a land-only map and empty
  // shells would otherwise eat the whole budget.
  const useful = mine.filter(
    (b) =>
      (b.trains ?? []).some((id) => gd.units.get(id)?.race === race) ||
      (b.researches ?? []).length > 0 ||
      b.supplyProvided > 0 ||
      !!b.upgradeTo ||
      !!b.attack,
  );
  const chain = new Set(useful.map((b) => b.id));

  let guard = 0;
  while (order.length < useful.length && guard++ < 200) {
    const ready = useful
      .filter((b) => !placed.has(b.id) && !supplies.includes(b.id))
      .filter((b) => !b.requiresBuilding || placed.has(b.requiresBuilding) || b.requiresBuilding === townHall)
      .sort(
        (a, b) =>
          totalCost(a) - totalCost(b) ||
          depthOf(byId, a) - depthOf(byId, b) ||
          (a.id < b.id ? -1 : 1),
      );
    if (!ready.length) {
      // Deadlock in the table (a prereq we never place): take the cheapest
      // remaining so the AI still progresses instead of stalling forever.
      const rest = useful
        .filter((b) => !placed.has(b.id) && !supplies.includes(b.id))
        .sort((a, b) => totalCost(a) - totalCost(b) || (a.id < b.id ? -1 : 1));
      if (!rest.length) break;
      placed.add(rest[0].id);
      order.push(rest[0].id);
      continue;
    }
    placed.add(ready[0].id);
    order.push(ready[0].id);
  }

  // ---- hall upgrade ladder -----------------------------------------------
  const hallUpgrades: string[] = [];
  let cur = byId.get(townHall);
  let hops = 0;
  while (cur?.upgradeTo && hops++ < 4) {
    const nextId = cur.upgradeTo;
    if (hallUpgrades.includes(nextId)) break;
    hallUpgrades.push(nextId);
    cur = byId.get(nextId);
  }

  // ---- army units in "when do they unlock" order ---------------------------
  const armyUnits = [...trainers.values()].flat();
  const seen = new Set<string>();
  const ordered = armyUnits
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .sort((a, b) => {
      const ua = gd.units.get(a)!;
      const ub = gd.units.get(b)!;
      return (
producerCost(byId, trainerOf(trainers, a)) - producerCost(byId, trainerOf(trainers, b)) ||
        totalUnitCost(ua) - totalUnitCost(ub) ||
        (a < b ? -1 : 1)
      );
    });

  void chain;
  return { race, worker, townHall, supplies, armyUnits: ordered, heroes, buildChain: order, hallUpgrades, trainers };
}

function trainerOf(trainers: Map<string, string[]>, unit: string): string | undefined {
  for (const [b, list] of trainers) if (list.includes(unit)) return b;
  return undefined;
}

function producerCost(byId: Map<string, BuildingDef>, b: string | undefined): number {
  if (!b) return 0;
  // A unit trained at the town hall is available from tick 0.
  if ((byId.get(b)?.supplyProvided ?? 0) >= HALL_SUPPLY) return 0;
  return byId.has(b) ? totalCost(byId.get(b)!) : 0;
}

/** Can this unit actually be bought (non-zero cost, sane train time)? */
function trainCostOk(u: UnitDef): boolean {
  return u.cost.gold + u.cost.lumber > 0 && u.trainTime > 1;
}

function totalCost(b: BuildingDef): number {
  return b.cost.gold + b.cost.lumber;
}

function totalUnitCost(u: UnitDef): number {
  return u.cost.gold + u.cost.lumber;
}

/** How many buildings deep this one sits in the requiresBuilding chain. */
function depthOf(byId: Map<string, BuildingDef>, b: BuildingDef, seen = new Set<string>()): number {
  if (!b.requiresBuilding || seen.has(b.id)) return 1;
  seen.add(b.id);
  const parent = byId.get(b.requiresBuilding);
  return parent ? 1 + depthOf(byId, parent, seen) : 1;
}

/** Do we own a built instance of `id` (or its town-hall equivalent)? */
export function _unusedOwns(owned: Map<string, number>, id: string): boolean {
  return (owned.get(id) ?? 0) > 0;
}
