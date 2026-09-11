/**
 * Deterministic map generation + the `data/maps/*.json` loader.
 *
 * Generation order is fixed (terrain -> water -> cliffs -> decor -> spawns ->
 * mines -> trees) and every random choice comes from a single `Rng` stream, so
 * the same `{seed,size,players,...}` always yields a byte-identical map.
 *
 * Guarantees: every spawn has a walkable 5x5 home, all spawns are mutually
 * reachable on foot, and each spawn owns `minesPerPlayer` gold seams inside its
 * tree ring.
 */
import { Fixed } from '../core/fixed.js';
import { Rng } from '../core/rng.js';
import { GOLD_MINE_CAPACITY } from '../core/constants.js';
import {
  Terrain,
  TILE_BLIGHT,
  TILE_CLIFF,
  TILE_DIRT,
  TILE_GRASS,
  TILE_GROUND,
  TILE_ROCK,
  TILE_SNOW,
  TILE_WALL,
  TILE_WATER,
} from './terrain.js';
import { PathGrid } from './pathgrid.js';
import { Pathfinder } from './pathfinding.js';

export interface MapGenOptions {
  seed: number;
  size: number;
  players: number;
  minesPerPlayer?: number;
  trees?: boolean;
  name?: string;
}

export interface GeneratedMap {
  terrain: Terrain;
  spawns: { x: Fixed; y: Fixed }[];
  mines: { x: Fixed; y: Fixed; capacity: number }[];
  trees: { x: Fixed; y: Fixed }[];
  decor: { x: Fixed; y: Fixed; kind: number }[];
}

/** Decor `kind` values (consumed by src/render for prop selection). */
export const DECOR_GRASS = 0;
export const DECOR_ROCK = 1;
export const DECOR_FLOWER = 2;
export const DECOR_BUSH = 3;
export const DECOR_RUBBLE = 4;
export const DECOR_LILY = 5;
export const DECOR_COUNT = 6;

const MIN_SIZE = 16;

function center(tx: number): Fixed {
  return tx * 65536 + 32768;
}

/** Square distance between tile coords. */
function tdist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function generateMap(opts: MapGenOptions): GeneratedMap {
  const size = Math.max(MIN_SIZE, opts.size | 0);
  const players = Math.max(1, Math.min(12, opts.players | 0));
  const minesPerPlayer = Math.max(1, opts.minesPerPlayer ?? 2);
  const withTrees = opts.trees !== false;
  const rng = new Rng(opts.seed);
  const terrain = new Terrain(size, size);

  // ---- base terrain -------------------------------------------------------
  const snow = size >= 96 && rng.chance(26214); // ~40% frozen maps
  const blight = !snow && rng.chance(13107); // ~20% corrupted
  const baseTile = snow ? TILE_SNOW : blight ? TILE_BLIGHT : TILE_GROUND;
  const altTile = snow ? TILE_GROUND : blight ? TILE_DIRT : TILE_GRASS;

  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      let t = baseTile;
      if (rng.int(100) < 12) t = altTile;
      if (rng.int(100) < 4) t = TILE_DIRT;
      terrain.setTile(tx, ty, t);
    }
  }
  // Solid border so nothing can path off the playable area.
  for (let i = 0; i < size; i++) {
    terrain.setTile(i, 0, TILE_WALL);
    terrain.setTile(i, size - 1, TILE_WALL);
    terrain.setTile(0, i, TILE_WALL);
    terrain.setTile(size - 1, i, TILE_WALL);
  }

  // ---- water bodies -------------------------------------------------------
  const lakes = rng.range(1, size >= 64 ? 4 : 2);
  for (let l = 0; l < lakes; l++) {
    let x = rng.range(6, size - 7);
    let y = rng.range(6, size - 7);
    let r = rng.range(Math.max(2, size >> 5), Math.max(3, size >> 3));
    const blobs = rng.range(2, 5);
    for (let b = 0; b < blobs; b++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          terrain.setTile(x + dx, y + dy, TILE_WATER);
        }
      }
      x += rng.range(-r, r);
      y += rng.range(-r, r);
      x = Math.max(3, Math.min(size - 4, x));
      y = Math.max(3, Math.min(size - 4, y));
      r = Math.max(2, r + rng.range(-1, 1));
    }
  }

  // ---- cliff outcrops -----------------------------------------------------
  const cliffs = rng.range(2, Math.max(3, size >> 4));
  for (let c = 0; c < cliffs; c++) {
    let x = rng.range(5, size - 6);
    let y = rng.range(5, size - 6);
    const len = rng.range(4, Math.max(6, size >> 3));
    const dir = rng.int(4);
    const ddx = [1, -1, 0, 0][dir];
    const ddy = [0, 0, 1, -1][dir];
    for (let s = 0; s < len; s++) {
      const w = rng.range(1, 2);
      for (let k = -w; k <= w; k++) {
        const tx = x + (ddy !== 0 ? k : 0);
        const ty = y + (ddx !== 0 ? k : 0);
        if (terrain.tile(tx, ty) !== TILE_WATER) terrain.setTile(tx, ty, TILE_CLIFF);
      }
      x += ddx;
      y += ddy;
      if (x < 4 || y < 4 || x > size - 5 || y > size - 5) break;
    }
  }

  // ---- spawn placement (corners of an inscribed square) -------------------
  const margin = Math.max(6, Math.floor(size * 0.12));
  const span = size - margin * 2;
  const spawns: { x: Fixed; y: Fixed }[] = [];
  const spawnTiles: { tx: number; ty: number }[] = [];
  for (let p = 0; p < players; p++) {
    let tx: number;
    let ty: number;
    if (players === 1) {
      tx = margin + (span >> 1);
      ty = size - 1 - margin;
    } else {
      const a = (Math.PI * 2 * p) / players - Math.PI / 4;
      const cx = (size - 1) / 2;
      const rad = (span / 2) * Math.SQRT1_2;
      tx = Math.round(cx + Math.cos(a) * rad);
      ty = Math.round(cx + Math.sin(a) * rad);
    }
    const home = findClear(terrain, size, tx, ty, 4);
    spawnTiles.push(home);
    spawns.push({ x: center(home.tx), y: center(home.ty) });
  }

  // Clear a town plate around every spawn.
  for (const s of spawnTiles) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const t = terrain.tile(s.tx + dx, s.ty + dy);
        if (t === TILE_WATER || t === TILE_CLIFF || t === TILE_ROCK || t === TILE_WALL) {
          terrain.setTile(s.tx + dx, s.ty + dy, baseTile);
        }
      }
    }
  }

  // ---- connectivity: carve until every spawn reaches every other ----------
  ensureConnected(terrain, spawnTiles);

  // ---- gold seams ---------------------------------------------------------
  const mines: { x: Fixed; y: Fixed; capacity: number }[] = [];
  for (const s of spawnTiles) {
    const placed: { tx: number; ty: number }[] = [];
    let guard = 0;
    while (placed.length < minesPerPlayer && guard++ < 400) {
      const a = rng.nextU32() / 0x100000000;
      const rr = 4 + ((rng.nextU32() % 5000) / 1000); // 4 .. 9 tiles
      const tx = Math.round(s.tx + Math.cos(a * Math.PI * 2) * rr);
      const ty = Math.round(s.ty + Math.sin(a * Math.PI * 2) * rr);
      if (!terrain.inside(tx, ty) || !terrain.walkable(tx, ty)) continue;
      if (tdist2(tx, ty, s.tx, s.ty) < 16) continue; // not on the town hall
      if (placed.some((p) => tdist2(p.tx, p.ty, tx, ty) < 9)) continue;
      placed.push({ tx, ty });
      mines.push({ x: center(tx), y: center(ty), capacity: GOLD_MINE_CAPACITY });
    }
  }

  // ---- trees --------------------------------------------------------------
  const trees: { x: Fixed; y: Fixed }[] = [];
  if (withTrees) {
    const density = Math.min(0.22, 0.1 + 12 / size);
    const total = Math.floor(size * size * density);
    let guard = 0;
    for (let i = 0; i < total && guard < total * 12; ) {
      guard++;
      const tx = rng.range(2, size - 3);
      const ty = rng.range(2, size - 3);
      if (!terrain.walkable(tx, ty)) continue;
      if (spawnTiles.some((s) => tdist2(s.tx, s.ty, tx, ty) < 36)) continue;
      if (mines.some((m) => tdist2(m.x >> 16, m.y >> 16, tx, ty) < 4)) continue;
      terrain.setTile(tx, ty, TILE_ROCK); // reserved tile so paths avoid forests
      trees.push({ x: center(tx), y: center(ty) });
      i++;
    }
  }

  // ---- decor --------------------------------------------------------------
  const decor: { x: Fixed; y: Fixed; kind: number }[] = [];
  const decorCount = Math.floor(size * size * 0.03);
  for (let i = 0; i < decorCount; i++) {
    const tx = rng.range(1, size - 2);
    const ty = rng.range(1, size - 2);
    const t = terrain.tile(tx, ty);
    let kind: number;
    if (t === TILE_WATER) kind = DECOR_LILY;
    else if (t === TILE_CLIFF || t === TILE_ROCK) kind = DECOR_RUBBLE;
    else if (t === TILE_SNOW) kind = rng.int(2) === 0 ? DECOR_ROCK : DECOR_GRASS;
    else {
      const k = rng.pick([45, 15, 15, 20, 5]);
      kind = k < 0 ? DECOR_GRASS : k;
    }
    decor.push({ x: center(tx), y: center(ty), kind });
  }

  return { terrain, spawns, mines, trees, decor };
}

/** Find a tile near (tx,ty) with a clear (2r+1)^2 building plate. */
function findClear(
  terrain: Terrain,
  size: number,
  tx: number,
  ty: number,
  maxR: number,
): { tx: number; ty: number } {
  for (let r = 0; r <= maxR * 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 3 || y < 3 || x > size - 4 || y > size - 4) continue;
        if (clearArea(terrain, x, y, 2)) return { tx: x, ty: y };
      }
    }
  }
  return { tx: Math.max(3, Math.min(size - 4, tx)), ty: Math.max(3, Math.min(size - 4, ty)) };
}

function clearArea(terrain: Terrain, tx: number, ty: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (!terrain.walkable(tx + dx, ty + dy)) return false;
  }
  return true;
}

/** Carve straight corridors until all spawns share one connected component. */
function ensureConnected(terrain: Terrain, spawnTiles: { tx: number; ty: number }[]): void {
  if (spawnTiles.length < 2) return;
  const grid = new PathGrid(terrain);
  const pf = new Pathfinder(grid);
  const req = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) => ({
    fromX: center(a.tx),
    fromY: center(a.ty),
    toX: center(b.tx),
    toY: center(b.ty),
    radius: 0 as Fixed,
    maxNodes: terrain.width * terrain.height * 4,
  });

  // Union-find over spawns, merging pairs that are already reachable.
  const parent = spawnTiles.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < spawnTiles.length; i++) {
    for (let j = i + 1; j < spawnTiles.length; j++) {
      if (root(i) === root(j)) continue;
      if (pf.find(req(spawnTiles[i], spawnTiles[j])).ok) parent[root(j)] = root(i);
    }
  }

  let guard = 0;
  for (let i = 1; i < spawnTiles.length; i++) {
    while (root(i) !== root(0) && guard++ < 64) {
      carveCorridor(terrain, spawnTiles[0], spawnTiles[i]);
      grid.rebuild();
      pf.clear();
      for (let a = 0; a < spawnTiles.length; a++) {
        for (let b = a + 1; b < spawnTiles.length; b++) {
          if (root(a) === root(b)) continue;
          if (pf.find(req(spawnTiles[a], spawnTiles[b])).ok) parent[root(b)] = root(a);
        }
      }
    }
  }
}

/** Straight Bresenham line with a 1-tile brush, avoiding the spawn plates. */
function carveCorridor(
  terrain: Terrain,
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
): void {
  let x = a.tx;
  let y = a.ty;
  const dx = Math.abs(b.tx - x);
  const dy = Math.abs(b.ty - y);
  const sx = x < b.tx ? 1 : -1;
  const sy = y < b.ty ? 1 : -1;
  let err = dx - dy;
  let steps = 0;
  const limit = terrain.width + terrain.height + 4;
  while (steps++ < limit) {
    brush(terrain, x, y);
    if (x === b.tx && y === b.ty) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function brush(terrain: Terrain, tx: number, ty: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = terrain.tile(tx + dx, ty + dy);
      if (t === TILE_WALL) continue; // never open the border
      if (t === TILE_WATER || t === TILE_CLIFF || t === TILE_ROCK) {
        terrain.setTile(tx + dx, ty + dy, TILE_DIRT);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// JSON map loading — data/maps/*.json
// { "name": string, "size": [w,h], "tiles": [[...]], "spawns": [[x,y],...],
//   "mines": [[x,y,capacity],...], "trees": [[x,y],...] }
// ---------------------------------------------------------------------------

function isNumArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function num(v: unknown, def = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

export function loadMapJson(json: unknown): GeneratedMap {
  if (typeof json !== 'object' || json === null) throw new Error('loadMapJson: not an object');
  const o = json as Record<string, unknown>;

  let width = 0;
  let height = 0;
  const sizeArr = o['size'];
  if (isNumArray(sizeArr) && sizeArr.length >= 2) {
    width = num(sizeArr[0]) | 0;
    height = num(sizeArr[1]) | 0;
  }
  const tilesIn = o['tiles'];
  if (isNumArray(tilesIn) && tilesIn.length > 0 && isNumArray(tilesIn[0])) {
    height = tilesIn.length;
    width = Math.max(width, (tilesIn[0] as unknown[]).length | 0);
  }
  if (width <= 0 || height <= 0) throw new Error('loadMapJson: missing size/tiles');

  const terrain = new Terrain(width, height);
  if (isNumArray(tilesIn)) {
    for (let ty = 0; ty < Math.min(height, tilesIn.length); ty++) {
      const row = tilesIn[ty];
      if (!isNumArray(row)) continue;
      for (let tx = 0; tx < Math.min(width, row.length); tx++) {
        terrain.setTile(tx, ty, num(row[tx]) | 0);
      }
    }
  }

  const readPts = (key: string): { x: Fixed; y: Fixed }[] => {
    const arr = o[key];
    const out: { x: Fixed; y: Fixed }[] = [];
    if (!isNumArray(arr)) return out;
    for (const item of arr) {
      if (!isNumArray(item) || item.length < 2) continue;
      out.push({ x: Math.round(num(item[0]) * 65536) | 0, y: Math.round(num(item[1]) * 65536) | 0 });
    }
    return out;
  };

  const spawns = readPts('spawns');
  const trees = readPts('trees');

  const mines: { x: Fixed; y: Fixed; capacity: number }[] = [];
  const mineArr = o['mines'];
  if (isNumArray(mineArr)) {
    for (const item of mineArr) {
      if (!isNumArray(item) || item.length < 2) continue;
      mines.push({
        x: Math.round(num(item[0]) * 65536) | 0,
        y: Math.round(num(item[1]) * 65536) | 0,
        capacity: num(item[2], GOLD_MINE_CAPACITY) | 0,
      });
    }
  }

  return { terrain, spawns, mines, trees, decor: [] };
}
