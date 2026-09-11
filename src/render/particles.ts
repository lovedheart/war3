/**
 * CPU particle system: impact sparks, blood, construction dust, explosions,
 * healing motes, blizzard snow and flame-strike fire.
 *
 * Pooled and allocation-free in steady state; the pool never grows past
 * `capacity` so a long match cannot leak. Particles are purely cosmetic and
 * therefore live entirely in the view layer (never hashed by the sim).
 */
import { hashStr, rand01 } from './palette.js';

export type ParticleKind =
  | 'spark' | 'blood' | 'dust' | 'smoke' | 'ember' | 'heal' | 'snow' | 'flame'
  | 'splash' | 'shadow' | 'frost';

export interface Particle {
  id: number;
  kind: ParticleKind;
  /** screen space */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds */
  life: number;
  ttl: number;
  size: number;
  rot: number;
  vrot: number;
  color: string;
  /** gravity in px/s^2 */
  grav: number;
  drag: number;
  fade: number;
  active: boolean;
}

export interface EmitOptions {
  count?: number;
  speed?: number;
  spread?: number;
  angle?: number;
  life?: number;
  size?: number;
  gravity?: number;
  drag?: number;
  colors?: string[];
  driftX?: number;
}

const KIND_DEFAULTS: Record<ParticleKind, Required<EmitOptions>> = {
  spark: { count: 6, speed: 150, spread: 1.6, angle: -Math.PI / 2, life: 0.28, size: 2.4, gravity: 320, drag: 1.4, colors: ['#fff6c8', '#ffd45e', '#ff9a3c'], driftX: 0 },
  blood: { count: 7, speed: 110, spread: 1.9, angle: -Math.PI / 2, life: 0.45, size: 3, gravity: 460, drag: 0.7, colors: ['#8e1b1b', '#c02b2b', '#e0524f'], driftX: 0 },
  dust: { count: 5, speed: 45, spread: 2.4, angle: -Math.PI / 2, life: 0.7, size: 5, gravity: -18, drag: 1.9, colors: ['#cbb98d', '#a89268', '#e0d3ae'], driftX: 0 },
  smoke: { count: 4, speed: 30, spread: 2.6, angle: -Math.PI / 2, life: 1.1, size: 8, gravity: -34, drag: 1.5, colors: ['#6b6b6b', '#8a8a8a', '#4a4a4a'], driftX: 0 },
  ember: { count: 8, speed: 90, spread: 3.14, angle: -Math.PI / 2, life: 0.8, size: 3, gravity: -60, drag: 1.1, colors: ['#ff8a3c', '#ffd45e', '#ff5a1e'], driftX: 0 },
  heal: { count: 6, speed: 34, spread: 1.2, angle: -Math.PI / 2, life: 0.9, size: 3, gravity: -46, drag: 1.2, colors: ['#bff0c8', '#7ee07e', '#ffffff'], driftX: 0 },
  snow: { count: 10, speed: 22, spread: 1.1, angle: Math.PI / 2, life: 2.2, size: 2.6, gravity: 26, drag: 0.4, colors: ['#ffffff', '#dff2ff', '#bfe0ff'], driftX: 12 },
  flame: { count: 9, speed: 70, spread: 1.0, angle: -Math.PI / 2, life: 0.6, size: 6, gravity: -110, drag: 1.2, colors: ['#ffd45e', '#ff8a3c', '#c03a10'], driftX: 0 },
  splash: { count: 8, speed: 120, spread: 3.14, angle: 0, life: 0.35, size: 2.6, gravity: 300, drag: 1.0, colors: ['#8fc6e8', '#dff2ff', '#3f7fae'], driftX: 0 },
  shadow: { count: 5, speed: 60, spread: 3.14, angle: 0, life: 0.5, size: 4, gravity: 40, drag: 1.6, colors: ['#3a2e44', '#5a4a6a', '#1a1020'], driftX: 0 },
  frost: { count: 7, speed: 80, spread: 2.2, angle: -Math.PI / 2, life: 0.5, size: 3, gravity: 120, drag: 1.2, colors: ['#dff2ff', '#8fd0ff', '#ffffff'], driftX: 0 },
};

export class ParticleSystem {
  readonly capacity: number;
  private pool: Particle[] = [];
  private cursor = 0;
  private clock = 0;
  /** particles currently alive (indices into pool) */
  private alive: number[] = [];
  private nextId = 1;
  /** peak simultaneous live particles — used by the leak test */
  peak = 0;
  emitted = 0;

  constructor(capacity = 1024) {
    this.capacity = Math.max(16, capacity | 0);
    for (let i = 0; i < this.capacity; i++) {
      this.pool.push({
        id: 0, kind: 'spark', x: 0, y: 0, vx: 0, vy: 0, life: 0, ttl: 0,
        size: 1, rot: 0, vrot: 0, color: '#fff', grav: 0, drag: 1, fade: 1, active: false,
      });
    }
  }

  get live(): number { return this.alive.length; }

  /** Deterministic pseudo-random per (kind, seedKey) so replays look identical. */
  private rnd(seedKey: number, salt: number): number {
    return rand01(seedKey, salt);
  }

  emit(kind: ParticleKind, x: number, y: number, opts: EmitOptions = {}): void {
    const d = KIND_DEFAULTS[kind];
    const count = Math.max(1, Math.min(64, opts.count ?? d.count));
    const colors = opts.colors ?? d.colors;
    const seedKey = hashStr(kind) ^ ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
    for (let i = 0; i < count; i++) {
      const p = this.obtain();
      if (!p) return; // pool exhausted: drop silently rather than allocate
      const r1 = this.rnd(seedKey, i * 3 + 1);
      const r2 = this.rnd(seedKey, i * 3 + 2);
      const r3 = this.rnd(seedKey, i * 3 + 3);
      const ang = (opts.angle ?? d.angle) + (r1 - 0.5) * (opts.spread ?? d.spread);
      const spd = (opts.speed ?? d.speed) * (0.55 + r2 * 0.9);
      p.kind = kind;
      p.x = x + (r3 - 0.5) * 6;
      p.y = y + (this.rnd(seedKey, i * 7 + 11) - 0.5) * 5;
      p.vx = Math.cos(ang) * spd + (opts.driftX ?? d.driftX);
      p.vy = Math.sin(ang) * spd;
      p.ttl = (opts.life ?? d.life) * (0.7 + r2 * 0.6);
      p.life = p.ttl;
      p.size = (opts.size ?? d.size) * (0.6 + r3 * 0.9);
      p.grav = opts.gravity ?? d.gravity;
      p.drag = opts.drag ?? d.drag;
      p.color = colors[(i + ((r1 * 97) | 0)) % colors.length];
      p.rot = r1 * Math.PI * 2;
      p.vrot = (r2 - 0.5) * 6;
      p.fade = 1;
      p.id = this.nextId++;
      this.emitted++;
    }
  }

  /** Advance all live particles. dt in seconds. */
  update(dt: number): void {
    this.clock += dt;
    let w = 0;
    for (let i = 0; i < this.alive.length; i++) {
      const idx = this.alive[i];
      const p = this.pool[idx];
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      const damp = 1 / (1 + p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.fade = p.life / p.ttl;
      this.alive[w++] = idx;
    }
    this.alive.length = w;
    if (this.alive.length > this.peak) this.peak = this.alive.length;
  }

  clear(): void {
    for (const idx of this.alive) this.pool[idx].active = false;
    this.alive.length = 0;
  }

  /** Iterate live particles for drawing (read-only). */
  forEach(fn: (p: Readonly<Particle>) => void): void {
    for (let i = 0; i < this.alive.length; i++) fn(this.pool[this.alive[i]]);
  }

  snapshot(): { live: number; peak: number; emitted: number; poolSize: number } {
    return { live: this.alive.length, peak: this.peak, emitted: this.emitted, poolSize: this.pool.length };
  }

  private obtain(): Particle | null {
    // Round-robin scan: O(1) amortised, never allocates.
    for (let n = 0; n < this.capacity; n++) {
      const idx = (this.cursor + n) % this.capacity;
      const p = this.pool[idx];
      if (!p.active) {
        this.cursor = (idx + 1) % this.capacity;
        p.active = true;
        this.alive.push(idx);
        return p;
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* damage floaters                                                     */
/* ------------------------------------------------------------------ */

export interface Floater {
  id: number;
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  ttl: number;
  color: string;
  size: number;
  crit: boolean;
  active: boolean;
}

export class FloaterLayer {
  private pool: Floater[] = [];
  private alive: number[] = [];
  private cursor = 0;
  private nextId = 1;
  peak = 0;

  constructor(private capacity = 128) { }

  get live(): number { return this.alive.length; }

  push(text: string, x: number, y: number, color: string, crit = false): void {
    let f: Floater | null = null;
    for (let n = 0; n < this.capacity; n++) {
      const idx = (this.cursor + n) % this.capacity;
      if (!this.pool[idx]?.active) {
        f = this.pool[idx] ?? (this.pool[idx] = blankFloater());
        this.cursor = (idx + 1) % this.capacity;
        f.active = true;
        this.alive.push(idx);
        break;
      }
    }
    if (!f) return;
    f.id = this.nextId++;
    f.text = text;
    f.x = x;
    f.y = y;
    f.vy = -34;
    f.ttl = crit ? 1.1 : 0.85;
    f.life = f.ttl;
    f.color = color;
    f.size = crit ? 17 : 13;
    f.crit = crit;
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.alive.length; i++) {
      const idx = this.alive[i];
      const f = this.pool[idx];
      f.life -= dt;
      if (f.life <= 0) { f.active = false; continue; }
      f.y += f.vy * dt;
      f.vy *= 1 / (1 + 1.6 * dt);
      this.alive[w++] = idx;
    }
    this.alive.length = w;
    if (this.alive.length > this.peak) this.peak = this.alive.length;
  }

  forEach(fn: (f: Readonly<Floater>) => void): void {
    for (let i = 0; i < this.alive.length; i++) fn(this.pool[this.alive[i]]);
  }

  clear(): void {
    for (const i of this.alive) this.pool[i].active = false;
    this.alive.length = 0;
  }

  stats(): { live: number; peak: number; poolSize: number } {
    return { live: this.alive.length, peak: this.peak, poolSize: this.pool.length };
  }
}

function blankFloater(): Floater {
  return { id: 0, text: '', x: 0, y: 0, vy: 0, life: 0, ttl: 1, color: '#fff', size: 12, crit: false, active: false };
}

/* ------------------------------------------------------------------ */
/* named emitters used by renderer/event wiring                        */
/* ------------------------------------------------------------------ */

export function emitHit(ps: ParticleSystem, x: number, y: number, attackType: string): void {
  switch (attackType) {
    case 'pierce': ps.emit('spark', x, y, { count: 5, colors: ['#fff6c8', '#dfe4ee'] }); break;
    case 'magic':
    case 'spell': ps.emit('shadow', x, y, { count: 6 }); ps.emit('spark', x, y, { count: 3, colors: ['#d8b6ff', '#ffffff'] }); break;
    case 'siege': ps.emit('ember', x, y, { count: 7 }); ps.emit('smoke', x, y, { count: 2 }); break;
    case 'chaos': ps.emit('flame', x, y, { count: 6 }); break;
    default: ps.emit('blood', x, y); break;
  }
}

export function emitDeath(ps: ParticleSystem, x: number, y: number, organic: boolean): void {
  if (organic) ps.emit('blood', x, y, { count: 14, speed: 150 });
  else ps.emit('smoke', x, y, { count: 6, size: 10 });
  ps.emit('dust', x, y, { count: 6 });
}

export function emitBuild(ps: ParticleSystem, x: number, y: number): void {
  ps.emit('dust', x, y, { count: 8, speed: 60 });
}

export function emitExplosion(ps: ParticleSystem, x: number, y: number): void {
  ps.emit('ember', x, y, { count: 16, speed: 190 });
  ps.emit('smoke', x, y, { count: 8, size: 12 });
  ps.emit('dust', x, y, { count: 10, speed: 110 });
}

export function emitHeal(ps: ParticleSystem, x: number, y: number): void {
  ps.emit('heal', x, y, { count: 8 });
}

export function emitBlizzard(ps: ParticleSystem, x: number, y: number): void {
  ps.emit('snow', x, y, { count: 14, size: 3 });
  ps.emit('frost', x, y, { count: 4 });
}

export function emitFlameStrike(ps: ParticleSystem, x: number, y: number): void {
  ps.emit('flame', x, y, { count: 16, speed: 110 });
  ps.emit('smoke', x, y, { count: 5, colors: ['#4a3a30', '#6b5a4a'] });
}
