/**
 * Command application: the ONLY path from player/AI intent into sim state.
 * Installed onto `World.applyCommand` by `installCommandHandler`.
 */
import { Fixed, ff, fi, fn } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import type { Command } from './commandTypes.js';
import { issue, smartRightClick, clearOrders, NO_TARGET } from './orders.js';
import { spawnBuilding, spawnItem } from './spawn.js';
import { getGameData, type UnitDef, type BuildingDef } from '../data/index.js';

export type { Command };

export interface PendingAbility {
  tick: number;
  caster: Eid;
  abilityId: string;
  target: number;
  x: Fixed;
  y: Fixed;
}

interface S {
  transform: { get(e: Eid): { x: Fixed; y: Fixed; w: number; h: number } | undefined };
  owner: { get(e: Eid): { player: number } | undefined };
  kind: { get(e: Eid): { kind: number } | undefined };
  health: {
    get(e: Eid): { hp: Fixed; hpMax: Fixed; dead: boolean; mp: Fixed; mpMax: Fixed } | undefined;
  };
  stats: { get(e: Eid): { id: string; isHero: boolean; level: number; xp: number } | undefined };
  orders: { get(e: Eid): import('./components.js').COrders | undefined };
  building: {
    get(
      e: Eid,
    ):
      | {
          buildingId: string;
          built: boolean;
          progress: number;
          totalTicks: number;
          underConstructionBy: number;
          trainQueue: { unitId: string; remaining: number }[];
          researchQueue: { techId: string; remaining: number }[];
          rallyX: Fixed;
          rallyY: Fixed;
        }
      | undefined;
  };
  cargo: { get(e: Eid): { carrying: string; amount: Fixed; sourceEid: number; destEid: number } | undefined };
  hero: {
    get(e: Eid): { itemSlots: (string | null)[]; itemCharges: number[]; respawnTick: number } | undefined;
  };
  item: { get(e: Eid): { itemId: string; ownerEid: number } | undefined };
  abilities: { get(e: Eid): { slots: { abilityId: string; readyAt: number }[]; arming: string | null } | undefined };
}

const S = (w: World) => w.stores as unknown as S;

function players(w: World) {
  return (w as unknown as { players: PlayerLike[] }).players;
}
interface PlayerLike {
  id: number;
  gold: Fixed;
  lumber: Fixed;
  canAfford(g: Fixed, l: Fixed): boolean;
  spend(g: Fixed, l: Fixed): void;
  supplyUsed: number;
  supplyFree(): number;
  hasTech(id: string): boolean;
  addTech(id: string, tick: number): void;
  upkeep: 0 | 1 | 2;
}

function fail(w: World, msg: string): void {
  w.bus.emit('log', { level: 'warn', msg });
}

/** Cost helper reading the data tables. */
function unitCost(d: UnitDef): [Fixed, Fixed] {
  return [fi(d.cost.gold), fi(d.cost.lumber)];
}

export function installCommandHandler(w: World): void {
  w.applyCommand = (world: World, cmd: Command) => apply(world, cmd);
}

export function apply(w: World, cmd: Command): void {
  const s = S(w);
  const gd = getGameData();
  switch (cmd.k) {
    case 'move': {
      const kind =
        cmd.mode === 'attack'
          ? 'attack'
          : cmd.mode === 'attackMove'
            ? 'attackMove'
            : cmd.mode === 'patrol'
              ? 'patrol'
              : cmd.mode === 'follow'
                ? 'follow'
                : 'move';
      for (const u of cmd.units) {
        if ((s.owner.get(u)?.player ?? -1) !== cmd.player) continue;
        issue(w, u, kind, NO_TARGET, cmd.to.x, cmd.to.y, cmd.queue ?? false);
      }
      break;
    }
    case 'stop':
      for (const u of cmd.units) {
        if ((s.owner.get(u)?.player ?? -1) !== cmd.player) continue;
        const o = s.orders.get(u);
        if (o) clearOrders(o);
      }
      break;
    case 'hold':
      for (const u of cmd.units) {
        if ((s.owner.get(u)?.player ?? -1) !== cmd.player) continue;
        const o = s.orders.get(u);
        if (o) {
          clearOrders(o);
          o.holdPosition = true;
        }
      }
      break;
    case 'rightClick':
      for (const u of cmd.units) {
        if ((s.owner.get(u)?.player ?? -1) !== cmd.player) continue;
      }
      smartRightClick(
        w,
        cmd.units.filter((u) => (s.owner.get(u)?.player ?? -1) === cmd.player),
        cmd.target,
        cmd.at,
        cmd.queue ?? false,
      );
      break;
    case 'train': {
      const b = s.building.get(cmd.building);
      if (!b || !b.built) return fail(w, 'train: building not ready');
      const def = gd.units.get(cmd.unitId);
      if (!def) return fail(w, `train: unknown unit ${cmd.unitId}`);
      const p = players(w)[cmd.player];
      if (!p) return;
      const [g, l] = unitCost(def);
      if (!p.canAfford(g, l)) return fail(w, 'train: insufficient resources');
      if (p.supplyFree() < (def.cost.popUpkeep ?? 1)) return fail(w, 'train: supply blocked');
      p.spend(g, l);
      b.trainQueue.push({ unitId: cmd.unitId, remaining: Math.round(def.trainTime * 30) });
      break;
    }
    case 'build': {
      const def = gd.buildings.get(cmd.buildingId);
      if (!def) return fail(w, `build: unknown building ${cmd.buildingId}`);
      const p = players(w)[cmd.player];
      if (!p) return;
      const tx = Math.floor(fn(cmd.at.x));
      const ty = Math.floor(fn(cmd.at.y));
      if (!placementOk(w, def, tx, ty)) return fail(w, 'build: invalid placement');
      if (!p.canAfford(fi(def.cost.gold), fi(def.cost.lumber))) return fail(w, 'build: insufficient resources');
      p.spend(fi(def.cost.gold), fi(def.cost.lumber));
      const e = spawnBuilding(w, defToSpec(def), tx, ty, cmd.player, false);
      const bt = s.building.get(e)!;
      bt.progress = Math.round(def.buildTime * 30);
      bt.totalTicks = bt.progress;
      bt.built = false;
      bt.underConstructionBy = cmd.worker;
      const wo = s.orders.get(cmd.worker);
      if (wo) {
        clearOrders(wo);
        wo.current = { kind: 'build', targetEid: e, tx: ff(tx), ty: ff(ty), mode: 0, param: cmd.buildingId };
      }
      // reserve footprint so two workers cannot stack a building
      markOccupied(w, e, tx, ty, def.footprint[0], def.footprint[1]);
      break;
    }
    case 'harvest': {
      const wc = s.cargo.get(cmd.worker);
      if (!wc) return fail(w, 'harvest: not a worker');
      const kindStr = cmd.kind === 'gold' ? 'gold' : 'wood';
      const wo = s.orders.get(cmd.worker);
      if (wo) {
        clearOrders(wo);
        wo.current = {
          kind: 'harvest',
          targetEid: cmd.target,
          tx: 0,
          ty: 0,
          mode: cmd.kind === 'gold' ? 0 : 1,
          param: kindStr,
        };
      }
      wc.sourceEid = cmd.target;
      break;
    }
    case 'return': {
      const wo = s.orders.get(cmd.worker);
      if (wo) {
        wo.current.kind = 'return';
        wo.current.targetEid = cmd.to;
      }
      break;
    }
    case 'research': {
      const b = s.building.get(cmd.building);
      if (!b) return;
      const tech = gd.tech.get(cmd.techId);
      if (!tech) return fail(w, `research: unknown tech ${cmd.techId}`);
      const p = players(w)[cmd.player];
      if (!p) return;
      if (p.hasTech(cmd.techId)) return;
      if (!p.canAfford(fi(tech.cost.gold), fi(tech.cost.lumber))) return fail(w, 'research: resources');
      for (const r of tech.requires) if (!p.hasTech(r)) return fail(w, 'research: tech prerequisite');
      p.spend(fi(tech.cost.gold), fi(tech.cost.lumber));
      b.researchQueue.push({ techId: cmd.techId, remaining: Math.round(tech.researchTime * 30) });
      break;
    }
    case 'upgradeUnit': {
      for (const u of cmd.units) {
        const st = s.stats.get(u);
        if (!st) continue;
        const to = gd.units.get(cmd.toId);
        if (!to) return fail(w, `upgradeUnit: unknown ${cmd.toId}`);
        const p = players(w)[cmd.player];
        if (!p) return;
        if (!p.canAfford(fi(to.cost.gold), fi(to.cost.lumber))) return fail(w, 'upgradeUnit: resources');
        p.spend(fi(to.cost.gold), fi(to.cost.lumber));
        st.id = cmd.toId;
        const h = s.health.get(u);
        if (h) {
          h.hpMax = fi(to.stats.hp);
          h.hp = fminFixed(h.hp + (h.hpMax - h.hp), h.hpMax);
        }
        const d = (w.stores.damage as unknown as S['health'] extends never ? never : { get(x: Eid): import('./components.js').CDamage | undefined }).get(u);
        if (d) {
          d.min = fi(to.damage.min);
          d.max = fi(to.damage.max);
        }
      }
      break;
    }
    case 'ability': {
      const ab = s.abilities.get(cmd.caster);
      if (!ab) return;
      const slot = ab.slots.find((x) => x.abilityId === cmd.abilityId);
      if (!slot) return fail(w, `ability: caster lacks ${cmd.abilityId}`);
      if (slot.readyAt > w.tick) return fail(w, 'ability: on cooldown');
      const h = s.health.get(cmd.caster);
      const def = gd.abilities.get(cmd.abilityId);
      if (!def) return fail(w, `ability: unknown ${cmd.abilityId}`);
      if (h && h.mp < fi(def.manaCost)) return fail(w, 'ability: no mana');
      if (h) h.mp -= fi(def.manaCost);
      slot.readyAt = w.tick + Math.round(def.cooldown * 30);
      w.bus.emit('ability:cast', { caster: cmd.caster, abilityId: cmd.abilityId, tick: w.tick });
      (w as unknown as { pendingAbilities: PendingAbility[] }).pendingAbilities.push({
        tick: w.tick + Math.round((def.castPoint ?? 0.5) * 30),
        caster: cmd.caster,
        abilityId: cmd.abilityId,
        target: cmd.target ?? NO_TARGET,
        x: cmd.at?.x ?? 0,
        y: cmd.at?.y ?? 0,
      });
      break;
    }
    case 'itemUse': {
      const hero = s.hero.get(cmd.unit);
      if (!hero) return;
      const itemId = hero.itemSlots[cmd.slot];
      if (!itemId) return;
      const it = gd.items.get(itemId);
      if (!it) return;
      (w as unknown as { pendingItems: { tick: number; unit: Eid; itemId: string; target: number; x: Fixed; y: Fixed }[] }).pendingItems.push({
        tick: w.tick,
        unit: cmd.unit,
        itemId,
        target: cmd.target ?? NO_TARGET,
        x: cmd.at?.x ?? 0,
        y: cmd.at?.y ?? 0,
      });
      break;
    }
    case 'itemDrop': {
      const hero = s.hero.get(cmd.unit);
      if (!hero) return;
      const itemId = hero.itemSlots[cmd.slot];
      if (!itemId) return;
      hero.itemSlots[cmd.slot] = null;
      const t = s.transform.get(cmd.unit);
      spawnItemEntity(w, itemId, cmd.at.x || (t?.x ?? 0), cmd.at.y || (t?.y ?? 0));
      break;
    }
    case 'itemGive': {
      const from = s.hero.get(cmd.from);
      const to = s.hero.get(cmd.to);
      if (!from || !to) return;
      const itemId = from.itemSlots[cmd.slot];
      if (!itemId) return;
      const free = to.itemSlots.indexOf(null);
      if (free < 0) return fail(w, 'itemGive: no free slot');
      to.itemSlots[free] = itemId;
      from.itemSlots[cmd.slot] = null;
      break;
    }
    case 'rally': {
      const b = s.building.get(cmd.entity);
      if (b) {
        b.rallyX = cmd.at.x;
        b.rallyY = cmd.at.y;
      }
      break;
    }
    case 'cancelTrain': {
      const b = s.building.get(cmd.building);
      if (!b) return;
      const q = b.trainQueue.splice(cmd.index, 1)[0];
      if (q) {
        const d = gd.units.get(q.unitId);
        if (d) refund(w, cmd.player, fi(d.cost.gold), fi(d.cost.lumber), 0.75);
      }
      break;
    }
    case 'cancelBuild': {
      const b = s.building.get(cmd.entity);
      if (!b || b.built) return;
      const d = gd.buildings.get(b.buildingId);
      if (d) refund(w, cmd.player, d.cost.gold, d.cost.lumber, 0.5);
      w.destroyEntity(cmd.entity);
      break;
    }
    case 'cancelResearch': {
      const b = s.building.get(cmd.building);
      if (!b) return;
      const q = b.researchQueue.splice(cmd.index, 1)[0];
      if (q) {
        const t = gd.tech.get(q.techId);
        if (t) refund(w, cmd.player, fi(t.cost.gold), fi(t.cost.lumber), 0.75);
      }
      break;
    }
    case 'revive': {
      const heroes = (w as unknown as { heroGraveyard: Map<number, { eid: Eid; respawnTick: number; name: string }> }).heroGraveyard;
      for (const [, v] of heroes) {
        if (v.eid === cmd.hero) {
          // revive handled by hero system when respawnTick reached
          v.respawnTick = Math.min(v.respawnTick, w.tick + 60);
          return;
        }
      }
      break;
    }
    case 'upkeep': {
      const p = players(w)[cmd.player];
      if (p) p.upkeep = cmd.mode;
      break;
    }
    case 'sell': {
      const b = s.building.get(cmd.building);
      if (!b) return;
      const d3 = gd.buildings.get(b.buildingId);
      if (d3) refund(w, cmd.player, fi(d3.cost.gold), fi(d3.cost.lumber), 0.5);
      w.destroyEntity(cmd.building);
      break;
    }
    case 'townHallConvert':
    case 'trigger':
    default:
      break;
  }
}

function fminFixed(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

function refund(w: World, player: number, gold: Fixed, lumber: Fixed, rate: number): void {
  const p = players(w)[player];
  if (!p) return;
  p.gold += Math.round(gold * rate) | 0;
  p.lumber += Math.round(lumber * rate) | 0;
}

function defToSpec(d: BuildingDef) {
  return {
    id: d.id,
    race: d.race,
    hp: d.stats.hp,
    armor: d.stats.armor,
    armorType: d.stats.armorType,
    w: d.footprint[0],
    h: d.footprint[1],
    supplyProvided: d.supplyProvided,
    buildTime: d.buildTime,
    canAttack: !!d.attack,
    dmgMin: d.attack?.min,
    dmgMax: d.attack?.max,
    range: d.attack?.range,
    cooldown: d.attack?.cooldown,
  };
}

function spawnItemEntity(w: World, itemId: string, x: Fixed, y: Fixed): void {
  spawnItem(w, itemId, x, y);
}

function markOccupied(w: World, e: Eid, tx: number, ty: number, fw: number, fh: number): void {
  const occ = (w as unknown as { occupied: Uint8Array }).occupied;
  const W = (w as unknown as { mapW: number }).mapW;
  if (!occ || !W) return;
  for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) occ[y * W + x] = 1;
  void e;
}

export function placementOk(w: World, def: BuildingDef, tx: number, ty: number): boolean {
  const terr = w.terrain;
  if (!terr) return false;
  const occ = (w as unknown as { occupied: Uint8Array }).occupied;
  for (let y = ty; y < ty + def.footprint[1]; y++) {
    for (let x = tx; x < tx + def.footprint[0]; x++) {
      if (x < 0 || y < 0 || x >= terr.width || y >= terr.height) return false;
      if (!terr.isWalkable(x, y)) return false;
      if (occ && occ[y * terr.width + x]) return false;
    }
  }
  return true;
}
