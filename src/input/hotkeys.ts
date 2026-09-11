/**
 * Central hotkey table.
 *
 * Single source of truth for both the input dispatcher and the UI tooltips:
 * the HUD reads this array to label command cards, so the mapping and the
 * label can never drift apart.
 */
import type { MoveMode } from '../sim/commandTypes.js';

export type InputAction =
  | { kind: 'stop' }
  | { kind: 'hold' }
  | { kind: 'move'; mode: MoveMode }
  | { kind: 'selectNone' }
  | { kind: 'selectAllReady' }
  | { kind: 'controlGroupSet'; slot: number }
  | { kind: 'controlGroupGet'; slot: number }
  | { kind: 'controlGroupAppend'; slot: number }
  | { kind: 'cameraCenter'; slot: number }
  | { kind: 'toggleDebug' }
  | { kind: 'zoomIn' }
  | { kind: 'zoomOut' };

export interface Hotkey {
  /** lower-cased KeyboardEvent.key, or the arrow-key name */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  /** when true, the entry only fires while units are selected */
  requiresSelection?: boolean;
  action: InputAction;
  /** human label for the UI tooltip */
  label: string;
}

export const HOTKEYS: Hotkey[] = [
  { key: 's', action: { kind: 'stop' }, label: 'Stop', requiresSelection: true },
  { key: 'h', action: { kind: 'hold' }, label: 'Hold Position', requiresSelection: true },
  { key: 'm', action: { kind: 'move', mode: 'move' }, label: 'Move', requiresSelection: true },
  { key: 'a', action: { kind: 'move', mode: 'attackMove' }, label: 'Attack-Move', requiresSelection: true },
  { key: 'escape', action: { kind: 'selectNone' }, label: 'Deselect' },
  { key: 'f2', action: { kind: 'selectAllReady' }, label: 'Select All Idle Workers' },
  { key: 'tab', action: { kind: 'toggleDebug' }, label: 'Toggle debug overlays' },
  { key: '=', action: { kind: 'zoomIn' }, label: 'Zoom in' },
  { key: '-', action: { kind: 'zoomOut' }, label: 'Zoom out' },
];

/** Ctrl+1..9 assign / 1..9 recall / Ctrl+Shift+1..9 append. */
export function digitAction(digit: number, ctrl: boolean, shift: boolean): InputAction {
  if (ctrl && shift) return { kind: 'controlGroupAppend', slot: digit };
  if (ctrl) return { kind: 'controlGroupSet', slot: digit };
  return { kind: 'controlGroupGet', slot: digit };
}

/** Arrow keys pan the camera; not part of HOTKEYS because they repeat. */
export const PAN_KEYS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  arrowdown: [0, 1],
  arrowleft: [-1, 0],
  arrowright: [1, 0],
};

/** Find the hotkey entry matching a key event (for UI highlighting). */
export function matchHotkey(key: string, ctrl: boolean, shift: boolean): Hotkey | undefined {
  const k = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  return HOTKEYS.find((h) => h.key === k && !!h.ctrl === ctrl && !!h.shift === shift);
}
