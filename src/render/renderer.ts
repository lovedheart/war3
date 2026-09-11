/**
 * Renderer: the only object in the view layer that owns canvas state.
 *
 * It is strictly READ-ONLY with respect to the simulation — it walks
 * `game.world.live` through the component stores and never assigns a sim
 * field. All cosmetic state (atlas, particles, floaters, hit-flash timers)
 * lives here so it can never perturb `stateHash()`.
 *
 * Node-safe: no DOM access happens at import time; every `createElement` is
 * inside a lazily-called function so importing this module under vitest (node)
 * cannot throw.
 */
import { Fixed, ff, fn } from '../core/fixed.js';
import { TICK_RATE } from '../core/constants.js';
import type { Eid } from '../core/pool.js';
import type { Game } from '../sim/index.js';
import { Camera } from './camera.js';
import { SpriteAtlas, registerStock, guessRace } from './atlas.js';
import { MinimapRenderer, blipColor, MINIMAP_BLIP_SIZE, type MinimapBlip } from './minimap.js';
import { ParticleSystem, FloaterLayer, emitHit, emitDeath, emitBuild } from './particles.js';
import { UNIT_SHAPES, BUILDING_SHAPES, ITEM_SHAPES, DECORATION_SHAPES, MISSILE_SHAPES } from './draw/spec.js';
import type { Ctx2D } from './draw/spec.js';
import {
  drawGround, drawEntities, drawFog, drawOverlays, drawDebug,
  stores, fogSource, viewerOf, entityVisible, entityScreenPos, sortEntities,
  type Stores,
} from './layers.js';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  debug?: boolean;
  /** bake the stock roster up-front instead of lazily (default true) */
  warmAtlas?: boolean;
  /** draw the minimap into the main canvas (default false — UI layer owns it) */
  showMinimap?: boolean;
}

export interface RenderStats {
  frameMs: number;
  entities: number;
  drawn: number;
  sprites: number;
  particles: number;
  pages: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx2D;
  readonly cam: Camera;
  readonly atlas: SpriteAtlas;
  readonly particles = new ParticleSystem(1536);
  readonly floaters = new FloaterLayer(192);
  readonly minimap: MinimapRenderer;
  debug = false;
  showMinimap: boolean;

  /** device pixel ratio applied as the base transform */
  private dpr = 1;
  private cssW = 640;
  private cssH = 360;
  /** last frame's world positions, for camera-independent particle anchoring */
  private lastFrame = 0;
  private clock = 0;
  private offs: (() => void)[] = [];
  private flash = new Map<Eid, number>();
  private destroyed = false;
  readonly stats: RenderStats = { frameMs: 0, entities: 0, drawn: 0, sprites: 0, particles: 0, pages: 0 };

  constructor(opts: RendererOptions) {
    this.canvas = opts.canvas;
    const ctx = (this.canvas as unknown as { getContext(t: '2d'): Ctx2D | null }).getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.showMinimap = opts.showMinimap ?? false;
    this.cam = new Camera({ viewW: this.cssW, viewH: this.cssH, bounds: { width: 128, height: 128 } });
    // Reuse the host canvas as the atlas page surface when no offscreen backend
    // exists (node/vitest). The atlas then shares this ctx — safe because bake
    // calls always sit inside an explicit save/restore in SpriteAtlas.
    const g = globalThis as unknown as { document?: unknown; OffscreenCanvas?: unknown };
    const hasBackend = !!g.document || !!g.OffscreenCanvas;
    const hostCtx = ctx;
    this.atlas = hasBackend ? new SpriteAtlas() : new SpriteAtlas(() => {
      (this.canvas as unknown as { __atlasCtx?: Ctx2D }).__atlasCtx = hostCtx;
      return this.canvas;
    });
    if (opts.warmAtlas !== false) this.warm();
    this.minimap = new MinimapRenderer({ size: 150 });
    this.debug = opts.debug ?? false;
  }

  /** Bake every silhouette named in the art spec so frame 1 has no hitches. */
  warm(): void {
    try {
      registerStock(this.atlas, {
        unit: [...UNIT_SHAPES],
        building: [...BUILDING_SHAPES],
        item: [...ITEM_SHAPES],
        decoration: [...DECORATION_SHAPES],
        missile: [...MISSILE_SHAPES],
      });
    } catch {
      /* headless / no canvas backend — sprites resolve lazily or fall back */
    }
  }

  /** Resize the backing store to CSS size x dpr and rebuild the base transform. */
  resize(cssW: number, cssH: number, dpr = 1): void {
    this.cssW = Math.max(1, cssW | 0);
    this.cssH = Math.max(1, cssH | 0);
    this.dpr = dpr > 0 ? dpr : 1;
    const cv = this.canvas as unknown as { width: number; height: number };
    const w = Math.max(1, Math.round(this.cssW * this.dpr));
    const h = Math.max(1, Math.round(this.cssH * this.dpr));
    // Only touch the backing store on an actual change: assigning width/height
    // resets all context state (fonts, smoothing, transforms) and reallocates.
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    this.cam.setView(this.cssW, this.cssH);
  }

  setDebug(on: boolean): void { this.debug = !!on; }

  /** Point the camera at a world position (fixed). */
  centerOn(x: Fixed, y: Fixed): void { this.cam.centerOn(x, y); }

  /** Pan by screen pixels (edge scrolling / WASD). */
  panByPixels(dx: number, dy: number): void { this.cam.panByPixels(dx, dy); }

  /** Wheel zoom about the viewport centre. */
  zoomBy(factor: number): void { this.cam.zoomBy(factor); }

  /** Screen px -> world fixed, for hit-testing and order targets. */
  screenToWorld(sx: number, sy: number): { x: Fixed; y: Fixed } { return this.cam.screenToWorld(sx, sy); }

  /* ------------------------------------------------------------------ */
  /* main entry                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Draw one frame. `alpha` ∈ [0,1] interpolates within the last tick.
   * Never mutates simulation state; tolerant of half-wired subsystems.
   */
  render(game: Game, alpha: number): void {
    if (this.destroyed || !game || !game.world) return;
    const t0 = nowMs();
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    const w = game.world;
    const terr = game.terrain as { width?: number; height?: number } | undefined;
    const mapW = Math.max(1, terr?.width ?? 1);
    const mapH = Math.max(1, terr?.height ?? 1);
    this.cam.setBounds(mapW, mapH);

    // keep the camera in sync with whatever the sim/app recorded
    const view = w.view as { cameraX?: Fixed; cameraY?: Fixed; zoom?: Fixed };
    if (typeof view.cameraX === 'number' && typeof view.cameraY === 'number') {
      this.cam.x = view.cameraX;
      this.cam.y = view.cameraY;
      if (typeof view.zoom === 'number') this.cam.zoom = view.zoom;
      this.cam.clamp();
    }

    const dt = this.dtSeconds(t0);
    const viewer = viewerOf(game);
    this.hookEvents(game);
    this.particles.update(dt);
    this.floaters.update(dt);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const src = fogSource(game, viewer);
    drawGround(ctx, game.terrain, this.cam, this.cssW, this.cssH, src, this.expiredMask, this.maskCols, this.maskX0, this.maskY0);
    drawEntities(ctx, game, this.cam, a, this.atlas);
    const mask = drawFog(ctx, game.fog, this.cam, this.cssW, this.cssH, viewer, game);
    if (mask) {
      const r = fogRange(this.cam, mapW, mapH);
      this.expiredMask = mask;
      this.maskCols = r.cols;
      this.maskX0 = r.x0;
      this.maskY0 = r.y0;
    }
    drawOverlays(ctx, game, this.cam, { particles: this.particles, floaters: this.floaters, alpha: a });
    if (this.debug) drawDebug(ctx, game, this.cam);
    if (this.showMinimap) this.drawMinimap(game, viewer);

    this.stats.frameMs = nowMs() - t0;
    this.stats.entities = w.live.length;
    this.stats.sprites = this.atlas.stats().sprites;
    this.stats.pages = this.atlas.stats().pages;
    this.stats.particles = this.particles.snapshot().live;
  }

  /** Convenience for the app loop: advance + draw without touching sim state. */
  renderGame(game: Game, alpha: number): void { this.render(game, alpha); }

  destroy(): void {
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.particles.clear();
    this.floaters.clear();
    this.flash.clear();
    this.atlas.dispose();
  }

  /* ------------------------------------------------------------------ */
  /* minimap                                                            */
  /* ------------------------------------------------------------------ */

  /** Blip list for the current viewer (visibility-filtered). */
  collectBlips(game: Game, viewer: number): MinimapBlip[] {
    const st = stores(game.world);
    const src = fogSource(game, viewer);
    const out: MinimapBlip[] = [];
    for (const e of game.world.live) {
      const eid = e as Eid;
      const t = st.transform?.get(eid);
      if (!t) continue;
      if (st.health?.get(eid)?.dead) continue;
      if (!entityVisible(st, src, eid)) continue;
      const own = st.owner?.get(eid)?.player ?? 0;
      const b = st.building?.get(eid);
      const k = st.kind?.get(eid)?.kind ?? 0;
      out.push({
        x: t.x, y: t.y,
        color: blipColor(own, own > 10),
        size: b ? MINIMAP_BLIP_SIZE + 1 : MINIMAP_BLIP_SIZE,
        kind: b ? 'building' : k === 2 ? 'item' : 'unit',
      });
    }
    return out;
  }

  /** Terrain byte array for the minimap (cached per renderer). */
  private terrainBytes(terrain: { width: number; height: number; tile(tx: number, ty: number): number }): Uint8Array {
    const key = terrain.width * 65536 + terrain.height;
    if (this.tbKey === key && this.tb) return this.tb;
    const n = terrain.width * terrain.height;
    const arr = new Uint8Array(n);
    let i = 0;
    for (let y = 0; y < terrain.height; y++) for (let x = 0; x < terrain.width; x++) arr[i++] = terrain.tile(x, y);
    this.tb = arr;
    this.tbKey = key;
    this.minimap.invalidate();
    return arr;
  }
  private tb: Uint8Array | null = null;
  private tbKey = -1;

  drawMinimap(game: Game, viewer: number, x?: number, y?: number): void {
    const terr = game.terrain as { width: number; height: number; tile(tx: number, ty: number): number } | undefined;
    if (!terr) return;
    this.minimap.draw(
      this.ctx, this.cam, this.collectBlips(game, viewer),
      terr.width, terr.height, this.terrainBytes(terr), fogSource(game, viewer),
      x ?? (this.cssW - this.minimap.size - 6), y ?? 6,
    );
  }

  /* ------------------------------------------------------------------ */
  /* cosmetic event hooks                                               */
  /* ------------------------------------------------------------------ */

  private hookEvents(game: Game): void {
    if (this.hooked === game) return;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.hooked = game;
    const bus = game.world.bus as unknown as { on(t: string, fn: (p: never) => void): () => void };
    if (!bus?.on) return;
    const st = stores(game.world);

    this.offs.push(bus.on('damage', (p: { src: Eid; dst: Eid; amount: number }) => {
      const pxy = this.screenOf(st, p.dst);
      if (!pxy) return;
      this.flash.set(p.dst, this.clock);
      const atkType = (st as { damage?: { get(e: Eid): { attackType: string } | undefined } }).damage?.get(p.src as Eid)?.attackType ?? 'normal';
      emitHit(this.particles, pxy.sx, pxy.sy - 14, atkType);
      this.floaters.push(String(Math.max(1, Math.round(fn(p.amount ?? 0)))), pxy.sx, pxy.sy - 26, '#ffffff');
    }));

    this.offs.push(bus.on('unit:died', (p: { eid: Eid }) => {
      const pxy = this.screenOf(st, p.eid);
      if (pxy) emitDeath(this.particles, pxy.sx, pxy.sy - 12, true);
      this.flash.delete(p.eid);
    }));

    this.offs.push(bus.on('building:constructed', (p: { eid: Eid }) => {
      const pxy = this.screenOf(st, p.eid);
      if (pxy) emitBuild(this.particles, pxy.sx, pxy.sy - 30);
    }));

    this.offs.push(bus.on('ability:cast', (p: { caster: Eid }) => {
      const pxy = this.screenOf(st, p.caster);
      if (pxy) this.particles.emit('spark', pxy.sx, pxy.sy - 22, { count: 10, colors: ['#d8b6ff', '#7ce0ff', '#ffffff'] });
    }));
  }
  private hooked: Game | null = null;

  private screenOf(st: Stores, eid: Eid): { sx: number; sy: number } | null {
    return entityScreenPos(st, eid, this.cam, 1);
  }

  /* ------------------------------------------------------------------ */
  /* internals                                                          */
  /* ------------------------------------------------------------------ */

  private expiredMask: Uint8Array | null = null;
  private maskCols = 0;
  private maskX0 = 0;
  private maskY0 = 0;

  private dtSeconds(t0: number): number {
    if (!this.lastFrame) { this.lastFrame = t0; return 1 / TICK_RATE; }
    const d = (t0 - this.lastFrame) / 1000;
    this.lastFrame = t0;
    this.clock += d;
    return d > 0 && d < 0.25 ? d : 1 / TICK_RATE;
  }
}

function fogRange(cam: Camera, mapW: number, mapH: number): { x0: number; y0: number; cols: number; rows: number } {
  const t = cam.visibleTiles();
  const x0 = Math.max(0, t.x0 - 1);
  const y0 = Math.max(0, t.y0 - 1);
  const x1 = Math.min(mapW - 1, t.x1 + 1);
  const y1 = Math.min(mapH - 1, t.y1 + 1);
  return { x0, y0, cols: Math.max(1, x1 - x0 + 1), rows: Math.max(1, y1 - y0 + 1) };
}

function nowMs(): number {
  const g = globalThis as unknown as { performance?: { now(): number } };
  return g.performance?.now ? g.performance.now() : Date.now();
}

void ff; void fn; void guessRace; void sortEntities;
