/**
 * Determinism + soak regression.
 *
 * The sim must be bit-reproducible: same seed, same tick count ⇒ same state
 * hash. A divergence here means a floating-point leak, an unordered iteration,
 * or a Map/Set walk feeding gameplay order — all of which would break replays
 * and lockstep. Soak ticks also catch stalls (infinite loops inside a system).
 */
import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/sim/index.js';

const PLAYERS = [
  { id: 1, race: 'human' as const, name: 'P1' },
  { id: 2, race: 'orc' as const, name: 'P2' },
];

function run(seed: number, ticks: number): number {
  const g = createGame({ seed, players: PLAYERS });
  g.update(ticks);
  return g.stateHash();
}

describe('determinism', () => {
  it('same seed + same ticks => identical hash', () => {
    expect(run(7, 900)).toBe(run(7, 900));
  });

  it('stays reproducible over a longer soak', () => {
    expect(run(31, 3000)).toBe(run(31, 3000));
  });

  it('different seeds diverge', () => {
    expect(run(7, 900)).not.toBe(run(8, 900));
  });

  it('command stream is reproducible', () => {
    const play = (seed: number) => {
      const g = createGame({ seed, players: PLAYERS });
      for (let t = 0; t < 600; t++) {
        if (t === 60) g.command({ k: 'upkeep', player: 1, mode: 0 });
        if (t === 120) g.command({ k: 'move', player: 1, units: [], to: { x: 65536 * 40, y: 65536 * 40 }, mode: 'attackMove' });
        g.update(1);
      }
      return g.stateHash();
    };
    expect(play(11)).toBe(play(11));
  });
});

describe('soak', () => {
  it('3000 ticks complete without stalling and keep entities alive', () => {
    const g = createGame({ seed: 5, players: PLAYERS });
    const t0 = Date.now();
    g.update(3000);
    const ms = Date.now() - t0;
    expect(g.world.tick).toBe(3000);
    expect(ms).toBeLessThan(20000); // ~100x realtime on this box
    const s = g.snapshot();
    expect(s.units.length).toBeGreaterThan(0);
    expect(s.buildings.length).toBeGreaterThanOrEqual(2);
  });

  it('workers actually gather resources (regression: idle-harvest bug)', () => {
    const g = createGame({ seed: 5, players: PLAYERS });
    const before = g.snapshot().resources.map((r) => r.gold + r.lumber);
    g.update(1800); // 60 s
    const after = g.snapshot().resources.map((r) => r.gold + r.lumber);
    // at least one side must have net-gained beyond its starting stock
    expect(after.some((v, i) => v > before[i])).toBe(true);
  });
});
