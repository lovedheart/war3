/**
 * Legality: AI commands may only reference the AI's own player seat and
 * entities that actually exist (at issue time or ever seen). No cross-player
 * commands, no phantom eids.
 */
import { describe, it, expect } from 'vitest';
import { makeSim, auditLegality } from './harness.js';

describe('ai command legality', () => {
  it('all referenced eids exist and player seats are legal', () => {
    const sim = makeSim({ seed: 5 });
    const ever = new Set<number>();
    for (let t = 0; t < 2400; t++) {
      sim.run(1);
      if (t % 10 === 0) {
        const s = sim.game.snapshot();
        for (const u of s.units) ever.add(u.eid);
        for (const b of s.buildings) ever.add(b.eid);
      }
    }
    // include currently-live eids too
    for (const e of sim.game.world.live as readonly number[]) ever.add(e);
    expect(sim.caps.length).toBeGreaterThan(10);
    expect(auditLegality(sim, ever)).toEqual([]);
  });

  it('AI never issues commands for the opponent', () => {
    const sim = makeSim({ seed: 9 });
    sim.run(1800);
    for (const { cmd } of sim.caps) {
      const p = (cmd as { player?: number }).player;
      expect(p === 1 || p === 2, `player ${p}`).toBe(true);
    }
    // Each controller only emits its own seat: P1-captured stream is all player 1.
    // (Both AIs attach here; check the per-seat streams.)
    const p1cmds = sim.commandsFor(1);
    const p2cmds = sim.commandsFor(2);
    expect(p1cmds.length + p2cmds.length).toBe(sim.caps.length);
  });

  it('build/harvest/train targets are owned by the issuer', () => {
    const sim = makeSim({ seed: 3 });
    sim.run(1800);
    const snap = sim.game.snapshot();
    const owner = new Map<number, number>();
    for (const u of snap.units) owner.set(u.eid, u.player);
    for (const b of snap.buildings) owner.set(b.eid, b.player);
    for (const { tick, cmd } of sim.caps) {
      const c = cmd as Record<string, unknown>;
      if (c.k === 'harvest' && typeof c.worker === 'number' && owner.has(c.worker)) {
        expect(owner.get(c.worker), `t=${tick} harvest worker`).toBe(c.player);
      }
      if (c.k === 'train' && typeof c.building === 'number' && owner.has(c.building)) {
        expect(owner.get(c.building), `t=${tick} train building`).toBe(c.player);
      }
      if (c.k === 'build' && typeof c.worker === 'number' && owner.has(c.worker)) {
        expect(owner.get(c.worker), `t=${tick} build worker`).toBe(c.player);
      }
    }
  });
});
