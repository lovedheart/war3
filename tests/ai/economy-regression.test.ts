/**
 * Economy regression lock (2026-08: AI silently never harvested wood and
 * never trained a combat unit; both must never regress).
 *
 *  (a) within 6000 ticks P1 must have TRAINED at least one combat unit —
 *      detected via a train command whose unit costs supply, or by the unit
 *      appearing in the snapshot;
 *  (b) P1 lumber must at some point exceed its starting value — proof the
 *      wood line actually delivered cargo.
 */
import { describe, it, expect } from 'vitest';
import { makeSim, resOf } from './harness.js';
import { getGameData } from '../../src/data/index.js';

const START_LUMBER = 50;

describe('ai economy regression lock', () => {
  it('normal AI trains >=1 combat unit and harvests wood within 6000 ticks', () => {
    const sim = makeSim({ seed: 7, difficulties: { 1: 'normal', 2: 'normal' } });
    const gd = getGameData();
    let lumberPeak = resOf(sim, 1).lumber;
    let trainedCombat = false;
    for (let t = 0; t < 6000; t++) {
      const before = sim.caps.length;
      sim.run(1);
      for (let i = before; i < sim.caps.length; i++) {
        const c = sim.caps[i].cmd as Record<string, unknown>;
        if (c.player === 1 && c.k === 'train') {
          const d = gd.units.get(c.unitId as string);
          if (d && d.cost.popUpkeep > 0 && d.cost.gold + d.cost.lumber > 75) trainedCombat = true;
        }
      }
      if (t % 50 === 0) lumberPeak = Math.max(lumberPeak, resOf(sim, 1).lumber);
    }
    // snapshot cross-check: any non-worker non-hero P1 unit counts too
    const s = sim.game.snapshot();
    const hasArmy = s.units.some((u) => u.player === 1 && u.id !== 'peasant' && !(gd.units.get(u.id)?.isHero ?? false));
    expect(trainedCombat || hasArmy, 'P1 trained no combat unit in 6000 ticks').toBe(true);
    expect(lumberPeak, `P1 lumber never exceeded start (${START_LUMBER}); peak was ${lumberPeak}`).toBeGreaterThan(START_LUMBER);
  }, 120_000);
});
