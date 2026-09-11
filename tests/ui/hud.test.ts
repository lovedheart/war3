import { describe, it, expect, beforeEach } from 'vitest';
import { createHud, type Hud } from '../../src/ui/index.js';
import { makeDoc, makeGame, recorder, visibleButtons, texts, byClass, type StubDoc, type StubEl, type FakeGame, type EntOpts } from './helpers.js';

let doc: StubDoc;
let root: StubEl;
let canvas: StubEl;
let rec: ReturnType<typeof recorder>;
let hud: Hud;
let game: FakeGame;
let selection: number[];

const ents = (extra: EntOpts[] = []): EntOpts[] => [
  { eid: 0x01000001, player: 1, id: 'peasant', kind: 0 },
  { eid: 0x01000002, player: 1, id: 'peasant', kind: 0 },
  { eid: 0x01000003, player: 1, id: 'footman', kind: 0 },
  { eid: 0x02000001, player: 1, id: 'town_hall', kind: 1, trainQueue: [{ unitId: 'peasant', remaining: 24 }] },
  ...extra,
];

function boot(opts: Partial<Parameters<typeof makeGame>[0]> = {}, sel: number[] = []): void {
  doc = makeDoc();
  root = doc.createElement('div');
  canvas = doc.createElement('canvas');
  rec = recorder();
  selection = sel;
  game = makeGame({ ents: ents(), viewer: 1, ...opts });
  hud = createHud({
    viewer: 1,
    dispatch: (c) => rec.dispatch(c),
    selectionProvider: () => selection,
    onMinimapClick: () => {},
    doc: doc as unknown as Document,
  });
  hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
  hud.frame(game.game as never, 1);
}

beforeEach(() => {
  doc = makeDoc();
});

describe('mount', () => {
  it('creates the four panels and injects the stylesheet once', () => {
    boot();
    expect(byClass(root, 'w3-resbar').length).toBe(1);
    expect(byClass(root, 'w3-minimap').length).toBe(1);
    expect(byClass(root, 'w3-right').length).toBe(1);
    expect(byClass(root, 'w3-tip').length).toBe(1);
    expect(doc.getElementById('war3-hud-styles')).toBeTruthy();
  });

  it('is idempotent when mounted twice', () => {
    boot();
    const n = hud.nodeCount;
    hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
    expect(hud.nodeCount).toBe(n);
  });
});

describe('resource bar', () => {
  it('shows gold/lumber/population from the snapshot', () => {
    boot({ gold: 1234, lumber: 567, supplyUsed: 12, supplyCap: 18 });
    const nums = byClass(root, 'w3-resbar')[0].flatten().map((e) => e.textContent).filter(Boolean);
    expect(nums).toContain('1234');
    expect(nums).toContain('567');
    expect(nums).toContain('12/18');
  });

  it('population turns red above cap and shows Upkeep at the 50/80 boundaries', () => {
    boot({ supplyUsed: 50, supplyCap: 60 });
    expect(byClass(root, 'w3-pop')[0].className).toBe('w3-pop ok');

    boot({ supplyUsed: 51, supplyCap: 60, upkeep: 1 });
    expect(byClass(root, 'w3-pop')[0].className).toBe('w3-pop low');
    expect(byClass(root, 'w3-upkeep')[0].textContent).toBe('Upkeep');

    boot({ supplyUsed: 81, supplyCap: 90, upkeep: 2 });
    expect(byClass(root, 'w3-pop')[0].className).toBe('w3-pop high');
    expect(byClass(root, 'w3-upkeep')[0].className).toBe('w3-upkeep up-high');
    expect(byClass(root, 'w3-upkeep')[0].textContent).toBe('Upkeep!');

    boot({ supplyUsed: 99, supplyCap: 90 });
    expect(byClass(root, 'w3-pop')[0].className).toBe('w3-pop high');
  });
});

describe('command card', () => {
  it('empty selection renders no buttons', () => {
    boot({}, []);
    expect(visibleButtons(root).length).toBe(0);
  });

  it('worker selection lists build buttons for its own race only', () => {
    boot({ gold: 4000, lumber: 4000 }, [0x01000001]);
    const labels = texts(root);
    expect(labels.length).toBeGreaterThan(3);
    expect(labels.some((t) => /Farm/i.test(t))).toBe(true);
    expect(labels.some((t) => /Barracks/i.test(t))).toBe(true);
    // orc-only structures must not appear for a human worker
    expect(labels.some((t) => /Orc Barracks|Great Hall/i.test(t))).toBe(false);
  });

  it('build button dispatches a placement request carrying the selected worker', () => {
    let req: unknown = null;
    doc = makeDoc();
    root = doc.createElement('div');
    canvas = doc.createElement('canvas');
    rec = recorder();
    game = makeGame({ ents: ents(), viewer: 1, gold: 4000, lumber: 4000 });
    hud = createHud({
      viewer: 1,
      dispatch: (c) => rec.dispatch(c),
      selectionProvider: () => [0x01000001],
      onPlacement: (r) => (req = r),
      doc: doc as unknown as Document,
    });
    hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
    hud.frame(game.game as never, 1);
    const farm = visibleButtons(root).find((b) => textsOf(b) === 'Farm');
    expect(farm).toBeTruthy();
    farm!.click();
    expect(req).toEqual({ buildingId: 'farm', worker: 0x01000001 });
  });

  it('greys out structures whose prerequisite is missing and names it in the tooltip', () => {
    // only a town_hall exists -> Keep is available, Castle (needs Keep) is not
    boot({ gold: 9999, lumber: 9999 }, [0x01000001]);
    const castle = visibleButtons(root).find((b) => /Castle/.test(textsOf(b)));
    expect(castle).toBeTruthy();
    expect(castle!.className).toContain('off');
    castle!.fire('mouseenter');
    const tip = byClass(root, 'w3-tip')[0];
    expect(tip.style.display).toBe('block');
    const lines = tip.flatten().map((e) => e.textContent).join('\n');
    expect(lines.toLowerCase()).toMatch(/requires keep/);
  });

  it('greys out unaffordable buildings with the shortfall in the tooltip', () => {
    boot({ gold: 10, lumber: 0 }, [0x01000001]);
    const farm = visibleButtons(root).find((b) => textsOf(b) === 'Farm');
    expect(farm!.className).toContain('off');
    farm!.fire('mouseenter');
    const lines = byClass(root, 'w3-tip')[0].flatten().map((e) => e.textContent).join('\n');
    expect(lines).toMatch(/more gold needed/);
    expect(lines).toMatch(/more lumber needed/);
  });

  it('combat units get move/stop/hold/attack-move and dispatch the right commands', () => {
    boot({}, [0x01000003]);
    const labels = texts(root);
    expect(labels).toEqual(expect.arrayContaining(['Move', 'Stop', 'Hold']));
    expect(labels.some((t) => /Attack-Move/.test(t))).toBe(true);

    const stop = visibleButtons(root).find((b) => textsOf(b) === 'Stop')!;
    stop.click();
    expect(rec.cmds).toEqual([{ k: 'stop', player: 1, units: [0x01000003] }]);

    const hold = visibleButtons(root).find((b) => textsOf(b) === 'Hold')!;
    hold.click();
    expect(rec.cmds[1]).toEqual({ k: 'hold', player: 1, units: [0x01000003] });
  });

  it('move button asks the app to resolve a destination instead of firing blind', () => {
    let target: unknown = null;
    doc = makeDoc();
    root = doc.createElement('div');
    canvas = doc.createElement('canvas');
    rec = recorder();
    game = makeGame({ ents: ents(), viewer: 1 });
    hud = createHud({
      viewer: 1,
      dispatch: (c) => rec.dispatch(c),
      selectionProvider: () => [0x01000003],
      onTarget: (t) => (target = t),
      doc: doc as unknown as Document,
    });
    hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
    hud.frame(game.game as never, 1);
    visibleButtons(root).find((b) => textsOf(b) === 'Move')!.click();
    expect(target).toEqual({ k: 'move', player: 1, units: [0x01000003], mode: 'move' });
    expect(rec.cmds.length).toBe(0);
  });

  it('building shows a training bubble whose cancel dispatches cancelTrain at the right index', () => {
    boot({}, [0x02000001]);
    const bubbles = byClass(root, 'w3-bubble').filter((b) => b.style.display !== 'none');
    expect(bubbles.length).toBe(1);
    bubbles[0].click();
    expect(rec.cmds).toEqual([{ k: 'cancelTrain', player: 1, building: 0x02000001, index: 0 }]);
  });

  it('hall trains units and dispatches train with the building eid', () => {
    boot({ gold: 400, lumber: 100, supplyCap: 20 }, [0x02000001]);
    const labels = texts(root);
    expect(labels.some((t) => /Peasant/i.test(t))).toBe(true);
    const btn = visibleButtons(root).find((b) => /Peasant/i.test(textsOf(b)))!;
    btn.click();
    expect(rec.cmds).toEqual([{ k: 'train', player: 1, building: 0x02000001, unitId: 'peasant' }]);
  });

  it('greys a trainable unit when supply is full but still reports the reason', () => {
    boot({ gold: 400, lumber: 100, supplyUsed: 12, supplyCap: 12 }, [0x02000001]);
    const btn = visibleButtons(root).find((b) => /Peasant/i.test(textsOf(b)))!;
    expect(btn.className).toContain('off');
    btn.fire('mouseenter');
    expect(byClass(root, 'w3-tip')[0].flatten().map((e) => e.textContent).join('\n')).toMatch(/Not enough supply/);
    btn.click();
    expect(rec.cmds.length).toBe(0); // blocked clicks never reach the sim
  });

  it('dead hero offers revive with the respawn countdown', () => {
    const heroEnts = ents([{ eid: 0x03000001, player: 1, id: 'archmage', hero: true, dead: true, respawnTick: 1200 }]);
    game = makeGame({ ents: heroEnts, viewer: 1, tick: 300 });
    doc = makeDoc();
    root = doc.createElement('div');
    canvas = doc.createElement('canvas');
    rec = recorder();
    hud = createHud({ viewer: 1, dispatch: (c) => rec.dispatch(c), selectionProvider: () => [0x03000001], doc: doc as unknown as Document });
    hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
    hud.frame(game.game as never, 1);
    const btn = visibleButtons(root).find((b) => /Revive/.test(textsOf(b)))!;
    expect(textsOf(btn)).toBe('Revive 30s');
    btn.click();
    expect(rec.cmds).toEqual([{ k: 'revive', player: 1, hero: 0x03000001 }]);
  });
});

describe('info panel', () => {
  it('describes a unit with damage and armor text', () => {
    boot({}, [0x01000003]);
    const name = byClass(root, 'w3-name')[0].textContent;
    expect(name.toLowerCase()).toContain('footman');
    const sub = byClass(root, 'w3-sub')[0].textContent;
    expect(sub).toMatch(/Normal/i);
    expect(sub).toMatch(/Heavy/i);
    expect(byClass(root, 'w3-stats')[0].textContent).toMatch(/Armor/);
  });

  it('gives heroes a gold frame, level badge and item tray', () => {
    const heroEnts = ents([{ eid: 0x03000001, player: 1, id: 'archmage', hero: true, level: 3, xp: 900, mpMax: 260, mp: 130, items: ['ckng', null, null, null, null, null], charges: [2, 0, 0, 0, 0, 0] }]);
    game = makeGame({ ents: heroEnts, viewer: 1 });
    doc = makeDoc();
    root = doc.createElement('div');
    canvas = doc.createElement('canvas');
    rec = recorder();
    hud = createHud({ viewer: 1, dispatch: (c) => rec.dispatch(c), selectionProvider: () => [0x03000001], doc: doc as unknown as Document });
    hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
    hud.frame(game.game as never, 1);
    expect(byClass(root, 'w3-portrait')[0].className).toContain('hero');
    expect(byClass(root, 'w3-lvl')[0].textContent).toBe('Lv 3');
    const slots = byClass(root, 'w3-slot');
    expect(slots.length).toBe(6);
    expect(slots.filter((s) => !s.className.includes('empty')).length).toBe(1);
    expect(slots[0].lastChild!.textContent).toBe('2');
  });
});

describe('minimap', () => {
  it('maps a click back to world coordinates and reports them', () => {
    let wx = -1;
    let wy = -1;
    doc = makeDoc();
    root = doc.createElement('div');
    canvas = doc.createElement('canvas');
    rec = recorder();
    game = makeGame({ ents: ents(), viewer: 1 });
    hud = createHud({
      viewer: 1,
      dispatch: (c) => rec.dispatch(c),
      onMinimapClick: (x, y) => {
        wx = x;
        wy = y;
      },
      doc: doc as unknown as Document,
    });
    hud.mount({ root: root as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement });
    hud.frame(game.game as never, 1);
    const mm = byClass(root, 'w3-minimap')[0].childNodes.find((c) => (c as StubEl).tagName === 'CANVAS') as StubEl;
    // 64-tile map into a 152px panel -> scale 2.375, no offset
    mm.fire('mousedown', { clientX: 32, clientY: 32, button: 0, preventDefault() {} });
    expect(wx).toBeCloseTo(32 / (152 / 64), 1);
    expect(wy).toBeCloseTo(32 / (152 / 64), 1);
  });
});

describe('performance', () => {
  it('does not add DOM nodes across frames', () => {
    boot({ gold: 500 }, [0x01000001]);
    const n = hud.nodeCount;
    const created = doc.created;
    for (let i = 0; i < 5; i++) {
      hud.frame(game.game as never, 1);
      game.setGold(500 + i * 10);
    }
    expect(hud.nodeCount).toBe(n);
    expect(doc.created).toBe(created);
  });

  it('reuses the same nodes when the selection changes', () => {
    boot({}, [0x01000001]);
    const n = hud.nodeCount;
    selection = [0x01000003];
    hud.frame(game.game as never, 1);
    selection = [0x02000001];
    hud.frame(game.game as never, 1);
    selection = [];
    hud.frame(game.game as never, 1);
    expect(hud.nodeCount).toBe(n);
  });

  it('reuses one tooltip node for every hover target', () => {
    boot({ gold: 9999, lumber: 9999 }, [0x01000001]);
    const btns = visibleButtons(root);
    for (const b of btns.slice(0, 6)) {
      b.fire('mouseenter');
      b.fire('mouseleave');
    }
    expect(byClass(root, 'w3-tip').length).toBe(1);
    // Pool is sized for the largest race's worker card (MAX_BUTTONS), so the
    // budget moved from 400 to 600 when the cap went 24 -> 48.
    expect(hud.nodeCount).toBeLessThan(600);
  });
});

function textsOf(b: StubEl): string {
  const t = b.childNodes.map((c) => c as StubEl).find((c) => c.className === 'txt');
  return t?.textContent ?? '';
}
