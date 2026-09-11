/**
 * Command card: decides which buttons exist for the current selection and
 * translates a click into a `Command`. The card is built once with a fixed
 * pool of button nodes; `frame()` only re-labels, re-paints and re-enables
 * them, so selecting different units never churns the DOM.
 */
import { fn } from '../core/fixed.js';
import { getGameData } from '../data/index.js';
import type { Command, MoveMode } from '../sim/commandTypes.js';
import type { Game } from '../sim/index.js';
import type { PlayerState } from '../sim/player.js';
import { paintIcon } from './icons.js';
import { abilityTip, buildingTip, techTip, unitTip, type TipLine } from './tooltip.js';

/** A command missing only its destination, handed to the app for point-picking. */
export interface PendingTarget {
  k: 'move' | 'rally';
  player: number;
  units?: number[];
  entity?: number;
  mode: MoveMode;
}

export interface PlacementRequest {
  buildingId: string;
  worker: number;
}

export interface CardOptions {
  doc: Document;
  dispatch(cmd: Command): void;
  bindTip(el: HTMLElement, lines: () => TipLine[]): void;
  alert(msg: string, err?: boolean): void;
  /** ask the app to enter build-placement mode */
  requestPlacement(req: PlacementRequest): void;
  /** ask the app to resolve a world point for a partially-built order */
  requestTarget(partial: PendingTarget): void;
  maxButtons?: number;
}

export interface CardSelection {
  units: number[];
  buildings: number[];
  /** first selected entity's records, resolved by the HUD */
  primary: SelRecord | null;
  count: number;
}

export interface SelRecord {
  eid: number;
  id: string;
  player: number;
  hero: boolean;
  dead: boolean;
  level: number;
  worker: boolean;
  isBuilding: boolean;
  hpFrac: number;
  mpFrac: number;
  mpMax: number;
  items: (string | null)[];
  itemCharges: number[];
  orderKind: string;
  name: string;
  sub: string;
  dmgMin?: number;
  dmgMax?: number;
  armorValue?: number;
  range?: number;
  rate?: number;
  speed?: number;
  xpFrac: number;
  respawnTicks?: number;
  abilities?: { id: string; level: number; readyAt: number; manaCost: number }[];
  trainQueue?: { unitId: string; remaining: number; total: number }[];
  researchQueue?: { techId: string; remaining: number; total: number }[];
  trains?: string[];
  researches?: string[];
}

interface Btn {
  el: HTMLElement;
  icon: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  label: HTMLElement;
  hot: HTMLElement;
  shade: HTMLElement;
  prog: HTMLElement;
  key: HTMLElement;
  tip?: () => TipLine[];
}

const MAX_BUTTONS = 24;
const TICK_RATE = 30;

export class CommandCard {
  private root!: HTMLElement;
  private grid!: HTMLElement;
  private queue!: HTMLElement;
  private btns: Btn[] = [];
  private bubbles: HTMLElement[] = [];
  private used = 0;
  private bubbleUsed = 0;
  /** armed action awaiting a world click, filled in by the app */
  pending: PlacementRequest | null = null;

  constructor(private o: CardOptions) {}

  build(): HTMLElement {
    const doc = this.o.doc;
    this.root = doc.createElement('div');
    this.root.className = 'w3-cmd pe';
    this.grid = doc.createElement('div');
    this.grid.className = 'w3-card';
    this.root.appendChild(this.grid);
    this.queue = doc.createElement('div');
    this.queue.className = 'w3-queue';
    this.root.appendChild(this.queue);
    return this.root;
  }

  private obtain(): Btn {
    let b = this.btns[this.used];
    if (!b) {
      const doc = this.o.doc;
      const el = doc.createElement('button');
      el.className = 'w3-btn';
      el.type = 'button';
      const icon = doc.createElement('canvas');
      icon.width = 29;
      icon.height = 29;
      const label = doc.createElement('span');
      label.className = 'txt';
      const hot = doc.createElement('label');
      const shade = doc.createElement('s');
      shade.style.display = 'none';
      const prog = doc.createElement('u');
      prog.style.width = '0%';
      const key = doc.createElement('span');
      key.className = 'w3-hot';
      el.appendChild(icon);
      el.appendChild(label);
      el.appendChild(hot);
      el.appendChild(shade);
      el.appendChild(prog);
      el.appendChild(key);
      b = { el, icon, ctx: icon.getContext?.('2d') ?? null, label, hot, shade, prog, key };
      el.addEventListener?.('click', () => this.fire(b));
      el.addEventListener?.('mouseenter', () => {
        if (b.tip) this.o.bindTip(el, b.tip);
      });
      this.btns.push(b);
      this.grid.appendChild(el);
    }
    this.used++;
    return b;
  }

  /** tooltip provider refreshed each frame */
  private tips = new WeakMap<Btn, () => TipLine[]>();

  private setTip(b: Btn, lines: () => TipLine[]): void {
    this.tips.set(b, lines);
    (b as unknown as { tip?: () => TipLine[] }).tip = lines;
  }

  private fire(b: Btn): void {
    const act = (b as unknown as { act?: () => void }).act;
    if (!act) return;
    if ((b as unknown as { off?: boolean }).off) {
      const why = (b as unknown as { why?: string }).why;
      if (why) this.o.alert(why, true);
      return;
    }
    act();
  }

  private configure(
    b: Btn,
    cfg: {
      id: string;
      text: string;
      hot?: string;
      off?: boolean;
      why?: string;
      armed?: boolean;
      progress?: number;
      player?: number;
      tip: () => TipLine[];
      act: () => void;
    },
  ): void {
    const key = cfg.id + '|' + cfg.text + '|' + (cfg.hot ?? '');
    if ((b as unknown as { key?: string }).key !== key) {
      (b as unknown as { key: string }).key = key;
      if (b.ctx) {
        b.ctx.clearRect(0, 0, 29, 29);
        paintIcon(b.ctx, cfg.id, 29, cfg.player);
      }
      b.label.textContent = cfg.text;
      b.hot.textContent = cfg.hot ?? '';
    }
    (b as unknown as { act: () => void }).act = cfg.act;
    (b as unknown as { off: boolean }).off = !!cfg.off;
    (b as unknown as { why?: string }).why = cfg.why;
    b.shade.style.display = cfg.off ? 'block' : 'none';
    b.el.className = 'w3-btn' + (cfg.off ? ' off' : '') + (cfg.armed ? ' armed' : '');
    this.setTip(b, cfg.tip);
  }

  private hideRest(): void {
    for (let i = this.used; i < this.btns.length; i++) this.btns[i].el.style.display = 'none';
    for (let i = this.bubbleUsed; i < this.bubbles.length; i++) this.bubbles[i].style.display = 'none';
  }

  /* ---------------------------------------------------------------- */
  /** ids of the viewer's completed buildings, refreshed by the HUD each frame */
  builtIds = new Map<number, string[]>();

  frame(game: Game, viewer: number, sel: CardSelection, builtList: string[]): void {
    this.used = 0;
    this.bubbleUsed = 0;
    if (builtList) this.builtIds.set(viewer, builtList);
    const gd = getGameData();
    const p = game.players[viewer];
    if (!sel.count) {
      this.hideRest();
      return;
    }

    // multi-select of buildings -> show the first one's card
    if (sel.primary?.isBuilding) this.buildingCard(viewer, p, sel.primary);
    else if (sel.primary?.hero) this.heroCard(viewer, p, sel.primary);
    else if (sel.primary?.worker) this.workerCard(gd, viewer, p, builtList ?? []);
    else this.unitCard(viewer, sel);

    this.hideRest();
  }

  /* ---- combat units ----------------------------------------------- */
  private unitCard(viewer: number, sel: CardSelection): void {
    const units = sel.units.length ? sel.units : sel.buildings;
    this.simple(viewer, units, 'move', 'Move', () => this.o.requestTarget({ k: 'move', player: viewer, units, mode: 'move' }), 'Click a destination');
    this.simple(viewer, units, 'stop', 'Stop', () => this.o.dispatch({ k: 'stop', player: viewer, units }));
    this.simple(viewer, units, 'hold', 'Hold', () => this.o.dispatch({ k: 'hold', player: viewer, units }));
    this.simple(viewer, units, 'attack', 'Attack-Move', () => this.o.requestTarget({ k: 'move', player: viewer, units, mode: 'attackMove' }), 'Click to attack-move');
  }

  private simple(
    viewer: number,
    _units: number[],
    id: string,
    text: string,
    act: () => void,
    hint?: string,
  ): void {
    const b = this.obtain();
    this.configure(b, {
      id,
      text,
      player: viewer,
      tip: () => [{ text, cls: 'name' }, { text: hint ?? basicHint(id), cls: 'desc' }],
      act,
    });
  }

  /* ---- workers ----------------------------------------------------- */
  private workerCard(gd: ReturnType<typeof getGameData>, viewer: number, p: PlayerState | undefined, builtList: string[]): void {
    const race = p?.race ?? 'human';
    const builtIds = new Set(builtList);
    const list = [...gd.buildings.entries()]
      .filter(([, d]) => d.race === race)
      .sort((a, b) => rank(a[1], builtIds) - rank(b[1], builtIds) || cmp(a[1].name, b[1].name))
      .slice(0, MAX_BUTTONS - 1);

    for (const [id, d] of list) {
      const missing: string[] = [];
      if (d.requiresBuilding && !builtIds.has(d.requiresBuilding)) {
        missing.push(`Requires ${gd.buildings.get(d.requiresBuilding)?.name ?? d.requiresBuilding}`);
      }
      const gold = d.cost.gold;
      const lumber = d.cost.lumber;
      const afford = (p?.gold ?? 0) >= gold && (p?.lumber ?? 0) >= lumber;
      if (!afford) {
        if ((p?.gold ?? 0) < gold) missing.push(`${gold - Math.floor(fn(p?.gold ?? 0))} more gold needed`);
        if ((p?.lumber ?? 0) < lumber) missing.push(`${lumber - Math.floor(fn(p?.lumber ?? 0))} more lumber needed`);
      }
      const off = missing.length > 0;
      const b = this.obtain();
      const worker = this.lastWorker;
      this.configure(b, {
        id,
        text: shortName(d.name),
        player: viewer,
        off,
        why: missing[0],
        armed: this.pending?.buildingId === id,
        tip: () => buildingTip(gd, id, missing),
        act: () => {
          if (worker === 0xffffffff) {
            this.o.alert('No worker selected', true);
            return;
          }
          this.pending = { buildingId: id, worker };
          this.o.requestPlacement({ buildingId: id, worker });
        },
      });
    }
  }

  /** set by the HUD before each frame so build buttons know their worker */
  lastWorker = 0xffffffff;

  /** current sim tick, set by the HUD before each frame */
  tick = 0;

  /* ---- buildings --------------------------------------------------- */
  private buildingCard(viewer: number, p: PlayerState | undefined, rec: SelRecord): void {
    const gd = getGameData();
    const eid = rec.eid;

    // training queue bubbles first (they overlay the card area)
    for (const q of rec.trainQueue ?? []) {
      const el = this.obtainBubble();
      const total = q.total || 1;
      const done = 1 - q.remaining / total;
      const ring = el.firstChild as HTMLElement;
      if (ring) ring.style.width = Math.round(Math.min(1, done) * 100) + '%';
      const secs = Math.ceil(q.remaining / TICK_RATE);
      const em = el.lastChild as HTMLElement;
      if (em.textContent !== String(secs)) em.textContent = String(secs);
      const idx = (rec.trainQueue ?? []).indexOf(q);
      (el as unknown as { act: () => void }).act = () =>
        this.o.dispatch({ k: 'cancelTrain', player: viewer, building: eid, index: idx });
      this.setBubbleTip(el, () => unitTip(gd, q.unitId, []));
    }

    if (!rec.isBuilding) return;

    // trainable units
    const trains = rec.trains ?? [];
    for (const uid of trains) {
      const d = gd.units.get(uid);
      if (!d) continue;
      const missing: string[] = [];
      if (d.prereq && !this.hasBuilding(viewer, d.prereq)) missing.push(`Requires ${gd.buildings.get(d.prereq)?.name ?? d.prereq}`);
      for (const t of (gd.buildings.get(rec.id)?.requiresTech ?? [])) {
        if (!(p?.techs ?? []).includes(t)) missing.push(`Requires ${gd.tech.get(t)?.name ?? t}`);
      }
      const popFree = (p?.supplyCap ?? 0) - (p?.supplyUsed ?? 0);
      if (popFree < (d.cost.popUpkeep ?? 1)) missing.push('Not enough supply');
      if ((p?.gold ?? 0) < d.cost.gold) missing.push(`${d.cost.gold - Math.floor(fn(p?.gold ?? 0))} more gold needed`);
      if ((p?.lumber ?? 0) < d.cost.lumber) missing.push(`${d.cost.lumber - Math.floor(fn(p?.lumber ?? 0))} more lumber needed`);
      const b = this.obtain();
      this.configure(b, {
        id: uid,
        text: shortName(d.name),
        player: viewer,
        off: missing.length > 0,
        why: missing[0],
        tip: () => unitTip(gd, uid, missing),
        act: () => this.o.dispatch({ k: 'train', player: viewer, building: eid, unitId: uid }),
      });
    }

    // researches
    for (const tid of rec.researches ?? []) {
      const t = gd.tech.get(tid);
      if (!t) continue;
      const missing: string[] = [];
      for (const r of t.requires) if (!(p?.techs ?? []).includes(r)) missing.push(`Requires ${gd.tech.get(r)?.name ?? r}`);
      if ((p?.gold ?? 0) < t.cost.gold) missing.push(`${t.cost.gold - Math.floor(fn(p?.gold ?? 0))} more gold needed`);
      if ((p?.lumber ?? 0) < t.cost.lumber) missing.push(`${t.cost.lumber - Math.floor(fn(p?.lumber ?? 0))} more lumber needed`);
      const b = this.obtain();
      this.configure(b, {
        id: tid,
        text: shortName(t.name),
        player: viewer,
        off: missing.length > 0,
        why: missing[0],
        tip: () => techTip(gd, tid, missing),
        act: () => this.o.dispatch({ k: 'research', player: viewer, building: eid, techId: tid }),
      });
    }

    // cancel buttons for in-progress work
    if ((rec.trainQueue ?? []).length) {
      const b = this.obtain();
      this.configure(b, {
        id: 'cancelTrain',
        text: 'Cancel',
        player: viewer,
        tip: () => [{ text: 'Cancel training', cls: 'name' }, { text: 'Refunds 50% (75% in a hall)', cls: 'desc' }],
        act: () => this.o.dispatch({ k: 'cancelTrain', player: viewer, building: eid, index: 0 }),
      });
    }
    if ((rec.researchQueue ?? []).length) {
      const b = this.obtain();
      this.configure(b, {
        id: 'cancelResearch',
        text: 'Cancel',
        player: viewer,
        tip: () => [{ text: 'Cancel research', cls: 'name' }],
        act: () => this.o.dispatch({ k: 'cancelResearch', player: viewer, building: eid, index: 0 }),
      });
    }
    if (rec.orderKind === 'building' || rec.dead) {
      const b = this.obtain();
      this.configure(b, {
        id: 'cancelBuild',
        text: 'Cancel',
        player: viewer,
        tip: () => [{ text: 'Cancel construction', cls: 'name' }],
        act: () => this.o.dispatch({ k: 'cancelBuild', player: viewer, entity: eid }),
      });
    }
    // rally point
    const rb = this.obtain();
    this.configure(rb, {
      id: 'rally',
      text: 'Rally Pt',
      player: viewer,
      tip: () => [{ text: 'Set Rally Point', cls: 'name' }, { text: 'Click a location', cls: 'desc' }],
      act: () => this.o.alert('Click a rally location'),
    });
    (rb as unknown as { rallyFor: number }).rallyFor = eid;
  }

  /* ---- heroes ------------------------------------------------------ */
  private heroCard(viewer: number, p: PlayerState | undefined, rec: SelRecord): void {
    const gd = getGameData();
    if (rec.dead) {
      const secs = Math.ceil((rec.respawnTicks ?? 0) / TICK_RATE);
      const b = this.obtain();
      this.configure(b, {
        id: 'revive',
        text: `Revive ${secs}s`,
        player: viewer,
        tip: () => [{ text: 'Revive Hero', cls: 'name' }, { text: `Returns at the Altar in ${secs}s`, cls: 'desc' }],
        act: () => this.o.dispatch({ k: 'revive', player: viewer, hero: rec.eid }),
      });
      return;
    }
    for (const a of rec.abilities ?? []) {
      const def = gd.abilities.get(a.id) ?? gd.abilityDefs.get(a.id);
      const manaShort = (p ? 0 : 0) + (a.manaCost > 0 && rec.mpMax <= 0 ? 1 : 0);
      const cdLeft = Math.max(0, a.readyAt - this.tick) / TICK_RATE;
      const b = this.obtain();
      this.configure(b, {
        id: a.id,
        text: shortName(def?.name ?? a.id),
        player: viewer,
        off: cdLeft > 0 || manaShort > 0,
        why: manaShort ? 'Not enough mana' : cdLeft > 0 ? 'Ability on cooldown' : undefined,
        tip: () => abilityTip(gd, a.id, manaShort > 0, cdLeft, a.level),
        act: () => this.o.dispatch({ k: 'ability', player: viewer, caster: rec.eid, abilityId: a.id, target: null }),
      });
    }
    // basic orders round out the card
    this.simple(viewer, [rec.eid], 'move', 'Move', () => {});
    this.simple(viewer, [rec.eid], 'stop', 'Stop', () => this.o.dispatch({ k: 'stop', player: viewer, units: [rec.eid] }));
  }

  /* ---- bubbles ------------------------------------------------------ */
  private obtainBubble(): HTMLElement {
    let el = this.bubbles[this.bubbleUsed];
    if (!el) {
      const doc = this.o.doc;
      el = doc.createElement('div');
      el.className = 'w3-bubble';
      const ring = doc.createElement('u');
      ring.style.cssText = 'position:absolute;left:0;top:0;bottom:0;background:rgba(110,224,110,.28);text-decoration:none';
      const c = doc.createElement('canvas');
      c.width = 30;
      c.height = 30;
      c.style.cssText = 'position:absolute;inset:0';
      const em = doc.createElement('em');
      el.appendChild(ring);
      el.appendChild(c);
      el.appendChild(em);
      el.addEventListener?.('click', () => {
        const act = (el as unknown as { act?: () => void }).act;
        act?.();
      });
      this.bubbles.push(el);
      this.queue.appendChild(el);
    }
    el.style.display = '';
    this.bubbleUsed++;
    return el;
  }

  private setBubbleTip(el: HTMLElement, lines: () => TipLine[]): void {
    this.o.bindTip(el, lines);
  }

  /* ---- helpers ------------------------------------------------------- */
  private hasBuilding(viewer: number, id: string): boolean {
    return (this.builtIds.get(viewer) ?? EMPTY).includes(id);
  }
}
const EMPTY: string[] = [];

function rank(d: { requiresBuilding?: string; cost: { gold: number } }, built: Set<string>): number {
  if (!d.requiresBuilding) return 0;
  return built.has(d.requiresBuilding) ? 1 : 2;
}
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function shortName(n: string): string {
  const s = n.replace(/\(.*?\)/g, '').trim();
  return s.length > 12 ? s.slice(0, 11) + '…' : s;
}
function basicHint(kind: string): string {
  switch (kind) {
    case 'move':
      return 'Move to target, dropping whatever is being done';
    case 'stop':
      return 'Halt and stop attacking';
    case 'hold':
      return 'Stay here and attack anything in range';
    default:
      return 'Attack-move: move and attack anything encountered';
  }
}
