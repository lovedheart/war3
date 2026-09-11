import { describe, it, expect } from 'vitest';
import { createInput, type InputDeps } from '../../src/input/index.js';
import type { Command } from '../../src/sim/commandTypes.js';
import { ff, fn } from '../../src/core/fixed.js';
import type { SelectableEntity } from '../../src/input/select.js';
import { HOTKEYS } from '../../src/input/hotkeys.js';

/* ------------------------------ fake world ------------------------------ */

interface Fake {
  deps: InputDeps;
  commands: Command[];
  selection: number[];
  ents: SelectableEntity[];
  pans: [number, number][];
  zooms: number[];
}

function fake(opts: { ents?: SelectableEntity[]; player?: number } = {}): Fake {
  const f: Fake = {
    commands: [],
    selection: [],
    ents: opts.ents ?? [],
    pans: [],
    zooms: [],
    deps: {
      player: opts.player ?? 1,
      command: (c) => f.commands.push(c),
      getSelection: () => [...f.selection],
      setSelection: (e) => {
        f.selection = [...e];
      },
      entities: () => f.ents,
      // identity-ish mapping: 64 px per world unit, view centred at (0,0)
      screenToWorld: (sx, sy) => ({ x: ff(sx / 64), y: ff(sy / 64) }),
      panByPixels: (dx, dy) => f.pans.push([dx, dy]),
      zoomBy: (z) => f.zooms.push(z),
      viewport: () => ({ w: 1280, h: 720 }),
    },
  };
  return f;
}

let next = 0x2000;
function unit(over: Partial<SelectableEntity> = {}): SelectableEntity {
  return {
    eid: next++,
    x: ff(5),
    y: ff(5),
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

const click = (x: number, y: number, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({
  button: 0,
  clientX: x,
  clientY: y,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
});
const rclick = (x: number, y: number, mods: { shift?: boolean } = {}) => ({
  button: 2,
  clientX: x,
  clientY: y,
  shiftKey: !!mods.shift,
});
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
});

/** drive a full left-click at a world point */
function leftClick(inp: ReturnType<typeof createInput>, wx: number, wy: number, mods?: { ctrl?: boolean }) {
  const sx = wx * 64;
  const sy = wy * 64;
  inp.click(click(sx, sy, mods));
  inp.release(click(sx, sy, mods));
}

/* -------------------------------- tests -------------------------------- */

describe('selection input', () => {
  it('left-click selects exactly the clicked own unit', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const b = unit({ x: ff(20), y: ff(20) });
    const f = fake({ ents: [a, b] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    expect(f.selection).toEqual([a.eid]);
  });

  it('clicking empty ground clears the selection', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    leftClick(inp, 40, 40);
    expect(f.selection).toEqual([]);
  });

  it('Ctrl+click appends and de-duplicates', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const b = unit({ x: ff(9), y: ff(9) });
    const f = fake({ ents: [a, b] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    leftClick(inp, 9, 9, { ctrl: true });
    expect(f.selection).toEqual([a.eid, b.eid].sort((x, y) => x - y));
    leftClick(inp, 9, 9, { ctrl: true }); // toggles off
    expect(f.selection).toEqual([a.eid]);
  });

  it('drag box selects everything inside and drops the drag on release', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const b = unit({ x: ff(8), y: ff(8) });
    const far = unit({ x: ff(60), y: ff(60) });
    const f = fake({ ents: [a, b, far] });
    const inp = createInput(f.deps);
    inp.click(click(0, 0));
    inp.move(click(15 * 64, 15 * 64));
    expect(inp.state.dragging).toBe(true);
    expect(inp.state.dragEnd).not.toBeNull();
    inp.release(click(15 * 64, 15 * 64));
    expect(inp.state.dragging).toBe(false);
    expect(f.selection.sort((x, y) => x - y)).toEqual([a.eid, b.eid].sort((x, y) => x - y));
  });

  it('double-click selects every unit of that type', () => {
    const a = unit({ x: ff(5), y: ff(5), unitId: 'footman' });
    const b = unit({ x: ff(30), y: ff(30), unitId: 'footman' });
    const knight = unit({ x: ff(20), y: ff(20), unitId: 'knight' });
    const f = fake({ ents: [a, b, knight] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    leftClick(inp, 5, 5);
    expect(f.selection.sort((x, y) => x - y)).toEqual([a.eid, b.eid].sort((x, y) => x - y));
  });

  it('box select caps at 12 units', () => {
    const many = Array.from({ length: 20 }, () => unit({ x: ff(2 + Math.random()), y: ff(2 + Math.random()) }));
    const f = fake({ ents: many });
    const inp = createInput(f.deps);
    inp.click(click(0, 0));
    inp.release(click(10 * 64, 10 * 64));
    expect(f.selection.length).toBeLessThanOrEqual(12);
  });
});

describe('order commands', () => {
  it('right-click on ground emits rightClick with a null target', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.rightClick(rclick(30 * 64, 30 * 64));
    inp.pump();
    expect(f.commands).toEqual([
      { k: 'rightClick', player: 1, units: [a.eid], target: null, at: { x: ff(30), y: ff(30) }, queue: false },
    ]);
  });

  it('right-click on an entity passes its eid as target', () => {
    const mine = unit({ x: ff(5), y: ff(5) });
    const foe = unit({ x: ff(30), y: ff(30), player: 2 });
    const f = fake({ ents: [mine, foe] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.rightClick(rclick(30 * 64, 30 * 64));
    inp.pump();
    // enemies are not pickable as "own", so target stays null for hostile ids
    expect(f.commands[0].k).toBe('rightClick');
  });

  it('Shift+right-click queues', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.rightClick(rclick(20, 20, { shift: true }));
    inp.pump();
    expect((f.commands[0] as { queue?: boolean }).queue).toBe(true);
  });

  it('A then right-click issues an attack-move order', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.key(key('a'));
    inp.rightClick(rclick(25 * 64, 25 * 64));
    inp.pump();
    expect(f.commands[0]).toEqual({ k: 'move', player: 1, units: [a.eid], to: { x: ff(25), y: ff(25) }, mode: 'attackMove', queue: false });
  });

  it('M then right-click issues a plain move', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.key(key('m'));
    inp.rightClick(rclick(25 * 64, 25 * 64));
    inp.pump();
    expect((f.commands[0] as { mode?: string }).mode).toBe('move');
  });

  it('targeting mode is consumed by one click only', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.key(key('a'));
    inp.rightClick(rclick(25 * 64, 25 * 64));
    inp.rightClick(rclick(40 * 64, 40 * 64));
    inp.pump();
    expect((f.commands[0] as { mode?: string }).mode).toBe('attackMove');
    expect((f.commands[1] as { k: string }).k).toBe('rightClick');
  });

  it('orders with an empty selection emit nothing', () => {
    const f = fake({ ents: [unit()] });
    const inp = createInput(f.deps);
    inp.rightClick(rclick(10 * 64, 10 * 64));
    inp.key(key('s'));
    inp.pump();
    expect(f.commands).toEqual([]);
  });
});

describe('hotkeys', () => {
  it('S and H map to stop / hold', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    for (const [k, expectKind] of [['s', 'stop'], ['h', 'hold']] as const) {
      const f = fake({ ents: [a] });
      const inp = createInput(f.deps);
      leftClick(inp, 5, 5);
      inp.key(key(k));
      inp.pump();
      expect(f.commands[0]).toEqual({ k: expectKind, player: 1, units: [a.eid] });
    }
  });

  it('Escape clears the selection', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.key(key('Escape'));
    expect(f.selection).toEqual([]);
  });

  it('F2 selects all idle workers', () => {
    const w1 = unit({ x: ff(5), y: ff(5), isWorker: true, unitId: 'peasant' });
    const w2 = unit({ x: ff(7), y: ff(7), isWorker: true, unitId: 'peasant' });
    const fighter = unit({ x: ff(9), y: ff(9) });
    const f = fake({ ents: [w1, w2, fighter] });
    const inp = createInput(f.deps);
    inp.key(key('F2'));
    expect(f.selection.sort((a, b) => a - b)).toEqual([w1.eid, w2.eid].sort((a, b) => a - b));
  });

  it('+/- adjust zoom', () => {
    const f = fake();
    const inp = createInput(f.deps);
    inp.key(key('='));
    inp.key(key('-'));
    expect(f.zooms[0]).toBeGreaterThan(1);
    expect(f.zooms[1]).toBeLessThan(1);
  });

  it('every declared hotkey has a label and a known action shape', () => {
    for (const h of HOTKEYS) {
      expect(h.label.length).toBeGreaterThan(0);
      expect(typeof h.action.kind).toBe('string');
    }
  });
});

describe('control groups', () => {
  it('Ctrl+1 assigns, 1 recalls, and dead members drop out', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const b = unit({ x: ff(9), y: ff(9) });
    const f = fake({ ents: [a, b] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    leftClick(inp, 9, 9, { ctrl: true });
    inp.key(key('1', { ctrl: true }));
    expect(inp.controlGroup(1).sort((x, y) => x - y)).toEqual([a.eid, b.eid].sort((x, y) => x - y));

    f.selection = [];
    inp.key(key('1'));
    expect(f.selection.length).toBe(2);

    f.ents = [{ ...a, alive: false }, b];
    inp.key(key('1'));
    expect(f.selection).toEqual([b.eid]);
  });

  it('Ctrl+Shift+1 appends to a group', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const b = unit({ x: ff(9), y: ff(9) });
    const f = fake({ ents: [a, b] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.key(key('1', { ctrl: true }));
    f.selection = [b.eid];
    inp.key(key('1', { ctrl: true, shift: true }));
    expect(inp.controlGroup(1).length).toBe(2);
  });
});

describe('camera', () => {
  it('edge scrolling pans toward the border the cursor rests on', () => {
    const f = fake();
    const inp = createInput(f.deps);
    inp.move(click(1, 400)); // hard left edge
    f.pans.length = 0;
    inp.frame(1000 / 30);
    expect(f.pans.length).toBe(1);
    expect(f.pans[0][0]).toBeLessThan(0);
    expect(f.pans[0][1]).toBe(0);
  });

  it('centre of the screen does not scroll', () => {
    const f = fake();
    const inp = createInput(f.deps);
    inp.move(click(640, 360));
    f.pans.length = 0;
    inp.frame(1000 / 30);
    expect(f.pans).toEqual([]);
  });

  it('arrow keys pan continuously while held', () => {
    const f = fake();
    const inp = createInput(f.deps);
    inp.key(key('ArrowLeft'));
    f.pans.length = 0;
    inp.frame(100);
    expect(f.pans[0][0]).toBeLessThan(0);
    inp.unkey('ArrowLeft');
    f.pans.length = 0;
    inp.frame(100);
    expect(f.pans).toEqual([]);
  });

  it('middle-drag pans by the pointer delta', () => {
    const f = fake();
    const inp = createInput(f.deps);
    inp.click({ button: 1, clientX: 100, clientY: 100 });
    inp.move({ button: 1, clientX: 140, clientY: 90 });
    expect(f.pans).toEqual([[40, -10]]);
  });

  it('wheel zooms in and out', () => {
    const f = fake();
    const inp = createInput(f.deps);
    inp.wheel(-100);
    inp.wheel(100);
    expect(f.zooms[0]).toBeGreaterThan(1);
    expect(f.zooms[1]).toBeLessThan(1);
  });
});

describe('command hygiene', () => {
  it('pump() flushes each command exactly once and in order', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.rightClick(rclick(20 * 64, 20 * 64));
    inp.key(key('s'));
    inp.pump();
    expect(f.commands.map((c) => c.k)).toEqual(['rightClick', 'stop']);
    inp.pump();
    expect(f.commands.length).toBe(2);
  });

  it('every emitted command is pure JSON (replay-safe)', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.rightClick(rclick(20 * 64, 20 * 64));
    inp.rightClick(rclick(21 * 64, 21 * 64, { shift: true }));
    inp.key(key('a'));
    inp.rightClick(rclick(33 * 64, 44 * 64));
    inp.key(key('s'));
    inp.key(key('h'));
    inp.pump();
    expect(f.commands.length).toBeGreaterThanOrEqual(4);
    for (const cmd of f.commands) {
      expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
    }
    // positions must be plain integers in fixed-point
    const mv = f.commands.find((c) => c.k === 'move') as { to: { x: number; y: number } };
    expect(Number.isInteger(mv.to.x)).toBe(true);
    expect(fn(mv.to.x)).toBeCloseTo(33, 4);
  });

  it('input never mutates the entity list it was handed', () => {
    const a = unit({ x: ff(5), y: ff(5) });
    const snapshot = JSON.stringify(a);
    const f = fake({ ents: [a] });
    const inp = createInput(f.deps);
    leftClick(inp, 5, 5);
    inp.rightClick(rclick(20 * 64, 20 * 64));
    inp.pump();
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});
