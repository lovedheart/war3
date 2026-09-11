/**
 * Command-effect verification: the AI subscribes to the sim's failure log,
 * matches rejections against the commands it queued one tick earlier, and
 * parks the responsible key in `blockedUntil` so it stops hammering the same
 * failing order every plan tick.
 */
import { describe, expect, it } from 'vitest';
import { makeSim } from './harness.js';

const SEC = 30;

describe('command-effect verification', () => {
  it('flags a failing command and throttles retries of the same target', () => {
    const sim = makeSim({ seed: 11 });
    const game = sim.game;
    const ais = [...sim.ais.values()];
    const ai = ais[0] as unknown as {
      verifyStats: { issued: number; checked: number; failed: number; unattributed: number };
      blockedUntil: Map<string, number>;
      issue(cmd: unknown): boolean;
    };
    // A harvest aimed at a nonexistent source fails every time it is applied.
    const bogus = { k: 'harvest', player: 1, worker: 0x7fc00000, target: 0x7fc00000, kind: 'gold' };
    let attempts = 0;
    for (let t = 0; t < 600; t++) {
      if (t % 20 === 0) {
        // simulate what assignWorkers would do on a persistent bad target
        const blocked = ai.blockedUntil.get(`harvest:${(0x7fc00000 >>> 0)}`);
        if (!blocked || blocked <= t) { ai.issue(bogus); attempts++; }
      }
      ais.forEach((a) => a.update());
      game.update(1);
    }
    expect(ai.verifyStats.failed).toBeGreaterThan(0);
    // blockedUntil backoff must have suppressed most of the 30 naive attempts
    expect(attempts).toBeLessThanOrEqual(6);
    void SEC;
  });

  it("does not blame our AI for another seat's failing commands", () => {
    // Only P1 runs an AI here; every injected failure belongs to P2, whose
    // rejections must be counted as unattributed, never parked on P1 keys.
    const sim = makeSim({ seed: 12, attach: [1] });
    const game = sim.game;
    const ai = [...sim.ais.values()][0] as unknown as {
      verifyStats: { failed: number; unattributed: number };
      blockedUntil: Map<string, number>;
    };
    // Baseline: how many failures P1's own AI hits naturally on this seed.
    sim.run(300);
    const base = ai.verifyStats.failed;
    for (let t = 0; t < 300; t++) {
      game.command({ k: 'train', player: 2, building: 0x7fc00000, unitId: 'grunt' });
      sim.run(1);
    }
    // The injected P2 failures must not add a single attribution to P1.
    expect(ai.verifyStats.failed).toBe(base);
    expect([...ai.blockedUntil.values()].every((v) => v <= game.world.tick)).toBe(true);
  });

  it('economy regression still holds with verification active', () => {
    const sim = makeSim({ seed: 7 });
    sim.run(9000);
    const game = sim.game;
    const snap = game.snapshot();
    const res = snap.resources.find((r) => r.player === 1)!;
    expect(res.lumber).toBeGreaterThan(0);
    const mil = snap.units.filter((u) => u.player === 1 && u.id !== 'peasant').length;
    expect(mil + snap.buildings.filter((b) => b.player === 1 && b.id === 'barracks_human').length).toBeGreaterThan(0);
  });
});
