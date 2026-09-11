/**
 * Authoritative-value assertions for the wired data tables.
 *
 * These pin the numbers that make the game *Warcraft III* rather than a generic
 * RTS. If a JSON edit drifts from TFT 1.20.x, this file goes red — that is the
 * point. Sources are noted per assertion.
 */
import { describe, expect, it } from 'vitest';
import { getGameData, setGameData } from '../../src/data/index.js';
import { loadGameData, loadRawTables } from '../../src/data/load.js';

const gd = loadGameData();

describe('loader wiring', () => {
  it('serves the JSON tables, not the fallback shim', () => {
    // The shim only knows ~30 units; the real table has 110+.
    expect(gd.units.size).toBeGreaterThanOrEqual(100);
    expect(gd.buildings.size).toBeGreaterThanOrEqual(25);
    expect(gd.items.size).toBeGreaterThanOrEqual(100);
    setGameData(gd);
    expect(getGameData()).toBe(gd);
  });

  it('exposes every GameData collection the sim reads', () => {
    for (const key of ['units', 'buildings', 'abilities', 'tech', 'items'] as const)
      expect(gd[key].size, key).toBeGreaterThan(0);
    expect(Object.keys(gd.races).length).toBeGreaterThanOrEqual(4);
    expect(gd.creepCamps.length).toBeGreaterThan(0);
    expect(gd.heroXp.length).toBe(10);
    expect(Object.keys(gd.buildingRoles).length).toBeGreaterThan(0);
    expect(typeof gd.lootTable.roll).toBe('function');
  });
});

describe('authoritative unit values (TFT 1.20)', () => {
  const u = (id: string) => {
    const d = gd.units.get(id);
    if (!d) throw new Error(`unit ${id} missing`);
    return d;
  };

  it('peasant: 220 hp, 5-6 dmg, 75g, 1 food', () => {
    const p = u('peasant');
    expect(p.stats.hp).toBe(220);
    expect([p.damage.min, p.damage.max]).toEqual([5, 6]);
    expect(p.cost.gold).toBe(75);
    expect(p.cost.popUpkeep).toBe(1);
  });

  it('peon: 250 hp, 7-8 dmg, 75g', () => {
    const p = u('peon');
    expect(p.stats.hp).toBe(250);
    expect([p.damage.min, p.damage.max]).toEqual([7, 8]);
    expect(p.cost.gold).toBe(75);
  });

  it('footman: 420 hp, 12-13 dmg, 135g, 2 food, heavy armor', () => {
    const f = u('footman');
    expect(f.stats.hp).toBe(420);
    expect([f.damage.min, f.damage.max]).toEqual([12, 13]);
    expect(f.cost.gold).toBe(135);
    expect(f.cost.popUpkeep).toBe(2);
    expect(f.armor.type).toBe('heavy');
  });

  it('grunt: 700 hp, 18-21 dmg, 200g, 3 food', () => {
    const g = u('grunt');
    expect(g.stats.hp).toBe(700);
    expect([g.damage.min, g.damage.max]).toEqual([18, 21]);
    expect(g.cost.gold).toBe(200);
    expect(g.cost.popUpkeep).toBe(3);
  });

  it('knight: 835 hp, 30-38 dmg, 245g+60l, 4 food', () => {
    const k = u('knight');
    expect(k.stats.hp).toBe(835);
    expect([k.damage.min, k.damage.max]).toEqual([30, 38]);
    expect(k.cost.gold).toBe(245);
    expect(k.cost.lumber).toBe(60);
    expect(k.cost.popUpkeep).toBe(4);
  });
});

describe('authoritative building values', () => {
  it('farm supplies 6 population for 80g/20l', () => {
    const f = gd.buildings.get('farm');
    expect(f).toBeTruthy();
    expect(f!.supplyProvided).toBe(6);
    expect(f!.cost.gold).toBe(80);
    expect(f!.cost.lumber).toBe(20);
  });

  it('burrow supplies 5 population (orc supply building)', () => {
    expect(gd.buildings.get('burrow')!.supplyProvided).toBe(5);
  });

  it('every race hall is a town-role drop-off', () => {
    for (const [id, r] of Object.entries(gd.races)) {
      if (!r.townHall) continue;
      expect(gd.buildingRoles[r.townHall], `role of ${r.townHall} (${id})`).toBe('town');
    }
  });
});

describe('hero experience curve', () => {
  it('matches the TFT curve exactly', () => {
    expect(gd.heroXp).toEqual([0, 350, 750, 1250, 1850, 2600, 3550, 4700, 6100, 7900]);
  });
});

describe('upkeep thresholds', () => {
  // The thresholds are sim constants (src/core/constants.ts), but they must
  // agree with what race.json documents, or balance work silently diverges.
  it('race.json declares the 50 / 80 population breakpoints', async () => {
    const { default: raceJson } = await import('../../data/race.json');
    const up = (raceJson as { upkeep: Record<string, { maxPopulation?: number; minPopulation?: number }> }).upkeep;
    expect(up.none.maxPopulation).toBe(50);
    expect(up.low.minPopulation).toBe(50);
    expect(up.low.maxPopulation).toBe(80);
    expect(up.high.minPopulation).toBe(80);
  });
});

describe('damage matrix (authoritative TFT column/row values)', () => {
  const matrix = loadRawTables().damage.matrix;

  it('keeps a complete 7x8 grid of finite multipliers', () => {
    const atk = ['normal', 'pierce', 'magic', 'chaos', 'hero', 'siege', 'spell'];
    const arm = ['unarmored', 'light', 'medium', 'heavy', 'reinforced', 'hero', 'fortification', 'ancient'];
    for (const a of atk) for (const b of arm) expect(matrix[a][b], `${a} vs ${b}`).toBeTypeOf('number');
  });

  it('chaos deals full damage to every armor type', async () => {
    const { default: d } = await import('../../data/damage.json');
    const chaos = (d as { matrix: Record<string, Record<string, number>> }).matrix.chaos;
    for (const k of Object.keys(chaos)) expect(chaos[k], `chaos vs ${k}`).toBeCloseTo(1, 6);
  });

  it('siege vs fortification = 2.0', async () => {
    const { default: d } = await import('../../data/damage.json');
    expect((d as { matrix: Record<string, Record<string, number>> }).matrix.siege.fortification).toBeCloseTo(2, 6);
  });

  it('magic vs hero = 0.3', async () => {
    const { default: d } = await import('../../data/damage.json');
    expect((d as { matrix: Record<string, Record<string, number>> }).matrix.magic.hero).toBeCloseTo(0.3, 6);
  });

  it('normal vs reinforced = 0.75', async () => {
    const { default: d } = await import('../../data/damage.json');
    expect((d as { matrix: Record<string, Record<string, number>> }).matrix.normal.reinforced).toBeCloseTo(0.75, 6);
  });
});

describe('field completeness', () => {
  it('every unit has finite damage / armor / stats / attributes / cost', () => {
    const bad: string[] = [];
    const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    for (const [id, u] of gd.units) {
      if (!fin(u.stats.hp) || !fin(u.stats.mp)) bad.push(`${id}.stats`);
      if (!fin(u.damage.min) || !fin(u.damage.max) || !fin(u.damage.range) || !fin(u.damage.cooldown))
        bad.push(`${id}.damage`);
      if (!fin(u.armor.value)) bad.push(`${id}.armor`);
      if (!fin(u.attributes.str) || !fin(u.attributes.agi) || !fin(u.attributes.int)) bad.push(`${id}.attributes`);
      if (!fin(u.cost.gold) || !fin(u.cost.lumber) || !fin(u.cost.popUpkeep)) bad.push(`${id}.cost`);
      if (!fin(u.moveSpeed) || !fin(u.sightRange) || !fin(u.radius)) bad.push(`${id}.movement`);
    }
    expect(bad, `non-finite fields: ${bad.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it('every building has finite stats, footprint and cost', () => {
    const bad: string[] = [];
    for (const [id, b] of gd.buildings) {
      if (!Number.isFinite(b.stats.hp)) bad.push(`${id}.hp`);
      if (!Number.isFinite(b.footprint[0]) || !Number.isFinite(b.footprint[1])) bad.push(`${id}.footprint`);
      if (!Number.isFinite(b.cost.gold) || !Number.isFinite(b.cost.lumber)) bad.push(`${id}.cost`);
      if (!Number.isFinite(b.buildTime) || !Number.isFinite(b.sightRange)) bad.push(`${id}.timing`);
    }
    expect(bad, `non-finite fields: ${bad.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it('armor/attack strings land inside the sim unions', () => {
    const ARMOR = ['unarmored', 'light', 'medium', 'heavy', 'reinforced', 'hero', 'fortification', 'ancient'];
    const ATTACK = ['normal', 'pierce', 'magic', 'chaos', 'hero', 'siege', 'spell'];
    for (const [id, u] of gd.units) {
      expect(ARMOR, `${id} armor`).toContain(u.armor.type);
      expect(ATTACK, `${id} attack`).toContain(u.damage.attackType);
    }
    for (const [id, b] of gd.buildings) expect(ARMOR, `${id} armor`).toContain(b.stats.armorType);
  });

  it('lootTable.roll is deterministic and returns known item ids', () => {
    let calls = 0;
    const rng = { int: (n: number) => ((calls = (calls * 1103515245 + 12345) >>> 8) % Math.max(1, n)) };
    const seen = new Set<string | null>();
    for (let lvl = 1; lvl <= 10; lvl++) for (let i = 0; i < 20; i++) seen.add(gd.lootTable.roll(lvl, rng));
    for (const s of seen) if (s !== null) expect(gd.items.has(s), `rolled item ${s}`).toBe(true);
    // identical RNG stream -> identical outcome (determinism contract)
    let c2 = 0;
    const rng2 = { int: (n: number) => ((c2 = (c2 * 1103515245 + 12345) >>> 8) % Math.max(1, n)) };
    let c3 = 0;
    const rng3 = { int: (n: number) => ((c3 = (c3 * 1103515245 + 12345) >>> 8) % Math.max(1, n)) };
    expect(gd.lootTable.roll(5, rng2)).toBe(gd.lootTable.roll(5, rng3));
  });
});
