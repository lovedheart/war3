import { describe, expect, it } from 'vitest';
import { fi, ff } from '../../src/core/fixed.js';
import { Hasher } from '../../src/core/hash.js';
import { Terrain, TILE_CLIFF, TILE_GRASS, TILE_WALL, TILE_WATER } from '../../src/map/terrain.js';
import { PathGrid } from '../../src/map/pathgrid.js';
import { Pathfinder } from '../../src/map/pathfinding.js';

const N = 24;

function open(): Terrain {
  return new Terrain(N, N);
}

function blockedColumn(terrain: Terrain, x: number, gapY: number): void {
  for (let y = 1; y < N - 1; y++) if (y !== gapY) terrain.setTile(x, y, TILE_WATER);
}

function toPairs(nodes: number[]): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < nodes.length; i += 2) pts.push([nodes[i] >> 16, nodes[i + 1] >> 16]);
  return pts;
}

describe('Terrain', () => {
  it('defaults to walkable ground and treats out-of-bounds as wall', () => {
    const t = open();
    expect(t.tile(5, 5)).toBe(0);
    expect(t.walkable(5, 5)).toBe(true);
    expect(t.isWalkable(-1, 0)).toBe(false);
    expect(t.tile(-1, 0)).toBe(TILE_WALL);
    expect(t.tile(0, N)).toBe(TILE_WALL);
  });

  it('worldToTile floors and tileToWorld returns the tile centre', () => {
    const t = open();
    expect(t.worldToTile(ff(7.25))).toBe(7);
    expect(t.worldToTile(ff(-0.5))).toBe(-1);
    expect(t.tileToWorld(3)).toBe(ff(3.5));
    expect(t.worldToTile(t.tileToWorld(9))).toBe(9);
  });

  it('setWalkable overrides the tile id and walkableBit agrees', () => {
    const t = open();
    t.setTile(2, 2, TILE_CLIFF);
    expect(t.walkable(2, 2)).toBe(false);
    t.setWalkable(2, 2, true);
    expect(t.walkable(2, 2)).toBe(true);
    expect(t.walkableBit(2, 2)).toBe(1);
    t.setTile(3, 3, TILE_WATER);
    expect(t.walkableBit(3, 3)).toBe(0);
  });

  it('hash is stable across clones and sensitive to edits', () => {
    const a = open();
    a.setTile(4, 4, TILE_WATER);
    const h1 = new Hasher();
    a.hash(h1);
    const h2 = new Hasher();
    a.clone().hash(h2);
    expect(h1.digest()).toBe(h2.digest());

    const b = a.clone();
    b.setTile(4, 5, TILE_CLIFF);
    const h3 = new Hasher();
    b.hash(h3);
    expect(h3.digest()).not.toBe(h1.digest());
  });
});

describe('PathGrid', () => {
  it('derives passability from terrain', () => {
    const t = open();
    t.setTile(6, 6, TILE_CLIFF);
    const g = new PathGrid(t);
    expect(g.passable(6, 6)).toBe(false);
    expect(g.cost(6, 6)).toBe(255);
    expect(g.passable(6, 7)).toBe(true);
    expect(g.cost(0, 0)).toBeGreaterThan(0);
    expect(g.cost(-1, 0)).toBe(255);
  });

  it('blockCircle / unblockCircle are reference counted', () => {
    const t = open();
    const g = new PathGrid(t);
    const at = ff(10.5);
    expect(g.passable(10, 10)).toBe(true);
    const openCost = g.cost(10, 10);
    g.blockCircle(at, at, fi(2), 1);
    expect(g.cost(10, 10)).toBeGreaterThan(openCost);
    g.blockCircle(at, at, fi(2), 1);
    const twice = g.cost(10, 10);
    g.unblockCircle(at, at, fi(2), 1);
    expect(g.cost(10, 10)).toBeLessThan(twice);
    g.unblockCircle(at, at, fi(2), 1);
    expect(g.clean()).toBe(true);
    expect(g.cost(10, 10)).toBe(openCost);
  });

  it('rebuild() drops blockers but keeps terrain impassability', () => {
    const t = open();
    t.setTile(8, 8, TILE_WATER);
    const g = new PathGrid(t);
    g.blockCircle(ff(4.5), ff(4.5), fi(1), 1);
    expect(g.clean()).toBe(false);
    g.rebuild();
    expect(g.clean()).toBe(true);
    expect(g.passable(8, 8)).toBe(false);
  });
});

describe('Pathfinder', () => {
  it('straight line across open ground hits both endpoints', () => {
    const pf = new Pathfinder(new PathGrid(open()));
    const r = pf.find({
      fromX: ff(2.5),
      fromY: ff(2.5),
      toX: ff(6.5),
      toY: ff(2.5),
      radius: 0,
      maxNodes: 4096,
    });
    expect(r.ok).toBe(true);
    expect(r.partial).toBe(false);
    const pts = toPairs(r.nodes);
    expect(pts[0]).toEqual([2, 2]);
    expect(pts[pts.length - 1]).toEqual([6, 2]);
    expect(pts.length).toBeLessThanOrEqual(5); // straight-ish, no wandering
  });

  it('routes around a wall through its only gap', () => {
    const t = open();
    blockedColumn(t, 11, 20);
    const grid = new PathGrid(t);
    const r = new Pathfinder(grid).find({
      fromX: ff(3.5),
      fromY: ff(12.5),
      toX: ff(20.5),
      toY: ff(12.5),
      radius: 0,
      maxNodes: 8192,
    });
    expect(r.ok).toBe(true);
    const pts = toPairs(r.nodes);
    for (const [x, y] of pts) expect(grid.passable(x, y)).toBe(true);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(1);
    }
    expect(pts.some(([, y]) => y === 20)).toBe(true);
    expect(pts[pts.length - 1]).toEqual([20, 12]);
  });

  it('never cuts diagonally between two blocked tiles', () => {
    const t = open();
    t.setTile(10, 10, TILE_WATER);
    t.setTile(9, 11, TILE_WATER);
    const grid = new PathGrid(t);
    const r = new Pathfinder(grid).find({
      fromX: ff(9.5),
      fromY: ff(11.5),
      toX: ff(10.5),
      toY: ff(10.5),
      radius: 0,
      maxNodes: 4096,
    });
    expect(r.ok).toBe(true);
    const pts = toPairs(r.nodes);
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        expect(grid.passable(pts[i - 1][0] + dx, pts[i - 1][1])).toBe(true);
        expect(grid.passable(pts[i - 1][0], pts[i - 1][1] + dy)).toBe(true);
      }
    }
  });

  it('reports partial:true and still advances when maxNodes runs out', () => {
    const t = new Terrain(64, 64);
    const pf = new Pathfinder(new PathGrid(t));
    const r = pf.find({
      fromX: ff(1.5),
      fromY: ff(1.5),
      toX: ff(62.5),
      toY: ff(62.5),
      radius: 0,
      maxNodes: 6,
    });
    expect(r.ok).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.nodes.length).toBeGreaterThanOrEqual(2);
    const lx = r.nodes[r.nodes.length - 2] >> 16;
    const ly = r.nodes[r.nodes.length - 1] >> 16;
    expect(lx + ly).toBeGreaterThan(2); // moved toward the goal
  });

  it('does not throw on a sealed-off target', () => {
    const t = open();
    // Moat that fully encloses the goal island, leaving no tile to reroute to.
    for (let i = 14; i <= 22; i++) {
      t.setTile(i, 14, TILE_WATER);
      t.setTile(i, 22, TILE_WATER);
      t.setTile(14, i, TILE_WATER);
      t.setTile(22, i, TILE_WATER);
    }
    const r = new Pathfinder(new PathGrid(t)).find({
      fromX: ff(3.5),
      fromY: ff(3.5),
      toX: ff(20.5),
      toY: ff(20.5),
      radius: 0,
      maxNodes: 4096,
    });
    expect(r.ok).toBe(false);
    expect(Array.isArray(r.nodes)).toBe(true);
  });

  it('settles next to the closest free tile when the goal is blocked', () => {
    const t = open();
    t.setTile(15, 12, TILE_CLIFF);
    const grid = new PathGrid(t);
    const r = new Pathfinder(grid).find({
      fromX: ff(5.5),
      fromY: ff(12.5),
      toX: ff(15.5),
      toY: ff(12.5),
      radius: 0,
      maxNodes: 4096,
    });
    expect(r.ok).toBe(true);
    const pts = toPairs(r.nodes);
    const last = pts[pts.length - 1];
    expect(grid.passable(last[0], last[1])).toBe(true);
    expect(Math.hypot(last[0] - 15, last[1] - 12)).toBeLessThanOrEqual(2.1);
  });

  it('prefers cheap terrain when a detour avoids snow', () => {
    const t = open();
    for (let y = 8; y < 16; y++) t.setTile(12, y, TILE_GRASS); // pricier strip
    const grid = new PathGrid(t);
    const r = new Pathfinder(grid).find({
      fromX: ff(2.5),
      fromY: ff(12.5),
      toX: ff(21.5),
      toY: ff(12.5),
      radius: 0,
      maxNodes: 8192,
    });
    expect(r.ok).toBe(true);
    const onGrass = toPairs(r.nodes).filter(([x, y]) => x === 12 && y >= 8 && y < 16);
    expect(onGrass.length).toBeLessThanOrEqual(1);
  });

  it('is deterministic for identical requests', () => {
    const t = open();
    for (let i = 4; i < 18; i++) t.setTile(i, 12 - (i % 3), TILE_GRASS);
    blockedColumn(t, 9, 5);
    const req = {
      fromX: ff(2.5),
      fromY: ff(20.5),
      toX: ff(21.5),
      toY: ff(3.5),
      radius: fi(1),
      maxNodes: 8192,
    };
    const a = new Pathfinder(new PathGrid(t)).find(req);
    const b = new Pathfinder(new PathGrid(t)).find(req);
    expect(a.ok).toBe(b.ok);
    expect(a.nodes).toEqual(b.nodes);
  });

  it('clear() resets cached search state without breaking later searches', () => {
    const t = open();
    const pf = new Pathfinder(new PathGrid(t));
    const first = pf.find({ fromX: ff(2.5), fromY: ff(2.5), toX: ff(9.5), toY: ff(9.5), radius: 0, maxNodes: 4096 });
    pf.clear();
    const second = pf.find({ fromX: ff(2.5), fromY: ff(2.5), toX: ff(9.5), toY: ff(9.5), radius: 0, maxNodes: 4096 });
    expect(first.ok && second.ok).toBe(true);
    expect(second.nodes).toEqual(first.nodes);
  });
});
