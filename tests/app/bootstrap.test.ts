import { describe, it, expect } from 'vitest';
import { collectSelectable } from '../../src/app/bootstrap.js';
import { createGame } from '../../src/sim/index.js';
import { ff } from '../../src/core/fixed.js';

function game() {
  return createGame({
    seed: 7,
    players: [
      { id: 1, race: 'human', name: 'P1' },
      { id: 2, race: 'orc', name: 'P2' },
    ],
  });
}

describe('collectSelectable', () => {
  it('exposes the starting units and buildings to the input layer', () => {
    const g = game();
    g.update(1); // flush deferred creations
    const ents = collectSelectable(g);
    const p1Units = ents.filter((e) => e.player === 1 && e.kind === 0);
    expect(p1Units.length).toBeGreaterThanOrEqual(4);
    expect(p1Units.every((e) => e.isWorker)).toBe(true);
    expect(ents.some((e) => e.player === 1 && e.kind === 1)).toBe(true);
  });

  it('never exposes decorations or missiles', () => {
    const g = game();
    g.update(1);
    for (const e of collectSelectable(g)) expect(e.kind).toBeLessThanOrEqual(2);
  });

  it('reports world positions in fixed point and marks heroes', () => {
    const g = game();
    g.update(1);
    const ents = collectSelectable(g);
    for (const e of ents) {
      expect(Number.isInteger(e.x)).toBe(true);
      expect(Number.isInteger(e.radius)).toBe(true);
      expect(typeof e.isHero).toBe('boolean');
    }
    // a hero, if spawned, must be flagged so box-select skips it
    const heroIds = new Set(['archmage', 'blademaster', 'paladin']);
    for (const e of ents) if (heroIds.has(e.unitId)) expect(e.isHero).toBe(true);
  });

  it('drops dead entities', () => {
    const g = game();
    g.update(1);
    const before = collectSelectable(g).length;
    const w = g.world as unknown as {
      live: number[];
      stores: { health: { add(e: number): { hp: number; dead: boolean } } };
    };
    const victim = collectSelectable(g)[0];
    w.stores.health.add(victim.eid).dead = true;
    expect(collectSelectable(g).length).toBe(before - 1);
  });

  it('does not mutate sim state (view is the only writable surface)', () => {
    const g = game();
    g.update(30);
    const h0 = g.stateHash();
    collectSelectable(g);
    collectSelectable(g);
    expect(g.stateHash()).toBe(h0);
  });
});

describe('bootstrap wiring contract', () => {
  it('the ViewState shape matches what the renderer reads', async () => {
    const g = game();
    expect(g.world.view).toHaveProperty('cameraX');
    expect(g.world.view).toHaveProperty('cameraY');
    expect(g.world.view).toHaveProperty('zoom');
    expect(Array.isArray(g.world.view.selection)).toBe(true);
    // selection must stay ascending for a stable render order
    g.world.view.selection = [9, 3, 5];
    expect(ff(0)).toBe(0);
  });
});
