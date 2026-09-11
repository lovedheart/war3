/**
 * Campaign <-> app integration: createApp({ campaign }) must boot the level
 * through startLevel, advance it via updateLevel, and freeze + announce the
 * outcome. Driven headlessly against the same DOM stub as tests/app/boot.
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

function boot(opts: Parameters<typeof createApp>[0]): App {
  const doc = makeDoc() as unknown as Document;
  const root = doc.createElement('div');
  (doc as unknown as { getElementById(id: string): unknown }).getElementById = () => root;
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
  return createApp(opts);
}

describe('campaign app wiring', () => {
  it('boots a level instead of a skirmish map and exposes the campaign handle', () => {
    const app = boot({ canvas: stubCanvas(), seed: 5, campaign: { levelId: 'human-02' } });
    try {
      expect(app.campaign).toBeDefined();
      expect(app.campaign!.levelId).toBe('human-02');
      expect(app.campaign!.outcome).toBe(null);
      app.game.update(1);
      const snap = app.game.snapshot();
      // the hand-authored human-02 map is 40x40, not the generated 96 default
      expect((app.game.terrain as unknown as { width: number }).width).toBe(40);
      expect(snap.buildings.some((b) => b.player === 1 && b.built)).toBe(true);
    } finally {
      app.destroy();
    }
  });

  it('advances through updateLevel and freezes with an outcome callback on win', () => {
    let fired: ['win' | 'lose', string] | null = null;
    const app = boot({
      canvas: stubCanvas(),
      seed: 5,
      campaign: { levelId: 'human-02' },
      onOutcome: (r, id) => (fired = [r, id]),
    });
    try {
      // survive target is 9000 ticks; drive ~10000 via the loop's advance()
      for (let i = 0; i < 400 && !app.campaign!.outcome; i++) app.loop.advance(1000);
      expect(app.campaign!.outcome).toBe('win');
      expect(fired).toEqual(['win', 'human-02']);
      // frozen: further frames must not tick the world any more
      const t = app.game.world.tick;
      app.loop.advance(1000);
      expect(app.game.world.tick).toBe(t);
    } finally {
      app.destroy();
    }
  });

  it('a skirmish boot has no campaign handle and keeps ticking normally', () => {
    const app = boot({ canvas: stubCanvas(), seed: 3, size: 48 });
    try {
      expect(app.campaign).toBeUndefined();
      const t0 = app.game.world.tick;
      app.loop.advance(500);
      expect(app.game.world.tick).toBeGreaterThan(t0);
    } finally {
      app.destroy();
    }
  });
});
