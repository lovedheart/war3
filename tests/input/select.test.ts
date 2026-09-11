import { describe, it, expect } from 'vitest';
import { ff } from '../../src/core/fixed.js';
import { boxSelect, cullBoxSelection, mergeSelection, pickAt, MAX_SELECTION, type SelectableEntity } from '../../src/input/select.js';

let next = 0x1000;
function ent(over: Partial<SelectableEntity> = {}): SelectableEntity {
  return {
    eid: next++,
    x: ff(10),
    y: ff(10),
    radius: ff(0.4),
    player: 1,
    kind: 0,
    unitId: 'footman',
    isHero: false,
    isWorker: false,
    alive: true,
    ...over,
  };
}

describe('pickAt', () => {
  it('picks the entity under the cursor', () => {
    const a = ent({ x: ff(5), y: ff(5) });
    const b = ent({ x: ff(40), y: ff(40) });
    expect(pickAt([a, b], ff(5.1), ff(5.1), 1)).toBe(a.eid);
  });

  it('returns null when nothing is close enough', () => {
    const a = ent({ x: ff(5), y: ff(5) });
    expect(pickAt([a], ff(30), ff(30), 1)).toBeNull();
  });

  it('ignores enemy and dead entities', () => {
    const mine = ent({ x: ff(5), y: ff(5) });
    const foe = ent({ x: ff(5), y: ff(5), player: 2 });
    const corpse = ent({ x: ff(5), y: ff(5), alive: false });
    expect(pickAt([foe, corpse, mine], ff(5), ff(5), 1)).toBe(mine.eid);
    expect(pickAt([foe, corpse], ff(5), ff(5), 1)).toBeNull();
  });

  it('prefers a unit standing in front of a building', () => {
    const hall = ent({ x: ff(10), y: ff(10), radius: ff(2), kind: 1 });
    const unit = ent({ x: ff(10.6), y: ff(10), kind: 0 });
    expect(pickAt([hall, unit], ff(10.6), ff(10), 1)).toBe(unit.eid);
  });
});

describe('boxSelect', () => {
  it('takes units whose centre is inside the rect', () => {
    const inA = ent({ x: ff(4), y: ff(4) });
    const inB = ent({ x: ff(6), y: ff(6) });
    const out = ent({ x: ff(30), y: ff(30) });
    const got = boxSelect([inA, inB, out], { x0: ff(0), y0: ff(0), x1: ff(10), y1: ff(10) }, 1);
    expect(got.sort((a, b) => a - b)).toEqual([inA.eid, inB.eid].sort((a, b) => a - b));
  });

  it('normalises inverted drag rectangles', () => {
    const a = ent({ x: ff(4), y: ff(4) });
    const fwd = boxSelect([a], { x0: ff(0), y0: ff(0), x1: ff(10), y1: ff(10) }, 1);
    const rev = boxSelect([a], { x0: ff(10), y0: ff(10), x1: ff(0), y1: ff(0) }, 1);
    expect(rev).toEqual(fwd);
  });

  it('excludes buildings from box selection', () => {
    const b = ent({ kind: 1, x: ff(4), y: ff(4) });
    expect(boxSelect([b], { x0: ff(0), y0: ff(0), x1: ff(10), y1: ff(10) }, 1)).toEqual([]);
  });

  it('excludes other players', () => {
    const foe = ent({ player: 2, x: ff(4), y: ff(4) });
    expect(boxSelect([foe], { x0: ff(0), y0: ff(0), x1: ff(10), y1: ff(10) }, 1)).toEqual([]);
  });
});

describe('cullBoxSelection', () => {
  it('prefers combat units over workers when over the cap', () => {
    const workers = Array.from({ length: 8 }, () => ent({ isWorker: true, unitId: 'peasant' }));
    const fighters = Array.from({ length: 8 }, () => ent());
    const picked = cullBoxSelection([...workers, ...fighters], MAX_SELECTION);
    const fighterIds = new Set(fighters.map((f) => f.eid));
    expect(picked.filter((e) => fighterIds.has(e)).length).toBe(8);
    expect(picked.length).toBe(MAX_SELECTION);
  });

  it('never auto-selects heroes', () => {
    const hero = ent({ isHero: true, unitId: 'archmage' });
    const a = ent();
    const picked = cullBoxSelection([hero, a], MAX_SELECTION);
    expect(picked).toEqual([a.eid]);
  });

  it('caps at 12', () => {
    const many = Array.from({ length: 30 }, () => ent());
    expect(cullBoxSelection(many).length).toBe(MAX_SELECTION);
  });

  it('returns ascending eids regardless of input order', () => {
    const ents = Array.from({ length: 5 }, () => ent());
    const a = cullBoxSelection(ents);
    const b = cullBoxSelection([...ents].reverse());
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort((x, y) => x - y));
  });
});

describe('mergeSelection', () => {
  it('adds without duplicates and stays sorted', () => {
    expect(mergeSelection([5, 9], [3, 9])).toEqual([3, 5, 9]);
  });

  it('caps the merged group', () => {
    const base = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(mergeSelection(base, [99, 100]).length).toBe(MAX_SELECTION);
  });
});
