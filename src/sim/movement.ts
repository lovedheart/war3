/**
 * Movement & collision system.
 *
 * Order of operations per tick (this ordering is load-bearing for determinism):
 *   1. orders  → desired velocity (target selection, chase, path follow)
 *   2. integrate position with velocity
 *   3. terrain clamp (cliffs / unwalkable push-out)
 *   4. pairwise separation (soft collision, mass-weighted)
 *   5. building footprint hard-block
 *
 * Units never teleport: separation only nudges, so a blocked unit stalls rather
 * than tunneling — same as WC3's "unit collision" behaviour.
 */
import { Fixed, ff, fn, fmul, fsqrt, fdiv, fi } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import { CHASE_LEASH, ACQUIRE_EXTRA, DEFAULT_ATTACK_POINT } from '../core/constants.js';
import { advance, ordersOf } from './orders.js';

const DT = ff(1) / 30; // one tick in seconds, fixed

interface S {
  transform: { get(e: Eid): { x: Fixed; y: Fixed; radius: Fixed; facing: number; w: number; h: number } | undefined };
  movement: { get(e: Eid): { speed: Fixed; vx: Fixed; vy: Fixed; fly: boolean; mass: Fixed; ox: Fixed; oy: Fixed; turnRate: number } | undefined };
  kind: { get(e: Eid): { kind: number } | undefined };
  owner: { get(e: Eid): { player: number } | undefined };
  damage: { get(e: Eid): { range: Fixed; cooldown: Fixed; attackPoint: Fixed } | undefined };
  attack: { get(e: Eid): { cooldownLeft: number; target: number; approaching: boolean } | undefined };
  health: { get(e: Eid): { dead: boolean; hp: Fixed } | undefined };
  building: { get(e: Eid): { built: boolean; buildingId: string; progress: number } | undefined };
}
const S = (w: World) => w.stores as unknown as S;

export function moveSystem(w: World, _tick: number): void {
  const s = S(w);
  const terr = w.terrain;

  // ---- phase A/B: desired velocity + integrate -------------------------
  for (const e of w.live) {
    const t = s.transform.get(e as Eid);
    if (!t) continue;
    const m = s.movement.get(e as Eid);
    if (!m) continue;
    if (s.health.get(e as Eid)?.dead) {
      m.vx = 0;
      m.vy = 0;
      continue;
    }
    const o = ordersOf(w, e as Eid);
    if (!o) continue;
    let dx = 0;
    let dy = 0;
    switch (o.current.kind) {
      case 'move':
      case 'attackMove':
      case 'patrol':
      case 'follow': {
        dx = o.current.tx - t.x;
        dy = o.current.ty - t.y;
        break;
      }
      case 'attack': {
        const tgt = o.current.targetEid;
        const tt = tgt !== 0xffffffff ? s.transform.get(tgt) : undefined;
        if (!tt || s.health.get(tgt)?.dead) {
          if (!advance(o)) o.current.kind = 'none';
          break;
        }
        const rng = s.damage.get(e as Eid)?.range ?? ff(1);
        const ddx = tt.x - t.x;
        const ddy = tt.y - t.y;
        const need = rng + t.radius + tt.radius;
        if (fmul(ddx, ddx) + fmul(ddy, ddy) > fmul(need, need)) {
          dx = ddx;
          dy = ddy;
        } else {
          m.vx = 0;
          m.vy = 0;
        }
        break;
      }
      case 'harvest':
      case 'build':
      case 'return': {
        const tt = s.transform.get(o.current.targetEid);
        if (tt) {
          const rng = ff(1.2);
          const ddx = tt.x - t.x;
          const ddy = tt.y - t.y;
          if (fmul(ddx, ddx) + fmul(ddy, ddy) > fmul(rng, rng)) {
            dx = ddx;
            dy = ddy;
          }
        }
        break;
      }
      default:
        break;
    }
    if (dx !== 0 || dy !== 0) {
      const len = fsqrt(fmul(dx, dx) + fmul(dy, dy));
      if (len > 0) {
        m.vx = fdiv(fmul(dx, m.speed), len);
        m.vy = fdiv(fmul(dy, m.speed), len);
        t.facing = angleSteps(dx, dy);
      }
    } else if (o.current.kind === 'move' && Math.abs(o.current.tx - t.x) < ff(0.15) && Math.abs(o.current.ty - t.y) < ff(0.15)) {
      m.vx = 0;
      m.vy = 0;
      if (!advance(o)) o.current.kind = 'none';
    } else {
      m.vx = 0;
      m.vy = 0;
    }
    t.x += fmul(m.vx, DT);
    t.y += fmul(m.vy, DT);
  }

  // ---- phase C: terrain clamp ------------------------------------------
  if (terr) {
    for (const e of w.live) {
      const m = s.movement.get(e as Eid);
      if (!m || m.fly) continue;
      const t = s.transform.get(e as Eid);
      if (!t) continue;
      const tx = Math.floor(fn(t.x));
      const ty = Math.floor(fn(t.y));
      if (!terr.isWalkable(tx, ty)) {
        // push back along velocity, then try axis-aligned slide
        t.x -= fmul(m.vx, DT);
        t.y -= fmul(m.vy, DT);
        const tx2 = Math.floor(fn(t.x));
        const ty2 = Math.floor(fn(t.y));
        if (!terr.isWalkable(tx2, ty2)) {
          if (terr.isWalkable(tx2 + 1, ty2)) t.x = ff(tx2 + 1) + ff(0.5);
          else if (terr.isWalkable(tx2 - 1, ty2)) t.x = ff(tx2 - 1) + ff(0.5);
          else if (terr.isWalkable(tx2, ty2 + 1)) t.y = ff(ty2 + 1) + ff(0.5);
          else if (terr.isWalkable(tx2, ty2 - 1)) t.y = ff(ty2 - 1) + ff(0.5);
          else {
            t.x = o_anchor_x(w, e as Eid, t);
            t.y = o_anchor_y(w, e as Eid, t);
            m.vx = 0;
            m.vy = 0;
          }
        }
      }
    }
  }

  // ---- phase D: pairwise separation ------------------------------------
  const quad = w.quad;
  if (quad) {
    const out: number[] = [];
    for (const e of w.live) {
      const t = s.transform.get(e as Eid);
      if (!t) continue;
      if (s.building.get(e as Eid)) continue; // buildings are static blockers
      const r = t.radius + ff(0.5);
      out.length = 0;
      quad.query(t.x, t.y, r, out);
      let ox = 0;
      let oy = 0;
      for (const other of out) {
        if (other <= e) continue; // each pair once
        if (s.building.get(other as Eid)) continue;
        const ot = s.transform.get(other as Eid);
        if (!ot) continue;
        const gap = t.radius + ot.radius;
        let ddx = t.x - ot.x;
        let ddy = t.y - ot.y;
        let d2 = fmul(ddx, ddx) + fmul(ddy, ddy);
        if (d2 >= fmul(gap, gap) || d2 === 0) continue;
        const d = fsqrt(d2);
        const overlap = gap - d;
        const nx = fdiv(ddx, d);
        const ny = fdiv(ddy, d);
        const om = s.movement.get(other as Eid)?.mass ?? fi(1);
        const share = fdiv(om, om + (s.movement.get(e as Eid)?.mass ?? fi(1)));
        ox += fmul(nx, fmul(overlap, share));
        oy += fmul(ny, fmul(overlap, share));
      }
      m_shift(s, e as Eid, ox, oy);
    }
  }
}

function m_shift(s: S, e: Eid, ox: Fixed, oy: Fixed): void {
  const t = s.transform.get(e);
  const m = s.movement.get(e);
  if (!t || !m) return;
  t.x += ox;
  t.y += oy;
  m.ox = ox;
  m.oy = oy;
}

function o_anchor_x(w: World, e: Eid, t: { x: Fixed }): Fixed {
  const o = ordersOf(w, e);
  return o && o.anchorX ? o.anchorX : t.x;
}
function o_anchor_y(w: World, e: Eid, t: { y: Fixed }): Fixed {
  const o = ordersOf(w, e);
  return o && o.anchorY ? o.anchorY : t.y;
}

/** atan2 replacement on fixed deltas -> trig steps (see core/geom). */
export function angleSteps(dx: Fixed, dy: Fixed): number {
  const a = Math.atan2(fn(dy), fn(dx));
  let deg = (a * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Math.round((deg * 4096) / 360) & 4095;
}

/** Distance helper used by several systems. */
export function dist(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  return fsqrt(fmul(ax - bx, ax - bx) + fmul(ay - by, ay - by));
}

export function withinLeash(o: { anchorX: Fixed; anchorY: Fixed }, x: Fixed, y: Fixed): boolean {
  if (!o.anchorX) return true;
  return dist(o.anchorX, o.anchorY, x, y) <= CHASE_LEASH + ACQUIRE_EXTRA;
}

export { DEFAULT_ATTACK_POINT };
