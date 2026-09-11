/**
 * Minimap: terrain colours + fog, entity blips, the viewport rectangle and the
 * click/double-click transform used to jump the camera.
 */
import type { Ctx2D } from './draw/spec.js';
import { Camera, MinimapTransform } from './camera.js';
import { TERRAIN, desaturateHex, playerColor } from './palette.js';
import { FOG_EXPIRED, FOG_UNEXPLORED } from '../core/constants.js';
import { fogStateAt, type FogSource } from './fogmask.js';

export interface MinimapBlip {
  x: number; // world fixed
  y: number;
  color: string;
  size: number;
  /** 'unit' | 'building' | 'item' | 'creep' — affects shape */
  kind: string;
}

export interface MinimapOptions {
  /** px edge of the square minimap surface */
  size?: number;
  showFog?: boolean;
}

export class MinimapRenderer {
  readonly size: number;
  private surface: HTMLCanvasElement | OffscreenCanvas | null = null;
  private sctx: Ctx2D | null = null;
  private terrainDirty = true;
  private lastMapHash = -1;
  readonly transformOf: (cam: Camera) => MinimapTransform;

  constructor(opts: MinimapOptions = {}) {
    this.size = Math.max(32, opts.size ?? 150);
    this.showFog = opts.showFog !== false;
    this.transformOf = (cam) => cam.minimapTransform(this.size);
  }

  readonly showFog: boolean;

  /** Re-render the static terrain layer (call when the map changes). */
  invalidate(): void {
    this.terrainDirty = true;
  }

  private ensure(): void {
    if (this.surface) return;
    const g = globalThis as unknown as {
      document?: { createElement(t: 'canvas'): HTMLCanvasElement };
      OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas;
    };
    let c: HTMLCanvasElement | OffscreenCanvas | null = null;
    if (g.document?.createElement) c = g.document.createElement('canvas');
    else if (g.OffscreenCanvas) c = new g.OffscreenCanvas(1, 1);
    if (!c) return;
    (c as unknown as { width: number; height: number }).width = this.size;
    (c as unknown as { height: number }).height = this.size;
    this.surface = c;
    this.sctx = (c as unknown as { getContext(t: '2d'): Ctx2D | null }).getContext('2d');
  }

  /** Draw terrain + fog into the cached surface. */
  private paintTerrain(mapW: number, mapH: number, tiles: Uint8Array | null, fog: FogSource | null): void {
    if (!this.sctx || !this.surface) return;
    const key = mapW * 131 + mapH * 7 + (tiles ? tiles.length : 0);
    if (key !== this.lastMapHash) { this.lastMapHash = key; this.terrainDirty = true; }
    if (!this.terrainDirty) return;
    const ctx = this.sctx;
    const t = new MinimapTransform(this.size, mapW, mapH);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, this.size, this.size);
    const cell = Math.max(1, Math.ceil(1 / t.scale));
    for (let ty = 0; ty < mapH; ty += 1) {
      for (let tx = 0; tx < mapW; tx += 1) {
        const id = tiles ? (tiles[ty * mapW + tx] ?? 0) : 0;
        let col = TERRAIN[id]?.base ?? '#4d5730';
        if (fog && this.showFog) {
          const st = fogStateAt(fog, tx, ty);
          if (st === FOG_UNEXPLORED) continue;
          if (st === FOG_EXPIRED) col = desaturateHex(col, 0.65);
        }
        ctx.fillStyle = col;
        ctx.fillRect(t.offX + tx * t.scale, t.offY + ty * t.scale, cell, cell);
      }
    }
    this.terrainDirty = false;
  }

  /**
   * Render the minimap. `blips` are already visibility-filtered by the caller
   * (the renderer knows what the viewer can see).
   */
  draw(
    ctx: Ctx2D,
    cam: Camera,
    blips: readonly MinimapBlip[],
    mapW: number,
    mapH: number,
    tiles: Uint8Array | null,
    fog: FogSource | null,
    x = 0,
    y = 0,
  ): void {
    this.ensure();
    this.paintTerrain(mapW, mapH, tiles, fog);
    ctx.save();
    ctx.translate(x, y);
    if (this.surface) {
      ctx.drawImage(this.surface as never, 0, 0, this.size, this.size);
    } else {
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, this.size, this.size);
    }
    const t = cam.minimapTransform(this.size);
    // blips
    for (const b of blips) {
      const p = t.worldToMap(b.x, b.y);
      ctx.fillStyle = b.color;
      if (b.kind === 'building') ctx.fillRect(p.mx - 1, p.my - 1, b.size + 1, b.size + 1);
      else {
        ctx.fillRect(p.mx, p.my, b.size, b.size);
      }
    }
    // viewport rectangle
    const vr = t.viewportRect(cam);
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1;
    ctx.strokeRect(vr.x + 0.5, vr.y + 0.5, vr.w, vr.h);
    ctx.restore();
  }

  /** Convert a click inside the minimap into a world position to jump to. */
  clickToWorld(cam: Camera, mx: number, my: number, ox = 0, oy = 0): { x: number; y: number } | null {
    const t = cam.minimapTransform(this.size);
    const lx = mx - ox;
    const ly = my - oy;
    if (!t.contains(lx, ly)) return null;
    const w = t.mapToWorld(lx, ly);
    return { x: w.x, y: w.y };
  }

  /** Screen-space rect of the minimap for hit-testing from the UI layer. */
  rect(ox = 0, oy = 0): { x: number; y: number; w: number; h: number } {
    return { x: ox, y: oy, w: this.size, h: this.size };
  }
}

/** Blip colour for an entity (creeps are grey in WC3's minimap). */
export function blipColor(player: number, isNeutral: boolean): string {
  if (isNeutral || player <= 0) return '#c9c9c9';
  return playerColor(player);
}

export const MINIMAP_BLIP_SIZE = 2;
