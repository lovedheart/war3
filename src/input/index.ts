/**
 * Input layer: turns DOM events into serialisable `Command`s.
 *
 * Hard rule — this module NEVER mutates sim state. The only exception is
 * `world.view`, which ARCHITECTURE.md designates as presentation-owned. Every
 * gameplay intent leaves through `deps.command()`, so replaying the recorded
 * command stream reproduces the match exactly.
 */
import type { Command, Vec2F } from '../sim/commandTypes.js';
import { ff } from '../core/fixed.js';
import { HOTKEYS, PAN_KEYS, digitAction, type InputAction } from './hotkeys.js';
import { boxSelect, mergeSelection, pickAt, MAX_SELECTION, type SelectableEntity } from './select.js';

export interface InputDeps {
  /** which player this input device controls */
  player: number;
  /** enqueue a command into the sim (the ONLY mutation path) */
  command(cmd: Command): void;
  /** read the current selection (ascending eid order) */
  getSelection(): number[];
  setSelection(eids: number[]): void;
  /** every selectable entity, for hit tests */
  entities(): SelectableEntity[];
  /** screen CSS px -> world fixed */
  screenToWorld(sx: number, sy: number): Vec2F;
  /** pan by screen px / zoom multiplicatively */
  panByPixels(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  /** viewport size in CSS px, for edge scrolling and box clamping */
  viewport(): { w: number; h: number };
  /** hover feedback for the renderer */
  setHover?(eid: number): void;
  /** debug overlay toggle (Tab) */
  toggleDebug?(): void;
  /** UI hooks (the HUD subscribes here; may be absent in tests) */
  onSelectionChanged?(eids: number[]): void;
}

export interface InputManager {
  /** attach to an EventTarget (defaults to window); returns a detach fn */
  attach(target?: EventTarget): void;
  detach(): void;
  /** call once per tick: flushes pending intents into Commands */
  pump(): void;
  /** per-frame housekeeping: edge scrolling + held-key panning */
  frame(dtMs: number): void;
  readonly state: InputState;
  controlGroup(slot: number): number[];
  /** direct dispatch entry points, used by the HUD's command cards */
  click(ev: PointerLike): void;
  move(ev: PointerLike): void;
  release(ev: PointerLike): void;
  rightClick(ev: PointerLike): void;
  wheel(deltaY: number): void;
  key(ev: KeyLike): void;
  unkey(key: string): void;
}

export interface InputState {
  mouseWorld: Vec2F;
  dragging: boolean;
  dragStart: { sx: number; sy: number } | null;
  dragEnd: { sx: number; sy: number } | null;
  attackMovePending: boolean;
  movePending: boolean;
  groups: Record<number, number[]>;
}

export interface PointerLike {
  button: number;
  clientX: number;
  clientY: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

/** Screen band (px) inside which the cursor scrolls the view. */
const EDGE_BAND_PX = 6;
const EDGE_SPEED_PX_PER_S = 900;
const PAN_KEY_SPEED_PX_PER_S = 620;
/** A left-drag shorter than this in both axes counts as a click. */
const CLICK_SLOP_PX = 4;

export function createInput(deps: InputDeps): InputManager {
  const state: InputState = {
    mouseWorld: { x: ff(0), y: ff(0) },
    dragging: false,
    dragStart: null,
    dragEnd: null,
    attackMovePending: false,
    movePending: false,
    groups: {},
  };

  const keysHeld = new Set<string>();
  let middleDown = false;
  let middleLast = { sx: 0, sy: 0 };
  let lastScreen = { sx: 0, sy: 0 };
  let lastClickEid = -1;
  let lastClickTick = 0;
  let clickClock = 0;
  let pending: Command[] = [];
  let attached = false;
  let target: EventTarget | null = null;

  const sel = (): number[] => deps.getSelection();
  const setSel = (eids: number[]): void => {
    deps.setSelection(eids);
    deps.onSelectionChanged?.(eids);
  };
  const emit = (cmd: Command): void => {
    pending.push(cmd);
  };
  const atMouse = (): Vec2F => ({ x: state.mouseWorld.x, y: state.mouseWorld.y });

  const trackMove = (ev: PointerLike): void => {
    lastScreen = { sx: ev.clientX, sy: ev.clientY };
    state.mouseWorld = deps.screenToWorld(ev.clientX, ev.clientY);
  };

  /* ------------------------------ pointer ------------------------------ */

  const click = (ev: PointerLike): void => {
    trackMove(ev);
    if (ev.button === 1) {
      middleDown = true;
      middleLast = { sx: ev.clientX, sy: ev.clientY };
      return;
    }
    if (ev.button !== 0) return;
    state.dragging = true;
    state.dragStart = { sx: ev.clientX, sy: ev.clientY };
    state.dragEnd = { sx: ev.clientX, sy: ev.clientY };
  };

  const move = (ev: PointerLike): void => {
    if (middleDown) {
      deps.panByPixels(ev.clientX - middleLast.sx, ev.clientY - middleLast.sy);
      middleLast = { sx: ev.clientX, sy: ev.clientY };
      lastScreen = { sx: ev.clientX, sy: ev.clientY };
      return;
    }
    trackMove(ev);
    if (state.dragging && state.dragEnd) {
      state.dragEnd = { sx: ev.clientX, sy: ev.clientY };
      return;
    }
    deps.setHover?.(pickAt(deps.entities(), state.mouseWorld.x, state.mouseWorld.y, deps.player) ?? 0xffffffff);
  };

  const release = (ev: PointerLike): void => {
    if (ev.button === 1) {
      middleDown = false;
      return;
    }
    if (ev.button !== 0 || !state.dragging) return;
    const start = state.dragStart ?? { sx: ev.clientX, sy: ev.clientY };
    const end = { sx: ev.clientX, sy: ev.clientY };
    state.dragging = false;
    state.dragStart = null;
    state.dragEnd = null;
    trackMove(ev);

    const ents = deps.entities();
    const dragged =
      Math.abs(end.sx - start.sx) > CLICK_SLOP_PX || Math.abs(end.sy - start.sy) > CLICK_SLOP_PX;
    if (dragged) {
      const a = deps.screenToWorld(start.sx, start.sy);
      const b = deps.screenToWorld(end.sx, end.sy);
      const picked = boxSelect(ents, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, deps.player);
      setSel(ev.ctrlKey ? mergeSelection(sel(), picked) : picked);
      return;
    }

    const hit = pickAt(ents, state.mouseWorld.x, state.mouseWorld.y, deps.player);
    if (hit === null) {
      if (!ev.ctrlKey) setSel([]);
      lastClickEid = -1;
      return;
    }
    if (ev.ctrlKey) {
      const cur = sel();
      setSel(cur.includes(hit) ? cur.filter((e) => e !== hit) : mergeSelection(cur, [hit]));
      lastClickEid = -1;
      return;
    }
    // double-click on the same unit id -> select all of that type on screen
    clickClock++;
    const unitId = idOf(ents, hit);
    const isDouble = hit === lastClickEid || (unitId !== '' && unitId === lastClickId && clickClock - lastClickTick <= 15);
    lastClickId = unitId;
    lastClickTick = clickClock;
    lastClickEid = hit;
    if (isDouble) {
      const same = ents
        .filter((e) => e.alive && e.player === deps.player && e.kind === 0 && e.unitId === unitId)
        .map((e) => e.eid)
        .sort((a, b) => a - b);
      setSel(same.slice(0, MAX_SELECTION));
    } else {
      setSel([hit]);
    }
  };

  let lastClickId = '';

  const rightClick = (ev: PointerLike): void => {
    trackMove(ev);
    const units = sel();
    const targeting = state.attackMovePending || state.movePending;
    if (!units.length && !targeting) return;
    const queue = !!ev.shiftKey;
    if (state.attackMovePending) {
      emit({ k: 'move', player: deps.player, units, to: atMouse(), mode: 'attackMove', queue });
      state.attackMovePending = false;
      return;
    }
    if (state.movePending) {
      emit({ k: 'move', player: deps.player, units, to: atMouse(), mode: 'move', queue });
      state.movePending = false;
      return;
    }
    const target = pickAt(deps.entities(), state.mouseWorld.x, state.mouseWorld.y, deps.player);
    emit({ k: 'rightClick', player: deps.player, units, target, at: atMouse(), queue });
  };

  const wheel = (deltaY: number): void => {
    deps.zoomBy(deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  /* ------------------------------ keyboard ----------------------------- */

  const applyAction = (act: InputAction): void => {
    const units = sel();
    switch (act.kind) {
      case 'stop':
        if (units.length) emit({ k: 'stop', player: deps.player, units });
        break;
      case 'hold':
        if (units.length) emit({ k: 'hold', player: deps.player, units });
        break;
      case 'move':
        if (!units.length) break;
        // A/M enter targeting mode; the Command fires on the next click
        if (act.mode === 'attackMove') state.attackMovePending = true;
        else state.movePending = true;
        break;
      case 'selectNone':
        setSel([]);
        break;
      case 'selectAllReady': {
        const workers = deps
          .entities()
          .filter((e) => e.alive && e.player === deps.player && e.kind === 0 && e.isWorker)
          .map((e) => e.eid)
          .sort((a, b) => a - b);
        setSel(workers.slice(0, MAX_SELECTION));
        break;
      }
      case 'controlGroupSet':
        state.groups[act.slot] = [...units];
        break;
      case 'controlGroupAppend':
        state.groups[act.slot] = mergeSelection(state.groups[act.slot] ?? [], units);
        break;
      case 'controlGroupGet': {
        const live = (state.groups[act.slot] ?? []).filter((e) => deps.entities().some((x) => x.eid === e && x.alive));
        state.groups[act.slot] = live;
        setSel(live);
        break;
      }
      case 'toggleDebug':
        deps.toggleDebug?.();
        break;
      case 'zoomIn':
        deps.zoomBy(1.15);
        break;
      case 'zoomOut':
        deps.zoomBy(1 / 1.15);
        break;
    }
  };

  const key = (ev: KeyLike): void => {
    const k = ev.key.toLowerCase();
    // Track every keydown so held-key panning works; keyup is the only removal.
    keysHeld.add(k);
    if (/^[1-9]$/.test(k)) {
      applyAction(digitAction(Number(k), !!ev.ctrlKey, !!ev.shiftKey));
      return;
    }
    if (PAN_KEYS[k]) return; // continuous panning handled in frame()
    const hk = HOTKEYS.find((h) => h.key === k && !!h.ctrl === !!ev.ctrlKey && !!h.shift === !!ev.shiftKey);
    if (!hk) return;
    if (hk.requiresSelection && !sel().length) return;
    applyAction(hk.action);
  };

  const unkey = (k: string): void => {
    const keyName = k.toLowerCase();
    keysHeld.delete(keyName);
  };

  /* --------------------------- frame / pump ---------------------------- */

  const frame = (dtMs: number): void => {
    const { w, h } = deps.viewport();
    let edgeX = 0;
    let edgeY = 0;
    if (lastScreen.sx <= EDGE_BAND_PX) edgeX -= 1;
    else if (lastScreen.sx >= w - EDGE_BAND_PX) edgeX += 1;
    if (lastScreen.sy <= EDGE_BAND_PX) edgeY -= 1;
    else if (lastScreen.sy >= h - EDGE_BAND_PX) edgeY += 1;
    let arrowX = 0;
    let arrowY = 0;
    for (const [k, v] of Object.entries(PAN_KEYS)) {
      if (!keysHeld.has(k)) continue;
      arrowX += v[0];
      arrowY += v[1];
    }
    const seconds = dtMs / 1000;
    // Edge scroll and key pan are independent sources; sum them into one pan so
    // a caller cannot observe two competing deltas in the same frame.
    const dx = edgeX * EDGE_SPEED_PX_PER_S + arrowX * PAN_KEY_SPEED_PX_PER_S;
    const dy = edgeY * EDGE_SPEED_PX_PER_S + arrowY * PAN_KEY_SPEED_PX_PER_S;
    if (dx || dy) deps.panByPixels(dx * seconds, dy * seconds);
  };

  const handlers: [string, EventListener][] = [
    ['mousedown', ((e: PointerEvent) => click(e)) as EventListener],
    ['mousemove', ((e: PointerEvent) => move(e)) as EventListener],
    ['mouseup', ((e: PointerEvent) => release(e)) as EventListener],
    ['contextmenu', ((e: Event) => {
      e.preventDefault();
      rightClick(e as unknown as PointerLike);
    }) as EventListener],
    ['wheel', ((e: WheelEvent) => {
      e.preventDefault();
      wheel(e.deltaY);
    }) as EventListener],
    ['keydown', ((e: KeyboardEvent) => key(e)) as EventListener],
    ['keyup', ((e: KeyboardEvent) => unkey(e.key)) as EventListener],
  ];

  return {
    attach(t) {
      if (attached) return;
      target = (t ?? (typeof window !== 'undefined' ? (window as unknown as EventTarget) : null)) as EventTarget | null;
      attached = true;
      if (!target || typeof target.addEventListener !== 'function') return;
      for (const [type, fn] of handlers) target.addEventListener(type, fn);
    },
    detach() {
      if (attached && target && typeof target.removeEventListener === 'function') {
        for (const [type, fn] of handlers) target.removeEventListener(type, fn);
      }
      attached = false;
      target = null;
    },
    pump() {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      for (const cmd of batch) deps.command(cmd);
    },
    frame,
    state,
    controlGroup(slot: number) {
      return state.groups[slot] ?? [];
    },
    click,
    move,
    release,
    rightClick,
    wheel,
    key,
    unkey,
  };
}

function idOf(ents: readonly SelectableEntity[], eid: number): string {
  return ents.find((e) => e.eid === eid)?.unitId ?? '';
}

/** Convenience for the HUD: build a Vec2F from plain numbers (in tiles). */
export function vecFromTiles(xTiles: number, yTiles: number): Vec2F {
  return { x: ff(xTiles) + ff(0.5), y: ff(yTiles) + ff(0.5) };
}
