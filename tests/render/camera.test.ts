import { describe, expect, it } from 'vitest';
import { ff, fi, fn } from '../../src/core/fixed.js';
import { TILE_SIZE_PX } from '../../src/core/constants.js';
import { Camera, MinimapTransform } from '../../src/render/camera.js';

function cam(zoom = ff(1)) {
  return new Camera({ viewW: 1280, viewH: 720, bounds: { width: 96, height: 96 }, zoom });
}

describe('camera transforms', () => {
  it('world <-> screen round-trips within fixed-point tolerance', () => {
    const c = cam();
    c.setView(8 * TILE_SIZE_PX, 6 * TILE_SIZE_PX); // small viewport so the centre stays free to move
    c.x = fi(48); c.y = fi(48);
    for (const [wx, wy] of [[fi(0), fi(0)], [fi(12.5), fi(77)], [fi(48), fi(48)], [fi(95), fi(1)]] as const) {
      const s = c.worldToScreen(wx, wy);
      const w = c.screenToWorld(s.sx, s.sy);
      expect(Math.abs(w.x - wx)).toBeLessThanOrEqual(64); // < 0.001 tiles
      expect(Math.abs(w.y - wy)).toBeLessThanOrEqual(64);
    }
  });

  it('round-trips at every zoom level', () => {
    for (const z of [0.5, 0.75, 1, 1.5, 2]) {
      const c = cam(ff(z));
      c.centerOn(fi(30), fi(60));
      const s = c.worldToScreen(fi(33), fi(57));
      const w = c.screenToWorld(s.sx, s.sy);
      expect(Math.abs(w.x - fi(33))).toBeLessThanOrEqual(128);
      expect(Math.abs(w.y - fi(57))).toBeLessThanOrEqual(128);
    }
  });

  it('pxPerUnit scales linearly with zoom and clamps out of range', () => {
    const c = cam();
    expect(c.pxPerUnit()).toBeCloseTo(TILE_SIZE_PX, 5);
    c.setZoom(ff(2));
    expect(c.pxPerUnit()).toBeCloseTo(TILE_SIZE_PX * 2, 5);
    c.setZoom(ff(9));
    expect(c.zoom).toBe(ff(2));
    c.setZoom(ff(0.01));
    expect(c.zoom).toBe(ff(0.5));
  });

  it('centre of the viewport maps to the camera position', () => {
    const c = cam();
    c.setView(1280, 720);
    c.x = fi(20); c.y = fi(20); // assigned directly: no clamp() runs on assignment
    const s = c.worldToScreen(fi(20), fi(20));
    expect(s.sx).toBeCloseTo(640, 5);
    expect(s.sy).toBeCloseTo(360, 5);
  });

  it('clamps the centre so no outside-map gap is shown', () => {
    const c = cam();
    c.setView(8 * TILE_SIZE_PX, 6 * TILE_SIZE_PX);
    c.centerOn(fi(0), fi(0));
    let r = c.visibleRect();
    expect(fn(r.minX)).toBeGreaterThanOrEqual(-0.01);
    expect(fn(r.minY)).toBeGreaterThanOrEqual(-0.01);
    c.centerOn(fi(500), fi(500));
    r = c.visibleRect();
    expect(fn(r.maxX)).toBeLessThanOrEqual(96.01);
    expect(fn(r.maxY)).toBeLessThanOrEqual(96.01);
    // a map smaller than the viewport is simply centred
    const small = new Camera({ viewW: 1280, viewH: 720, bounds: { width: 8, height: 8 } });
    small.centerOn(fi(0), fi(0));
    expect(fn(small.x)).toBeCloseTo(4, 3);
  });

  it('visibleTiles covers the whole map when zoomed out on a small map', () => {
    const c = new Camera({ viewW: 1280, viewH: 720, bounds: { width: 16, height: 16 } });
    const t = c.visibleTiles();
    expect(t.x0).toBe(0);
    expect(t.y0).toBe(0);
    expect(t.x1).toBeLessThanOrEqual(15);
    expect(t.y1).toBeLessThanOrEqual(15);
  });

  it('panByPixels moves the view by exactly the requested pixels', () => {
    // NOTE: uses ff(), not fi(). `fi()` currently returns a corrupt value for
    // every cached argument (intCache[i] === (i+256) << 16, so fi(1) is 257):
    // reported to the main agent as a core/fixed.ts bug.
    const c = cam();
    c.setView(1280, 720);
    c.centerOn(ff(48), ff(48)); // mid-map: clamping cannot mask the delta
    const k = c.pxPerUnit();
    const beforeX = c.worldToScreenX(ff(45));
    const beforeY = c.worldToScreenY(ff(45));
    c.panByPixels(120, -60);
    expect(c.x - ff(48)).toBeCloseTo((120 / k) * 65536, 1);
    expect(c.y - ff(48)).toBeCloseTo((-60 / k) * 65536, 1);
    expect(c.worldToScreenX(ff(45)) - beforeX).toBeCloseTo(-120, 3);
    expect(c.worldToScreenY(ff(45)) - beforeY).toBeCloseTo(60, 3);
  });

  it('edge scrolling moves the camera only near the borders', () => {
    const c = cam();
    c.setView(1280, 720);
    c.x = fi(48); c.y = fi(48);
    const x0 = c.x;
    expect(c.edgeScroll(640, 360, 10)).toBe(false);
    expect(c.x).toBe(x0);
    c.edgeScroll(2, 360, 10);
    expect(c.x).toBeLessThan(x0);
  });

  it('minimap transform maps the map onto the square and back', () => {
    const t = new MinimapTransform(150, 96, 64);
    const a = t.tileToMap(0, 0);
    const b = t.tileToMap(96, 64);
    expect(a.mx).toBeGreaterThanOrEqual(t.offX);
    expect(b.mx).toBeLessThanOrEqual(150 + 1);
    expect(b.my).toBeLessThanOrEqual(150 + 1);
    const back = t.mapToWorld(t.offX, t.offY);
    expect(Math.abs(back.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.y)).toBeLessThanOrEqual(1);
    expect(t.contains(-1, 0)).toBe(false);
  });

  it('viewportRect grows as you zoom out', () => {
    const c = cam(ff(2));
    c.centerOn(fi(48), fi(48));
    const t = new MinimapTransform(150, 96, 96);
    const near = t.viewportRect(c);
    c.setZoom(ff(0.5));
    const far = t.viewportRect(c);
    expect(far.w).toBeGreaterThan(near.w);
    expect(far.h).toBeGreaterThan(near.h);
  });
});
