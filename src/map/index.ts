/**
 * `src/map` public surface: terrain data, traversal, spatial index and fog.
 * The simulation only ever talks to the map through these classes.
 */
export {
  Terrain,
  CLIFF_SHIFT,
  TILE_GROUND,
  TILE_GRASS,
  TILE_DIRT,
  TILE_CLIFF,
  TILE_WATER,
  TILE_ROCK,
  TILE_BLIGHT,
  TILE_SNOW,
  TILE_WALL,
  TILE_COUNT,
  tileImpassable,
  tileName,
  terrainBounds,
  clampTile,
} from './terrain.js';

export { PathGrid, BLOCKED } from './pathgrid.js';

export { Pathfinder } from './pathfinding.js';
export type { PathRequest, PathResult } from './pathfinding.js';

export { FlowField } from './flowfield.js';

export { QuadTree } from './quadtree.js';

export { FogOfWar, FOG_UNEXPLORED, FOG_EXPIRED, FOG_VISIBLE } from './fog.js';

export {
  generateMap,
  loadMapJson,
  DECOR_GRASS,
  DECOR_ROCK,
  DECOR_FLOWER,
  DECOR_BUSH,
  DECOR_RUBBLE,
  DECOR_LILY,
  DECOR_COUNT,
} from './mapgen.js';
export type { MapGenOptions, GeneratedMap } from './mapgen.js';

import type { Fixed } from '../core/fixed.js';
import { Terrain } from './terrain.js';
import { PathGrid } from './pathgrid.js';
import { Pathfinder } from './pathfinding.js';
import { QuadTree } from './quadtree.js';
import { FogOfWar } from './fog.js';
import type { GeneratedMap, MapGenOptions } from './mapgen.js';
import { generateMap, loadMapJson } from './mapgen.js';
import { Hasher } from '../core/hash.js';

/** Everything a match needs to boot: one bundle so wiring is a single call. */
export interface GameMap extends GeneratedMap {
  readonly name: string;
  readonly seed: number;
  grid: PathGrid;
  pathfinder: Pathfinder;
  quad: QuadTree;
  fog: FogOfWar;
  /** stable hash of terrain + geometry, embedded in replays */
  mapHash(): number;
}

export interface LoadMapArgs {
  json?: unknown;
  gen?: MapGenOptions;
  players?: number;
}

/** Build the runtime map wrapper from JSON (preferred) or procedural options. */
export function loadMap(args: LoadMapArgs): GameMap {
  let generated: GeneratedMap;
  let name = 'generated';
  let seed = 0;
  if (args.json !== undefined) {
    generated = loadMapJson(args.json);
    name = typeof (args.json as { name?: unknown }).name === 'string'
      ? (args.json as { name: string }).name
      : 'custom';
    seed = 0;
  } else {
    const opts: MapGenOptions = args.gen ?? { seed: 1, size: 64, players: 2 };
    generated = generateMap(opts);
    name = opts.name ?? 'generated';
    seed = opts.seed >>> 0;
  }

  const terrain = generated.terrain;
  const grid = new PathGrid(terrain);
  const pathfinder = new Pathfinder(grid);
  const quad = new QuadTree(0, 0, terrain.width << 16, terrain.height << 16, 8);
  const players = Math.max(2, args.players ?? generated.spawns.length ?? 2);
  const fog = new FogOfWar(terrain.width, terrain.height, players);

  const mapHash = (): number => {
    const h = new Hasher();
    h.str(name).int(seed);
    terrain.hash(h);
    h.int(generated.spawns.length);
    for (const s of generated.spawns) h.int(s.x).int(s.y);
    h.int(generated.mines.length);
    for (const m of generated.mines) h.int(m.x).int(m.y).int(m.capacity);
    h.int(generated.trees.length);
    return h.digest();
  };

  return {
    ...generated,
    name,
    seed,
    grid,
    pathfinder,
    quad,
    fog,
    mapHash,
  };
}

/** Tile centre helper mirroring the ARCHITECTURE.md coordinate contract. */
export function tileCenter(tx: number): Fixed {
  return tx * 65536 + 32768;
}

/** World position -> tile index (floor). */
export function worldToTile(v: Fixed): number {
  return v >> 16;
}

/** Convenience: does a whole square plate fit? (building placement check) */
export function plateWalkable(t: Terrain, tx: number, ty: number, size: number): boolean {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) if (!t.walkable(tx + dx, ty + dy)) return false;
  }
  return true;
}
