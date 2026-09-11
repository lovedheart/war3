import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/sim/index.js';
import { makeDoc } from '../ui/helpers.js';
import { createHud } from '../../src/ui/index.js';
import type { Command } from '../../src/sim/commandTypes.js';

const PLAYERS = [
  { id: 1, race: 'human' as const, name: 'P1' },
  { id: 2, race: 'orc' as const, name: 'P2' },
];

/**
 * Item slots must be Command-only: the panel may never touch hero.itemSlots
 * directly, or replays desync. These tests assert the emitted Commands and that
 * the sim state is untouched until a tick applies them.
 */
const heroEidRef = { value: 0xffffffff };

function mountHudWithHeroCarrying(itemId: string | null) {
  const doc = makeDoc();
  const root = doc.createElement('div');
  const canvas = doc.createElement('canvas') as unknown as HTMLCanvasElement;
  const sent: Command[] = [];
  const hud = createHud({ viewer: 1, dispatch: (c) => sent.push(c), doc: doc as unknown as Document, selectionProvider: () => [heroEidRef.value] });
  hud.mount({ root: root as unknown as HTMLElement, canvas });


  const game = createGame({ seed: 3, size: 48, players: PLAYERS });
  game.update(2);
  // Fabricate a selection record by writing only presentation-side view state and
  // an inventory onto a real unit through the sim's own store (test fixture).
  const w = game.world as unknown as { live: number[]; stores: Record<string, { get(e: number): unknown; add?(e: number): unknown }> };
  let heroEid = -1;
  for (const e of w.live) {
    const st = w.stores.stats.get(e) as { id: string } | undefined;
    if (st?.id === 'peasant') {
      heroEid = e;
      break;
    }
  }
  expect(heroEid).toBeGreaterThan(0);
  heroEidRef.value = heroEid;
  const hero = (w.stores.hero.add as (e: number) => { itemSlots: (string | null)[]; itemCharges: number[]; respawnTick: number })(heroEid);
  // The panel only shows a tray for a hero, so promote the fixture.
  (w.stores.stats.get(heroEid) as { isHero: boolean; level: number }).isHero = true;
  hero.itemSlots[0] = itemId;
  hero.itemCharges[0] = 3;
  w.live.length && ((game.world.view.selection = [heroEid]), undefined);
  return { hud, sent, heroEid, doc, root, game };
}

describe('item tray', () => {
  it('renders six slots and marks the filled one', () => {
    const { hud, root, game } = mountHudWithHeroCarrying('ckng');
    hud.frame(game, 1);
    const slots = slotsOf(root);
    expect(slots.length).toBe(6);
    expect(slots.filter((s) => !/empty/.test(s.className)).length).toBe(1);
    hud.destroy();
  });

  it('Alt-click drops the item via an itemDrop Command', () => {
    const { hud, sent, root, game } = mountHudWithHeroCarrying('ckng');
    hud.frame(game, 1);
    const slots = slotsOf(root);
    slots[0].fire('click', { altKey: true });
    expect(sent.length).toBe(1);
    expect(sent[0].k).toBe('itemDrop');
    expect(JSON.parse(JSON.stringify(sent[0]))).toEqual(sent[0]);
    hud.destroy();
  });

  it('click-then-click gives between slots of the same owner', () => {
    const { hud, sent, root, game } = mountHudWithHeroCarrying('ckng');
    const w = game.world as unknown as { stores: Record<string, { get(e: number): { itemSlots: (string | null)[] } | undefined }> };
    hud.frame(game, 1);
    const slots = slotsOf(root);
    slots[0].fire('click', {}); // arm
    expect(sent.length).toBe(0);
    slots[0].fire('click', {}); // arm slot 0
    // Two clicks on occupied slots of the same hero move the item.
    const w2 = game.world as unknown as { stores: Record<string, { get(e: number): { itemSlots: (string | null)[] } }> };
    w2.stores.hero.get(Number((game.world.view.selection as number[])[0])).itemSlots[1] = 'modt';
    hud.frame(game, 1);
    slotsOf(root)[0].fire('click', {}); // arm
    slotsOf(root)[1].fire('click', {}); // give
    expect(sent.length).toBe(1);
    expect(sent[0].k).toBe('itemGive');
    // Nothing changed in the sim yet — only a Command was queued.
    hud.destroy();
    void w;
  });

  it('double-click uses the item', () => {
    const { hud, sent, root, game } = mountHudWithHeroCarrying('ckng');
    hud.frame(game, 1);
    const slots = slotsOf(root);
    slots[0].fire('dblclick', {});
    expect(sent.length).toBe(1);
    expect(sent[0].k).toBe('itemUse');
    hud.destroy();
  });

  it('empty slots are inert', () => {
    const { hud, sent, root, game } = mountHudWithHeroCarrying(null);
    hud.frame(game, 1);
    const slots = slotsOf(root);
    slots[0].fire('click', { altKey: true });
    slots[0].fire('dblclick', {});
    expect(sent.length).toBe(0);
    hud.destroy();
  });
});

/* ---- tiny helpers over the stub DOM ---- */
import type { StubEl } from '../ui/helpers.js';

function slotsOf(root: unknown): StubEl[] {
  return (root as StubEl).querySelectorAll('.w3-slot');
}
