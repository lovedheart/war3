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

/** How long a unit holds an obstacle-avoidance heading once it starts one. */
const RETREAT_TICKS = 10;

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
    // While a unit is walking round an obstacle it holds its retreat heading,
    // so it commits to the detour instead of re-aiming at the wall every tick.
    if (o.retreatTicks > 0 && (o.retreatX || o.retreatY)) {
      o.retreatTicks--;
      const rlen = fsqrt(fmul(o.retreatX, o.retreatX) + fmul(o.retreatY, o.retreatY));
      if (rlen) {
        m.vx = fdiv(fmul(o.retreatX, m.speed), rlen);
        m.vy = fdiv(fmul(o.retreatY, m.speed), rlen);
        t.facing = angleSteps(o.retreatX, o.retreatY);
        t.x += fmul(m.vx, DT);
        t.y += fmul(m.vy, DT);
        continue;
      }
      o.retreatTicks = 0;
    } else {
      o.retreatTicks = 0;
    }
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
        // A harvester alternates between its source and its drop-off; the
        // economy system steers by writing tx/ty, so walk toward tx/ty when it
        // is set and only fall back to the order target when it is not.
        const hasWaypoint = o.current.tx !== 0 || o.current.ty !== 0;
        const tt = hasWaypoint ? null : s.transform.get(o.current.targetEid);
        const wx = hasWaypoint ? o.current.tx : tt?.x ?? 0;
        const wy = hasWaypoint ? o.current.ty : tt?.y ?? 0;
        if (wx !== 0 || wy !== 0) {
          const rng = hasWaypoint ? ff(1.4) : ff(1.2);
          const ddx = wx - t.x;
          const ddy = wy - t.y;
          if (fmul(ddx, ddx) + fmul(ddy, ddy) > fmul(rng, rng)) {
            // Never steer into impassable ground: a worker beside a tree's
            // reserved tile would otherwise keep a velocity the terrain clamp
            // cancels every tick and vibrate in place forever.
            const step = steerAroundTerrain(terr, t, wx, wy, m.speed);
            dx = step.x;
            dy = step.y;
            // Commit to the detour: when we had to move away from the waypoint,
            // hold that heading for a stretch so we clear the obstacle instead
            // of turning straight back into it on the next tick.
            if (step.x * ddx + step.y * ddy < 0) {
              o.retreatX = step.x;
              o.retreatY = step.y;
              o.retreatTicks = RETREAT_TICKS;
            }
          } else if (hasWaypoint) {
            // arrived at the waypoint; clear it so the economy system can advance
            o.current.tx = 0;
            o.current.ty = 0;
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
          // Candidate slides. A naive slide snaps the unit onto a tile centre
          // that can sit on the side it was trying to leave, so the very next
          // tick walks it back into the blocked cell — an endless loop that
          // freezes the unit in place. Accept a candidate only when it lands on
          // walkable ground AND moves us away from where we started this tick.
          // Reference position: where we were at the START of this tick, before
          // phase B integrated the velocity. Slides are judged against this so a
          // candidate that merely retraces the blocked step is rejected.
          const sx = t.x;
          const sy = t.y;
          const ax = Math.abs(m.vx);
          const ay = Math.abs(m.vy);
          type Slide = { run: () => void; ok: () => boolean };
          const slideX = (dir: number): Slide => ({
            run: () => (t.x = ff(tx2 + dir) + ff(0.5)),
            ok: () => terr.isWalkable(tx2 + dir, ty2) && Math.abs(t.x - sx) >= ff(0.4),
          });
          const slideY = (dir: number): Slide => ({
            run: () => (t.y = ff(ty2 + dir) + ff(0.5)),
            ok: () => terr.isWalkable(tx2, ty2 + dir) && Math.abs(t.y - sy) >= ff(0.4),
          });
          // Order by how well each candidate agrees with the direction we are
          // actually heading, preferring the dominant axis. The old fixed order
          // could pick a slide that ran *against* the velocity, undoing itself
          // on the next tick and freezing the unit against a corner.
          const score = (sl: Slide): number => {
            const bx = t.x;
            const by = t.y;
            sl.run();
            const dx = t.x - bx;
            const dy = t.y - by;
            t.x = bx;
            t.y = by;
            return (dx === 0 ? 0 : (dx > 0 ? m.vx : -m.vx)) + (dy === 0 ? 0 : (dy > 0 ? m.vy : -m.vy));
          };
          const cands: Slide[] = ax >= ay ? [slideX(1), slideX(-1), slideY(1), slideY(-1)] : [slideY(1), slideY(-1), slideX(1), slideX(-1)];
          const scored = cands.map((sl) => ({ sl, s: score(sl) }));
          const seen = new Set<string>();
          const slides: Slide[] = [];
          for (const c of scored) {
            if (c.s <= 0 || seen.has(String(c.s))) continue;
            seen.add(String(c.s));
            slides.push(c.sl);
          }
          let nudged = false;
          for (const sl of slides) {
            const bx = t.x;
            const by = t.y;
            sl.run();
            const fx = Math.floor(fn(t.x));
            const fy = Math.floor(fn(t.y));
            if (!terr.isWalkable(fx, fy) || !sl.ok()) {
              t.x = bx;
              t.y = by;
              continue;
            }
            nudged = true;
            break;
          }
          if (!nudged) {
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


/**
 * Direction toward (wx,wy) with the component that would push us into
 * impassable ground dropped. Keeps workers from pinning against tree tiles and
 * cliff corners, where the terrain clamp would otherwise cancel all motion.
 */
/**
 * Direction toward (wx,wy) with any component that would push us into
 * impassable ground dropped, so a unit never grinds against a wall. Without
 * this a worker beside a tree's reserved tile keeps a full velocity that the
 * terrain clamp cancels every tick, freezing it in place forever.
 */
/**
 * Direction toward (wx,wy) that does not aim straight into a wall. A unit whose
 * target sits on impassable ground (a tree's reserved tile) would otherwise keep
 * a full velocity that the terrain clamp cancels every tick, so it would vibrate
 * in place forever. When the direct heading is blocked we take a perpendicular
 * detour; the candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
/**
 * Direction toward (wx,wy) that does not aim into impassable ground. A unit
 * whose target sits on a blocked tile (a tree's reserved tile) would otherwise
 * keep a velocity the terrain clamp cancels every tick and vibrate in place
 * forever. Candidate order is fixed so this stays deterministic.
 */
function steerAroundTerrain(
  terr: { isWalkable(tx: number, ty: number): boolean } | null,
  t: { x: Fixed; y: Fixed },
  wx: Fixed,
  wy: Fixed,
  speed: Fixed,
): { x: Fixed; y: Fixed } {
  const ddx = wx - t.x;
  const ddy = wy - t.y;
  if (!terr || (!ddx && !ddy)) return { x: ddx, y: ddy };
  // Probe where one tick of travel would land us (same integration phase B
  // performs) — a whole-tile probe skips over the cell we actually hit.
  const len = fsqrt(fmul(ddx, ddx) + fmul(ddy, ddy));
  if (!len) return { x: ddx, y: ddy };
  const ux = fdiv(ddx, len);
  const uy = fdiv(ddy, len);
  const step = fmul(speed, DT);
  const nx = t.x + fmul(ux, step);
  const ny = t.y + fmul(uy, step);
  if (terr.isWalkable(Math.floor(fn(nx)), Math.floor(fn(ny)))) return { x: ddx, y: ddy };
  // Blocked ahead. Slide along whichever axis is open — the wall runs along the
  // blocked axis, so moving along the other one skirts it. When both axes are
  // blocked we are in a pocket; back off along either, deterministic order.
  const sx = ddx >= 0 ? 1 : -1;
  const sy = ddy >= 0 ? 1 : -1;
  const slideX = terr.isWalkable(Math.floor(fn(t.x + fmul(ff(sx), step))), Math.floor(fn(t.y)));
  const slideY = terr.isWalkable(Math.floor(fn(t.x)), Math.floor(fn(t.y + fmul(ff(sy), step))));
  if (slideX && !slideY) return { x: ff(sx), y: 0 };
  if (slideY && !slideX) return { x: 0, y: ff(sy) };
  if (slideX && slideY) {
    // Both open: take whichever closes on the goal more.
    return Math.abs(fmul(ddx, ux)) >= Math.abs(fmul(ddy, uy)) ? { x: ff(sx), y: 0 } : { x: 0, y: ff(sy) };
  }
  // Pocket (both axes blocked ahead): look a few steps down each candidate
  // direction (fixed order: forward X, forward Y, back X, back Y) and take the
  // one that actually makes progress toward the waypoint. The lookahead is
  // what rounds a corner — backing straight out of the pocket just ping-pongs.
  const LOOKAHEAD = 8;
  const gainX = fmul(ff(sx * LOOKAHEAD), ux);
  const gainY = fmul(ff(sy * LOOKAHEAD), uy);
  let bestX = 0;
  let bestY = 0;
  let bestScore = 0;
  for (const c of [
    [ff(sx), 0 as Fixed],
    [0 as Fixed, ff(sy)],
    [ff(-sx), 0 as Fixed],
    [0 as Fixed, ff(-sy)],
  ] as ReadonlyArray<readonly [Fixed, Fixed]>) {
    let px = t.x;
    let py = t.y;
    let k = 0;
    for (; k < LOOKAHEAD; k++) {
      px += c[0];
      py += c[1];
      if (!terr.isWalkable(Math.floor(fn(px)), Math.floor(fn(py)))) break;
    }
    if (k === 0) continue; // first step already blocked
    const score = (c[0] ? gainX : gainY) + k;
    if (score > bestScore) {
      bestScore = score;
      bestX = c[0];
      bestY = c[1];
    }
  }
  return { x: bestX, y: bestY };
}
