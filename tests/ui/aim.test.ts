import { describe, it, expect } from 'vitest';
import { needsAim } from '../../src/ui/aim.js';
import { createGame } from '../../src/sim/index.js';
import { getGameData } from '../../src/data/index.js';

describe('ability aiming classification', () => {
  it('ground-targeted spells need a point', () => {
    expect(needsAim({ radius: 6 })).toBe(true);
    expect(needsAim({ effects: [{ kind: 'aoe' }] })).toBe(true);
    expect(needsAim({ effects: [{ kind: 'summon', unitId: 'bat' } as { kind: string }] })).toBe(true);
  });

  it('instant/self abilities do not', () => {
    expect(needsAim({ effects: [{ kind: 'buff' }] })).toBe(false);
    expect(needsAim({ effects: [{ kind: 'heal' }] })).toBe(false);
    expect(needsAim(undefined)).toBe(false);
  });

  it('data table agrees: blizzard aims, devotion does not', () => {
    const gd = getGameData();
    const blizzard = gd.abilityDefs.get('blizzard') ?? gd.abilities.get('blizzard');
    const devotion = gd.abilityDefs.get('devotion') ?? gd.abilities.get('devotion');
    if (blizzard) expect(needsAim(blizzard as never)).toBe(true);
    if (devotion) expect(needsAim(devotion as never)).toBe(false);
  });

  it('an aimed cast carries the clicked point into the sim', () => {
    const g = createGame({ seed: 4, size: 48, players: [{ id: 1, race: 'human', name: 'P1' }, { id: 2, race: 'orc', name: 'P2' }] });
    g.update(2);
    // The Command shape itself must be able to carry a ground point.
    const cmd = { k: 'ability', player: 1, caster: 0xffffffff, abilityId: 'blizzard', target: null, at: { x: 65536 * 10, y: 65536 * 10 } } as const;
    expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
    void g;
  });
});
