/**
 * Replay playback.
 *
 * A recorded match is its seed, map size, player setup and the ordered
 * `world.commandLog` (tick + JSON-safe Command). Rebuilding a game with the
 * same seed and re-issuing each command at its tick reproduces the match bit
 * for bit — the sim is deterministic, so a replay needs no snapshots.
 */
import { createGame, type Game, type GameOptions } from '../sim/index.js';
import type { Command } from '../sim/commandTypes.js';

export interface ReplayRecording {
  seed: number;
  size?: number;
  players: GameOptions['players'];
  /** every command in queue order; `tick` is when it was queued */
  commands: { tick: number; cmd: Command }[];
}

/** Snapshot a live game into a portable, JSON-safe recording. */
export function record(game: Game): ReplayRecording {
  const opts = (game.world as unknown as { replayOpts?: { seed: number; size?: number; players: GameOptions['players'] } }).replayOpts;
  if (!opts) throw new Error('record: game was not created with replay metadata');
  return {
    seed: opts.seed,
    size: opts.size,
    players: opts.players,
    commands: (game.world as unknown as { commandLog: { tick: number; cmd: Command }[] }).commandLog.map((q) => ({ tick: q.tick, cmd: q.cmd })),
  };
}

/**
 * A running playback. `advance` feeds the recorded commands back at their
 * ticks; `seek` re-simulates from scratch (the sim has no snapshot restore).
 */
export class ReplayPlayer {
  readonly game: Game;
  private readonly rec: ReplayRecording;
  private cursor = 0;

  constructor(rec: ReplayRecording) {
    this.rec = rec;
    this.game = createGame({
      seed: rec.seed,
      size: rec.size,
      players: rec.players,
    });
  }

  /** current simulated tick of the playback */
  get tick(): number {
    return this.game.world.tick;
  }

  /** total ticks in the recording */
  get length(): number {
    return this.rec.commands.length ? this.rec.commands[this.rec.commands.length - 1].tick : 0;
  }

  /** advance by whole ticks, injecting each command at its recorded tick */
  advance(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      while (this.cursor < this.rec.commands.length && this.rec.commands[this.cursor].tick === this.game.world.tick + 1) {
        this.game.command(this.rec.commands[this.cursor++].cmd);
      }
      this.game.update(1);
    }
  }

  /** run to a specific absolute tick (idempotent while already past it) */
  seekTo(tick: number): void {
    while (this.game.world.tick < tick) this.advance(Math.min(600, tick - this.game.world.tick));
  }

  /** rewind and replay to a tick — the only way to go backwards */
  seek(tick: number): void {
    this.rebuild();
    this.seekTo(tick);
  }

  /** fresh game at tick 0 with the cursor reset */
  rebuild(): void {
    const fresh = createGame({ seed: this.rec.seed, size: this.rec.size, players: this.rec.players });
    (this as unknown as { game: Game }).game = fresh;
    this.cursor = 0;
  }
}
