import { describe, expect, it } from 'vitest';
import { ff, fn } from '../../src/core/fixed.js';
import { Terrain, TILE_CLIFF } from '../../src/map/terrain.js';
import { PathGrid } from '../../src/map/pathgrid.js';
import { FlowField } from '../../src/map/flowfield.js';

const N = 32;

function open(): Terrain {
  return new Terrain(N, N);
}

/** Simulate one gradient-descent walker and report where it ends up. */
function walk(
  field: FlowField,
  startX: number,
  startY: number,
  stepTiles = 0.5,
  maxSteps = 4000,
): { tx: number; ty: number; steps: number } {
  let x = startX;
  let y = startY;
  const step = ff(stepTiles);
  for (let s = 0; s < maxSteps; s++) {
    if ((x >> 16) === field.goalTx && (y >> 16) === field.goalTy) {
      return { tx: x >> 16, ty: y >> 16, steps: s };
    }
    const steps = field.direction(x, y);
    // heading -> dx/dy through the same trig table the sim uses
    const SIN_N = 4096;
    const i = ((steps % SIN_N) + SIN_N) % SIN_N;
    const ang = (i / SIN_N) * Math.PI * 2;
    x = (x + Math.round(Math.cos(ang) * step)) | 0;
    y = (y + Math.round(Math.sin(ang) * step)) | 0;
    if (x < 0 || y < 0 || x >= ff(N) || y >= ff(N)) break;
  }
  return { tx: x >> 16, ty: y >> 16, steps: maxSteps };
}

describe('FlowField', () => {
  it('builds a field whose goal tile has zero distance', () => {
    const grid = new PathGrid(open());
    const f = new FlowField(grid);
    f.build(20, 12, 64);
    expect(f.valid()).toBe(true);
    expect(f.distAt(20, 12)).toBe(0);
    expect(f.goalTx).toBe(20);
    expect(f.goalTy).toBe(12);
    expect(f.distAt(-1, -1)).toBe(-1);
    expect(f.reached).toBeGreaterThan(200);
  });

  it('distance grows monotonically away from the goal on open ground', () => {
    const grid = new PathGrid(open());
    const f = new FlowField(grid);
    f.build(16, 16, 64);
    const d0 = f.distAt(16, 16);
    const d3 = f.distAt(13, 16);
    const d7 = f.distAt(9, 16);
    expect(d0).toBeLessThan(d3);
    expect(d3).toBeLessThan(d7);
  });

  it('gradient descent converges to the goal from every corner', () => {
    const grid = new PathGrid(open());
    const f = new FlowField(grid);
    f.build(16, 16, 64);
    const starts: [number, number][] = [
      [1.5, 1.5],
      [30.5, 1.5],
      [1.5, 30.5],
      [30.5, 30.5],
      [16.5, 1.5],
      [1.5, 16.5],
    ];
    for (const [sx, sy] of starts) {
      const r = walk(f, ff(sx), ff(sy));
      expect([r.tx, r.ty]).toEqual([16, 16]);
    }
  });

  it('routes around a wall instead of walking into it', () => {
    const t = open();
    for (let y = 4; y <= 28; y++) if (y !== 26) t.setTile(12, y, TILE_CLIFF);
    const f = new FlowField(new PathGrid(t));
    f.build(24, 16, 64);
    const r = walk(f, ff(4.5), ff(16.5));
    expect([r.tx, r.ty]).toEqual([24, 16]);
  });

  it('direction is 0 once standing on the goal tile', () => {
    const f = new FlowField(new PathGrid(open()));
    f.build(8, 8, 64);
    expect(f.direction(ff(8.5), ff(8.5))).toBe(0);
  });

  it('radius limits coverage', () => {
    const f = new FlowField(new PathGrid(open()));
    f.build(16, 16, 3);
    expect(f.distAt(16, 16)).toBe(0);
    expect(f.distAt(16, 19)).toBeGreaterThanOrEqual(0);
    expect(f.distAt(16, 30)).toBe(-1);
  });

  it('snaps an unreachable goal tile onto a neighbouring free tile', () => {
    const t = open();
    t.setTile(10, 10, TILE_CLIFF);
    const f = new FlowField(new PathGrid(t));
    f.build(10, 10, 64);
    expect(f.valid()).toBe(true);
    expect(f.distAt(f.goalTx, f.goalTy)).toBe(0);
    expect([f.goalTx, f.goalTy]).not.toEqual([10, 10]);
  });

  it('is deterministic across instances', () => {
    const t = open();
    for (let i = 5; i < 25; i++) t.setTile(i, 10 + (i % 4), TILE_CLIFF);
    const a = new FlowField(new PathGrid(t));
    const b = new FlowField(new PathGrid(t));
    a.build(25, 25, 64);
    b.build(25, 25, 64);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) expect(a.distAt(x, y)).toBe(b.distAt(x, y));
    }
    expect(fn(ff(1))).toBe(1);
  });
});
