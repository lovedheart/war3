/**
 * Fog-of-war mask.
 *
 * Three states per tile (unexplored / previously-seen / visible). The mask is
 * built as a small offscreen canvas — one 1x1 alpha pixel per tile — then
 * upscaled with `imageSmoothingEnabled` on, which gives free bilinear feather
 * at the fog border and costs one drawImage per frame (no per-pixel JS loop).
 *
 * The "previously seen" state additionally needs the terrain drawn in
 * desaturated colours; layers.ts does that with a second terrain pass clipped
 * to the expired region, so this module also exposes the per-tile state grid.
 */
import { FOG_EXPIRED, FOG_UNEXPLORED, FOG_VISIBLE } from '../core/constants.js';
import { Camera } from './camera.js';

/** Minimal surface we need from src/map's FogOfWar (kept structural on purpose). */
export interface FogLike {
  isVisibleTile?(tx: number, ty: number, player: number): boolean;
  exploredTile?(tx: number, ty: number, player: number): boolean;
  /** optional raw accessor: returns FOG_* for a tile */
  stateAt?(tx: number, ty: number, player: number): number;
  width?: number;
  height?: number;
}

export interface FogSource {
  fog: FogLike | null;
  viewer: number;
  mapW: number;
  mapH: number;
}

/** Resolve one tile's fog state defensively (other agents may not be wired yet). */
export function fogStateAt(src: FogSource, tx: number, ty: number): number {
  const f = src.fog;
  if (!f) return FOG_VISIBLE;
  if (tx < 0 || ty < 0 || tx >= src.mapW || ty >= src.mapH) return FOG_UNEXPLORED;
  if (src.viewer <= 0) return FOG_VISIBLE;
  try {
    if (f.stateAt) return clampState(f.stateAt(tx, ty, src.viewer));
    if (f.isVisibleTile && f.isVisibleTile(tx, ty, src.viewer)) return FOG_VISIBLE;
    if (f.exploredTile) return f.exploredTile(tx, ty, src.viewer) ? FOG_EXPIRED : FOG_UNEXPLORED;
    if (f.isVisibleTile) return FOG_EXPIRED; // no exploration history available
  } catch {
    /* subsystem not ready */
  }
  return FOG_VISIBLE;
}

function clampState(v: number): number {
  return v === FOG_VISIBLE ? FOG_VISIBLE : v === FOG_EXPIRED ? FOG_EXPIRED : FOG_UNEXPLORED;
}

/** Tile range the camera shows, padded by one tile for the feathering seam. */
export function fogTileRange(cam: Camera, mapW: number, mapH: number): { x0: number; y0: number; cols: number; rows: number } {
  const t = cam.visibleTiles();
  const x0 = Math.max(0, t.x0 - 1);
  const y0 = Math.max(0, t.y0 - 1);
  const x1 = Math.min(mapW - 1, t.x1 + 1);
  const y1 = Math.min(mapH - 1, t.y1 + 1);
  return { x0, y0, cols: Math.max(1, x1 - x0 + 1), rows: Math.max(1, y1 - y0 + 1) };
}

/**
 * Write the fog alpha grid into an ImageData sized cols x rows.
 * Alpha semantics: 255 = fully blacked out (unexplored), ~140 = dimmed
 * (expired), 0 = fully visible. Kept as a pure function so it is unit-testable
 * without a canvas.
 */
export function fillFogImageData(
  data: Uint8ClampedArray,
  src: FogSource,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  expiredAlpha = 140,
): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const st = fogStateAt(src, x0 + c, y0 + r);
      const i = (r * cols + c) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = st === FOG_VISIBLE ? 0 : st === FOG_EXPIRED ? expiredAlpha : 255;
    }
  }
}

/** Aggregate helper used by layers.ts: is any of this rect worth drawing? */
export function rectVisibility(src: FogSource, tx0: number, ty0: number, tx1: number, ty1: number): 'all' | 'some' | 'none' {
  let anyVisible = false;
  let anyHidden = false;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const st = fogStateAt(src, tx, ty);
      if (st === FOG_VISIBLE) anyVisible = true;
      else anyHidden = true;
      if (anyVisible && anyHidden) return 'some';
    }
  }
  return anyVisible ? 'all' : 'none';
}

/** Map-space centre of a tile range (for the debug overlay). */
export function fogStats(src: FogSource, cam: Camera, mapW: number, mapH: number): { visible: number; expired: number; unexplored: number } {
  const r = fogTileRange(cam, mapW, mapH);
  let v = 0, e = 0, u = 0;
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      const st = fogStateAt(src, r.x0 + x, r.y0 + y);
      if (st === FOG_VISIBLE) v++; else if (st === FOG_EXPIRED) e++; else u++;
    }
  }
  return { visible: v, expired: e, unexplored: u };
}
