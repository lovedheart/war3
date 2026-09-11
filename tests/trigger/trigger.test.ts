import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/sim/index.js';
import {
  createTriggerEngine,
  elapsed,
  goldAtLeast,
  unitCount,
  enemyNear,
  allOf,
  anyOf,
  announce,
  attackMoveAll,
  describeTriggers,
  type TriggerCtx,
} from '../../src/trigger/index.js';

const PLAYERS = [
  { id: 1, race: 'human' as const, name: 'P1' },
  { id: 2, race: 'orc' as const, name: 'P2' },
];

function game(seed = 5) {
  return createGame({ seed, size: 64, players: PLAYERS });
}

function ctxFor(g: ReturnType<typeof game>, sink: Command_[]): TriggerCtx {
  return {
    game: g,
    command: (c) => sink.push(c),
    say: () => {},
  };
}

type Command_ = Parameters<ReturnType<typeof game>['command']>[0];

describe('trigger conditions', () => {
  it('elapsed fires at the right tick', () => {
    const g = game();
    expect(elapsed(10).eval(ctxFor(g, []))).toBe(false);
    g.update(20);
    expect(elapsed(10).eval(ctxFor(g, []))).toBe(true);
  });

  it('goldAtLeast reads the player table', () => {
    const g = game();
    const c = ctxFor(g, []);
    expect(goldAtLeast(1, 100000).eval(c)).toBe(false);
    expect(goldAtLeast(1, 200).eval(c)).toBe(true); // P1 starts with 275 gold
  });

  it('unitCount counts by id and in total', () => {
    const g = game();
    g.update(2);
    const c = ctxFor(g, []);
    expect(unitCount(1, 1, 'peasant').eval(c)).toBe(true);
    expect(unitCount(1, 999, 'peasant').eval(c)).toBe(false);
    expect(unitCount(1, 1, 'footman').eval(c)).toBe(false);
  });

  it('combinators compose', () => {
    const g = game();
    g.update(2);
    const c = ctxFor(g, []);
    expect(allOf(elapsed(1), unitCount(1, 1, 'peasant')).eval(c)).toBe(true);
    expect(anyOf(elapsed(99999), unitCount(1, 1, 'peasant')).eval(c)).toBe(true);
    expect(allOf(elapsed(99999), unitCount(1, 1, 'peasant')).eval(c)).toBe(false);
  });

  it('enemyNear respects the fog (no information leak)', () => {
    const g = game(5);
    g.update(2);
    const c = ctxFor(g, []);
    // P2's starting peons are far away and unexplored at t0.
    const s = g.snapshot();
    const foe = s.units.find((u) => u.player === 2)!;
    expect(enemyNear(foe.x, foe.y, 12, 1).eval(c)).toBe(false);
  });
});

describe('trigger engine', () => {
  it('fires once and only once when once:true', () => {
    const g = game();
    const eng = createTriggerEngine();
    const said: string[] = [];
    eng.add({
      id: 'intro',
      once: true,
      when: [elapsed(1)],
      then: [{ describe: () => 'say', run: () => said.push('hi') }],
    });
    const ctx = { game: g, command: () => {}, say: () => {} };
    g.update(10);
    eng.step(ctx);
    for (let i = 0; i < 5; i++) {
      g.update(30);
      eng.step(ctx);
    }
    expect(said).toEqual(['hi']);
  });

  it('honours the evaluation period', () => {
    const g = game();
    const eng = createTriggerEngine();
    let runs = 0;
    eng.add({
      id: 'spam',
      period: 30,
      when: [elapsed(0)],
      then: [{ describe: () => 'x', run: () => runs++ }],
    });
    const ctx = { game: g, command: () => {}, say: () => {} };
    for (let i = 0; i < 60; i++) {
      g.update(1);
      eng.step(ctx);
    }
    expect(runs).toBeLessThanOrEqual(4); // 60 ticks / 30-period + first eval
    expect(runs).toBeGreaterThan(0);
  });

  it('actions that mutate go out as Commands only', () => {
    const g = game();
    g.update(60);
    const sent: Command_[] = [];
    // Give P1 something military so the action is not a no-op: promote a worker's
    // roster by training is slow, so order every unit incl. workers instead.
    const eng = createTriggerEngine();
    eng.add({ id: 'wave', when: [elapsed(1)], then: [attackMoveAll(1, { x: 32, y: 32 }, { includeWorkers: true })] });
    g.update(2);
    eng.step(ctxFor(g, sent));
    expect(sent.length).toBe(1);
    expect(sent[0].k).toBe('move');
    expect(JSON.parse(JSON.stringify(sent[0]))).toEqual(sent[0]); // plain JSON
    // The sim itself was untouched until the command was applied by a tick.
    const before = g.stateHash();
    g.command(sent[0]);
    g.update(1);
    expect(g.stateHash()).not.toBe(before);
  });

  it('is deterministic across identical replays', () => {
    const run = () => {
      const g = game(11);
      const eng = createTriggerEngine();
      const log: string[] = [];
      eng.add({ id: 'a', when: [elapsed(30)], then: [announce('a')] });
      eng.add({ id: 'b', when: [allOf(elapsed(60), unitCount(1, 1, 'peasant'))], then: [announce('b')] });
      const ctx = { game: g, command: () => {}, say: (s: string) => log.push(`${g.world.tick}:${s}`) };
      for (let i = 0; i < 200; i++) {
        g.update(1);
        eng.step(ctx);
      }
      return { log, hash: g.stateHash() };
    };
    expect(run()).toEqual(run());
  });

  it('describeTriggers renders a readable script', () => {
    const eng = createTriggerEngine();
    eng.add({ id: 't1', when: [goldAtLeast(1, 500)], then: [announce('rich')] });
    const text = describeTriggers(eng);
    expect(text[0]).toContain('t1');
    expect(text[0]).toContain('p1.gold >= 500');
  });

  it('remove() stops further firing', () => {
    const g = game();
    const eng = createTriggerEngine();
    let n = 0;
    eng.add({ id: 'x', period: 1, when: [elapsed(0)], then: [{ describe: () => '', run: () => n++ }] });
    const ctx = { game: g, command: () => {}, say: () => {} };
    g.update(1);
    eng.step(ctx);
    eng.remove('x');
    for (let i = 0; i < 20; i++) {
      g.update(1);
      eng.step(ctx);
    }
    expect(n).toBe(1);
  });
});
