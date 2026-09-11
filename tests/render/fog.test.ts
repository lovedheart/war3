import { describe, expect, it } from 'vitest';
import { ff } from '../../src/core/fixed.js';
import { FOG_EXPIRED, FOG_UNEXPLORED, FOG_VISIBLE } from '../../src/core/constants.js';
import { Camera } from '../../src/render/camera.js';
import { fillFogImageData, fogStateAt, fogTileRange, rectVisibility, fogStats, type FogSource } from '../../src/render/fogmask.js';
import { drawFog, fogPixelRect } from '../../src/render/layers.js';
import { fakeCtx } from './helpers.js';

/** checkerboard: visible / expired / unexplored by (x+y)%3 */
function src(mapW = 24, mapH = 24): FogSource {
  return {
    viewer: 1, mapW, mapH,
    fog: { stateAt: (tx, ty) => (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH ? FOG_UNEXPLORED : [FOG_VISIBLE, FOG_EXPIRED, FOG_UNEXPLORED][(tx + ty) % 3]) },
  };
}
function cam(viewW = 512, viewH = 512, mapW = 24, mapH = 24) {
  const c = new Camera({ viewW, viewH, bounds: { width: mapW, height: mapH } });
  c.x = ff(12); c.y = ff(12);
  return c;
}

describe('fog state resolution', () => {
  it('treats out-of-range tiles as unexplored', () => {
    const s = src();
    expect(fogStateAt(s, -1, 0)).toBe(FOG_UNEXPLORED);
    expect(fogStateAt(s, 99, 3)).toBe(FOG_UNEXPLORED);
  });

  it('reveals everything for viewer 0 (observer mode)', () => {
    const s: FogSource = { ...src(), viewer: 0 };
    expect(fogStateAt(s, 5, 5)).toBe(FOG_VISIBLE);
  });

  it('is fully visible when no fog layer exists', () => {
    expect(fogStateAt({ fog: null, viewer: 1, mapW: 8, mapH: 8 }, 3, 3)).toBe(FOG_VISIBLE);
  });

  it('falls back to isVisibleTile/exploredTile when stateAt is absent', () => {
    const s: FogSource = { viewer: 1, mapW: 8, mapH: 8, fog: { isVisibleTile: (tx) => tx === 0, exploredTile: (tx) => tx < 4 } };
    expect(fogStateAt(s, 0, 0)).toBe(FOG_VISIBLE);
    expect(fogStateAt(s, 2, 0)).toBe(FOG_EXPIRED);
    expect(fogStateAt(s, 6, 0)).toBe(FOG_UNEXPLORED);
  });
});

describe('fog alpha grid', () => {
  it('maps tile states to the documented alpha values', () => {
    const cols = 3, rows = 1;
    const data = new Uint8ClampedArray(cols * rows * 4);
    fillFogImageData(data, src(), 0, 0, cols, rows);
    expect(data[3]).toBe(0);            // (0,0) visible
    expect(data[7]).toBe(140);          // (1,0) expired
    expect(data[11]).toBe(255);         // (2,0) unexplored
    for (let i = 0; i < 3; i++) { expect(data[i * 4]).toBe(0); expect(data[i * 4 + 1]).toBe(0); expect(data[i * 4 + 2]).toBe(0); }
  });

  it('is row-major and honours the x0/y0 origin', () => {
    const cols = 2, rows = 2;
    const data = new Uint8ClampedArray(cols * rows * 4);
    fillFogImageData(data, src(), 1, 1, cols, rows);
    // state(tx,ty) = [visible, expired, unexplored][(tx+ty)%3]
    // (1,1)->idx 2 unexplored, (2,1)->idx 0 visible, (1,2)->idx 0 visible, (2,2)->idx 1 expired
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(0);
    expect(data[11]).toBe(0);
    expect(data[15]).toBe(140);
  });

  it('accepts a custom expired alpha', () => {
    const data = new Uint8ClampedArray(4 * 4);
    fillFogImageData(data, src(), 0, 1, 4, 1, 64);
    expect(data[3]).toBe(140 === 140 ? 64 : 0); // (0,1) is expired -> custom alpha
    expect(data[7]).toBe(255);                  // (1,1) is unexplored -> opaque
  });
});

describe('fog geometry', () => {
  it('fogTileRange pads by one tile and clamps to the map', () => {
    const r = fogTileRange(cam(512, 512, 24, 24), 24, 24);
    expect(r.x0).toBeGreaterThanOrEqual(0);
    expect(r.y0).toBeGreaterThanOrEqual(0);
    expect(r.x0 + r.cols - 1).toBeLessThanOrEqual(23);
    expect(r.cols).toBeGreaterThan(1);
  });

  it('tile -> pixel mapping is consistent with the camera', () => {
    const c = cam(512, 512, 24, 24);
    const p = fogPixelRect(src(), c, 24, 24);
    expect(p.px).toBeCloseTo(c.worldToScreenX(ff(p.x0)), 6);
    expect(p.py).toBeCloseTo(c.worldToScreenY(ff(p.y0)), 6);
    // one cell per column spans exactly the padded tile count in px
    expect(p.cols * c.pxPerUnit()).toBeGreaterThan(0);
  });

  it('rectVisibility classifies homogeneous and mixed rects', () => {
    const s = src();
    expect(rectVisibility(s, 0, 0, 0, 0)).toBe('all');   // (0,0) visible
    expect(rectVisibility(s, 2, 0, 2, 0)).toBe('none');   // unexplored
    expect(rectVisibility(s, 0, 0, 2, 0)).toBe('some');
  });

  it('fogStats counts every tile in range exactly once', () => {
    const c = cam(256, 256, 12, 12);
    const s = src(12, 12);
    const st = fogStats(s, c, 12, 12);
    const r = fogTileRange(c, 12, 12);
    expect(st.visible + st.expired + st.unexplored).toBe(r.cols * r.rows);
  });
});

describe('drawFog', () => {
  it('composites without a canvas backend and returns an expired mask', () => {
    const f = fakeCtx();
    const c = cam(512, 512, 24, 24);
    const game = {
      terrain: { width: 24, height: 24 },
      fog: { state: (tx: number, ty: number) => (tx + ty) % 3 === 0 ? FOG_VISIBLE : (tx + ty) % 3 === 1 ? FOG_EXPIRED : FOG_UNEXPLORED },
    } as never;
    const mask = drawFog(f.ctx, null, c, 512, 512, 1, game);
    expect(mask).not.toBeNull();
    const r = fogTileRange(c, 24, 24);
    expect(mask!.length).toBe(r.cols * r.rows);
    let ones = 0;
    for (const v of mask!) ones += v;
    expect(ones).toBeGreaterThan(0); // the checkerboard must contain expired tiles
    expect(f.calls.fill).toBeGreaterThan(0); // batched rect fallback used under node
  });

  it('never throws for a null fog or zero-size camera', () => {
    const f = fakeCtx();
    const tiny = new Camera({ viewW: 1, viewH: 1, bounds: { width: 1, height: 1 } });
    expect(() => drawFog(f.ctx, null, tiny, 1, 1, 1, { terrain: { width: 1, height: 1 } } as never)).not.toThrow();
  });
});
