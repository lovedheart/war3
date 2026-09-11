/**
 * Minimal DOM stub — enough of the Document/Element surface for the HUD, with
 * no jsdom dependency. Nodes are plain objects; we count them to prove the HUD
 * does not rebuild its DOM every frame.
 */

export interface StubNode {
  nodeType: number;
  childNodes: StubNode[];
  parentNode: StubNode | null;
  ownerDocument: StubDoc;
}

export interface StubEl extends StubNode {
  nodeType: 1;
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  innerHTML: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  width: number;
  height: number;
  type: string;
  listeners: Record<string, ((ev: unknown) => void)[]>;
  fire(type: string, ev?: unknown): void;
  appendChild<T extends StubNode>(c: T): T;
  removeChild<T extends StubNode>(c: T): T;
  addEventListener(t: string, fn: (ev: unknown) => void): void;
  removeEventListener(t: string, fn: (ev: unknown) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  getContext(kind: string): unknown;
  querySelectorAll(sel: string): StubEl[];
  readonly firstChild: StubEl | null;
  readonly lastChild: StubEl | null;
  click(): void;
  /** all descendants including self */
  flatten(): StubEl[];
}

let uid = 0;

export function makeElement(doc: StubDoc, tag: string): StubEl {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    width: 0,
    height: 0,
    type: '',
    listeners: {},
    childNodes: [],
    parentNode: null,
    ownerDocument: doc,
    fire(this: StubEl, type: string, ev?: unknown) {
      for (const fn of this.listeners[type] ?? []) fn(ev ?? { clientX: 0, clientY: 0, button: 0, preventDefault() {} });
    },
    appendChild<T extends StubNode>(this: StubEl, c: T): T {
      c.parentNode = this;
      this.childNodes.push(c);
      return c;
    },
    removeChild<T extends StubNode>(this: StubEl, c: T): T {
      const i = this.childNodes.indexOf(c);
      if (i >= 0) this.childNodes.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    addEventListener(this: StubEl, t: string, fn: (ev: unknown) => void) {
      (this.listeners[t] ??= []).push(fn);
    },
    removeEventListener(this: StubEl, t: string, fn: (ev: unknown) => void) {
      const a = this.listeners[t];
      if (a) this.listeners[t] = a.filter((f) => f !== fn);
    },
    getBoundingClientRect(this: StubEl) {
      return { left: 0, top: 0, width: this.width || 152, height: this.height || 152 };
    },
    getContext() {
      return fakeCtx();
    },
    querySelectorAll(this: StubEl, sel: string): StubEl[] {
      const want = sel.replace(/^\./, '');
      return this.flatten().filter((e) => e.className.split(' ').includes(want));
    },
    get firstChild() {
      return (((el as unknown as { childNodes: StubNode[] }).childNodes[0]) as StubEl) ?? null;
    },
    get lastChild() {
      const cs = (el as unknown as { childNodes: StubNode[] }).childNodes;
      return (cs[cs.length - 1] as StubEl) ?? null;
    },
    click(this: StubEl) {
      this.fire('click');
    },
    flatten(this: StubEl): StubEl[] {
      const out: StubEl[] = [this];
      for (const c of this.childNodes) if (c.nodeType === 1) out.push(...(c as StubEl).flatten());
      return out;
    },
  } as unknown as StubEl;
  void uid;
  return el;
}

function fakeCtx(): unknown {
  const noop = () => undefined;
  const target: Record<string, unknown> = { canvas: {} };
  return new Proxy(target, {
    get(t: Record<string, unknown>, k: string | symbol) {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (k === 'measureText') return () => ({ width: 8 });
      return noop;
    },
    set(t: Record<string, unknown>, k: string | symbol, v: unknown) {
      if (typeof k === 'string') t[k] = v;
      return true;
    },
  });
}

export interface StubDoc extends StubNode {
  createElement(tag: string): StubEl;
  getElementById(id: string): StubEl | null;
  addEventListener(t: string, fn: (ev: unknown) => void): void;
  removeEventListener(t: string, fn: (ev: unknown) => void): void;
  listeners: Record<string, ((ev: unknown) => void)[]>;
  head: StubEl;
  documentElement: StubEl;
  /** total elements ever created (leak detector) */
  created: number;
}

export function makeDoc(): StubDoc {
  const registry = new Map<string, StubEl>();
  const doc = {
    nodeType: 9,
    childNodes: [],
    parentNode: null,
    listeners: {},
    created: 0,
    head: null as unknown as StubEl,
    documentElement: null as unknown as StubEl,
    createElement(tag: string) {
      doc.created++;
      const el = makeElement(doc, tag);
      return el;
    },
    getElementById(id: string) {
      return registry.get(id) ?? null;
    },
    addEventListener(this: StubEl, t: string, fn: (ev: unknown) => void) {
      (doc.listeners[t] ??= []).push(fn);
    },
    removeEventListener(this: StubEl, t: string, fn: (ev: unknown) => void) {
      const a = doc.listeners[t];
      if (a) doc.listeners[t] = a.filter((f) => f !== fn);
    },
  } as unknown as StubDoc;
  doc.head = makeElement(doc, 'head');
  doc.documentElement = makeElement(doc, 'html');
  doc.documentElement.appendChild(doc.head);
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = (tag: string) => {
    const el = origCreate(tag);
    const prevId = '';
    Object.defineProperty(el, 'id', {
      get: () => prevId,
      set(v: string) {
        (el as unknown as { _id: string })._id = v;
        if (v) registry.set(v, el);
      },
      configurable: true,
    });
    return el;
  };
  return doc;
}

/* ------------------------------------------------------------------ */
/* Fake Game                                                           */
/* ------------------------------------------------------------------ */
export interface EntOpts {
  eid: number;
  player: number;
  id: string;
  kind?: number; // 0 unit 1 building 2 item
  hero?: boolean;
  level?: number;
  xp?: number;
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  dead?: boolean;
  built?: boolean;
  trainQueue?: { unitId: string; remaining: number }[];
  researchQueue?: { techId: string; remaining: number }[];
  items?: (string | null)[];
  charges?: number[];
  abilities?: { id: string; level?: number; readyAt?: number; manaCost?: number }[];
  orderKind?: string;
  respawnTick?: number;
  x?: number;
  y?: number;
}

interface Store<T> {
  map: Map<number, T>;
  get(e: number): T | undefined;
  add(e: number, v: T): T;
}

function store<T>(): Store<T> & { get(e: number): T | undefined } {
  const map = new Map<number, T>();
  return {
    map,
    get: (e: number) => map.get(e),
    add(e: number, v: T) {
      map.set(e, v);
      return v;
    },
  };
}

export interface FakeGameOpts {
  viewer?: number;
  race?: string;
  gold?: number;
  lumber?: number;
  supplyUsed?: number;
  supplyCap?: number;
  upkeep?: 0 | 1 | 2;
  techs?: string[];
  ents: EntOpts[];
  tick?: number;
}

export interface FakeGame {
  game: unknown;
  world: { tick: number; live: number[]; stores: Record<string, Store<never>> };
  players: unknown[];
  commands: unknown[];
  snapshot(): unknown;
  setGold(g: number): void;
}

const FP = 65536;

export function makeGame(o: FakeGameOpts): FakeGame {
  const stores: Record<string, Store<never>> = {
    kind: store(),
    owner: store(),
    stats: store(),
    health: store(),
    building: store(),
    orders: store(),
    hero: store(),
    abilities: store(),
    damage: store(),
    armor: store(),
    movement: store(),
    transform: store(),
  } as unknown as Record<string, Store<never>>;

  const live: number[] = [];
  for (const e of o.ents) {
    live.push(e.eid);
    const s = stores as unknown as Record<string, { add(e: number, v: never): unknown; get(e: number): unknown }>;
    s.kind.add(e.eid, { kind: e.kind ?? 0 } as never);
    s.owner.add(e.eid, { player: e.player } as never);
    s.transform.add(e.eid, { x: (e.x ?? 40) * FP, y: (e.y ?? 40) * FP } as never);
    s.health.add(e.eid, {
      hp: (e.hp ?? 100) * FP,
      hpMax: (e.hpMax ?? 100) * FP,
      mp: (e.mp ?? 0) * FP,
      mpMax: (e.mpMax ?? 0) * FP,
      dead: !!e.dead,
    } as never);
    if ((e.kind ?? 0) === 1) {
      s.building.add(e.eid, {
        buildingId: e.id,
        built: e.built !== false,
        progress: 0,
        totalTicks: 0,
        trainQueue: e.trainQueue ?? [],
        researchQueue: e.researchQueue ?? [],
      } as never);
    } else {
      s.stats.add(e.eid, {
        id: e.id,
        level: e.level ?? 1,
        isHero: !!e.hero,
        xp: e.xp ?? 0,
        race: o.race ?? 'human',
      } as never);
      s.orders.add(e.eid, { current: { kind: e.orderKind ?? 'none', param: '' } } as never);
      s.damage.add(e.eid, { min: FP, max: 2 * FP, cooldown: 1.35 * FP, range: 3 * FP, attackType: 'normal' } as never);
      s.armor.add(e.eid, { value: 2 * FP, type: 'heavy' } as never);
      s.movement.add(e.eid, { speed: 2.5 * FP } as never);
      if (e.hero) {
        s.hero.add(e.eid, {
          itemSlots: e.items ?? [null, null, null, null, null, null],
          itemCharges: e.charges ?? [0, 0, 0, 0, 0, 0],
          respawnTick: e.respawnTick ?? 0,
        } as never);
        s.abilities.add(e.eid, {
          slots: (e.abilities ?? []).map((a) => ({
            abilityId: a.id,
            level: a.level ?? 1,
            readyAt: a.readyAt ?? 0,
            manaCost: a.manaCost ?? 0,
          })),
        } as never);
      }
    }
  }

  const ps = {
    id: o.viewer ?? 1,
    race: o.race ?? 'human',
    gold: (o.gold ?? 500) * FP,
    lumber: (o.lumber ?? 100) * FP,
    supplyUsed: o.supplyUsed ?? 4,
    supplyCap: o.supplyCap ?? 12,
    upkeep: o.upkeep ?? 0,
    techs: o.techs ?? [],
    name: 'P1',
  };
  const players: unknown[] = [];
  for (let i = 0; i < 13; i++) players[i] = i === (o.viewer ?? 1) ? ps : { id: i, race: 'neutral', gold: 0, lumber: 0, supplyUsed: 0, supplyCap: 0, upkeep: 0, techs: [] };

  const world = { tick: o.tick ?? 0, live, stores } as FakeGame['world'];
  const commands: unknown[] = [];
  const game = {
    world,
    terrain: { width: 64, height: 64 },
    fog: { state: () => 2 },
    players,
    update() {},
    command(c: unknown) {
      commands.push(c);
    },
    stateHash: () => 0,
    snapshot() {
      return {
        tick: world.tick,
        units: live
          .filter((e) => (stores.kind.get(e) as { kind: number } | undefined)?.kind === 0)
          .map((e) => {
            const st = stores.stats.get(e) as { id: string } | undefined;
            const h = stores.health.get(e) as { hp: number; hpMax: number } | undefined;
            const ow = stores.owner.get(e) as { player: number } | undefined;
            const tf = stores.transform.get(e) as { x: number; y: number } | undefined;
            return {
              eid: e,
              id: st?.id ?? '',
              player: ow?.player ?? 0,
              x: (tf?.x ?? 0) / FP,
              y: (tf?.y ?? 0) / FP,
              hp: (h?.hp ?? 0) / FP,
              hpMax: (h?.hpMax ?? 0) / FP,
              level: (st as { level?: number } | undefined)?.level ?? 1,
            };
          }),
        buildings: live
          .filter((e) => !!stores.building.get(e))
          .map((e) => {
            const b = stores.building.get(e) as unknown as { buildingId: string; built: boolean };
            const h = stores.health.get(e) as { hp: number; hpMax: number } | undefined;
            const ow = stores.owner.get(e) as { player: number } | undefined;
            return { eid: e, id: b.buildingId, player: ow?.player ?? 0, built: b.built, hp: (h?.hp ?? 0) / FP, hpMax: (h?.hpMax ?? 0) / FP };
          }),
        resources: [{ player: o.viewer ?? 1, gold: (ps.gold as number) / FP, lumber: (ps.lumber as number) / FP, supplyUsed: ps.supplyUsed, supplyCap: ps.supplyCap, upkeep: ps.upkeep }],
      };
    },
  };
  return { game, world, players, commands, snapshot: () => game.snapshot(), setGold: (g: number) => ((ps.gold as number) = g * FP) };
}

/** Collect every dispatched Command from a hud's dispatch sink. */
export function recorder(): { cmds: unknown[]; dispatch(c: unknown): void } {
  const cmds: unknown[] = [];
  return { cmds, dispatch: (c: unknown) => cmds.push(c) };
}

export function byClass(root: StubEl, cls: string): StubEl[] {
  return root.flatten().filter((e) => e.className.split(' ').includes(cls));
}

export function visibleButtons(root: StubEl): StubEl[] {
  return byClass(root, 'w3-btn').filter((e) => e.style.display !== 'none');
}

export function texts(root: StubEl): string[] {
  return visibleButtons(root)
    .map((b) => b.childNodes.map((c) => c as StubEl).find((c) => c.className === 'txt')?.textContent ?? '')
    .filter(Boolean);
}
