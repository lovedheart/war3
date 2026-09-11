import { describe, expect, it } from 'vitest';
import { SpriteAtlas, bakeKey, slotSize, splitKey, guessRace } from '../../src/render/atlas.js';
import { fakeCtx } from './helpers.js';

function makeAtlas() {
  const f = fakeCtx();
  const canvas = { width: 0, height: 0, getContext: () => f.ctx } as never;
  return { atlas: new SpriteAtlas(() => canvas), f };
}

describe('atlas keys', () => {
  it('bakeKey is deterministic and race/flag qualified', () => {
    expect(bakeKey('unit', 'footman')).toBe('unit:footman@n');
    expect(bakeKey('unit', 'footman', { race: 'human' })).toBe('unit:footman@human');
    expect(bakeKey('unit', 'archmage', { race: 'human', hero: true })).toBe('unit:archmage@human#hero');
    expect(bakeKey('building', 'keep', { race: 'orc', ghost: true })).toBe('building:keep@orc#scaffold');
    expect(bakeKey('item', 'potion_hp')).toBe('item:potion_hp');
    // stable across calls
    expect(bakeKey('unit', 'grunt', { race: 'orc' })).toBe(bakeKey('unit', 'grunt', { race: 'orc' }));
  });

  it('splitKey round-trips bakeKey parts', () => {
    const k = bakeKey('unit', 'death_knight', { race: 'undead', hero: true });
    const p = splitKey(k);
    expect(p.cat).toBe('unit');
    expect(p.id).toBe('death_knight');
    expect(p.race).toBe('undead');
    expect(p.flags).toEqual(['hero']);
  });

  it('slotSize follows the hero/category rule', () => {
    expect(slotSize('unit')).toBe(64);
    expect(slotSize('unit', true)).toBe(88);
    expect(slotSize('building')).toBe(128);
    expect(slotSize('item')).toBe(32);
  });

  it('register is idempotent and baking allocates one slot per key', () => {
    const { atlas, f } = makeAtlas();
    const k1 = atlas.register('unit', 'footman', { race: 'human' });
    const k2 = atlas.register('unit', 'footman', { race: 'human' });
    expect(k1).toBe(k2);
    atlas.register('unit', 'knight', { race: 'human', hero: false });
    atlas.bakeAll();
    expect(atlas.stats().sprites).toBe(2);
    expect(atlas.isBaked).toBe(true);
    expect(f.calls.fill).toBeGreaterThan(0);
    const a = atlas.entry(k1)!;
    const kb = atlas.register('unit', 'knight');
    const b = atlas.resolve('unit', 'knight')!;
    expect(atlas.entry(kb)).toBe(b);
    expect(a.page).toBe(b.page);
    expect(a.slot).not.toBe(b.slot); // distinct slots
    expect(a.anchorX).toBeCloseTo(32, 5);
  });

  it('resolve() bakes lazily and returns the same entry twice', () => {
    const { atlas, f: _f } = makeAtlas();
    const e1 = atlas.resolve('unit', 'peon', { race: 'orc' });
    const e2 = atlas.resolve('unit', 'peon', { race: 'orc' });
    expect(e1).not.toBeNull();
    expect(e2).toBe(e1);
  });

  it('drawSprite falls back to a placeholder for unknown keys without throwing', async () => {
    const { atlas, f } = makeAtlas();
    const { drawSprite } = await import('../../src/render/atlas.js');
    expect(drawSprite(atlas, f.ctx, 'unit:nope', 10, 10)).toBe(false);
    expect(f.calls.rect).toBeGreaterThan(0);
  });

  it('guessRace maps stock ids to palettes', () => {
    expect(guessRace('peasant')).toBe('human');
    expect(guessRace('grunt')).toBe('orc');
    expect(guessRace('ghoul')).toBe('undead');
    expect(guessRace('huntress')).toBe('night_elf');
    expect(guessRace('mysterious_thing')).toBe('neutral');
  });

  it('dispose frees the pages and clears entries', () => {
    const { atlas, f: _f } = makeAtlas();
    atlas.register('unit', 'footman');
    atlas.bakeAll();
    atlas.dispose();
    expect(atlas.keys()).toEqual([]);
    expect(atlas.ready()).toBe(false);
  });
});
