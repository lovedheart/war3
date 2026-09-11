/**
 * End-to-end boot check: the whole stack (sim + render + input + HUD) must
 * assemble and run a few frames against a minimal DOM stub, with no browser.
 */
import { describe, it, expect } from 'vitest';
import { createApp, type App } from '../../src/app/bootstrap.js';
import { makeDoc } from '../ui/helpers.js';

function stubCanvas(): HTMLCanvasElement {
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'canvas') return { width: 1280, height: 720 };
        if (k === 'createImageData' || k === 'getImageData')
          return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (k === 'measureText') return () => ({ width: 8 });
        return () => {};
      },
    },
  );
  const el = {
    width: 1280,
    height: 720,
    clientWidth: 1280,
    clientHeight: 720,
    style: {},
    getContext: () => ctx,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return el as unknown as HTMLCanvasElement;
}

describe('app boot', () => {
  it('assembles sim + renderer + input + hud and runs frames', () => {
    const doc = makeDoc() as unknown as Document;
    const root = doc.createElement('div');
    (doc as unknown as { getElementById(id: string): unknown }).getElementById = () => root;
    (globalThis as { document?: unknown }).document = doc;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;

    const app: App = createApp({ canvas: stubCanvas(), seed: 3, size: 48, viewer: 1 });
    expect(app.game.world.tick).toBe(0);

    // Drive the loop manually — no rAF in node.
    for (let i = 0; i < 10; i++) app.loop.advance(33.4);
    expect(app.game.world.tick).toBeGreaterThan(0);

    // The HUD must have mounted into #ui-root and refreshed at least once.
    expect(root.childNodes.length).toBeGreaterThan(0);
    expect(Number.isFinite(app.renderer.cam.x)).toBe(true);

    app.destroy();
    delete (globalThis as { document?: unknown }).document;
  });
});
