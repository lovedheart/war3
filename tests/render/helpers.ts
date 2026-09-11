/** Shared test doubles: a recording Canvas2D stub and a minimal fake Game. */

export interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  calls: Record<string, number>;
  total(): number;
  reset(): void;
}

export function fakeCtx(): FakeCtx {
  const calls: Record<string, number> = {};
  const target: Record<string, unknown> = { canvas: {} };
  const ctx = new Proxy(target, {
    get(t: Record<string, unknown>, k: string) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() { /* noop */ } });
      if (k === 'measureText') return () => ({ width: 10 });
      return (..._a: unknown[]) => { calls[k] = (calls[k] ?? 0) + 1; };
    },
    set(t: Record<string, unknown>, k: string, v: unknown) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    calls,
    total: () => Object.values(calls).reduce((a, b) => a + b, 0),
    reset: () => { for (const k of Object.keys(calls)) delete calls[k]; },
  };
}

interface EntOpts {
  eid: number;
  x: number; y: number;
  player?: number;
  kind?: number;
  radius?: number;
  id?: string;
  race?: string;
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  dead?: boolean;
  buildingId?: string;
  built?: boolean;
  w?: number;
  h?: number;
  fly?: boolean;
  vx?: number;
  hero?: boolean;
  level?: number;
  itemId?: string;
}

const FP = 65536;

/** Build a structural fake matching the shape layers.ts reads from World. */
export function fakeGame(entities: EntOpts[], opts: { mapW?: number; mapH?: number; tick?: number; fogState?: (tx: number, ty: number, p: number) => number } = {}) {
  const mapW = opts.mapW ?? 32;
  const mapH = opts.mapH ?? 32;
  const byName = new Map<string, Map<number, unknown>>();
  const put = (name: string, eid: number, v: unknown) => {
    let m = byName.get(name);
    if (!m) byName.set(name, (m = new Map()));
    m.set(eid, v);
  };
  for (const e of entities) {
    put('transform', e.eid, { x: Math.round(e.x * FP), y: Math.round(e.y * FP), facing: 0, radius: Math.round((e.radius ?? 0.35) * FP), w: e.w ?? 1, h: e.h ?? 1, z: 0 });
    put('kind', e.eid, { kind: e.kind ?? 0 });
    put('owner', e.eid, { player: e.player ?? 1 });
    put('health', e.eid, { hp: Math.round((e.hp ?? 100) * FP), hpMax: Math.round((e.hpMax ?? 100) * FP), mp: Math.round((e.mp ?? 0) * FP), mpMax: Math.round((e.mpMax ?? 0) * FP), dead: !!e.dead, deathTick: 0 });
    if (e.id !== undefined || e.hero) put('stats', e.eid, { str: 10, agi: 10, int: 10, primary: 'str', level: e.level ?? 1, xp: 0, isHero: !!e.hero, id: e.id ?? '', race: e.race ?? 'human', upgradeTo: null, trainingDoneTick: 0 });
    if (e.buildingId !== undefined) put('building', e.eid, { buildingId: e.buildingId, built: e.built ?? true, progress: 0, totalTicks: 100, underConstructionBy: 0, rallyX: 0, rallyY: 0, trainQueue: [], researchQueue: [], supplyProvided: 5, canAttack: false, upgradeTier: 1 });
    if (e.fly || e.vx) put('movement', e.eid, { speed: 0, vx: Math.round((e.vx ?? 0) * FP), vy: 0, turnRate: 0, fly: !!e.fly, mass: FP, ox: 0, oy: 0 });
    put('orders', e.eid, { current: { kind: 'none', targetEid: 0xffffffff, tx: 0, ty: 0, mode: 0, param: '' }, queue: [], anchorX: 0, anchorY: 0 });
    if (e.itemId !== undefined) put('item', e.eid, { itemId: e.itemId, x: 0, y: 0, charges: 0, ownerEid: 0xffffffff });
  }
  const store = (name: string) => ({
    get: (eid: number) => byName.get(name)?.get(eid >>> 0),
  });
  const world = {
    live: entities.map((e) => e.eid),
    tick: opts.tick ?? 1,
    view: { cameraX: 0, cameraY: 0, zoom: FP, selection: [] as number[], hoverEid: 0xffffffff },
    alive: (eid: number) => byName.get('transform')?.has(eid >>> 0) === true,
    stores: {
      transform: store('transform'), kind: store('kind'), owner: store('owner'),
      health: store('health'), stats: store('stats'), building: store('building'),
      movement: store('movement'), orders: store('orders'), item: store('item'),
    },
    bus: { on: () => () => undefined },
    rng: { nextU32: () => 1 },
  };
  const terrain = {
    width: mapW, height: mapH,
    tile: (tx: number, ty: number) => ((tx + ty) & 3) === 0 ? 4 : ((tx * 7 + ty * 3) % 11 === 0 ? 2 : 1),
    isWalkable: () => true,
  };
  const fog = opts.fogState ? {
    width: mapW, height: mapH,
    state: (tx: number, ty: number, p: number) => opts.fogState!(tx, ty, p),
    isVisibleTile: (tx: number, ty: number, p: number) => opts.fogState!(tx, ty, p) === 2,
    exploredTile: (tx: number, ty: number, p: number) => opts.fogState!(tx, ty, p) !== 0,
  } : null;
  const game = { world, terrain, fog, players: [{ id: 1, active: true, defeated: false }], grid: null, quad: null };
  // Structural double: the layers only ever read through these fields.
  return {
    game: game as unknown as import('../../src/sim/index.js').Game,
    world: world as unknown as import('../../src/sim/world.js').World,
    terrain,
    fog,
  };
}
