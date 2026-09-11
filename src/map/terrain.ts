/**
 * Terrain: one byte per tile plus a derived walkability bitmap.
 *
 * Coordinate convention (ARCHITECTURE.md §3): 1 game unit == 1 tile, tile
 * `(tx, ty)` centre is at world position `ff(tx) + ff(0.5)`.
 *
 * Out of bounds reads behave like map edge: `TILE_WALL` / not walkable.
 */
import { Fixed } from '../core/fixed.js';
import { Hasher } from '../core/hash.js';

export const TILE_GROUND = 0;
export const TILE_GRASS = 1;
export const TILE_DIRT = 2;
export const TILE_CLIFF = 3;
export const TILE_WATER = 4;
export const TILE_ROCK = 5;
export const TILE_BLIGHT = 6;
export const TILE_SNOW = 7;
export const TILE_WALL = 8;

export const TILE_COUNT = 9;

/** Tiles units can never stand on. */
const IMPASSABLE_MASK: boolean[] = (() => {
  const m = new Array<boolean>(TILE_COUNT).fill(false);
  m[TILE_CLIFF] = true;
  m[TILE_WATER] = true;
  m[TILE_ROCK] = true;
  m[TILE_WALL] = true;
  return m;
})();

/**
 * Tile-space offset (in 1/8-tile units) applied to cliff tiles so a unit
 * brushing against a cliff slides off it instead of grinding to a halt
 * (WC3 cliff "slip" behaviour). Collision consumes it as `offset / 8` tiles.
 */
export const CLIFF_SHIFT = 8;

export function tileImpassable(t: number): boolean {
  return t < 0 || t >= TILE_COUNT ? true : IMPASSABLE_MASK[t];
}

/** Human-readable name, for debug output and the map editor overlay. */
export function tileName(t: number): string {
  switch (t) {
    case TILE_GROUND:
      return 'ground';
    case TILE_GRASS:
      return 'grass';
    case TILE_DIRT:
      return 'dirt';
    case TILE_CLIFF:
      return 'cliff';
    case TILE_WATER:
      return 'water';
    case TILE_ROCK:
      return 'rock';
    case TILE_BLIGHT:
      return 'blight';
    case TILE_SNOW:
      return 'snow';
    default:
      return 'wall';
  }
}

export class Terrain {
  readonly width: number;
  readonly height: number;
  /** raw tile ids, row-major, length width*height */
  readonly tiles: Uint8Array;
  /** 1 bit per tile: 1 = base-terrain walkable (before dynamic blockers) */
  private walk: Uint8Array;

  constructor(width: number, height: number) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.tiles = new Uint8Array(this.width * this.height);
    this.walk = new Uint8Array((this.width * this.height + 7) >> 3);
    // Default fill is TILE_GROUND (0) which is walkable, so set every bit.
    this.walk.fill(0xff);
  }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  tile(tx: number, ty: number): number {
    if (!this.inside(tx, ty)) return TILE_WALL;
    return this.tiles[ty * this.width + tx];
  }

  setTile(tx: number, ty: number, t: number): void {
    if (!this.inside(tx, ty)) return;
    const i = ty * this.width + tx;
    this.tiles[i] = t & 0xff;
    if (tileImpassable(t)) this.walk[i >> 3] &= ~(1 << (i & 7));
    else this.walk[i >> 3] |= 1 << (i & 7);
  }

  walkable(tx: number, ty: number): boolean {
    if (!this.inside(tx, ty)) return false;
    const i = ty * this.width + tx;
    return (this.walk[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** Explicit override; does not change the tile id (used for ramps/doors). */
  setWalkable(tx: number, ty: number, v: boolean): void {
    if (!this.inside(tx, ty)) return;
    const i = ty * this.width + tx;
    if (v) this.walk[i >> 3] |= 1 << (i & 7);
    else this.walk[i >> 3] &= ~(1 << (i & 7));
  }

  /** 0 | 1, canonical form for hashing. */
  walkableBit(tx: number, ty: number): number {
    return this.walkable(tx, ty) ? 1 : 0;
  }

  /** Alias required by `World.terrain` (`SimTerrainLike`). */
  isWalkable(tx: number, ty: number): boolean {
    return this.walkable(tx, ty);
  }

  /** World coordinate -> owning tile index (floor, works for negatives). */
  worldToTile(x: Fixed): number {
    return x >> 16;
  }

  /** Tile index -> its centre in world coordinates (`ff(tx) + ff(0.5)`). */
  tileToWorld(tx: number): Fixed {
    return (tx | 0) * 65536 + 32768;
  }

  tileX(x: Fixed): number {
    return this.worldToTile(x);
  }

  tileY(y: Fixed): number {
    return this.worldToTile(y);
  }

  centerOf(tx: number, ty: number): { x: Fixed; y: Fixed } {
    return { x: this.tileToWorld(tx), y: this.tileToWorld(ty) };
  }

  /** Count of tiles with the given id (map stats / balance report). */
  countTile(t: number): number {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === t) n++;
    return n;
  }

  /** Fill rect inclusive on both axes. */
  fillRect(x0: number, y0: number, x1: number, y1: number, t: number): void {
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.setTile(tx, ty, t);
  }

  clone(): Terrain {
    const t = new Terrain(this.width, this.height);
    t.tiles.set(this.tiles);
    t.walk.set(this.walk);
    return t;
  }

  hash(h: Hasher): void {
    h.int(this.width).int(this.height);
    // Canonical order: tile ids first, then the walkability bitmap.
    let prev = -1;
    let run = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t === prev) run++;
      else {
        if (prev >= 0) h.int(prev).int(run);
        prev = t;
        run = 1;
      }
    }
    if (prev >= 0) h.int(prev).int(run);
    for (let i = 0; i < this.walk.length; i++) h.int(this.walk[i]);
  }
}

/** Convenience: tile bounds of a whole map in world coordinates. */
export function terrainBounds(t: Terrain): { maxX: Fixed; maxY: Fixed } {
  return { maxX: t.width * 65536, maxY: t.height * 65536 };
}

/** Nearest in-bounds tile clamp (integer). */
export function clampTile(v: number, size: number): number {
  return v < 0 ? 0 : v >= size ? size - 1 : v | 0;
}

/** Round-to-nearest helper kept here so callers avoid importing ffloor twice. */
export function fnearest(x: Fixed): number {
  return Math.round(x / 65536) | 0;
}
