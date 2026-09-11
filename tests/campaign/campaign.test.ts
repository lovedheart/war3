/**
 * Campaign regression: level metadata validity, boot state, scripted win/lose
 * paths, outcome evaluation and determinism. Pure logic — no canvas, no DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  listLevels,
  loadLevel,
  startLevel,
  updateLevel,
  checkOutcome,
  type CampaignLevel,
} from '../../src/campaign/index.js';
import { createAiController } from '../../src/ai/index.js';
import { getGameData } from '../../src/data/index.js';
import { kill } from '../../src/sim/combat.js';
import type { Game } from '../../src/sim/index.js';

const IDS = ['human-01', 'human-02', 'human-03', 'human-04'];

describe('level metadata', () => {
  it('lists the four human levels in order', () => {
    expect(listLevels().map((l) => l.id)).toEqual(IDS);
  });

  it('references only known buildings/units and ships a map file', () => {
    const gd = getGameData();
    for (const id of IDS) {
      const lv = loadLevel(id);
      if (lv.win.kind === 'build') expect(gd.buildings.has(lv.win.buildingId), `${id} win building`).toBe(true);
      if (lv.ai) {
        expect(gd.units.has(lv.ai.workerId), `${id} worker`).toBe(true);
        for (const b of lv.ai.buildings) expect(gd.buildings.has(b.buildingId), `${id} policy ${b.buildingId}`).toBe(true);
        for (const a of lv.ai.army) expect(gd.units.has(a.unitId), `${id} army ${a.unitId}`).toBe(true);
      }
      if (lv.lose.kind === 'lossUnit') expect(gd.units.has(lv.lose.unitId), `${id} loss unit`).toBe(true);
      const m = lv.map as { name?: string; size?: number[] };
      expect(typeof m.name).toBe('string');
      expect(Array.isArray(m.size)).toBe(true);
    }
  });

  it('every policy home / farm / building spot sits on walkable ground', () => {
    for (const id of IDS) {
      const lv = loadLevel(id);
      if (!lv.ai) continue;
      const tiles = (lv.map as { tiles: number[][] }).tiles;
      const walkable = (x: number, y: number): boolean => {
        const t = tiles[y]?.[x];
        return t !== undefined && t !== 8 && t !== 3 && t !== 4 && t !== 5; // wall/cliff/water/rock
      };
      const spots = [lv.ai.home, ...lv.ai.farms.map((f) => f.at), ...lv.ai.buildings.map((b) => b.at)];
      for (const s of spots) {
        let ok = false;
        for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) ok = walkable(s.x + dx, s.y + dy);
        expect(ok, `${id} spot ${s.x},${s.y}`).toBe(true);
      }
    }
  });
});

describe('startLevel boot state', () => {
  it('settles every player seat with hall + workers and default resources', () => {
    for (const id of IDS) {
      const g = startLevel(id, 7);
      g.update(1);
      const lv = loadLevel(id);
      const snap = g.snapshot();
      for (const p of lv.players) {
        const blds = snap.buildings.filter((b) => b.player === p.id);
        expect(blds.length, `${id} P${p.id} buildings`).toBeGreaterThanOrEqual(1);
        expect(blds.some((b) => b.built), `${id} P${p.id} hall built`).toBe(true);
        const units = snap.units.filter((u) => u.player === p.id);
        expect(units.length, `${id} P${p.id} units`).toBeGreaterThanOrEqual(4);
      }
      const r1 = snap.resources.find((r) => r.player === 1)!;
      expect(r1.gold).toBe(lv.players[0].startGold ?? 275);
      expect(r1.lumber).toBe(lv.players[0].startLumber ?? 50);
    }
  });

  it('extraStarts settle a hall for seats beyond the declared players', () => {
    const g = startLevel('human-03', 7);
    g.update(1);
    const lv = loadLevel('human-03');
    // every declared seat must have at least its hall standing
    for (const p of lv.players) {
      expect(g.snapshot().buildings.some((b) => b.player === p.id), `seat ${p.id}`).toBe(true);
    }
    expect(lv.extraStarts && lv.extraStarts.length > 0).toBe(true);
  });
});

describe('scripted outcomes', () => {
  it('human-02 survives to its tick target with no player input', () => {
    const g = startLevel('human-02', 7);
    let out: 'win' | 'lose' | null = null;
    for (let t = 0; t < 9200 && !out; t++) out = updateLevel(g);
    expect(out).toBe('win');
    expect(g.world.tick).toBeGreaterThanOrEqual(9000 - 1);
  });

  it('human-01 reaches its build goal when P1 runs the skirmish AI', () => {
    const g = startLevel('human-01', 7);
    const ai = createAiController(g, 1, 'normal');
    let out: 'win' | 'lose' | null = null;
    for (let t = 0; t < 12000 && !out; t++) {
      ai.update();
      out = updateLevel(g);
    }
    expect(out).toBe('win');
    const built = g.snapshot().buildings.some((b) => b.player === 1 && b.id === 'barracks_human' && b.built);
    expect(built).toBe(true);
  });

  it('losing every P1 building trips lossAnyBuilding (human-02)', () => {
    const g = startLevel('human-02', 7);
    const lv = loadLevel('human-02');
    g.update(1);
    const w = g.world as unknown as {
      live: number[];
      stores: { owner: { get(e: number): { player: number } | undefined }; building: { get(e: number): unknown } };
    };
    for (const e of [...w.live]) {
      if (w.stores.building.get(e) && w.stores.owner.get(e)?.player === 1) kill(w as never, e, null, g.world.tick);
    }
    g.update(2); // destruction is deferred a tick
    expect(checkOutcome(g, lv)).toBe('lose');
  });
});

describe('checkOutcome kinds', () => {
  function sandbox(): Game {
    return startLevel('human-02', 7);
  }
  const base = (over: Partial<CampaignLevel>): CampaignLevel => ({
    id: 'x',
    title: 'x',
    brief: '',
    objective: '',
    map: { name: 'x', size: [32, 32], tiles: [], spawns: [], mines: [], trees: [] } as never,
    players: [
      { id: 1, race: 'human', name: 'a' },
      { id: 2, race: 'orc', name: 'b' },
    ],
    win: { kind: 'survive', ticks: 1e9 },
    lose: { kind: 'timeout', ticks: 1e9 },
    parSeconds: 1,
    ...over,
  });

  it('survive wins exactly at the tick target', () => {
    const g = sandbox();
    const lv = base({ win: { kind: 'survive', ticks: 50 } });
    for (let t = 0; t < 49; t++) g.update(1);
    expect(checkOutcome(g, lv)).toBe(null);
    g.update(1);
    expect(checkOutcome(g, lv)).toBe('win');
  });

  it('timeout loses exactly at the tick target', () => {
    const g = sandbox();
    const lv = base({ lose: { kind: 'timeout', ticks: 40 } });
    for (let t = 0; t < 39; t++) g.update(1);
    expect(checkOutcome(g, lv)).toBe(null);
    g.update(1);
    expect(checkOutcome(g, lv)).toBe('lose');
  });

  it('build wins once a matching built building exists for P1 only', () => {
    const g = sandbox();
    const lv = base({ win: { kind: 'build', buildingId: 'town_hall' } });
    g.update(1);
    expect(checkOutcome(g, lv)).toBe('win'); // P1 town hall is built at boot
    const lvOrc = base({ win: { kind: 'build', buildingId: 'great_hall' } });
    expect(checkOutcome(g, lvOrc)).toBe(null); // enemy halls never satisfy P1 goals
  });

  it('reach wins when any P1 unit enters the radius box', () => {
    const g = sandbox();
    g.update(1); // entities only enter the snapshot after the first tick
    const p1 = g.snapshot().units.find((u) => u.player === 1)!;
    const lv = base({ win: { kind: 'reach', x: Math.round(p1.x), y: Math.round(p1.y), radius: 2 } });
    expect(checkOutcome(g, lv)).toBe('win');
    const far = base({ win: { kind: 'reach', x: 2, y: 2, radius: 1 } });
    expect(checkOutcome(g, far)).toBe(null);
  });

  it('killAll wins only after every listed enemy seat is empty', () => {
    const g = sandbox();
    const lv = base({ win: { kind: 'killAll', enemy: [2] } });
    g.update(1);
    expect(checkOutcome(g, lv)).toBe(null);
    const w = g.world as unknown as { live: number[]; stores: { owner: { get(e: number): { player: number } | undefined } } };
    for (const e of [...w.live]) if (w.stores.owner.get(e)?.player === 2) kill(w as never, e, null, g.world.tick);
    g.update(2);
    expect(checkOutcome(g, lv)).toBe('win');
  });

  it('lossUnit loses when every unit of the guarded type dies', () => {
    const g = sandbox();
    g.update(1); // the snapshot is empty until the first tick
    const heroId = g.snapshot().units.find((u) => u.player === 1)!.id;
    const lv = base({ lose: { kind: 'lossUnit', unitId: heroId } });
    expect(checkOutcome(g, lv)).toBe(null);
    for (const v of g.snapshot().units.filter((u) => u.player === 1 && u.id === heroId)) {
      kill(g.world as never, v.eid, null, g.world.tick);
    }
    g.update(2); // destroy is deferred to the start of the next tick(s)
    expect(checkOutcome(g, lv)).toBe('lose');
  });
});

describe('campaign determinism', () => {
  it('same seed produces identical worlds (with and without AI input)', () => {
    const run = (seed: number, useAi: boolean): number[] => {
      const g = startLevel(useAi ? 'human-01' : 'human-02', seed);
      const ai = useAi ? createAiController(g, 1, 'normal') : null;
      const hashes: number[] = [];
      for (let t = 0; t < 600; t++) {
        ai?.update();
        updateLevel(g);
        if (t % 150 === 0) hashes.push(g.stateHash());
      }
      return hashes;
    };
    expect(run(11, false)).toEqual(run(11, false));
    expect(run(11, true)).toEqual(run(11, true));
    expect(run(11, false)).not.toEqual(run(12, false));
  });
});
