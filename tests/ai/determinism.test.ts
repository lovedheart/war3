/**
 * Determinism with AI players: the AI must be a pure function of world state +
 * its own Rng stream. Same seed, same difficulty, same tick count ⇒ same hash.
 */
import { describe, it, expect } from 'vitest';
import { makeSim } from './harness.js';

function runAi(seed: number, ticks: number, diff: 'easy' | 'normal' | 'hard' = 'normal'): number {
  const sim = makeSim({ seed, difficulties: { 1: diff, 2: diff } });
  sim.run(ticks);
  return sim.game.stateHash();
}

describe('ai determinism', () => {
  it('same seed + normal AI twice => identical hash (3600 ticks)', () => {
    expect(runAi(7, 3600)).toBe(runAi(7, 3600));
  });

  it('reproducible across a longer soak with hard AI', () => {
    expect(runAi(13, 5400, 'hard')).toBe(runAi(13, 5400, 'hard'));
  });

  it('different seeds diverge under identical AI', () => {
    expect(runAi(7, 1800)).not.toBe(runAi(8, 1800));
  });
});
