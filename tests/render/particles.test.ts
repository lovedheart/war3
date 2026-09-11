import { describe, expect, it } from 'vitest';
import { ParticleSystem, FloaterLayer, emitHit, emitDeath, emitExplosion } from '../../src/render/particles.js';
import { fakeCtx } from './helpers.js';
import { drawOverlays } from '../../src/render/layers.js';
import { Camera } from '../../src/render/camera.js';
import { ff } from '../../src/core/fixed.js';

function cam() {
  const c = new Camera({ viewW: 400, viewH: 300, bounds: { width: 16, height: 16 } });
  c.centerOn(ff(8), ff(8));
  return c;
}
const emptyGame = { world: { live: [], tick: 1, view: {}, stores: {}, alive: () => false }, terrain: null, fog: null, players: [] } as never;

describe('particle pool', () => {
  it('never exceeds its capacity and reports a bounded peak', () => {
    const ps = new ParticleSystem(64);
    for (let i = 0; i < 500; i++) ps.emit('spark', i % 400, i % 300);
    expect(ps.snapshot().live).toBeLessThanOrEqual(64);
    expect(ps.snapshot().peak).toBeLessThanOrEqual(64);
    expect(ps.snapshot().poolSize).toBeLessThanOrEqual(64);
    expect(ps.snapshot().emitted).toBeLessThanOrEqual(64);
  });

  it('recycles slots so a long match does not leak', () => {
    const ps = new ParticleSystem(32);
    for (let frame = 0; frame < 200; frame++) {
      ps.emit('blood', 10, 10, { life: 0.2 });
      ps.update(1 / 30);
      if (ps.snapshot().poolSize > 32) throw new Error('pool grew');
    }
    ps.update(5);
    expect(ps.snapshot().live).toBe(0);
    expect(ps.snapshot().poolSize).toBeLessThanOrEqual(32);
  });

  it('clear() releases everything and update() is idempotent when empty', () => {
    const ps = new ParticleSystem(16);
    ps.emit('ember', 5, 5, { count: 10 });
    expect(ps.snapshot().live).toBeGreaterThan(0);
    ps.clear();
    expect(ps.snapshot().live).toBe(0);
    expect(() => ps.update(0.1)).not.toThrow();
    ps.forEach(() => { throw new Error('iterated a dead particle'); });
  });

  it('advances physics and fades by remaining life', () => {
    const ps = new ParticleSystem(16);
    ps.emit('blood', 100, 100, { count: 1, speed: 0, gravity: 300, life: 1 });
    let before = { y: 0, fade: 0 };
    ps.forEach((p) => { before = { y: p.y, fade: p.fade }; });
    ps.update(0.1);
    let after = { y: 0, fade: 0 };
    ps.forEach((p) => { after = { y: p.y, fade: p.fade }; });
    expect(after.y).toBeGreaterThan(before.y); // gravity pulled it down
    // ttl is jittered per particle (0.7..1.3 x life), so only the trend matters
    expect(after.fade).toBeGreaterThan(0.7);
    expect(after.fade).toBeLessThan(1);
  });

  it('named emitters respect the attack-type mapping', () => {
    const ps = new ParticleSystem(256);
    emitHit(ps, 1, 1, 'pierce');
    const pierce = ps.snapshot().live;
    emitHit(ps, 1, 1, 'normal');
    expect(ps.snapshot().live).toBeGreaterThan(pierce);
    emitDeath(ps, 1, 1, true);
    emitExplosion(ps, 1, 1);
    expect(ps.snapshot().live).toBeGreaterThan(0);
  });
});

describe('floater pool', () => {
  it('caps at capacity and drains without leaking', () => {
    const fl = new FloaterLayer(8);
    for (let i = 0; i < 100; i++) fl.push('-' + i, i, i, '#fff');
    expect(fl.live).toBeLessThanOrEqual(8);
    expect(fl.stats().poolSize).toBeLessThanOrEqual(8);
    fl.update(5);
    expect(fl.live).toBe(0);
    expect(fl.stats().poolSize).toBeLessThanOrEqual(8);
  });

  it('rises and fades over its lifetime', () => {
    const fl = new FloaterLayer(4);
    fl.push('-12', 50, 200, '#fff');
    let y0 = 0;
    fl.forEach((f) => { y0 = f.y; });
    fl.update(0.2);
    let y1 = 0;
    fl.forEach((f) => { y1 = f.y; });
    expect(y1).toBeLessThan(y0);
    fl.clear();
    expect(fl.live).toBe(0);
  });
});

describe('drawing pools with no canvas', () => {
  it('drawOverlays renders particles and floaters through a stub ctx', () => {
    const f = fakeCtx();
    const ps = new ParticleSystem(64);
    const fl = new FloaterLayer(8);
    ps.emit('spark', 20, 20, { count: 8 });
    fl.push('-7', 30, 40, '#fff', true);
    drawOverlays(f.ctx, emptyGame, cam(), { particles: ps, floaters: fl });
    expect(f.calls.fillRect).toBeGreaterThan(0);
    expect(f.calls.fillText).toBeGreaterThan(0);
    expect(f.calls.strokeText).toBeGreaterThan(0);
  });
});
