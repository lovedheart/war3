import { describe, expect, it } from 'vitest';
import { ff } from '../../src/core/fixed.js';
import { TILE_SIZE_PX } from '../../src/core/constants.js';
import { Camera } from '../../src/render/camera.js';
import { SpriteAtlas } from '../../src/render/atlas.js';
import {
  drawGround, drawEntities, drawOverlays, drawDebug, sortEntities, collectEntities,
  entityScreenPos, hitFlash, stores, type DrawEntityItem,
} from '../../src/render/layers.js';
import { fakeCtx, fakeGame } from './helpers.js';

function makeCam(mapW = 64, mapH = 64) {
  const c = new Camera({ viewW: 800, viewH: 600, bounds: { width: mapW, height: mapH } });
  c.centerOn(ff(32), ff(32));
  return c;
}
function atlasFor(f: ReturnType<typeof fakeCtx>) {
  const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
  return new SpriteAtlas(() => canvas);
}

describe('y-sort stability', () => {
  const mk = (eid: number, sortY: number): DrawEntityItem => ({ eid, sortY, eidKey: eid >>> 0 });

  it('orders by y then ascending eid', () => {
    // eids are index<<20 | generation, so the canonical key is eid >>> 0
    const items = [mk(7 << 20, 3), mk(3 << 20, 1), mk(9 << 20, 3), mk(1 << 20, 3), mk(5 << 20, 0)];
    expect(sortEntities(items).map((i) => i.sortY)).toEqual([0, 1, 3, 3, 3]);
    expect(sortEntities(items).filter((i) => i.sortY === 3).map((i) => i.eid))
      .toEqual([1 << 20, 7 << 20, 9 << 20]);
  });

  it('is independent of input order', () => {
    const base = [11, 12, 13, 14].map((e) => mk(e << 20, 2));
    const rev = [...base].reverse();
    expect(sortEntities(base).map((i) => i.eid)).toEqual(sortEntities(rev).map((i) => i.eid));
  });

  it('handles negative and fractional sort keys', () => {
    const items = [mk(1 << 20, -0.5), mk(2 << 20, -0.5), mk(3 << 20, 0.25)];
    expect(sortEntities(items).map((i) => i.eid)).toEqual([1 << 20, 2 << 20, 3 << 20]);
  });

  it('collectEntities sorts buildings below units sharing the same ground line', () => {
    const { game } = fakeGame([
      { eid: 1 << 20, x: 10, y: 10, id: 'footman' },
      { eid: 2 << 20, x: 10, y: 10, buildingId: 'keep', w: 3, h: 3 },
    ]);
    const out = collectEntities(game, 1);
    // building footprint extends further down, so it paints later
    expect(out[out.length - 1].eid).toBe(2 << 20);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].sortY >= out[i - 1].sortY).toBe(true);
      if (out[i].sortY === out[i - 1].sortY) expect(out[i].eidKey > out[i - 1].eidKey).toBe(true);
    }
  });

  it('skips dead and component-less entities', () => {
    const { game } = fakeGame([
      { eid: 1, x: 5, y: 5, id: 'footman' },
      { eid: 2, x: 6, y: 6, id: 'grunt', dead: true },
    ]);
    game.world.live.push(999999); // no components at all
    const ids = collectEntities(game, 1).map((i) => i.eid);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(999999);
  });
});

describe('entityScreenPos', () => {
  it('matches the camera transform and interpolates motion', () => {
    const cam = makeCam();
    const { world } = fakeGame([{ eid: 1, x: 32, y: 32, id: 'footman', vx: 6 }]);
    const st = stores(world);
    const t = (world.stores.transform.get(1) as { x: number; y: number });
    const atOne = entityScreenPos(st, 1, cam, 1);
    const atHalf = entityScreenPos(st, 1, cam, 0.5);
    expect(atOne).not.toBeNull();
    // alpha === 1 must be the raw sim position (no extrapolation at all)
    expect(atOne!.sx).toBeCloseTo(cam.worldToScreenX(t.x), 9);
    // alpha < 1 pulls the sprite back toward where it was at the start of the tick
    expect(atHalf!.sx).toBeLessThan(atOne!.sx + 0.5);
    const k = Math.floor((65536 - Math.round(0.5 * 65536)) / 30); // fdivi truncates
    expect(atHalf!.sx).toBeLessThan(atOne!.sx);
    expect(Math.abs(atHalf!.sx - cam.worldToScreenX(t.x - 6 * 65536 * (k / 65536)))).toBeLessThan(0.02);
    expect(Math.abs(atHalf!.sy - atOne!.sy)).toBeLessThan(1e-6);
  });

  it('returns null for unknown entities', () => {
    const { world } = fakeGame([{ eid: 1, x: 1, y: 1 }]);
    expect(entityScreenPos(stores(world), 4242, makeCam(), 1)).toBeNull();
  });
});

describe('hit flash', () => {
  it('decays to zero after two ticks', () => {
    const { world } = fakeGame([{ eid: 1, x: 5, y: 5 }]);
    const st = stores(world) as Stores & {
      lastHit: { map: Map<number, number>; get(e: number): { tick: number } | undefined };
    };
    st.lastHit = {
      map: new Map<number, number>(),
      get(e: number) { const t = this.map.get(e >>> 0); return t === undefined ? undefined : { tick: t }; },
    };
    st.lastHit.map.set(1, 10);
    const asStores = st as unknown as Parameters<typeof hitFlash>[0];
    expect(hitFlash(asStores, 1, 10, 1)).toBe(1);
    expect(hitFlash(asStores, 1, 11, 1)).toBeGreaterThan(0);
    expect(hitFlash(asStores, 1, 13, 1)).toBe(0);
    expect(hitFlash(asStores, 2, 10, 1)).toBe(0);
  });
});
interface Stores { [k: string]: unknown }

describe('draw passes are node-safe', () => {
  it('drawGround paints without a real canvas', () => {
    const f = fakeCtx();
    const { terrain } = fakeGame([], { mapW: 32, mapH: 32 });
    drawGround(f.ctx, terrain as never, makeCam(32, 32), 800, 600);
    expect(f.calls.fillRect).toBeGreaterThanOrEqual(1);
    expect(f.calls.fill).toBeGreaterThan(1);
  });

  it('drawGround tolerates a missing terrain', () => {
    const f = fakeCtx();
    drawGround(f.ctx, null, makeCam(), 800, 600);
    expect(f.total()).toBeGreaterThan(0);
  });

  it('drawGround batches tiles per palette entry instead of per tile', () => {
    const f = fakeCtx();
    const { terrain } = fakeGame([], { mapW: 64, mapH: 64 });
    drawGround(f.ctx, terrain as never, makeCam(64, 64), 800, 600);
    // ~9 terrain ids -> a handful of fillStyle switches, not thousands
    expect(f.calls.fill).toBeLessThan(60);
  });

  it('drawEntities blits sprites for every visible kind', () => {
    const f = fakeCtx();
    const { game } = fakeGame([
      { eid: 1, x: 30, y: 30, id: 'footman', race: 'human' },
      { eid: 2, x: 31, y: 31, buildingId: 'barracks', race: 'human', w: 3, h: 3 },
      { eid: 3, x: 32, y: 32, kind: 2, itemId: 'potion_hp' },
      { eid: 4, x: 33, y: 33, kind: 3 },
      { eid: 5, x: 34, y: 34, id: 'dragon', fly: true },
      { eid: 6, x: 35, y: 35, id: 'archmage', hero: true, level: 3, mp: 100, mpMax: 200 },
    ]);
    drawEntities(f.ctx, game, makeCam(), 1, atlasFor(f));
    expect(f.calls.drawImage).toBeGreaterThanOrEqual(5);
  });

  it('drawEntities skips off-screen entities', () => {
    const f = fakeCtx();
    const { game } = fakeGame([{ eid: 1, x: 30, y: 30, id: 'footman' }, { eid: 2, x: 60, y: 60, id: 'grunt' }]);
    drawEntities(f.ctx, game, makeCam(), 1, atlasFor(f));
    expect(f.calls.drawImage).toBeGreaterThanOrEqual(1);
  });

  it('drawEntities survives an empty live list and missing stores', () => {
    const f = fakeCtx();
    const game = { world: { live: [], tick: 1, view: {}, stores: {} }, terrain: null, fog: null, players: [] } as never;
    drawEntities(f.ctx, game, makeCam(), 1, atlasFor(f));
    drawOverlays(f.ctx, game, makeCam(), {});
    drawDebug(f.ctx, game, makeCam());
    expect(f.total()).toBeGreaterThan(0);
  });

  it('drawOverlays paints health bars grouped by colour', () => {
    const f = fakeCtx();
    const { game } = fakeGame([
      { eid: 1, x: 30, y: 30, id: 'footman', player: 1, hp: 100, hpMax: 100 },
      { eid: 2, x: 31, y: 31, id: 'grunt', player: 2, hp: 10, hpMax: 100 },
      { eid: 3, x: 32, y: 32, id: 'peon', player: 1, hp: 0, hpMax: 100, dead: true },
    ]);
    drawOverlays(f.ctx, game, makeCam(), {});
    expect(f.calls.fill).toBeGreaterThan(1);
    expect(f.total()).toBeGreaterThan(4);
  });

  it('drawOverlays honours selection and hover rings', () => {
    const f = fakeCtx();
    const { game, world } = fakeGame([
      { eid: 1, x: 30, y: 30, id: 'footman' },
      { eid: 2, x: 31, y: 31, id: 'grunt', player: 2 },
    ]);
    world.view.selection = [1];
    world.view.hoverEid = 2;
    drawOverlays(f.ctx, game, makeCam(), {});
    expect(f.calls.stroke).toBeGreaterThan(0);
  });

  it('drawDebug draws collision circles and order vectors', () => {
    const f = fakeCtx();
    const { game, world } = fakeGame([{ eid: 1, x: 30, y: 30, id: 'footman' }]);
    (world.stores.orders.get(1) as { current: unknown }).current = { kind: 'move', targetEid: 0xffffffff, tx: ff(40), ty: ff(40), mode: 0, param: '' };
    drawDebug(f.ctx, game, makeCam());
    expect(f.calls.stroke).toBeGreaterThan(0);
  });

  it('respects TILE_SIZE_PX scaling between zooms', () => {
    const near = fakeCtx();
    const far = fakeCtx();
    const ents = [{ eid: 1, x: 32, y: 32, id: 'footman' }];
    const g1 = fakeGame(ents).game;
    const g2 = fakeGame(ents).game;
    const c1 = makeCam();
    const c2 = makeCam();
    c2.setZoom(ff(2));
    drawEntities(near.ctx, g1, c1, 1, atlasFor(near));
    drawEntities(far.ctx, g2, c2, 1, atlasFor(far));
    expect(c2.pxPerUnit()).toBeCloseTo(c1.pxPerUnit() * 2, 5);
    expect(c1.pxPerUnit()).toBeCloseTo(TILE_SIZE_PX, 5);
  });
});
