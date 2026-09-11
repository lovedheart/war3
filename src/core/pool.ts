/**
 * Generation-indexed entity id + free list. Ids are 32-bit: index | generation.
 * Recycling an index bumps the generation so stale references fail loudly.
 */
/** Entity id type: index<<GEN_BITS | generation. */
export type Eid = number;

export const GEN_BITS = 20;
const GEN_MASK = (1 << GEN_BITS) - 1;

export function eidIndex(eid: number): number {
  return (eid >>> GEN_BITS) >>> 0;
}

export function eidGen(eid: number): number {
  return eid & GEN_MASK;
}

export function makeEid(index: number, gen: number): number {
  return (((index << GEN_BITS) >>> 0) | (gen & GEN_MASK)) >>> 0;
}

export const NULL_EID = 0xffffffff >>> 0;

export class EntityPool {
  private gens: number[] = [];
  private free: number[] = [];
  alive = 0;

  acquire(): number {
    let idx: number;
    if (this.free.length > 0) {
      idx = this.free.pop()!;
    } else {
      idx = this.gens.length;
      this.gens.push(0);
    }
    this.alive++;
    return makeEid(idx, this.gens[idx]);
  }

  release(eid: number): void {
    const idx = eidIndex(eid);
    if (idx >= this.gens.length) return;
    this.gens[idx] = (this.gens[idx] + 1) & GEN_MASK;
    this.free.push(idx);
    this.alive--;
  }

  valid(eid: number): boolean {
    if (eid === NULL_EID) return false;
    const idx = eidIndex(eid);
    return idx < this.gens.length && this.gens[idx] === eidGen(eid);
  }

  /** Iterate live ids deterministically by index order. */
  forEach(fn: (eid: number) => void): void {
    for (let i = 0; i < this.gens.length; i++) {
      // callers filter with a component presence check; we cannot know liveness here
      fn(makeEid(i, this.gens[i]));
    }
  }
}

/** Simple object pool for short-lived records (projectiles, particles). */
export class ObjectPool<T> {
  private freeList: T[] = [];
  constructor(
    private create: () => T,
    private reset: (o: T) => void,
    prealloc = 0,
  ) {
    for (let i = 0; i < prealloc; i++) this.freeList.push(create());
  }

  obtain(): T {
    const o = this.freeList.pop();
    if (o !== undefined) {
      this.reset(o);
      return o;
    }
    return this.create();
  }

  release(o: T): void {
    this.freeList.push(o);
  }
}
