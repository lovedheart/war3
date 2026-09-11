/**
 * Camera: world <-> screen mapping, zoom, edge clamping and the minimap
 * transform. World positions are `Fixed` (1 unit == 1 tile); screen space is
 * CSS pixels (device-pixel scaling is applied by the renderer's base
 * transform, never here).
 */
import { Fixed, fi, ff, fn, fmul } from '../core/fixed.js';
import { TILE_SIZE_PX } from '../core/constants.js';

export interface CameraBounds {
  /** map size in tiles */
  width: number;
  height: number;
}

export interface CameraOptions {
  /** view width in CSS px */
  viewW: number;
  viewH: number;
  bounds: CameraBounds;
  zoom?: Fixed;
  minZoom?: Fixed;
  maxZoom?: Fixed;
  /** margin (in CSS px) kept visible when the pointer hits a screen edge */
  edgeScrollPx?: number;
}

export const DEFAULT_ZOOM = ff(1);
export const MIN_ZOOM = ff(0.5);
export const MAX_ZOOM = ff(2);

export class Camera {
  /** top-left-ish centre of the view, world fixed */
  x: Fixed = 0;
  y: Fixed = 0;
  zoom: Fixed;
  readonly minZoom: Fixed;
  readonly maxZoom: Fixed;
  viewW = 640;
  viewH = 360;
  bounds: CameraBounds = { width: 128, height: 128 };
  edgeScrollPx = 8;

  constructor(opts: CameraOptions) {
    this.zoom = opts.zoom ?? DEFAULT_ZOOM;
    this.minZoom = opts.minZoom ?? MIN_ZOOM;
    this.maxZoom = opts.maxZoom ?? MAX_ZOOM;
    this.setView(opts.viewW, opts.viewH);
    this.bounds = opts.bounds;
    if (opts.edgeScrollPx !== undefined) this.edgeScrollPx = opts.edgeScrollPx;
    this.clamp();
  }

  setView(w: number, h: number): void {
    this.viewW = Math.max(1, w | 0);
    this.viewH = Math.max(1, h | 0);
  }

  setBounds(width: number, height: number): void {
    this.bounds = { width: Math.max(1, width | 0), height: Math.max(1, height | 0) };
    this.clamp();
  }

  /** Pixels per world unit at the current zoom. */
  pxPerUnit(): number {
    return TILE_SIZE_PX * fn(this.zoom);
  }

  /** Zoom about the viewport centre. */
  setZoom(z: Fixed): void {
    this.zoom = z < this.minZoom ? this.minZoom : z > this.maxZoom ? this.maxZoom : z;
    this.clamp();
  }

  zoomBy(factor: number): void {
    this.setZoom(fmul(this.zoom, ff(factor)));
  }

  /* ---------------- coordinate transforms ---------------- */

  /** World x -> screen x (CSS px). */
  worldToScreenX(wx: Fixed): number {
    return (fn(wx) - fn(this.x)) * this.pxPerUnit() + this.viewW / 2;
  }

  worldToScreenY(wy: Fixed): number {
    return (fn(wy) - fn(this.y)) * this.pxPerUnit() + this.viewH / 2;
  }

  worldToScreen(wx: Fixed, wy: Fixed): { sx: number; sy: number } {
    return { sx: this.worldToScreenX(wx), sy: this.worldToScreenY(wy) };
  }

  /** Screen x -> world x. */
  screenToWorldX(sx: number): Fixed {
    return ff((sx - this.viewW / 2) / this.pxPerUnit() + fn(this.x));
  }

  screenToWorldY(sy: number): Fixed {
    return ff((sy - this.viewH / 2) / this.pxPerUnit() + fn(this.y));
  }

  screenToWorld(sx: number, sy: number): { x: Fixed; y: Fixed } {
    return { x: this.screenToWorldX(sx), y: this.screenToWorldY(sy) };
  }

  /* ---------------- panning ---------------- */

  /** Pan by a delta expressed in screen pixels. */
  panByPixels(dx: number, dy: number): void {
    const k = this.pxPerUnit();
    this.x = ff(fn(this.x) + dx / k);
    this.y = ff(fn(this.y) + dy / k);
    this.clamp();
  }

  panByUnits(dx: Fixed, dy: Fixed): void {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  centerOn(wx: Fixed, wy: Fixed): void {
    this.x = wx;
    this.y = wy;
    this.clamp();
  }

  /**
   * Edge scrolling: pass pointer position in screen px (or -1 to disable an
   * axis). Returns true when the camera moved.
   */
  edgeScroll(mx: number, my: number, speedPxPerStep: number): boolean {
    const m = this.edgeScrollPx;
    let dx = 0;
    let dy = 0;
    if (mx >= 0 && mx < m) dx = -speedPxPerStep;
    else if (mx >= 0 && mx > this.viewW - m) dx = speedPxPerStep;
    if (my >= 0 && my < m) dy = -speedPxPerStep;
    else if (my >= 0 && my > this.viewH - m) dy = speedPxPerStep;
    if (dx === 0 && dy === 0) return false;
    const before = this.x + this.y;
    this.panByPixels(dx, dy);
    return before !== this.x + this.y;
  }

  /** Keep the view inside the map (WC3 stops at the border rather than centring). */
  clamp(): void {
    const halfW = fn(fi(this.bounds.width)) / 2;
    const halfH = fn(fi(this.bounds.height)) / 2;
    const viewUnitsW = this.viewW / this.pxPerUnit() / 2;
    const viewUnitsH = this.viewH / this.pxPerUnit() / 2;
    const maxX = Math.max(0, halfW - viewUnitsW);
    const maxY = Math.max(0, halfH - viewUnitsH);
    // Map spans [-half, +half] around its centre in this project's convention;
    // but tile (0,0) is the top-left, so the legal centre range is [view, size-view].
    const loX = viewUnitsW, loY = viewUnitsH;
    const hiX = Math.max(loX, this.bounds.width - viewUnitsW);
    const hiY = Math.max(loY, this.bounds.height - viewUnitsH);
    let cx = fn(this.x);
    let cy = fn(this.y);
    if (this.bounds.width <= viewUnitsW * 2) cx = this.bounds.width / 2;
    else cx = cx < loX ? loX : cx > hiX ? hiX : cx;
    if (this.bounds.height <= viewUnitsH * 2) cy = this.bounds.height / 2;
    else cy = cy < loY ? loY : cy > hiY ? hiY : cy;
    this.x = ff(cx);
    this.y = ff(cy);
    void maxX; void maxY;
  }

  /* ---------------- viewport queries ---------------- */

  /** Visible world rect, fixed point. */
  visibleRect(): { minX: Fixed; minY: Fixed; maxX: Fixed; maxY: Fixed } {
    const hw = this.viewW / this.pxPerUnit() / 2;
    const hh = this.viewH / this.pxPerUnit() / 2;
    return {
      minX: ff(fn(this.x) - hw),
      minY: ff(fn(this.y) - hh),
      maxX: ff(fn(this.x) + hw),
      maxY: ff(fn(this.y) + hh),
    };
  }

  /** Tile index range currently on screen (inclusive, clamped to the map). */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const r = this.visibleRect();
    return {
      x0: clampi(Math.floor(fn(r.minX)), 0, this.bounds.width - 1),
      y0: clampi(Math.floor(fn(r.minY)), 0, this.bounds.height - 1),
      x1: clampi(Math.ceil(fn(r.maxX)), 0, this.bounds.width - 1),
      y1: clampi(Math.ceil(fn(r.maxY)), 0, this.bounds.height - 1),
    };
  }

  /* ---------------- minimap ---------------- */

  /**
   * Minimap transform: the whole map maps onto `size x size` px, aspect kept
   * (letterboxed). Used both for drawing dots and for click-to-jump.
   */
  minimapTransform(sizePx: number): MinimapTransform {
    return new MinimapTransform(sizePx, this.bounds.width, this.bounds.height);
  }
}

export class MinimapTransform {
  readonly scale: number;
  readonly offX: number;
  readonly offY: number;
  readonly size: number;
  readonly mapW: number;
  readonly mapH: number;

  constructor(sizePx: number, mapW: number, mapH: number) {
    this.size = Math.max(1, sizePx | 0);
    this.mapW = Math.max(1, mapW);
    this.mapH = Math.max(1, mapH);
    this.scale = this.size / Math.max(this.mapW, this.mapH);
    this.offX = ((this.size - this.mapW * this.scale) / 2) | 0;
    this.offY = ((this.size - this.mapH * this.scale) / 2) | 0;
  }

  /** World fixed -> minimap px. */
  worldToMap(wx: Fixed, wy: Fixed): { mx: number; my: number } {
    return {
      mx: this.offX + (fn(wx) * this.scale) | 0,
      my: this.offY + (fn(wy) * this.scale) | 0,
    };
  }

  /** Tile indices -> minimap px. */
  tileToMap(tx: number, ty: number): { mx: number; my: number } {
    return { mx: this.offX + tx * this.scale, my: this.offY + ty * this.scale };
  }

  /** Minimap px -> world fixed (for double-click jump). */
  mapToWorld(mx: number, my: number): { x: Fixed; y: Fixed } {
    return {
      x: ff((mx - this.offX) / this.scale),
      y: ff((my - this.offY) / this.scale),
    };
  }

  /** Whether a minimap click lies inside the drawn square. */
  contains(mx: number, my: number): boolean {
    return mx >= this.offX && my >= this.offY && mx < this.offX + this.mapW * this.scale && my < this.offY + this.mapH * this.scale;
  }

  /** Viewport rectangle on the minimap, in px. */
  viewportRect(cam: Camera): { x: number; y: number; w: number; h: number } {
    const r = cam.visibleRect();
    const a = this.worldToMap(r.minX, r.minY);
    const b = this.worldToMap(r.maxX, r.maxY);
    return { x: a.mx, y: a.my, w: Math.max(2, b.mx - a.mx), h: Math.max(2, b.my - a.my) };
  }
}

function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v | 0;
}
