/**
 * Order stack: issue / queue / advance orders, and the smart right-click
 * resolution that makes WC3 feel the way it does.
 */
import { Fixed } from '../core/fixed.js';
import { Eid } from '../core/pool.js';
import { World } from './world.js';
import type { COrders, OrderSlot, OrderKind } from './components.js';
import type { MoveMode } from './commandTypes.js';

export const NO_TARGET = 0xffffffff;

export function blankOrder(): OrderSlot {
  return { kind: 'none', targetEid: NO_TARGET, tx: 0, ty: 0, mode: 0, param: '' };
}

export function ordersOf(w: World, e: Eid): COrders | undefined {
  return (w.stores.orders as unknown as { get(x: Eid): COrders | undefined }).get(e);
}

export function clearOrders(o: COrders): void {
  o.current = blankOrder();
  o.queue.length = 0;
  o.acquireTarget = NO_TARGET;
}

function slotFromMode(mode: MoveMode): OrderKind {
  switch (mode) {
    case 'attack':
      return 'attack';
    case 'attackMove':
      return 'attackMove';
    case 'patrol':
      return 'patrol';
    case 'follow':
      return 'follow';
    default:
      return 'move';
  }
}

/** Issue an order to one unit; honours Shift-queueing and returns false if queue is full. */
export function issue(
  w: World,
  e: Eid,
  kind: OrderKind,
  targetEid: number,
  tx: Fixed,
  ty: Fixed,
  queue: boolean,
  param = '',
  mode = 0,
): boolean {
  const o = ordersOf(w, e);
  if (!o) return false;
  const slot: OrderSlot = { kind, targetEid, tx, ty, mode, param };
  if (queue && o.current.kind !== 'none') {
    if (o.queue.length >= 32) return false;
    o.queue.push(slot);
    return true;
  }
  o.current = slot;
  o.queue.length = 0;
  o.acquireTarget = NO_TARGET;
  const t = (w.stores.transform as unknown as { get(x: Eid): { x: Fixed; y: Fixed } | undefined }).get(e);
  if (t) {
    o.anchorX = t.x;
    o.anchorY = t.y;
  }
  return true;
}

/** Pop the next queued order into `current`. Returns true if something was popped. */
export function advance(o: COrders): boolean {
  const next = o.queue.shift();
  if (!next) return false;
  o.current = next;
  o.acquireTarget = NO_TARGET;
  return true;
}

/**
 * Smart right-click on empty ground / entity, replicating WC3 context rules:
 *   own unit + worker        -> harvest or repair
 *   enemy unit               -> attack
 *   own building under constr-> build/assist
 *   gold mine / tree         -> harvest
 *   item                     -> pick up
 *   ally unit                -> follow
 *   anything else            -> move
 */
export function smartRightClick(
  w: World,
  units: readonly Eid[],
  target: Eid | null,
  at: { x: Fixed; y: Fixed },
  queue: boolean,
): void {
  const kindStore = w.stores.kind as unknown as { get(x: Eid): { kind: number } | undefined };
  const ownerStore = w.stores.owner as unknown as { get(x: Eid): { player: number } | undefined };
  const cargoStore = w.stores.cargo as unknown as { get(x: Eid): { carrying: string } | undefined };
  const bStore = w.stores.building as unknown as {
    get(x: Eid): { built: boolean; buildingId: string } | undefined;
  };
  const mineStore = w.stores.mine as unknown as { get(x: Eid): unknown };
  const treeStore = w.stores.tree as unknown as { get(x: Eid): unknown };


  for (const u of units) {
    const me = ownerStore.get(u)?.player ?? 0;
    if (target === null || target === NO_TARGET) {
      issue(w, u, 'move', NO_TARGET, at.x, at.y, queue);
      continue;
    }
    const tk = kindStore.get(target)?.kind;
    const tp = ownerStore.get(target)?.player ?? 0;
    if (tk === 2 /* item */) {
      issue(w, u, 'harvest', target, at.x, at.y, queue, 'item', 2);
      continue;
    }
    if (mineStore.get(target)) {
      issue(w, u, 'harvest', target, at.x, at.y, queue, 'gold', 0);
      continue;
    }
    if (treeStore.get(target)) {
      issue(w, u, 'harvest', target, at.x, at.y, queue, 'wood', 1);
      continue;
    }
    if (bStore.get(target) && !bStore.get(target)!.built && tp === me) {
      issue(w, u, 'build', target, at.x, at.y, queue, bStore.get(target)!.buildingId);
      continue;
    }
    if (tp === me) {
      if (cargoStore.get(u) && tk === 1 /* building */) {
        issue(w, u, 'return', target, at.x, at.y, queue);
      } else if (cargoStore.get(u)) {
        issue(w, u, 'follow', target, at.x, at.y, queue);
      } else {
        issue(w, u, 'follow', target, at.x, at.y, queue);
      }
      continue;
    }
    // hostile (neutral-aggressive and other players are attackable)
    if (tp !== 11 /* neutral passive */) {
      issue(w, u, 'attack', target, at.x, at.y, queue);
      continue;
    }
    issue(w, u, 'move', NO_TARGET, at.x, at.y, queue);
  }
}

export function moveModeToKind(m: MoveMode): OrderKind {
  return slotFromMode(m);
}
