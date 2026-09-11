/**
 * Render passes. Each layer is a standalone function so it can be unit-tested
 * with a recording stub context and reordered by the renderer without risk.
 *
 * Layer order used by renderer.ts:
 *   ground -> entity shadows -> entities (y-sorted) -> fog -> overlays -> debug
 *
 * Everything here is READ-ONLY with respect to the simulation: no store value
 * is ever assigned, and missing components are skipped rather than fatal.
 */
import { Fixed, ff, fn } from '../core/fixed.js';
import { TILE_SIZE_PX, FOG_UNEXPLORED, FOG_VISIBLE } from '../core/constants.js';
import { stepsToDeg } from '../core/geom.js';
import type { Eid } from '../core/pool.js';
import type { Game } from '../sim/index.js';
import type { World } from '../sim/world.js';
import type { Terrain } from '../map/terrain.js';
import type { FogOfWar } from '../map/fog.js';
import { Camera } from './camera.js';
import { SpriteAtlas, bakeKey, drawSprite, guessRace } from './atlas.js';
import {
  TERRAIN, UI, racePalette, terrainSwatch, terrainVariant, desaturateHex,
  playerColor, healthBarColor, shadeHex, tintHex, withAlpha, rand01, hash2,
} from './palette.js';
import { FOG_EXPIRED_WASH } from './palette.js';
import { fillFogImageData, fogTileRange, fogStateAt, type FogSource } from './fogmask.js';
import { footprintPx, spriteKey, isHeroId } from './draw/spec.js';
import type { Ctx2D } from './draw/spec.js';
import { shadowBlob } from './draw/common.js';
import type { ParticleSystem, FloaterLayer } from './particles.js';

/* ------------------------------------------------------------------ */
/* Store access (structural — components.ts is the field authority)    */
/* ------------------------------------------------------------------ */

interface STransform { x: Fixed; y: Fixed; facing: number; radius: Fixed; w: number; h: number; z: number }
interface SKind { kind: number }
interface SOwner { player: number }
interface SHealth { hp: Fixed; hpMax: Fixed; mp: Fixed; mpMax: Fixed; dead: boolean; deathTick: number }
interface SStats { id: string; race: string; level: number; isHero: boolean; str: number; agi: number; int: number }
interface SBuilding { buildingId: string; built: boolean; progress: number; totalTicks: number; trainQueue: unknown[]; rallyX: Fixed; rallyY: Fixed }
interface SMovement { speed: Fixed; vx: Fixed; vy: Fixed; fly: boolean }
interface SOrders { current: { kind: string; targetEid: number; tx: Fixed; ty: Fixed }; queue: unknown[]; anchorX: Fixed; anchorY: Fixed }
interface SItem { itemId: string }
interface SMissile { srcEid: number; targetEid: number; tx: Fixed; ty: Fixed; kind: string }
interface SAttack { cooldownLeft: number; swing: number; target: number }
interface SBuffs { list: { kind: string; untilTick: number }[] }

export interface Stores {
  transform?: { get(e: Eid): STransform | undefined };
  kind?: { get(e: Eid): SKind | undefined };
  owner?: { get(e: Eid): SOwner | undefined };
  health?: { get(e: Eid): SHealth | undefined };
  stats?: { get(e: Eid): SStats | undefined };
  building?: { get(e: Eid): SBuilding | undefined };
  movement?: { get(e: Eid): SMovement | undefined };
  orders?: { get(e: Eid): SOrders | undefined };
  item?: { get(e: Eid): SItem | undefined };
  missile?: { get(e: Eid): SMissile | undefined };
  attack?: { get(e: Eid): SAttack | undefined };
  buffs?: { get(e: Eid): SBuffs | undefined };
}

export function stores(w: World | undefined | null): Stores {
  return ((w as { stores?: Stores } | undefined)?.stores) ?? {};
}

const KIND_UNIT = 0;
const KIND_BUILDING = 1;
const KIND_ITEM = 2;
const KIND_DECORATION = 3;
const KIND_MISSILE = 4;
const NULL_EID = 0xffffffff;

/* ------------------------------------------------------------------ */
/* Shared frame context                                               */
/* ------------------------------------------------------------------ */

export interface FrameCtx {
  ctx: Ctx2D;
  cam: Camera;
  game: Game;
  atlas: SpriteAtlas;
  /** tick interpolation factor in [0,1] */
  alpha: number;
  now: number;
  viewer: number;
  selected: Set<number>;
  hover: number;
}

/** Ground-plane screen position of an entity, tick-interpolated. */
export function entityScreenPos(st: Stores, eid: Eid, cam: Camera, alpha: number): { sx: number; sy: number } | null {
  const t = st.transform?.get(eid);
  if (!t) return null;
  const m = st.movement?.get(eid);
  let x = t.x;
  let y = t.y;
  if (m && (m.vx !== 0 || m.vy !== 0)) {
    // back up one step by (1-alpha) of this tick's motion
    x -= ((m.vx / 30) * (1 - alpha)) | 0;
    y -= ((m.vy / 30) * (1 - alpha)) | 0;
  }
  return { sx: cam.worldToScreenX(x), sy: cam.worldToScreenY(y) };
}

/** Is this tile worth drawing for the current viewer? */
export function tileVisible(src: FogSource, tx: number, ty: number): boolean {
  return fogStateAt(src, tx, ty) !== FOG_UNEXPLORED;
}

/** Entity visibility test used by both entity and overlay passes. */
export function entityVisible(st: Stores, src: FogSource, eid: Eid): boolean {
  const t = st.transform?.get(eid);
  if (!t) return false;
  const own = st.owner?.get(eid)?.player ?? 0;
  if (own > 0 && own <= 10 && own === src.viewer) return true; // always see your own
  return tileVisible(src, Math.floor(fn(t.x)), Math.floor(fn(t.y)));
}

/* ------------------------------------------------------------------ */
/* 1. ground                                                          */
/* ------------------------------------------------------------------ */

export function drawGround(
  ctx: Ctx2D,
  terrain: Terrain | null | undefined,
  cam: Camera,
  viewW: number,
  viewH: number,
  fog?: FogSource | null,
  expiredMask?: Uint8Array | null,
  maskCols = 0,
  maskX0 = 0,
  maskY0 = 0,
): void {
  ctx.save();
  ctx.fillStyle = '#0d1016';
  ctx.fillRect(0, 0, viewW, viewH);
  if (!terrain) { ctx.restore(); return; }
  const r = tilesInRange(cam, terrain.width, terrain.height);
  const ppu = cam.pxPerUnit();
  // one batched path per palette entry keeps fillStyle switches to ~9/frame
  for (let ti = 0; ti < TERRAIN.length; ti++) {
    const sw = TERRAIN[ti];
    let opened = false;
    ctx.fillStyle = sw.base;
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        if (terrain.tile(tx, ty) !== ti) continue;
        if (fog && fogStateAt(fog, tx, ty) === FOG_UNEXPLORED) continue;
        const sx = Math.floor(cam.worldToScreenX(ff(tx)));
        const sy = Math.floor(cam.worldToScreenY(ff(ty)));
        if (!opened) { ctx.beginPath(); opened = true; }
        ctx.rect(sx, sy, Math.ceil(ppu) + 1, Math.ceil(ppu) + 1);
      }
    }
    if (opened) ctx.fill();
  }
  // deterministic speckle texture, batched per tile id
  if (ppu >= 18) {
    for (let ti = 0; ti < TERRAIN.length; ti++) {
      const sw = TERRAIN[ti];
      let opened = false;
      ctx.fillStyle = withAlpha(sw.speck, 0.5);
      for (let ty = r.y0; ty <= r.y1; ty++) {
        for (let tx = r.x0; tx <= r.x1; tx++) {
          if (terrain.tile(tx, ty) !== ti) continue;
          if (fog && fogStateAt(fog, tx, ty) === FOG_UNEXPLORED) continue;
          const v = terrainVariant(tx, ty, ti);
          const bx = cam.worldToScreenX(ff(tx));
          const by = cam.worldToScreenY(ff(ty));
          if (!opened) { ctx.beginPath(); opened = true; }
          for (let k = 0; k < 3; k++) {
            const ox = (v * 7 + k * 23 + (hash2(tx, ty) & 7)) % 13;
            const oy = (v * 11 + k * 17 + (hash2(ty, tx) & 7)) % 13;
            ctx.rect(bx + (ox / 13) * ppu, by + (oy / 13) * ppu, Math.max(1, ppu * 0.06), Math.max(1, ppu * 0.06));
          }
        }
      }
      if (opened) ctx.fill();
    }
  }
  // cliff faces: darken the tile below a cliff run so elevation reads at a glance
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      if (terrain.tile(tx, ty) !== 3 && terrain.tile(tx, ty) !== 5) continue;
      if (!tileBelowIsCliff(terrain, tx, ty)) continue;
      ctx.rect(Math.floor(cam.worldToScreenX(ff(tx))), Math.floor(cam.worldToScreenY(ff(ty))), Math.ceil(ppu) + 1, Math.ceil(ppu * 0.34));
    }
  }
  ctx.fill();
  // water shimmer
  ctx.strokeStyle = withAlpha(TERRAIN[4].speck, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      if (terrain.tile(tx, ty) !== 4) continue;
      if (fog && fogStateAt(fog, tx, ty) === FOG_UNEXPLORED) continue;
      const ph = rand01(hash2(tx, ty), 3);
      const bx = cam.worldToScreenX(ff(tx));
      const by = cam.worldToScreenY(ff(ty)) + ppu * (0.28 + 0.4 * ph);
      ctx.moveTo(bx + ppu * 0.12, by);
      ctx.lineTo(bx + ppu * 0.5, by);
    }
  }
  ctx.stroke();
  // desaturating wash over previously-seen tiles (clipped to the fog mask)
  if (expiredMask && maskCols > 0) {
    ctx.save();
    clipExpired(ctx, expiredMask, maskCols, maskX0, maskY0, cam);
    ctx.fillStyle = FOG_EXPIRED_WASH;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }
  ctx.restore();
}

function tileBelowIsCliff(t: Terrain, tx: number, ty: number): boolean {
  return !(t.tile(tx, ty - 1) === 3 || t.tile(tx, ty - 1) === 5);
}

function tilesInRange(cam: Camera, mapW: number, mapH: number) {
  const r = cam.visibleTiles();
  return { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(mapW - 1, r.x1), y1: Math.min(mapH - 1, r.y1) };
}

/* ------------------------------------------------------------------ */
/* 2. entities (stable y-sort)                                        */
/* ------------------------------------------------------------------ */

export interface DrawEntityItem {
  eid: Eid;
  /** sort key: bottom edge of the footprint */
  sortY: number;
  /** stable tie-breaker */
  eidKey: number;
}

/**
 * Stable painter order: primary key `sortY`, secondary key ascending eid.
 * The explicit tie-break makes the order independent of Array#sort stability
 * and of insertion order, which matters because entities arrive from a Set.
 */
export function sortEntities(items: DrawEntityItem[]): DrawEntityItem[] {
  items.sort((a, b) => (a.sortY - b.sortY) || (a.eidKey - b.eidKey));
  return items;
}

export function collectEntities(game: Game, viewer: number): DrawEntityItem[] {
  const w = game.world;
  const st = stores(w);
  const fogSrc = fogSource(game, viewer);
  const out: DrawEntityItem[] = [];
  for (const e of w.live) {
    const eid = e as Eid;
    const t = st.transform?.get(eid);
    if (!t) continue;
    if (st.health?.get(eid)?.dead) continue;
    if (!entityVisible(st, fogSrc, eid)) continue;
    const b = st.building?.get(eid);
    const halfH = b ? (t.h * 0.5 - 0.15) : (fn(t.radius) || 0.3);
    out.push({ eid, sortY: fn(t.y) + halfH, eidKey: eid >>> 0 });
  }
  return sortEntities(out);
}

export function drawEntities(ctx: Ctx2D, game: Game, cam: Camera, alpha: number, atlas?: SpriteAtlas): void {
  const w = game.world;
  const st = stores(w);
  const viewer = viewerOf(game);
  const atl = atlas ?? new SpriteAtlas();
  const sel = selectionSet(game);
  const items = collectEntities(game, viewer);

  /* pass A: contact shadows, batched into one path */
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.34;
  ctx.beginPath();
  for (const it of items) {
    const p = entityScreenPos(st, it.eid, cam, alpha);
    if (!p) continue;
    const t = st.transform?.get(it.eid);
    if (!t) continue;
    if (st.building?.get(it.eid)) continue;
    if (st.movement?.get(it.eid)?.fly) continue;
    const rx = Math.max(3, cam.pxPerUnit() * (fn(t.radius) || 0.35) * 1.1);
    ellipsePath(ctx, p.sx, p.sy + 1, rx, rx * 0.42);
  }
  ctx.fill();
  ctx.restore();

  /* pass B: sprites */
  for (const it of items) {
    const eid = it.eid;
    const p = entityScreenPos(st, eid, cam, alpha);
    if (!p) continue;
    if (p.sx < -140 || p.sy < -220 || p.sx > cam.viewW + 140 || p.sy > cam.viewH + 160) continue;
    drawOneEntity(ctx, atl, st, game, eid, p.sx, p.sy, cam, alpha, sel.has(eid >>> 0));
  }
}

function drawOneEntity(
  ctx: Ctx2D,
  atl: SpriteAtlas,
  st: Stores,
  game: Game,
  eid: Eid,
  sx: number,
  sy: number,
  cam: Camera,
  alpha: number,
  selected: boolean,
): void {
  const t = st.transform?.get(eid);
  if (!t) return;
  const kind = st.kind?.get(eid)?.kind ?? KIND_UNIT;
  const zoom = cam.pxPerUnit() / TILE_SIZE_PX;

  if (selected) drawSelectionRing(ctx, sx, sy, t, cam, false);

  if (kind === KIND_BUILDING) {
    const b = st.building?.get(eid);
    const id = b?.buildingId ?? '';
    const ghost = !!b && !b.built;
    const key = atl.resolve('building', id, { race: raceOf(st, eid, id), ghost })?.key
      ?? bakeKey('building', id, { race: raceOf(st, eid, id), ghost });
    const px = footprintPx(t.w || 1, t.h || 1, TILE_SIZE_PX) * zoom;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    drawSprite(atl, ctx, key, sx, sy, false, px / slotOf(atl, key));
    ctx.restore();
    if (ghost && b) drawBuildProgress(ctx, sx, sy - px * 0.55, px, b.progress, b.totalTicks);
    return;
  }

  if (kind === KIND_ITEM) {
    const id = st.item?.get(eid)?.itemId ?? '';
    const key = atl.resolve('item', id)?.key ?? spriteKey('item', id);
    drawSprite(atl, ctx, key, sx, sy - 6 * zoom, false, (TILE_SIZE_PX * 0.55 * zoom) / slotOf(atl, key));
    return;
  }

  if (kind === KIND_MISSILE) {
    const m = st.missile?.get(eid);
    const key = atl.resolve('missile', m?.kind ?? 'magic_missile')?.key ?? spriteKey('missile', m?.kind ?? 'magic_missile');
    ctx.save();
    ctx.translate(sx, sy - 14 * zoom);
    const tgt = m && m.targetEid !== NULL_EID ? st.transform?.get(m.targetEid as Eid) : null;
    if (tgt) ctx.rotate(Math.atan2(cam.worldToScreenY(tgt.y) - (sy - 14 * zoom), cam.worldToScreenX(tgt.x) - sx));
    drawSprite(atl, ctx, key, 0, 0, false, (TILE_SIZE_PX * 0.4 * zoom) / slotOf(atl, key));
    ctx.restore();
    return;
  }

  if (kind === KIND_DECORATION) {
    const key = atl.resolve('decoration', decoIdFor(t))?.key ?? spriteKey('decoration', 'tree');
    drawSprite(atl, ctx, key, sx, sy, false, (TILE_SIZE_PX * 1.5 * zoom) / slotOf(atl, key));
    return;
  }

  /* ---- unit ---- */
  const s = st.stats?.get(eid);
  const id = s?.id ?? '';
  const hero = !!s?.isHero || isHeroId(id);
  const fly = !!st.movement?.get(eid)?.fly;
  const key = atl.resolve('unit', id, { race: raceOf(st, eid, id), hero, fly })?.key
    ?? bakeKey('unit', id, { race: raceOf(st, eid, id), hero });
  const scale = (hero ? 1.28 : 1) * (fly ? 1.05 : 1) * zoom;
  const bob = fly ? Math.sin((game.world.tick + (eid & 7)) * 0.18) * 2.5 * zoom : 0;

  ctx.save();
  if (fly) ctx.translate(0, -8 * zoom);
  if (bob) ctx.translate(0, bob);
  // face left/right from the deterministic facing angle
  const flip = facingFlips(st, eid);
  drawSprite(atl, ctx, key, sx, sy, flip, scale);

  // hit flash: white silhouette for a few ticks after damage
  const atk = st.attack?.get(eid);
  const flash = hitFlash(st, eid, game.world.tick, alpha);
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.75;
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(atl, ctx, key, sx, sy, flip, scale);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // dying units fade toward bone-white
  const h = st.health?.get(eid);
  if (h?.dead && h.deathTick) {
    const age = game.world.tick - h.deathTick;
    const a = Math.max(0, 1 - age / 300);
    ctx.save();
    ctx.globalAlpha = a * 0.8;
    ctx.globalCompositeOperation = 'saturation';
    drawSprite(atl, ctx, key, sx, sy, flip, scale);
    ctx.restore();
  }
  void atk;
}

/** True when the unit's heading points screen-left (mirror the sprite). */
function facingFlips(st: Stores, eid: Eid): boolean {
  const t = st.transform?.get(eid);
  if (!t || !t.facing) return false;
  const deg = stepsToDeg(t.facing);
  return deg > 90 && deg < 270;
}

/** Decaying [0..1] white-flash weight right after a hit was registered. */
export function hitFlash(st: Stores, eid: Eid, tick: number, alpha: number): number {
  const c = (st as { lastHit?: { get(e: Eid): { tick: number } | undefined } }).lastHit?.get(eid);
  if (!c) return 0;
  const age = tick - c.tick + (1 - alpha);
  return age <= 2 ? 1 - age / 3 : 0;
}

function slotOf(atl: SpriteAtlas, key: string): number {
  return atl.entry(key)?.box ?? 64;
}

function raceOf(st: Stores, eid: Eid, id: string): string {
  const r = st.stats?.get(eid)?.race;
  if (r && r !== 'neutral') return r;
  return guessRace(id);
}

function decoIdFor(t: STransform): string {
  // deterministic pseudo-variant so forests are not all identical
  const h = hash2(Math.floor(fn(t.x)), Math.floor(fn(t.y)));
  const n = h & 3;
  return n === 0 ? 'shrub' : n === 1 ? 'pine' : n === 2 ? 'rock' : 'tree';
}

/* ------------------------------------------------------------------ */
/* 3. fog                                                             */
/* ------------------------------------------------------------------ */

export function fogSource(game: Game, viewer: number): FogSource {
  const f = game.fog as FogOfWar | null;
  const terr = game.terrain;
  return {
    fog: f ? { stateAt: (tx, ty, p) => f.state(tx, ty, p), isVisibleTile: (tx, ty, p) => f.isVisibleTile(tx, ty, p), exploredTile: (tx, ty, p) => f.exploredTile(tx, ty, p) } : null,
    viewer,
    mapW: terr?.width ?? 1,
    mapH: terr?.height ?? 1,
  };
}

/** Tile grid -> pixel-space rect mapping, exposed for tests. */
export function fogPixelRect(
  _fog: FogSource,
  cam: Camera,
  mapW: number,
  mapH: number,
): { x0: number; y0: number; cols: number; rows: number; px: number; py: number } {
  const r = fogTileRange(cam, mapW, mapH);
  const origin = cam.worldToScreen(ff(r.x0), ff(r.y0));
  return { ...r, px: origin.sx, py: origin.sy };
}

export function drawFog(
  ctx: Ctx2D,
  fog: FogOfWar | null | undefined,
  cam: Camera,
  w: number,
  h: number,
  viewer: number,
  game?: Game,
): Uint8Array | null {
  const terr = game?.terrain;
  const mapW = terr?.width ?? fog?.width ?? 1;
  const mapH = terr?.height ?? fog?.height ?? 1;
  void fog;
  const src: FogSource = game ? fogSource(game, viewer) : { fog: null, viewer, mapW, mapH };
  const r = fogTileRange(cam, mapW, mapH);
  const scratch = fogScratch(r.cols * r.rows * 4);
  const data = scratch.data;
  fillFogImageData(data, src, r.x0, r.y0, r.cols, r.rows);
  const surf = scratch.surface;
  const sctx = scratch.sctx;
  const origin = cam.worldToScreen(ff(r.x0), ff(r.y0));
  let img = scratch.img;
  if (!img || scratch.imgCols !== r.cols || scratch.imgRows !== r.rows) {
    img = makeImageData(r.cols, r.rows);
    scratch.img = img;
    scratch.imgCols = r.cols;
    scratch.imgRows = r.rows;
    scratch.cols = -1;
  }
  const cell = cam.pxPerUnit();
  const dw = r.cols * cell;
  const dh = r.rows * cell;
  if (surf && sctx && img) {
    img.data.set(data.subarray(0, r.cols * r.rows * 4));
    sctx.clearRect(0, 0, r.cols, r.rows);
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(surf as never, origin.sx, origin.sy, dw, dh);
    ctx.restore();
  } else {
    // fallback: one rect per non-visible tile (still no per-pixel loop)
    ctx.save();
    for (let row = 0; row < r.rows; row++) {
      for (let col = 0; col < r.cols; col++) {
        const st = fogStateAt(src, r.x0 + col, r.y0 + row);
        if (st === FOG_VISIBLE) continue;
        ctx.globalAlpha = st === FOG_UNEXPLORED ? 1 : 0.55;
        ctx.fillStyle = st === FOG_UNEXPLORED ? '#000000' : '#12141a';
        ctx.fillRect(origin.sx + col * cell, origin.sy + row * cell, cell + 1, cell + 1);
      }
    }
    ctx.restore();
  }
  // return the expired-mask so drawGround can desaturate those tiles next frame
  const mask = new Uint8Array(r.cols * r.rows);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 40 && data[i * 4 + 3] < 200 ? 1 : 0;
  scratch.cols = r.cols;
  scratch.rows = r.rows;
  void w; void h;
  return mask;
}

interface FogScratch {
  surface: HTMLCanvasElement | OffscreenCanvas | null;
  sctx: Ctx2D | null;
  img: ImageData | null;
  imgCols: number;
  imgRows: number;
  data: Uint8ClampedArray;
  cols: number;
  rows: number;
}
let fogCache: FogScratch | null = null;

/** Allocate ImageData via the DOM when present, else a plain-array shim. */
export function makeImageData(cols: number, rows: number): ImageData {
  const g = globalThis as unknown as { createImageData?: (w: number, h: number) => ImageData; document?: { createElement(t: 'canvas'): HTMLCanvasElement } };
  if (typeof g.createImageData === 'function') return g.createImageData(cols, rows);
  if (g.document?.createElement) {
    const c = g.document.createElement('canvas');
    c.width = cols; c.height = rows;
    const cc = (c as unknown as { getContext(t: '2d'): { createImageDataSource?: never } & CanvasRenderingContext2D }).getContext('2d');
    if (cc?.createImageData) return cc.createImageData(cols, rows);
  }
  return { data: new Uint8ClampedArray(cols * rows * 4), width: cols, height: rows } as unknown as ImageData;
}

function fogScratch(minBytes: number): FogScratch {
  if (!fogCache) {
    const data = new Uint8ClampedArray(Math.max(minBytes, 4096));
    fogCache = { surface: null, sctx: null, img: null, imgCols: -1, imgRows: -1, data, cols: -1, rows: -1 };
  }
  if (fogCache.data.length < minBytes) fogCache.data = new Uint8ClampedArray(minBytes);
  if (fogCache.surface === null) {
    const g = globalThis as unknown as {
      document?: { createElement(t: 'canvas'): HTMLCanvasElement };
      OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas;
      createImageBitmap?: unknown;
    };
    if (g.document?.createElement) {
      const c = g.document.createElement('canvas');
      fogCache.surface = c;
      fogCache.sctx = (c as unknown as { getContext(t: '2d'): Ctx2D | null }).getContext('2d');
    } else if (g.OffscreenCanvas) {
      const c = new g.OffscreenCanvas(1, 1);
      fogCache.surface = c;
      fogCache.sctx = (c as unknown as { getContext(t: '2d'): Ctx2D | null }).getContext('2d');
    } else {
      fogCache.surface = undefined as never;
    }
  }
  return fogCache;
}

/** Clip to the union of expired tiles using an even-odd path (one fill). */
function clipExpired(ctx: Ctx2D, mask: Uint8Array, cols: number, x0: number, y0: number, cam: Camera): void {
  const cell = cam.pxPerUnit();
  ctx.beginPath();
  for (let row = 0; row * cols < mask.length; row++) {
    for (let col = 0; col < cols; col++) {
      if (!mask[row * cols + col]) continue;
      const o = cam.worldToScreen(ff(x0 + col), ff(y0 + row));
      ctx.rect(o.sx, o.sy, cell + 1, cell + 1);
    }
  }
  ctx.clip();
}

/* ------------------------------------------------------------------ */
/* 4. overlays                                                        */
/* ------------------------------------------------------------------ */

export function drawOverlays(
  ctx: Ctx2D,
  game: Game,
  cam: Camera,
  opts: { particles?: ParticleSystem; floaters?: FloaterLayer; alpha?: number } = {},
): void {
  const st = stores(game.world);
  const viewer = viewerOf(game);
  const src = fogSource(game, viewer);
  const sel = selectionSet(game);
  const alpha = opts.alpha ?? 1;
  const hover = (game.world.view as { hoverEid?: number }).hoverEid ?? NULL_EID;
  const zoom = cam.pxPerUnit() / TILE_SIZE_PX;

  /* health / mana bars + hero badges, batched by colour */
  const bars: { x: number; y: number; w: number; h: number; frac: number; color: string; low: boolean }[] = [];
  for (const e of game.world.live) {
    const eid = e as Eid;
    const h = st.health?.get(eid);
    if (!h || h.dead) continue;
    if (!st.transform?.get(eid)) continue;
    if (!entityVisible(st, src, eid)) continue;
    const p = entityScreenPos(st, eid, cam, alpha);
    if (!p) continue;
    if (p.sx < -80 || p.sy < -80 || p.sx > cam.viewW + 80 || p.sy > cam.viewH + 80) continue;
    const b = st.building?.get(eid);
    const s = st.stats?.get(eid);
    const t = st.transform?.get(eid)!;
    const wpx = b ? footprintPx(t.w || 1, t.h || 1, TILE_SIZE_PX) * zoom * 0.8
      : Math.max(20, cam.pxPerUnit() * (fn(t.radius) || 0.35) * 2.1);
    const above = b ? footprintPx(t.w || 1, t.h || 1, TILE_SIZE_PX) * zoom * 0.62 : 26 * zoom * (s?.isHero ? 1.5 : 1);
    const frac = h.hpMax > 0 ? clamp01(h.hp / h.hpMax) : 1;
    bars.push({ x: p.sx - wpx / 2, y: p.sy - above, w: wpx, h: Math.max(3, 4 * zoom), frac, color: healthBarColor(st.owner?.get(eid)?.player ?? 0), low: frac < 0.34 });
    if (s?.isHero) heroBadge(ctx, p.sx - wpx / 2 - 9 * zoom, p.sy - above - 1, s.level, zoom);
    if (h.mpMax > 0) {
      const mf = clamp01(h.mp / h.mpMax);
      ctx.fillStyle = UI.hpBack;
      ctx.fillRect(p.sx - wpx / 2, p.sy - above + 4 * zoom, wpx, Math.max(2, 2.5 * zoom));
      ctx.fillStyle = UI.mpBar;
      ctx.fillRect(p.sx - wpx / 2, p.sy - above + 4 * zoom, wpx * mf, Math.max(2, 2.5 * zoom));
    }
  }
  // back plates in one path, then fills grouped by colour
  ctx.save();
  ctx.fillStyle = UI.hpBack;
  ctx.beginPath();
  for (const bar of bars) ctx.rect(bar.x, bar.y, bar.w, bar.h);
  ctx.fill();
  const groups = new Map<string, typeof bars>();
  for (const bar of bars) {
    const k = bar.low ? '__low' : bar.color;
    const g = groups.get(k);
    if (g) g.push(bar); else groups.set(k, [bar]);
  }
  for (const [k, list] of groups) {
    ctx.fillStyle = k === '__low' ? UI.hpLow : k;
    ctx.beginPath();
    for (const bar of list) ctx.rect(bar.x, bar.y, bar.w * bar.frac, bar.h);
    ctx.fill();
  }
  ctx.restore();

  /* selection rings + hover ring */
  for (const eid of sel) drawSelectionFor(ctx, st, game, eid as Eid, cam, alpha, false);
  if (hover !== NULL_EID) drawSelectionFor(ctx, st, game, hover as Eid, cam, alpha, true);

  /* build-site ghosts (rally lines) */
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = withAlpha(UI.indicator, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const e of game.world.live) {
    const b = st.building?.get(e as Eid);
    if (!b || !b.built || !b.rallyX) continue;
    const t = st.transform?.get(e as Eid);
    if (!t) continue;
    if (!entityVisible(st, src, e as Eid)) continue;
    const a = cam.worldToScreen(t.x, t.y);
    const c = cam.worldToScreen(b.rallyX, b.rallyY);
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(c.sx, c.sy);
  }
  ctx.stroke();
  ctx.restore();

  /* particles */
  const ps = opts.particles;
  if (ps) {
    ps.forEach((p) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.fade));
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + p.fade * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    });
    ctx.globalAlpha = 1;
  }
  /* damage floaters */
  const fl = opts.floaters;
  if (fl) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(13)}px system-ui, sans-serif`;
    fl.forEach((f) => {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.ttl));
      ctx.lineWidth = 3;
      ctx.strokeStyle = UI.textShadow;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.crit ? UI.crit : f.color;
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.restore();
  }
}

function drawSelectionFor(ctx: Ctx2D, st: Stores, game: Game, eid: Eid, cam: Camera, alpha: number, soft: boolean): void {
  if (!game.world.alive(eid)) return;
  const p = entityScreenPos(st, eid, cam, alpha);
  const t = st.transform?.get(eid);
  if (!p || !t) return;
  drawSelectionRing(ctx, p.sx, p.sy, t, cam, soft);
}

export function drawSelectionRing(ctx: Ctx2D, sx: number, sy: number, t: STransform, cam: Camera, soft: boolean): void {
  const zoom = cam.pxPerUnit() / TILE_SIZE_PX;
  const b = (t.w || 0) > 1;
  ctx.save();
  ctx.strokeStyle = soft ? UI.hoverRing : UI.selectionRing;
  ctx.lineWidth = soft ? 1.5 : 2;
  ctx.globalAlpha = soft ? 0.7 : 0.95;
  if (b) {
    const w = footprintPx(t.w, t.h, TILE_SIZE_PX) * zoom * 0.92;
    ctx.strokeRect(sx - w / 2, sy - w * 0.22, w, w * 0.42);
  } else {
    const rx = Math.max(7, cam.pxPerUnit() * (fn(t.radius) || 0.35) * 1.5);
    ellipsePath(ctx, sx, sy, rx, rx * 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

function heroBadge(ctx: Ctx2D, x: number, y: number, level: number, zoom: number): void {
  const r = 6.5 * zoom;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y - r);
  ctx.lineTo(x + r, y + r * 0.35);
  ctx.lineTo(x, y + r * 1.2);
  ctx.lineTo(x - r, y + r * 0.35);
  ctx.closePath();
  ctx.fillStyle = UI.heroBadge;
  ctx.fill();
  ctx.strokeStyle = '#6b4f10';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#241a05';
  ctx.font = `bold ${Math.max(7, Math.round(8 * zoom))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(String(level | 0), x, y + r * 0.62);
  ctx.restore();
}

function drawBuildProgress(ctx: Ctx2D, x: number, y: number, w: number, remaining: number, total: number): void {
  const frac = total > 0 ? clamp01(1 - remaining / total) : 1;
  const bw = Math.max(18, w * 0.7);
  ctx.save();
  ctx.fillStyle = UI.hpBack;
  ctx.fillRect(x - bw / 2, y, bw, 5);
  ctx.fillStyle = UI.scaffold;
  ctx.fillRect(x - bw / 2, y, bw * frac, 5);
  ctx.strokeStyle = withAlpha('#ffffff', 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(x - bw / 2 + 0.5, y + 0.5, bw - 1, 4);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 5. debug                                                           */
/* ------------------------------------------------------------------ */

export function drawDebug(ctx: Ctx2D, game: Game, cam: Camera): void {
  const st = stores(game.world);
  const alpha = 1;
  ctx.save();

  // collision circles
  ctx.strokeStyle = 'rgba(255,120,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const e of game.world.live) {
    const t = st.transform?.get(e as Eid);
    if (!t) continue;
    const p = entityScreenPos(st, e as Eid, cam, alpha);
    if (!p) continue;
    const r = cam.pxPerUnit() * (fn(t.radius) || 0.3);
    ellipsePath(ctx, p.sx, p.sy, r, r);
  }
  ctx.stroke();

  // pathfinding grid
  const grid = game.grid as { passable?(tx: number, ty: number): boolean } | undefined;
  if (grid?.passable) {
    const r = tilesInRange(cam, game.terrain.width, game.terrain.height);
    ctx.strokeStyle = 'rgba(90,200,255,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        if (grid.passable(tx, ty)) continue;
        const o = cam.worldToScreen(ff(tx), ff(ty));
        ctx.rect(o.sx, o.sy, cam.pxPerUnit(), cam.pxPerUnit());
      }
    }
    ctx.stroke();
  }

  // quadtree nodes
  const qt = game.quad as unknown as QuadNode | undefined;
  if (qt) {
    ctx.strokeStyle = 'rgba(255,255,120,0.22)';
    ctx.beginPath();
    quadRects(ctx, cam, qt, 0);
    ctx.stroke();
  }

  // command vectors
  ctx.strokeStyle = 'rgba(120,255,160,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const e of game.world.live) {
    const o = st.orders?.get(e as Eid);
    const t = st.transform?.get(e as Eid);
    if (!o || !t || o.current.kind === 'none') continue;
    const a = cam.worldToScreen(t.x, t.y);
    const dst = o.current.targetEid !== NULL_EID
      ? st.transform?.get(o.current.targetEid as Eid)
      : null;
    const bx = dst ? dst.x : o.current.tx;
    const by = dst ? dst.y : o.current.ty;
    if (!bx && !by) continue;
    const b = cam.worldToScreen(bx, by);
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
  }
  ctx.stroke();
  ctx.restore();
}

interface QuadNode { minX: Fixed; minY: Fixed; maxX: Fixed; maxY: Fixed; children?: QuadNode[] }

function quadRects(ctx: Ctx2D, cam: Camera, node: QuadNode, depth: number): void {
  if (depth > 6) return;
  const a = cam.worldToScreen(node.minX, node.minY);
  const b = cam.worldToScreen(node.maxX, node.maxY);
  ctx.rect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
  const kids = node.children as QuadNode[] | undefined;
  if (kids) for (const k of kids) quadRects(ctx, cam, k, depth + 1);
}

/* ------------------------------------------------------------------ */
/* small shared helpers                                               */
/* ------------------------------------------------------------------ */

export function ellipsePath(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  if (typeof ctx.ellipse === 'function') ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  else ctx.arc(cx, cy, Math.max(0.1, rx), 0, Math.PI * 2);
}

export function viewerOf(game: Game): number {
  const v = (game as { viewer?: number }).viewer;
  if (typeof v === 'number' && v > 0) return v;
  const players = game.players;
  if (players) for (const p of players) if (p && p.active && !p.defeated) return p.id;
  return 1;
}

export function selectionSet(game: Game): Set<number> {
  const sel = (game.world.view as { selection?: number[] }).selection ?? [];
  const s = new Set<number>();
  for (const e of sel) s.add(e >>> 0);
  return s;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

void shadeHex; void tintHex; void shadowBlob; void playerColor; void racePalette; void terrainSwatch; void desaturateHex; void KIND_UNIT;
