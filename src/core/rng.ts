/**
 * Deterministic PRNG (xorshift128, 128-bit state).
 * Same seed => same sequence on every engine. Never use Math.random() in sim.
 */
import { Fixed, FP_SHIFT, FP_SCALE } from './fixed.js';

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    this.seed(seed >>> 0);
  }

  /** SplitMix32 seeding so nearby seeds decorrelate. */
  seed(seed: number): void {
    let z = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
      z = (z + 0x6d2b79f5) >>> 0;
      let t = z;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** Raw 32-bit unsigned. */
  nextU32(): number {
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = this.s0;
    t ^= t << 11;
    t ^= t >>> 8;
    this.s0 = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.s0;
  }

  /** Integer in [0, n). n <= 0 returns 0. */
  int(n: number): number {
    if (n <= 0) return 0;
    return this.nextU32() % n;
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    return lo + this.int(hi - lo + 1);
  }

  /** true with probability p (fixed-point 0..65536). */
  chance(p: Fixed): boolean {
    if (p <= 0) return false;
    if (p >= FP_SCALE) return true;
    return this.int(FP_SCALE) < p;
  }

  /** Weighted pick over a table of integer weights. Returns index or -1. */
  pick(weights: number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
    if (total <= 0) return -1;
    let r = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Snapshot / restore for replays and lockstep rollback. */
  save(): number[] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  restore(s: number[]): void {
    this.s0 = s[0];
    this.s1 = s[1];
    this.s2 = s[2];
    this.s3 = s[3];
  }
}

/** Compile-time constant probability helper in fixed point. */
export function pct(x: number): Fixed {
  return Math.round((x * FP_SCALE) / 100) | 0;
}

export { FP_SHIFT };
