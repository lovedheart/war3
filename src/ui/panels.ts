/**
 * The four HUD panels. Each builds its DOM once in `build()` and afterwards
 * only mutates textContent / className / style.width — `frame()` must never
 * append or remove nodes (asserted by tests/ui).
 */

import { getGameData } from '../data/index.js';
import type { Command } from '../sim/commandTypes.js';
import type { Game, Snapshot } from '../sim/index.js';
import type { PlayerState } from '../sim/player.js';
import { paintIcon } from './icons.js';
import type { Tooltip } from './tooltip.js';

const TICK_RATE = 30;

export interface PanelHost {
  doc: Document;
  parent: HTMLElement;
  dispatch(cmd: Command): void;
  tooltip: Tooltip;
  viewer: number;
  /** register a node for hover-tooltip wiring */
  bindTip(el: HTMLElement, lines: () => TipLine[]): void;
  alert(msg: string, err?: boolean): void;
}

interface TipLine {
  text: string;
  cls?: 'name' | 'desc' | 'cost' | 'miss' | 'key';
}

/* ------------------------------------------------------------------ */
/* Resource bar                                                        */
/* ------------------------------------------------------------------ */
export class ResourceBar {
  private gold!: HTMLElement;
  private lumber!: HTMLElement;
  private pop!: HTMLElement;
  private upkeep!: HTMLElement;
  private lastGold = -1;
  private lastLumber = -1;
  private bumpUntil = { gold: 0, lumber: 0 };

  constructor(private h: PanelHost) {}

  build(): HTMLElement {
    const el = this.h.doc.createElement('div');
    el.className = 'w3-panel w3-resbar pe';
    el.appendChild(this.field('gold', (this.gold = this.h.doc.createElement('b'))));
    el.appendChild(this.field('lumber', (this.lumber = this.h.doc.createElement('b'))));
    this.pop = this.h.doc.createElement('b');
    const popWrap = this.h.doc.createElement('div');
    popWrap.className = 'w3-pop ok';
    const popLbl = this.h.doc.createElement('span');
    popLbl.textContent = 'Population';
    popWrap.appendChild(popLbl);
    popWrap.appendChild(this.pop);
    el.appendChild(popWrap);
    this.upkeep = this.h.doc.createElement('span');
    this.upkeep.className = 'w3-upkeep';
    el.appendChild(this.upkeep);
    this.popWrap = popWrap;
    return el;
  }

  private popWrap!: HTMLElement;

  private field(kind: 'gold' | 'lumber', value: HTMLElement): HTMLElement {
    const w = this.h.doc.createElement('div');
    w.className = 'w3-res';
    const g = this.h.doc.createElement('i');
    g.className = 'w3-glyph ' + kind;
    w.appendChild(g);
    w.appendChild(value);
    return w;
  }

  /** `res` is the snapshot row (plain numbers); `p` supplies upkeep/supply. */
  frame(res: { gold: number; lumber: number } | undefined, p: PlayerState | undefined, nowMs: number): void {
    if (!res || !p) return;
    const gold = Math.floor(res.gold);
    const lumber = Math.floor(res.lumber);
    if (gold !== this.lastGold) {
      this.gold.textContent = String(gold);
      if (gold > this.lastGold && this.lastGold >= 0) this.bumpUntil.gold = nowMs + 450;
      this.lastGold = gold;
    }
    if (lumber !== this.lastLumber) {
      this.lumber.textContent = String(lumber);
      if (lumber > this.lastLumber && this.lastLumber >= 0) this.bumpUntil.lumber = nowMs + 450;
      this.lastLumber = lumber;
    }
    this.gold.className = nowMs < this.bumpUntil.gold ? 'bump' : '';
    this.lumber.className = nowMs < this.bumpUntil.lumber ? 'bump' : '';

    const used = p.supplyUsed;
    const cap = p.supplyCap;
    this.pop.textContent = `${used}/${cap}`;
    const cls = used > cap ? 'w3-pop high' : p.upkeep === 2 ? 'w3-pop high' : p.upkeep === 1 ? 'w3-pop low' : 'w3-pop ok';
    if (this.popWrap.className !== cls) this.popWrap.className = cls;

    const txt = p.upkeep === 2 ? 'Upkeep!' : p.upkeep === 1 ? 'Upkeep' : '';
    if (this.upkeep.textContent !== txt) this.upkeep.textContent = txt;
    const ucls = 'w3-upkeep' + (p.upkeep === 2 ? ' up-high' : p.upkeep === 1 ? ' up-low' : '');
    if (this.upkeep.className !== ucls) this.upkeep.className = ucls;
  }
}

/* ------------------------------------------------------------------ */
/* Minimap panel                                                       */
/* ------------------------------------------------------------------ */
export class MinimapPanel {
  canvas!: HTMLCanvasElement;
  private size = 152;
  /** map dimensions, learned from the first frame */
  private mapW = 1;
  private mapH = 1;

  constructor(
    private h: PanelHost,
    private onClick: (worldX: number, worldY: number) => void,
  ) {}

  build(): HTMLElement {
    const el = this.h.doc.createElement('div');
    el.className = 'w3-panel w3-minimap pe';
    this.canvas = this.h.doc.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    el.appendChild(this.canvas);
    this.canvas.addEventListener?.('mousedown', (ev: Event) => {
      const e = ev as MouseEvent;
      if (e.button !== 0) return;
      const r = this.canvas.getBoundingClientRect?.() ?? ({ left: 0, top: 0, width: this.size, height: this.size } as DOMRect);
      const sx = r.width || this.size;
      const mx = ((e.clientX - r.left) / sx) * this.size;
      const my = ((e.clientY - r.top) / sx) * this.size;
      const w = this.mapPxToWorld(mx, my);
      this.onClick(w.x, w.y);
    });
    return el;
  }

  /** Minimap px -> world tile coords (mirrors MinimapTransform.mapToWorld). */
  mapPxToWorld(mx: number, my: number): { x: number; y: number } {
    const scale = this.size / Math.max(1, Math.max(this.mapW, this.mapH));
    const offX = (this.size - this.mapW * scale) / 2;
    const offY = (this.size - this.mapH * scale) / 2;
    return { x: (mx - offX) / scale, y: (my - offY) / scale };
  }

  frame(game: Game, draw?: (ctx: CanvasRenderingContext2D, game: Game, viewer: number) => void): void {
    const t = game.terrain as unknown as { width?: number; height?: number } | undefined;
    if (t?.width && t?.height) {
      this.mapW = t.width;
      this.mapH = t.height;
    }
    if (!draw) return;
    const ctx = this.canvas.getContext?.('2d') as CanvasRenderingContext2D | null;
    if (ctx) draw(ctx, game, this.h.viewer);
  }
}

/* ------------------------------------------------------------------ */
/* Selection info panel                                                */
/* ------------------------------------------------------------------ */
export class InfoPanel {
  private root!: HTMLElement;
  private portrait!: HTMLCanvasElement;
  private level!: HTMLElement;
  private name!: HTMLElement;
  private sub!: HTMLElement;
  private hpBar!: HTMLElement;
  private mpBar!: HTMLElement;
  private xpBar!: HTMLElement;
  private mpWrap!: HTMLElement;
  private xpWrap!: HTMLElement;
  private stats!: HTMLElement;
  private slots: HTMLElement[] = [];
  private slotCtx: (CanvasRenderingContext2D | null)[] = [];
  private slotKey: string[] = [];

  constructor(private h: PanelHost) {}

  build(): HTMLElement {
    const doc = this.h.doc;
    const root = (this.root = doc.createElement('div'));
    root.className = 'w3-info';

    const pWrap = doc.createElement('div');
    pWrap.className = 'w3-portrait';
    this.portrait = doc.createElement('canvas');
    this.portrait.width = 62;
    this.portrait.height = 62;
    pWrap.appendChild(this.portrait);
    this.level = doc.createElement('span');
    this.level.className = 'w3-lvl';
    pWrap.appendChild(this.level);
    this.portraitWrap = pWrap;
    root.appendChild(pWrap);

    this.name = doc.createElement('div');
    this.name.className = 'w3-name';
    root.appendChild(this.name);

    this.hpBar = bar(doc, 'hp');
    root.appendChild(this.hpBar);
    this.mpWrap = bar(doc, 'mp');
    this.mpBar = this.mpWrap.firstChild as HTMLElement;
    root.appendChild(this.mpWrap);
    this.xpWrap = bar(doc, 'xp');
    this.xpBar = this.xpWrap.firstChild as HTMLElement;
    root.appendChild(this.xpWrap);

    this.sub = doc.createElement('div');
    this.sub.className = 'w3-sub';
    root.appendChild(this.sub);
    this.stats = doc.createElement('div');
    this.stats.className = 'w3-stats';
    root.appendChild(this.stats);

    const tray = doc.createElement('div');
    tray.className = 'w3-items';
    for (let i = 0; i < 6; i++) {
      const s = doc.createElement('div');
      s.className = 'w3-slot empty';
      const c = doc.createElement('canvas');
      c.width = 27;
      c.height = 27;
      s.appendChild(c);
      const badge = doc.createElement('em');
      badge.style.display = 'none';
      s.appendChild(badge);
      this.slots.push(s);
      this.slotCtx.push(c.getContext?.('2d') ?? null);
      this.slotKey.push('');
      tray.appendChild(s);
    }
    this.tray = tray;
    root.appendChild(tray);
    return root;
  }

  private portraitWrap!: HTMLElement;
  private tray!: HTMLElement;

  /** @param sel entity records pulled from the sim (read-only) */
  frame(info: SelInfo | null): void {
    const hide = (on: boolean) => {
      this.root.style.visibility = on ? 'hidden' : 'visible';
    };
    if (!info) {
      hide(true);
      return;
    }
    hide(false);
    const key = info.id + '|' + (info.hero ? 'h' : 'u');
    if (this.portraitKey !== key) {
      this.portraitKey = key;
      const ctx = this.portrait.getContext?.('2d') as CanvasRenderingContext2D | null;
      if (ctx) paintIcon(ctx, info.id, 62);
    }
    this.portraitWrap.className = 'w3-portrait' + (info.hero ? ' hero' : '');
    set(this.level, info.hero && !info.dead ? `Lv ${info.level}` : '');
    set(this.name, info.name + (info.count > 1 ? ` (${info.count})` : ''));
    set(this.sub, info.sub);
    fill(this.hpBar, info.hpFrac);
    this.hpBar.className = 'w3-bar hp' + (info.hpFrac < 0.34 ? ' low' : info.hpFrac < 0.67 ? ' mid' : '');
    this.mpWrap.style.display = info.mpMax > 0 ? '' : 'none';
    if (info.mpMax > 0) fill(this.mpBar, info.mpFrac);
    this.xpWrap.style.display = info.hero ? '' : 'none';
    if (info.hero) fill(this.xpBar, info.xpFrac);

    const statBits: string[] = [];
    if (info.dmgMin != null) statBits.push(`Dmg <span>${info.dmgMin}-${info.dmgMax}</span>`);
    if (info.armorValue != null) statBits.push(`Armor <span>${info.armorValue}</span>`);
    if (info.range != null) statBits.push(`Range <span>${info.range}</span>`);
    if (info.speed != null) statBits.push(`Speed <span>${info.speed}</span>`);
    if (info.rate != null) statBits.push(`Attack <span>${info.rate}s</span>`);
    const txt = statBits.join(' · ');
    if (this.stats.innerHTML !== txt) this.stats.innerHTML = txt;

    for (let i = 0; i < 6; i++) {
      const id = info.items[i] ?? '';
      const k = id + ':' + (info.itemCharges[i] ?? 0);
      const slot = this.slots[i];
      slot.className = 'w3-slot' + (id ? '' : ' empty');
      const badge = slot.lastChild as HTMLElement;
      if (id) {
        if (this.slotKey[i] !== k) {
          this.slotKey[i] = k;
          const ctx = this.slotCtx[i];
          if (ctx) paintIcon(ctx, id, 27);
        }
        set(badge, (info.itemCharges[i] ?? 0) > 1 ? String(info.itemCharges[i]) : '');
        badge.style.display = (info.itemCharges[i] ?? 0) > 1 ? '' : 'none';
      } else {
        if (this.slotKey[i] !== '') {
          this.slotKey[i] = '';
          const ctx = this.slotCtx[i];
          ctx?.clearRect?.(0, 0, 27, 27);
        }
        badge.style.display = 'none';
      }
    }
    this.tray.style.display = info.hero ? '' : 'none';
  }

  private portraitKey = '';
}

export interface SelInfo {
  id: string;
  name: string;
  count: number;
  hero: boolean;
  dead: boolean;
  level: number;
  hpFrac: number;
  mpFrac: number;
  mpMax: number;
  xpFrac: number;
  sub: string;
  dmgMin?: number;
  dmgMax?: number;
  armorValue?: number;
  range?: number;
  speed?: number;
  rate?: number;
  items: (string | null)[];
  itemCharges: number[];
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */
export class Alerts {
  private root!: HTMLElement;
  private pool: HTMLElement[] = [];
  private free: HTMLElement[] = [];

  constructor(private h: PanelHost) {}

  build(): HTMLElement {
    this.root = this.h.doc.createElement('div');
    this.root.className = 'w3-panel w3-alerts';
    return this.root;
  }

  push(msg: string, err = false, nowMs = 0): void {
    let el = this.free.pop();
    if (!el) {
      el = this.h.doc.createElement('div');
      this.pool.push(el);
      this.root.appendChild(el);
    }
    el.className = 'w3-alert' + (err ? ' err' : '');
    el.textContent = msg;
    el.style.display = '';
    el.dataset.until = String(nowMs + 2200);
    // recycle after the CSS fade so the node count stays bounded
    setTimeout(() => {
      el!.style.display = 'none';
      this.free.push(el!);
    }, 2300);
  }

  /** Number of live alert nodes (bounded by the pool). */
  get poolSize(): number {
    return this.pool.length;
  }
}

/* ------------------------------------------------------------------ */
function bar(doc: Document, kind: string): HTMLElement {
  const w = doc.createElement('div');
  w.className = 'w3-bar ' + kind;
  const i = doc.createElement('i');
  w.appendChild(i);
  return w;
}
function fill(i: HTMLElement, frac: number): void {
  const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
  const css = pct + '%';
  if (i.style.width !== css) i.style.width = css;
}
function set(el: HTMLElement, txt: string): void {
  if (el.textContent !== txt) el.textContent = txt;
}

export function snapshotOf(game: Game): Snapshot {
  return game.snapshot();
}

export const UI_TICK_RATE = TICK_RATE;
export { getGameData };
