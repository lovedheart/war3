/**
 * A single reused tooltip node. One element is created at mount and only its
 * children's text is rewritten on hover, so hovering never grows the DOM.
 */
import type { GameData } from '../data/index.js';

export interface TipLine {
  text: string;
  cls?: 'name' | 'desc' | 'cost' | 'miss' | 'key';
}

export interface Tooltip {
  el: HTMLElement;
  /** Replace the contents with `lines` (reusing existing child nodes). */
  show(lines: TipLine[]): void;
  hide(): void;
  move(x: number, y: number): void;
  readonly visible: boolean;
}

const CLS: Record<string, string> = {
  name: 't-name',
  desc: 't-desc',
  cost: 't-cost',
  miss: 't-miss',
  key: 't-key',
};

export function createTooltip(doc: Document, host: HTMLElement): Tooltip {
  const el = doc.createElement('div');
  el.className = 'w3-tip';
  host.appendChild(el);
  const rows: HTMLElement[] = [];
  let shown = false;

  const api: Tooltip = {
    el,
    get visible() {
      return shown;
    },
    show(lines: TipLine[]) {
      for (let i = 0; i < lines.length; i++) {
        let r = rows[i];
        if (!r) {
          r = doc.createElement('div');
          rows.push(r);
          el.appendChild(r);
        }
        const cls = 'w3-tip-row ' + (CLS[lines[i].cls ?? 'desc'] ?? '');
        if (r.className !== cls) r.className = cls;
        if (r.textContent !== lines[i].text) r.textContent = lines[i].text;
        r.style.display = '';
      }
      for (let i = lines.length; i < rows.length; i++) rows[i].style.display = 'none';
      el.style.display = 'block';
      shown = true;
    },
    hide() {
      el.style.display = 'none';
      shown = false;
    },
    move(x: number, y: number) {
      el.style.left = Math.round(x + 14) + 'px';
      el.style.top = Math.round(y + 16) + 'px';
    },
  };
  return api;
}

/** Compose the standard tooltip body for a trainable unit. */
export function unitTip(gd: GameData, id: string, missing: string[], hot?: string): TipLine[] {
  const d = gd.units.get(id);
  if (!d) return [{ text: id, cls: 'name' }];
  const out: TipLine[] = [{ text: d.name, cls: 'name' }];
  if (d.isHero) out.push({ text: 'Hero', cls: 'desc' });
  out.push({
    text: costText(d.cost.gold, d.cost.lumber, d.cost.popUpkeep),
    cls: 'cost',
  });
  out.push({ text: `Training time ${Math.ceil(d.trainTime)}s`, cls: 'desc' });
  for (const m of missing) out.push({ text: m, cls: 'miss' });
  if (hot) out.push({ text: `Hotkey: ${hot}`, cls: 'key' });
  return out;
}

/** Tooltip body for a buildable structure. */
export function buildingTip(gd: GameData, id: string, missing: string[], hot?: string): TipLine[] {
  const d = gd.buildings.get(id);
  if (!d) return [{ text: id, cls: 'name' }];
  const out: TipLine[] = [
    { text: d.name, cls: 'name' },
    { text: costText(d.cost.gold, d.cost.lumber, 0), cls: 'cost' },
    { text: `Build time ${Math.ceil(d.buildTime)}s · ${d.footprint[0]}×${d.footprint[1]}`, cls: 'desc' },
  ];
  if (d.supplyProvided) out.push({ text: `Provides ${d.supplyProvided} supply`, cls: 'desc' });
  for (const m of missing) out.push({ text: m, cls: 'miss' });
  if (hot) out.push({ text: `Hotkey: ${hot}`, cls: 'key' });
  return out;
}

/** Tooltip body for a research item. */
export function techTip(gd: GameData, id: string, missing: string[]): TipLine[] {
  const t = gd.tech.get(id);
  if (!t) return [{ text: id, cls: 'name' }];
  const out: TipLine[] = [
    { text: t.name, cls: 'name' },
    { text: costText(t.cost.gold, t.cost.lumber, 0), cls: 'cost' },
    { text: `Research time ${Math.ceil(t.researchTime)}s`, cls: 'desc' },
  ];
  for (const m of missing) out.push({ text: m, cls: 'miss' });
  return out;
}

/** Tooltip body for an ability. */
export function abilityTip(
  gd: GameData,
  id: string,
  manaShort: boolean,
  cdLeft = 0,
  level = 1,
): TipLine[] {
  const a = gd.abilities.get(id) ?? gd.abilityDefs.get(id);
  if (!a) return [{ text: id, cls: 'name' }];
  const out: TipLine[] = [{ text: `${a.name} (Lv ${level})`, cls: 'name' }];
  if (a.manaCost) out.push({ text: `${a.manaCost} mana`, cls: 'cost' });
  if (a.cooldown) out.push({ text: `Cooldown ${fn2(a.cooldown)}s`, cls: 'desc' });
  if (cdLeft > 0) out.push({ text: `Ready in ${Math.ceil(cdLeft)}s`, cls: 'miss' });
  if (manaShort) out.push({ text: 'Not enough mana', cls: 'miss' });
  return out;
}

/** Tooltip body for an inventory item. */
export function itemTip(gd: GameData, id: string, charges: number): TipLine[] {
  const it = gd.items.get(id);
  if (!it) return [{ text: id, cls: 'name' }];
  const out: TipLine[] = [{ text: it.name, cls: 'name' }, { text: cap(it.quality) + ' item', cls: 'desc' }];
  if (charges > 0) out.push({ text: `${charges} charges`, cls: 'cost' });
  out.push({ text: 'Left-click to use · right-click to drop', cls: 'key' });
  return out;
}

function fn2(x: number): number {
  return Math.round(x * 10) / 10;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function costText(gold: number, lumber: number, pop: number): string {
  const bits: string[] = [];
  if (gold) bits.push(`${gold} gold`);
  if (lumber) bits.push(`${lumber} lumber`);
  if (pop) bits.push(`${pop} supply`);
  return bits.length ? bits.join(', ') : 'Free';
}
