/**
 * ECS-lite: one Struct-of-Arrays table per component.
 *
 * Components are plain objects stored in a dense array indexed by entity index;
 * `has()` is a presence-bitmap test. Systems iterate index order (deterministic).
 */
import { Eid, eidIndex } from '../core/pool.js';

export interface ComponentCtor<T> {
  readonly name: string;
  create(): T;
}

export class Store<T extends object> {
  readonly data: (T | undefined)[] = [];
  private present: Uint8Array = new Uint8Array(64);

  constructor(
    readonly name: string,
    private factory: () => T,
  ) {}

  private grow(i: number): void {
    while (this.data.length <= i) this.data.push(undefined);
    if (this.present.length <= (i >> 3)) {
      const next = new Uint8Array(Math.max(this.present.length * 2, (i >> 3) + 1));
      next.set(this.present);
      this.present = next;
    }
  }

  add(eid: Eid): T {
    const i = eidIndex(eid);
    this.grow(i);
    const c = this.factory();
    this.data[i] = c;
    this.present[i >> 3] |= 1 << (i & 7);
    return c;
  }

  get(eid: Eid): T | undefined {
    return this.data[eidIndex(eid)];
  }

  /** Non-undefined assert; only call when has() was true. */
  require(eid: Eid): T {
    const c = this.data[eidIndex(eid)];
    if (!c) throw new Error(`missing component ${this.name} on ${eid}`);
    return c;
  }

  has(eid: Eid): boolean {
    const i = eidIndex(eid);
    return i < this.present.length * 8 && (this.present[i >> 3] & (1 << (i & 7))) !== 0;
  }

  remove(eid: Eid): void {
    const i = eidIndex(eid);
    if (i < this.data.length) this.data[i] = undefined;
    if (i < this.present.length * 8) this.present[i >> 3] &= ~(1 << (i & 7));
  }

  clear(i: number): void {
    if (i < this.data.length) this.data[i] = undefined;
    if (i < this.present.length * 8) this.present[i >> 3] &= ~(1 << (i & 7));
  }

  /** Iterate live entities in ascending index order. */
  forEach(fn: (eid: Eid, c: T) => void): void {
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i];
      if (c !== undefined) fn((((i << 20) >>> 0) | 0) as Eid, c);
    }
  }
}

/** Registry of stores plus per-entity lifecycle bookkeeping. */
export class ComponentRegistry {
  private stores = new Map<string, Store<object>>();
  /** bitset of which components an entity holds, by store id */
  private masks = new Uint32Array(64);

  register<T extends object>(store: Store<T>): Store<T> {
    this.stores.set(store.name, store as unknown as Store<object>);
    return store;
  }

  store<T extends object>(name: string): Store<T> {
    const s = this.stores.get(name);
    if (!s) throw new Error(`unregistered component store: ${name}`);
    return s as unknown as Store<T>;
  }

  all(): Store<object>[] {
    return [...this.stores.values()];
  }

  reset(): void {
    for (const s of this.stores.values()) {
      s.data.length = 0;
      s['present' as never] = new Uint8Array(64) as never;
    }
    this.masks.fill(0);
  }
}
