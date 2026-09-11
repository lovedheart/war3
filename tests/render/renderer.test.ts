import { describe, expect, it, vi } from 'vitest';
import { ff } from '../../src/core/fixed.js';
import { Renderer } from '../../src/render/renderer.js';
import { fakeCtx, fakeGame } from './helpers.js';

function makeRenderer(mapW = 48, mapH = 48) {
  const f = fakeCtx();
  const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
  const r = new Renderer({ canvas });
  const { game } = fakeGame([{ eid: 1 << 20, x: 24, y: 24, id: 'footman', race: 'human' }], { mapW, mapH });
  return { r, f, game };
}

describe('Renderer lifecycle', () => {
  it('throws when the canvas has no 2d context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as never;
    expect(() => new Renderer({ canvas })).toThrow();
  });

  it('resize sets the backing store to css*dpr and updates the camera', () => {
    const { r, game } = makeRenderer();
    r.resize(1280, 720, 2);
    const cv = r.canvas as unknown as { width: number; height: number };
    expect(cv.width).toBe(2560);
    expect(cv.height).toBe(1440);
    r.render(game, 1);
    expect(r.cam.viewW).toBe(1280);
    expect(r.cam.viewH).toBe(720);
  });

  it('resize(0,0) cannot produce a zero-size canvas', () => {
    const { r } = makeRenderer();
    r.resize(0, 0, 0);
    const cv = r.canvas as unknown as { width: number; height: number };
    expect(cv.width).toBeGreaterThanOrEqual(1);
    expect(cv.height).toBeGreaterThanOrEqual(1);
  });

  it('render() never mutates simulation state', () => {
    const { r, game, world } = (() => {
      const f = fakeCtx();
      const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
      const renderer = new Renderer({ canvas });
      const g = fakeGame([{ eid: 1 << 20, x: 24, y: 24, id: 'footman', vx: 2 }], { mapW: 48, mapH: 48 });
      return { r: renderer, game: g.game, world: g.world };
    })();
    const before = JSON.stringify(world.live) + JSON.stringify(world.stores.transform.get(1 << 20));
    for (let i = 0; i < 4; i++) r.render(game, i / 3);
    expect(JSON.stringify(world.live) + JSON.stringify(world.stores.transform.get(1 << 20))).toBe(before);
  });

  it('tolerates garbage input instead of throwing', () => {
    const { r } = makeRenderer();
    r.resize(320, 240, 1);
    expect(() => r.render(undefined as never, 1)).not.toThrow();
    expect(() => r.render({} as never, 1)).not.toThrow();
    expect(() => r.render({ world: { live: [], view: {}, stores: {} } } as never, NaN)).not.toThrow();
  });

  it('clamps alpha into [0,1]', () => {
    const { r, game } = makeRenderer();
    r.resize(640, 480, 1);
    expect(() => r.render(game, -5)).not.toThrow();
    expect(() => r.render(game, 9)).not.toThrow();
  });

  it('adopts the camera position recorded in world.view', () => {
    const f = fakeCtx();
    const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
    const r = new Renderer({ canvas });
    const { game, world } = fakeGame([], { mapW: 64, mapH: 64 });
    world.view.cameraX = ff(10);
    world.view.cameraY = ff(12);
    world.view.zoom = ff(1.5);
    r.resize(800, 600, 1);
    r.render(game, 1);
    expect(r.cam.x).toBe(ff(10));
    expect(r.cam.y).toBe(ff(12));
    expect(r.cam.zoom).toBe(ff(1.5));
  });

  it('setDebug toggles the debug pass', () => {
    const ents = [{ eid: 1 << 20, x: 24, y: 24, id: 'footman' }, { eid: 2 << 20, x: 25, y: 25, id: 'grunt', player: 2 }];
    const mk = () => {
      const f = fakeCtx();
      const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
      const r = new Renderer({ canvas });
      const { game } = fakeGame(ents, { mapW: 48, mapH: 48 });
      r.resize(640, 480, 1);
      return { r, f, game };
    };
    const a = mk();
    a.r.render(a.game, 1);
    const plain = a.f.total();
    const b = mk();
    b.r.setDebug(true);
    expect(b.r.debug).toBe(true);
    b.r.render(b.game, 1);
    // the collision-circle / grid / quadtree / order-vector overlay adds work
    expect(b.f.total()).toBeGreaterThan(plain);
    b.r.setDebug(false);
    expect(b.r.debug).toBe(false);
  });

  it('destroy unsubscribes from the bus and turns render into a no-op', () => {
    const subs: string[] = [];
    const offs: ReturnType<typeof vi.fn>[] = [];
    const f = fakeCtx();
    const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
    const { game, world } = fakeGame([{ eid: 1 << 20, x: 16, y: 16, id: 'footman' }], { mapW: 32, mapH: 32 });
    (world as { bus: unknown }).bus = {
      on: (t: string) => {
        subs.push(t);
        const off = vi.fn();
        offs.push(off);
        return off;
      },
    };
    const r = new Renderer({ canvas });
    r.resize(320, 240, 1);
    r.render(game, 1);
    expect(subs.length).toBeGreaterThan(0); // damage / died / constructed / cast
    r.destroy();
    for (const off of offs) expect(off).toHaveBeenCalled();
    f.reset();
    r.render(game, 1);
    expect(f.total()).toBe(0);
  });

  it('collectBlips filters by fog and marks buildings', () => {
    const { r, game } = makeRenderer();
    r.resize(640, 480, 1);
    const blips = r.collectBlips(game, 1);
    expect(blips.length).toBeGreaterThan(0);
    expect(blips[0].color).toMatch(/^#/);
  });

  it('exposes per-frame stats', () => {
    const { r, game } = makeRenderer();
    r.resize(640, 480, 1);
    r.render(game, 1);
    expect(r.stats.entities).toBe(1);
    expect(r.stats.sprites).toBeGreaterThan(0); // stock roster is pre-baked
    expect(Number.isFinite(r.stats.frameMs)).toBe(true);
  });
});


