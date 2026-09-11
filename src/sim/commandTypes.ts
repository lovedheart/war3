/**
 * Serializable player/AI intent. Everything that changes the sim from outside
 * goes through this union: mouse input, hotkeys and the AI all build Commands.
 * Replays are `{ seed, mapHash, mapJson, commands: [tick, Command][] }`.
 *
 * JSON-safe only (numbers/strings/arrays). `null` target means "no entity".
 */
import type { Fixed } from '../core/fixed.js';

export interface Vec2F {
  x: Fixed;
  y: Fixed;
}

export type MoveMode = 'move' | 'attack' | 'attackMove' | 'patrol' | 'follow';

export type Command =
  | { k: 'move'; player: number; units: number[]; to: Vec2F; mode: MoveMode; queue?: boolean }
  | { k: 'stop'; player: number; units: number[] }
  | { k: 'hold'; player: number; units: number[] }
  | { k: 'rightClick'; player: number; units: number[]; target: number | null; at: Vec2F; queue?: boolean }
  | { k: 'train'; player: number; building: number; unitId: string }
  | { k: 'build'; player: number; worker: number; buildingId: string; at: Vec2F }
  | { k: 'harvest'; player: number; worker: number; target: number; kind: 'gold' | 'wood' }
  | { k: 'return'; player: number; worker: number; to: number }
  | { k: 'research'; player: number; building: number; techId: string }
  | { k: 'upgradeUnit'; player: number; units: number[]; toId: string }
  | { k: 'ability'; player: number; caster: number; abilityId: string; target: number | null; at?: Vec2F }
  | { k: 'itemUse'; player: number; unit: number; slot: number; target: number | null; at?: Vec2F }
  | { k: 'itemDrop'; player: number; unit: number; slot: number; at: Vec2F }
  | { k: 'itemGive'; player: number; from: number; slot: number; to: number }
  | { k: 'rally'; player: number; entity: number; at: Vec2F }
  | { k: 'cancelTrain'; player: number; building: number; index: number }
  | { k: 'cancelBuild'; player: number; entity: number }
  | { k: 'cancelResearch'; player: number; building: number; index: number }
  | { k: 'revive'; player: number; hero: number }
  | { k: 'upkeep'; player: number; mode: 0 | 1 | 2 }
  | { k: 'sell'; player: number; building: number }
  | { k: 'townHallConvert'; player: number; building: number }
  | { k: 'trigger'; player: number; name: string; payload?: unknown };

export interface TimedCommand {
  tick: number;
  cmd: Command;
}
