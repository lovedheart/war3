/**
 * Fixed-step main loop.
 *
 * The sim only ever advances in whole ticks at `TICK_RATE`; rendering happens
 * once per animation frame with an interpolation factor `alpha` in [0,1]
 * describing how far the next tick is from being reached. This keeps gameplay
 * deterministic (identical tick counts on every machine) while staying smooth.
 *
 * Deliberately DOM-free: `advance(realMs)` is public so tests can drive time by
 * hand, and `start()` merely wraps it in requestAnimationFrame when available.
 */
import { TICK_RATE } from '../core/constants.js';

export interface LoopHooks {
  /** advance the simulation by a whole number of ticks */
  update(dtTicks: number): void;
  /** draw one frame; alpha is the fraction of the way to the next tick */
  render(alpha: number): void;
}

export interface LoopStats {
  /** total sim ticks executed since construction */
  ticks: number;
  /** rendered frames per second over the last second */
  fps: number;
  /** sim ticks per second over the last second (should track TICK_RATE) */
  tps: number;
  /** milliseconds spent in update+render during the most recent advance() */
  frameMs: number;
}

/** A single real-time step may never simulate more than this many ticks. */
const DEFAULT_MAX_CATCH_UP_TICKS = 30; // == 1 second at 30 Hz

export class FixedStepLoop {
  private readonly hooks: LoopHooks;
  readonly tickRate: number;
  private readonly tickMs: number;
  private accumulator = 0;
  private maxCatchUpTicks: number;
  private running = false;
  private paused = false;
  private rafId = 0;
  private lastStamp = 0;

  private frames = 0;
  private ticksInWindow = 0;
  private windowMs = 0;
  private readonly statTicksTotal = { value: 0 };

  constructor(hooks: LoopHooks, tickRate: number = TICK_RATE) {
    if (!(tickRate > 0)) throw new Error('tickRate must be positive');
    this.hooks = hooks;
    this.tickRate = tickRate;
    this.tickMs = 1000 / tickRate;
    this.maxCatchUpTicks = DEFAULT_MAX_CATCH_UP_TICKS;
  }

  setMaxCatchUpTicks(n: number): void {
    this.maxCatchUpTicks = Math.max(1, n | 0);
  }

  get stats(): LoopStats {
    const win = this.windowMs > 0 ? this.windowMs : 1;
    return {
      ticks: this.statTicksTotal.value,
      fps: (this.frames * 1000) / win,
      tps: (this.ticksInWindow * 1000) / win,
      frameMs: this.lastFrameMs,
    };
  }

  private lastFrameMs = 0;

  /** Interpolation factor for the current accumulator (0 => just ticked). */
  get alpha(): number {
    return Math.min(1, this.accumulator / this.tickMs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastStamp = now();
    const step = (stamp: number) => {
      if (!this.running) return;
      const dt = stamp - this.lastStamp;
      this.lastStamp = stamp;
      this.advance(dt);
      this.rafId = schedule(step);
    };
    this.rafId = schedule(step);
  }

  stop(): void {
    this.running = false;
    if (this.rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Suspend ticking and rendering (tab hidden); the accumulator is kept. */
  setPaused(on: boolean): void {
    this.paused = on;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Advance real time. Runs as many whole ticks as fit, capped so that coming
   * back from a background tab does not try to simulate minutes at once, then
   * renders exactly one frame.
   */
  advance(realMs: number): void {
    const ms = Number.isFinite(realMs) && realMs > 0 ? realMs : 0;
    if (this.paused) return;
    const t0 = perfNow();
    this.windowMs += ms;
    this.frames++;

    this.accumulator += ms;
    let ticks = Math.floor(this.accumulator / this.tickMs);
    if (ticks > this.maxCatchUpTicks) {
      // Drop the excess rather than banking it: the sim must not stall the
      // renderer chasing a backlog, and dropping keeps every client in step.
      this.accumulator -= (ticks - this.maxCatchUpTicks) * this.tickMs;
      ticks = this.maxCatchUpTicks;
    }
    if (ticks > 0) {
      this.accumulator -= ticks * this.tickMs;
      this.hooks.update(ticks);
      this.statTicksTotal.value += ticks;
      this.ticksInWindow += ticks;
    }
    this.hooks.render(this.alpha);
    this.lastFrameMs = perfNow() - t0;

    if (this.windowMs >= 1000) {
      this.frames = 0;
      this.ticksInWindow = 0;
      this.windowMs = 0;
    }
  }
}

/* ---------------- environment shims (kept inside functions) ------------- */

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function perfNow(): number {
  return now();
}

function schedule(fn: (t: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return 0;
}
