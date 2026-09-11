/**
 * HUD facade: assembles the panels, reads the simulation each frame (read-only)
 * and funnels every interaction into `dispatch(Command)`.
 */
import { fn } from '../core/fixed.js';
import { getGameData } from '../data/index.js';
import type { Command } from '../sim/commandTypes.js';
import type { Game } from '../sim/index.js';
import { Alerts, InfoPanel, MinimapPanel, ResourceBar, type SelInfo } from './panels.js';
import { CommandCard, type CardSelection, type PendingTarget, type PlacementRequest, type SelRecord } from './commandcard.js';
import { createTooltip, itemTip, type Tooltip } from './tooltip.js';
import { injectStyles } from './styles.js';

export interface UiMount {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
}

export interface HudOptions {
  viewer: number;
  dispatch(cmd: Command): void;
  minimapDraw?(ctx: CanvasRenderingContext2D, game: Game, viewer: number): void;
  onMinimapClick?(worldX: number, worldY: number): void;
  selectionProvider?(): number[];
  /** ask the app to start a build ghost at a picked tile */
  onPlacement?(req: PlacementRequest): void;
  /** ask the app to resolve a destination for a partially-built order */
  onTarget?(req: PendingTarget): void;
  doc?: Document;
}

export interface Hud {
  mount(m: UiMount): void;
  frame(game: Game, viewer: number): void;
  onHover?(world: { x: number; y: number }): void;
  destroy(): void;
  readonly el: HTMLElement;
  /** test/diagnostic hooks */
  readonly card: CommandCard;
  alert(msg: string, err?: boolean): void;
  readonly nodeCount: number;
}

const TICK_RATE = 30;

/** Entity records the HUD needs; resolved straight off the stores. */
interface Stores {
  kind?: { get(e: number): { kind: number } | undefined };
  owner?: { get(e: number): { player: number } | undefined };
  stats?: { get(e: number): { id: string; level: number; isHero: boolean; xp: number; race: string } | undefined };
  health?: { get(e: number): { hp: number; hpMax: number; mp: number; mpMax: number; dead: boolean } | undefined };
  building?: {
    get(
      e: number,
    ): { buildingId: string; built: boolean; trainQueue: { unitId: string; remaining: number }[]; researchQueue: { techId: string; remaining: number }[]; progress: number; totalTicks: number } | undefined;
  };
  orders?: { get(e: number): { current: { kind: string; param: string } } | undefined };
  hero?: { get(e: number): { itemSlots: (string | null)[]; itemCharges: number[]; respawnTick: number } | undefined };
  abilities?: { get(e: number): { slots: { abilityId: string; level: number; readyAt: number; manaCost: number }[] } | undefined };
  damage?: { get(e: number): { min: number; max: number; cooldown: number; range: number; attackType: string } | undefined };
  armor?: { get(e: number): { value: number; type: string } | undefined };
  movement?: { get(e: number): { speed: number } | undefined };
}

function stores(game: Game): Stores {
  return game.world.stores as unknown as Stores;
}

export function createHud(opts: HudOptions): Hud {
  const doc = opts.doc ?? (globalThis as unknown as { document: Document }).document;
  const host = doc.createElement('div');
  host.className = 'w3-hud';
  let mounted = false;
  let destroyed = false;
  let nodesAtMount = 0;

  const tip: Tooltip = createTooltip(doc, host);
  const alerts = new Alerts({ doc, parent: host, dispatch: opts.dispatch, tooltip: tip, viewer: opts.viewer, bindTip, alert });
  const resbar = new ResourceBar({ doc, parent: host, dispatch: opts.dispatch, tooltip: tip, viewer: opts.viewer, bindTip, alert });
  const minimap = new MinimapPanel({ doc, parent: host, dispatch: opts.dispatch, tooltip: tip, viewer: opts.viewer, bindTip, alert }, (x, y) =>
    opts.onMinimapClick?.(x, y),
  );
  const info = new InfoPanel({ doc, parent: host, dispatch: opts.dispatch, tooltip: tip, viewer: opts.viewer, bindTip, alert });
  const right = doc.createElement('div');
  right.className = 'w3-panel w3-right pe';
  const card = new CommandCard({
    doc,
    dispatch: opts.dispatch,
    bindTip,
    alert,
    requestPlacement: (r) => {
      card.pending = r;
      opts.onPlacement?.(r);
    },
    requestTarget: (t) => opts.onTarget?.(t),
  });

  function bindTip(el: HTMLElement, lines: () => { text: string; cls?: 'name' | 'desc' | 'cost' | 'miss' | 'key' }[]): void {
    if (el.dataset.tipBound) return;
    el.dataset.tipBound = '1';
    el.addEventListener?.('mouseenter', () => {
      tip.show(lines());
      moveTipToMouse();
    });
    el.addEventListener?.('mouseleave', () => tip.hide());
  }

  let lastMouse = { x: 0, y: 0 };
  function moveTipToMouse(): void {
    tip.move(lastMouse.x, lastMouse.y);
  }
  function onMouseMove(ev: Event): void {
    const e = ev as MouseEvent;
    lastMouse = { x: e.clientX, y: e.clientY };
    if (tip.visible) moveTipToMouse();
  }
  function onContextMenu(ev: Event): void {
    ev.preventDefault?.();
    tip.hide();
  }

  function alert(msg: string, err = false): void {
    alerts.push(msg, err, nowMs());
  }

  function nowMs(): number {
    const p = (globalThis as unknown as { performance?: { now(): number } }).performance;
    return p ? p.now() : Date.now();
  }

  const hud: Hud = {
    el: host,
    card,
    alert,
    get nodeCount() {
      return countNodes(host);
    },
    mount(m: UiMount) {
      if (mounted) return;
      mounted = true;
      injectStyles(doc);
      m.root.appendChild(host);
      host.appendChild(resbar.build());
      host.appendChild(minimap.build());
      right.appendChild(info.build());
      right.appendChild(card.build());
      host.appendChild(right);
      host.appendChild(alerts.build());
      doc.addEventListener?.('mousemove', onMouseMove);
      m.canvas.addEventListener?.('contextmenu', onContextMenu);
      nodesAtMount = countNodes(host);
    },
    frame(game: Game, viewer: number) {
      if (destroyed || !game?.world) return;
      const snap = game.snapshot();
      const res = snap.resources.find((r) => r.player === viewer);
      resbar.frame(res, game.players[viewer], nowMs());
      minimap.frame(game, opts.minimapDraw);

      const sel = (opts.selectionProvider?.() ?? []).filter((e) => game.world.live.includes(e));
      const builtList = ownedBuildings(game, viewer);
      card.tick = game.world.tick;
      card.lastWorker = firstWorker(sel);
      const rec = primaryRecord(game, sel);
      const cs: CardSelection = {
        units: sel.filter((e) => !isBuilding(game, e)),
        buildings: sel.filter((e) => isBuilding(game, e)),
        primary: rec,
        count: sel.length,
      };
      card.frame(game, viewer, cs, builtList);
      info.frame(rec ? infoFrom(rec, sel.length) : null);
      void snap.tick;
      void TICK_RATE;
      void fn;
    },
    onHover(world: { x: number; y: number }) {
      void world;
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener?.('mousemove', onMouseMove);
      host.parentNode?.removeChild?.(host);
    },
  };
  void nodesAtMount;
  return hud;
}

/* ------------------------------------------------------------------ */
function countNodes(el: HTMLElement): number {
  let n = 1;
  const kids = (el.childNodes ?? []) as unknown as ArrayLike<HTMLElement>;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i] as HTMLElement & { childNodes?: unknown };
    if (k && typeof (k as HTMLElement).childNodes !== 'undefined') n += countNodes(k as HTMLElement);
    else n += 1;
  }
  return n;
}

function isBuilding(game: Game, eid: number): boolean {
  return !!stores(game).building?.get(eid);
}

function firstWorker(sel: number[]): number {
  return sel.length ? sel[0] : 0xffffffff;
}

function ownedBuildings(game: Game, viewer: number): string[] {
  const st = stores(game);
  const out: string[] = [];
  for (const e of game.world.live) {
    const b = st.building?.get(e);
    if (b?.built && st.owner?.get(e)?.player === viewer) out.push(b.buildingId);
  }
  return out;
}

/** The record the panel describes: first selected entity, or the dominant one. */
function primaryRecord(game: Game, sel: number[]): SelRecord | null {
  if (!sel.length) return null;
  const st = stores(game);
  const eid = sel[0];
  const gd = getGameData();
  const own = st.owner?.get(eid);
  if (!own) return null;
  const b = st.building?.get(eid);
  const s = st.stats?.get(eid);
  const h = st.health?.get(eid);
  const id = b?.buildingId || s?.id || '';
  const def = b ? gd.buildings.get(id) : gd.units.get(id);
  const hero = !!s?.isHero;
  const raceId = s?.race ?? def?.race ?? 'human';
  const worker = !b && !!def && (gd.races[raceId]?.worker === id || /^(peasant|peon|acolyte|wisp)$/.test(id));
  const dmg = st.damage?.get(eid);
  const arm = st.armor?.get(eid);
  const mv = st.movement?.get(eid);
  const heroC = st.hero?.get(eid);
  const ord = st.orders?.get(eid);
  const hpFrac = h && h.hpMax > 0 ? h.hp / h.hpMax : 1;
  const mpMax = h?.mpMax ?? 0;
  const xp = s?.xp ?? 0;
  const lvl = s?.level ?? 1;
  const curve = gd.heroXp;
  const lo = curve[Math.max(0, lvl - 1)] ?? 0;
  const hi = curve[lvl] ?? lo + 1;
  return {
    eid,
    id,
    player: own.player,
    hero,
    dead: !!h?.dead,
    level: lvl,
    worker,
    isBuilding: !!b,
    hpFrac,
    mpFrac: mpMax > 0 ? (h?.mp ?? 0) / mpMax : 0,
    mpMax,
    xpFrac: hero ? Math.min(1, Math.max(0, (xp - lo) / Math.max(1, hi - lo))) : 0,
    items: heroC?.itemSlots ?? [null, null, null, null, null, null],
    itemCharges: heroC?.itemCharges ?? [0, 0, 0, 0, 0, 0],
    orderKind: b && !b.built ? 'building' : ord?.current.kind ?? 'none',
    name: def ? (def as { name: string }).name : id,
    sub: subtitle(b, arm, dmg),
    dmgMin: dmg ? Math.round(fn(dmg.min)) : undefined,
    dmgMax: dmg ? Math.round(fn(dmg.max)) : undefined,
    armorValue: arm ? Math.round(fn(arm.value)) : undefined,
    range: dmg ? Math.round(fn(dmg.range)) : undefined,
    rate: dmg && dmg.cooldown > 0 ? Math.round(fn(dmg.cooldown) * 10) / 10 : undefined,
    speed: mv ? Math.round(fn(mv.speed) * 10) / 10 : undefined,
    respawnTicks: hero && h?.dead ? Math.max(0, (heroC?.respawnTick ?? 0) - game.world.tick) : undefined,
    abilities: st.abilities?.get(eid)?.slots.map((a) => ({ id: a.abilityId, level: a.level, readyAt: a.readyAt, manaCost: a.manaCost })),
    trainQueue: b?.trainQueue.map((q) => ({ unitId: q.unitId, remaining: q.remaining, total: q.remaining })),
    researchQueue: b?.researchQueue.map((q) => ({ techId: q.techId, remaining: q.remaining, total: q.remaining })),
    trains: b ? gd.buildings.get(b.buildingId)?.trains : undefined,
    researches: b ? gd.buildings.get(b.buildingId)?.researches : undefined,
  };
}

function subtitle(
  b: { buildingId: string } | undefined,
  arm: { value: number; type: string } | undefined,
  dmg: { attackType: string } | undefined,
): string {
  if (b) return 'Structure — Fortification';
  if (dmg?.attackType && arm) return `${cap(dmg.attackType)} — ${cap(arm.type)}`;
  if (arm) return `${cap(arm.type)} armor`;
  return '';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function infoFrom(r: SelRecord, count: number): SelInfo {
  return {
    id: r.id,
    name: r.name,
    count,
    hero: r.hero,
    dead: r.dead,
    level: r.level,
    hpFrac: r.hpFrac,
    mpFrac: r.mpFrac,
    mpMax: r.mpMax,
    xpFrac: r.xpFrac,
    sub: r.sub,
    dmgMin: r.dmgMin,
    dmgMax: r.dmgMax,
    armorValue: r.armorValue,
    range: r.range,
    speed: r.speed,
    rate: r.rate,
    items: r.items,
    itemCharges: r.itemCharges,
  };
}

export { itemTip };
