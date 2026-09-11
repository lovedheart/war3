/**
 * Replay: a recording (seed + players + commandLog) must reproduce the match
 * bit-for-bit, and playback must be seekable.
 */
import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/sim/index.js';
import { record, ReplayPlayer } from '../../src/app/replay.js';
import { createAiController } from '../../src/ai/index.js';

const PLAYERS = [
  { id: 1, race: 'human' as const, name: 'P1' },
  { id: 2, race: 'orc' as const, name: 'P2' },
];

describe('replay', () => {
  it('records every queued command with its tick', () => {
    const g = createGame({ seed: 7, size: 48, players: PLAYERS });
    for (let t = 0; t < 60; t++) g.update(1);
    const u = g.snapshot().units.find((x) => x.player === 1)!;
    g.command({ k: 'move', player: 1, units: [u.eid], to: { x: 10, y: 10 }, mode: 'move' });
    for (let t = 0; t < 30; t++) g.update(1);
    const rec = record(g);
    expect(rec.commands.length).toBeGreaterThanOrEqual(1);
    expect(rec.commands[rec.commands.length - 1].tick).toBe(61);
    // JSON-safe: survives a round trip untouched
    expect(JSON.parse(JSON.stringify(rec.commands[0]))).toEqual(rec.commands[0]);
  });

  it('replays an AI match to an identical state hash', () => {
    const g = createGame({ seed: 11, size: 64, players: PLAYERS });
    const ais = [createAiController(g, 1, 'normal'), createAiController(g, 2, 'normal')];
    for (let t = 0; t < 900; t++) {
      ais.forEach((a) => a.update());
      g.update(1);
    }
    const rec = record(g);
    const p = new ReplayPlayer(rec);
    p.seekTo(900);
    expect(p.game.stateHash()).toBe(g.stateHash());
  });

  it('seek rewinds and re-simulates to the same mid-match hash', () => {
    const g = createGame({ seed: 5, size: 48, players: PLAYERS });
    for (let t = 0; t < 400; t++) g.update(1);
    const rec = record(g);
    const p = new ReplayPlayer(rec);
    p.seekTo(400);
    const full = p.game.stateHash();
    p.seek(200);
    expect(p.tick).toBe(200);
    p.seekTo(400);
    expect(p.game.stateHash()).toBe(full);
  });
});
