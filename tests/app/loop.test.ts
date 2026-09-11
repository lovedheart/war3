import { describe, it, expect } from 'vitest';
import { FixedStepLoop, type LoopHooks } from '../../src/app/loop.js';
import { TICK_RATE } from '../../src/core/constants.js';

function recorder(): { hooks: LoopHooks; ticks: number[]; alphas: number[] } {
  const ticks: number[] = [];
  const alphas: number[] = [];
  return {
    ticks,
    alphas,
    hooks: { update: (n) => ticks.push(n), render: (a) => alphas.push(a) },
  };
}

describe('FixedStepLoop', () => {
  it('defaults to the sim tick rate', () => {
    const r = recorder();
    expect(new FixedStepLoop(r.hooks).tickRate).toBe(TICK_RATE);
    expect(new FixedStepLoop(r.hooks).stats.ticks).toBe(0);
  });

  it('runs exactly one tick per tick-period of real time', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.advance(1000 / 30);
    expect(r.ticks).toEqual([1]);
    expect(loop.stats.ticks).toBe(1);
  });

  it('accumulates sub-tick frames without ticking', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.advance(5);
    loop.advance(5);
    expect(r.ticks).toEqual([]);
    expect(loop.stats.ticks).toBe(0);
    // still renders every frame so motion stays smooth
    expect(r.alphas.length).toBe(2);
  });

  it('catches up multiple ticks in one long frame', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.advance(100); // 3 ticks at 30 Hz
    expect(r.ticks.reduce((a, b) => a + b, 0)).toBe(3);
    expect(loop.stats.ticks).toBe(3);
  });

  it('caps catch-up and drops the backlog instead of stalling', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.setMaxCatchUpTicks(2);
    loop.advance(10_000); // a backgrounded tab returning after 10 s
    expect(r.ticks).toEqual([2]);
    // The backlog is dropped rather than banked, so the *next* frame ticks at
    // its normal rate instead of also running at the cap.
    loop.setMaxCatchUpTicks(30);
    let guard = 0;
    while (r.ticks.length < 7 && guard++ < 20) loop.advance(1000 / 30);
    // every post-catch-up frame ticks exactly once: nothing was banked
    expect(new Set(r.ticks.slice(1))).toEqual(new Set([1]));
    expect(r.ticks.length).toBeGreaterThanOrEqual(7);
  });

  it('reports alpha as progress toward the next tick', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    const period = 1000 / 30;
    loop.advance(period * 2.5);
    expect(r.ticks).toEqual([2]);
    expect(loop.alpha).toBeCloseTo(0.5, 5);
    expect(r.alphas[r.alphas.length - 1]).toBeCloseTo(0.5, 5);
  });

  it('alpha never exceeds 1', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.setMaxCatchUpTicks(1000);
    loop.advance(500);
    expect(loop.alpha).toBeLessThanOrEqual(1);
    for (const a of r.alphas) expect(a).toBeGreaterThanOrEqual(0);
  });

  it('ignores non-finite and negative real time', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.advance(NaN);
    loop.advance(-100);
    expect(r.ticks).toEqual([]);
    expect(r.alphas.length).toBe(2); // still draws
  });

  it('renders exactly once per advance()', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    for (let i = 0; i < 40; i++) loop.advance(16.7);
    expect(r.alphas.length).toBe(40);
  });

  it('setPaused suppresses both update and render', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    loop.setPaused(true);
    loop.advance(1000);
    expect(r.ticks).toEqual([]);
    expect(r.alphas).toEqual([]);
    expect(loop.isPaused).toBe(true);
    loop.setPaused(false);
    loop.advance(100);
    expect(r.ticks.length).toBeGreaterThan(0);
  });

  it('rejects a non-positive tick rate', () => {
    const r = recorder();
    expect(() => new FixedStepLoop(r.hooks, 0)).toThrow();
  });

  it('computes fps and tps over a one-second window', () => {
    const r = recorder();
    const loop = new FixedStepLoop(r.hooks, 30);
    // stop just short of the one-second window rollover, which resets counters
    for (let i = 0; i < 59; i++) loop.advance(16.6667);
    const s = loop.stats;
    expect(s.fps).toBeGreaterThan(55);
    expect(s.fps).toBeLessThanOrEqual(61);
    expect(s.tps).toBeGreaterThan(20);
    expect(s.ticks).toBeGreaterThan(0);
  });
});
