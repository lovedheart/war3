import { describe, expect, it } from 'vitest';
import { ff } from '../../src/core/fixed.js';
import { QuadTree } from '../../src/map/quadtree.js';

const W = ff(128); // 128 x 128 world units

function tree(cap = 4): QuadTree {
  return new QuadTree(0, 0, W, W, cap);
}

describe('QuadTree', () => {
  it('finds entries inside the query radius and excludes distant ones', () => {
    const q = tree();
    q.insert(1, ff(10), ff(10), ff(0.5));
    q.insert(2, ff(60), ff(60), ff(0.5));
    q.insert(3, ff(11), ff(11), ff(0.5));
    const out = q.query(ff(10.5), ff(10.5), ff(3), []);
    expect(out).toEqual([1, 3]);
  });

  it('respects entry radii (large units are hit earlier)', () => {
    const q = tree();
    q.insert(7, ff(50), ff(50), ff(6));
    expect(q.query(ff(56), ff(50), ff(0.5), [])).toEqual([7]);
    expect(q.query(ff(60), ff(50), ff(0.5), [])).toEqual([]);
  });

  it('dedupes repeated inserts of the same eid and returns ascending order', () => {
    const q = tree(2);
    // Same entity re-inserted every tick without remove() — the common case
    // when a system forgets to call remove(), or an oversized unit straddling
    // several leaves.
    for (let i = 0; i < 20; i++) q.insert(42, ff(30), ff(30), ff(0.5));
    for (let eid = 1; eid <= 12; eid++) q.insert(eid, ff(30 + eid * 0.1), ff(30), ff(0.4));
    const out = q.query(ff(31), ff(30), ff(8), []);
    expect(out).toContain(42);
    expect(out.length).toBe(new Set(out).size);
    const sorted = [...out].sort((a, b) => a - b);
    expect(out).toEqual(sorted);
  });

  it('appends to an existing output array without duplicating its content', () => {
    const q = tree();
    q.insert(5, ff(20), ff(20), ff(0.5));
    const out = [99];
    q.query(ff(20), ff(20), ff(2), out);
    expect(out).toEqual([99, 5]);
  });

  it('remove() drops the entry from later queries', () => {
    const q = tree(2);
    for (let i = 1; i <= 40; i++) q.insert(i, ff(i * 3), ff(i * 2), ff(0.5));
    expect(q.size).toBe(40);
    q.remove(17);
    expect(q.size).toBe(39);
    expect(q.query(ff(17 * 3), ff(17 * 2), ff(1), [])).not.toContain(17);
    q.remove(17); // idempotent
    expect(q.size).toBe(39);
  });

  it('clear() empties the tree including subdivided children', () => {
    const q = tree(2);
    for (let i = 1; i <= 200; i++) q.insert(i, ff((i * 7) % 128), ff((i * 11) % 128), ff(0.5));
    expect(q.size).toBe(200);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.query(ff(64), ff(64), ff(200), [])).toEqual([]);
  });

  it('handles many entries and stays sublinear vs brute force', () => {
    const q = tree(4);
    const N = 2000;
    for (let i = 0; i < N; i++) {
      // deterministic scatter, no Math.random
      const x = ff(((i * 37) % 128) + ((i % 5) * 0.2));
      const y = ff(((i * 61) % 128) + ((i % 3) * 0.2));
      q.insert(i, x, y, ff(0.5));
    }
    const hits = q.query(ff(64), ff(64), ff(4), []);
    let brute = 0;
    for (let i = 0; i < N; i++) {
      const x = ((i * 37) % 128) + (i % 5) * 0.2;
      const y = ((i * 61) % 128) + (i % 3) * 0.2;
      if (Math.hypot(x - 64, y - 64) <= 4.5) brute++;
    }
    expect(hits.length).toBe(brute);
    expect(hits.length).toBeLessThan(N / 2);
  });

  it('clamps out-of-bounds points into the root instead of losing them', () => {
    const q = tree();
    q.insert(3, ff(-40), ff(500), ff(0.5));
    expect(q.size).toBe(1);
    // Clamped to the nearest in-bounds point, so a wide query still finds it.
    expect(q.query(ff(64), ff(64), ff(200), [])).toContain(3);
  });

  it('all() reports every stored id ascending', () => {
    const q = tree(2);
    for (const e of [9, 3, 5, 1]) q.insert(e, ff(e * 10), ff(e * 10), ff(0.5));
    expect(q.all([])).toEqual([1, 3, 5, 9]);
  });
});
