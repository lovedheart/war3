/**
 * Difficulty monotonicity: on the same map, hard AI must not be *worse* than
 * normal, normal not worse than easy — measured by a robust composite of army
 * population + built structures over a 6000-tick match. Deliberately loose
 * (a few points of slack) so natural variance doesn't flip the assertion; if
 * it fails, that is a real inversion and should be reported, not thresholded
 * away.
 */
import { describe, it, expect } from 'vitest';
import { makeSim } from './harness.js';
import { getGameData } from '../../src/data/index.js';

const WORKERS = new Set(['peasant', 'peon']);

function power(sim: ReturnType<typeof makeSim>, player: number): number {
  const s = sim.game.snapshot();
  const gd = getGameData();
  let pop = 0;
  for (const u of s.units) {
    if (u.player !== player || WORKERS.has(u.id)) continue;
    pop += gd.units.get(u.id)?.cost.popUpkeep ?? 1;
  }
  const built = s.buildings.filter((b) => b.player === player && b.built).length;
  return pop + built;
}

function runMatch(diff: 'easy' | 'normal' | 'hard'): { p1: number; p2: number } {
  // Mirror matchup: P1 vs P2 same difficulty, same seed. Average both seats to
  // cancel positional asymmetry of the generated map.
  const sim = makeSim({ seed: 77, difficulties: { 1: diff, 2: diff } });
  sim.run(6000);
  return { p1: power(sim, 1), p2: power(sim, 2) };
}

describe('ai difficulty monotonicity', () => {
  it('hard >= normal >= easy on composite score (both seats averaged)', () => {
    const e = runMatch('easy');
    const n = runMatch('normal');
    const h = runMatch('hard');
    const avg = (m: { p1: number; p2: number }) => (m.p1 + m.p2) / 2;
    const data = { easy: avg(e), normal: avg(n), hard: avg(h) };
    // Slack of 4 points absorbs per-seat noise without hiding real regressions.
    expect(data.hard, JSON.stringify(data)).toBeGreaterThanOrEqual(data.normal - 4);
    expect(data.normal, JSON.stringify(data)).toBeGreaterThanOrEqual(data.easy - 4);
  }, 120_000);
});
