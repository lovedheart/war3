/**
 * Command purity: every intent the AI emits must be a plain, JSON-safe Command
 * from the serialisable union (replays and lockstep depend on it). The harness
 * hook already throws on non-JSON payloads; here we additionally round-trip
 * every captured command through JSON and compare.
 */
import { describe, it, expect } from 'vitest';
import { makeSim, jsonSafe } from './harness.js';

describe('ai command purity', () => {
  it('every issued command is JSON round-trip identical', () => {
    const sim = makeSim({ seed: 21 });
    const seen = new Set<number>();
    for (let t = 0; t < 1800; t++) {
      sim.run(1);
      for (const u of sim.game.snapshot().units) seen.add(u.eid);
      for (const b of sim.game.snapshot().buildings) seen.add(b.eid);
    }
    expect(sim.caps.length).toBeGreaterThan(10); // AI actually did something
    for (const { cmd, tick } of sim.caps) {
      const bad = jsonSafe(cmd);
      expect(bad, `t=${tick} ${cmd.k}: ${bad}`).toBeNull();
      expect(JSON.parse(JSON.stringify(cmd)), `t=${tick} ${cmd.k} round-trip`).toEqual(cmd);
    }
  });

  it('commands never carry object references beyond plain data', () => {
    // A structural scan for functions anywhere in the command graph, done
    // independently of the JSON hook (catches getters / proxies).
    const sim = makeSim({ seed: 42 }, );
    sim.run(900);
    const walk = (v: unknown, path: string): string | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'function') return `${path}: function`;
      if (typeof v !== 'object') return null;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const e = walk(x, `${path}.${k}`);
        if (e) return e;
      }
      return null;
    };
    for (const { cmd } of sim.caps) expect(walk(cmd, '$')).toBeNull();
  });
});
