/**
 * Typed event bus. Purely a decoupling layer for presentation/audio/trigger
 * listeners; the simulation itself must not depend on listener order, so no
 * sim logic may live in a handler.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<M extends Record<string, unknown>> {
  private map = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    let s = this.map.get(type);
    if (!s) this.map.set(type, (s = new Set()));
    s.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof M>(type: K, fn: Handler<M[K]>): void {
    this.map.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const s = this.map.get(type);
    if (!s || s.size === 0) return;
    // iterate over a snapshot so handlers may unsubscribe safely
    for (const fn of [...s]) (fn as Handler<M[K]>)(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
