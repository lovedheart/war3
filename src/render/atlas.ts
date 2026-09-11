/**
 * Procedural sprite atlas.
 *
 * Every sprite is *baked* once into a 512x512 offscreen canvas per category by
 * calling its vector draw function, then blitted with `drawImage` for the rest
 * of the session. Blitting is ~an order of magnitude cheaper than replaying
 * hundreds of path operations per frame.
 *
 * No DOM access happens at import time: `createCanvas()` is resolved lazily so
 * the module stays importable in node (unit tests) and under SSR.
 */
import type { Ctx2D, ArtCategory } from './draw/spec.js';
import { SLOT_PX, HERO_SLOT_PX, parseSpriteKey, shapeFor, spriteKey, isHeroId } from './draw/spec.js';
import type { DrawSpec, DrawFn } from './draw/spec.js';
import { racePalette } from './palette.js';
import { drawUnit } from './draw/unit.js';
import { drawBuilding } from './draw/building.js';
import { drawItem } from './draw/item.js';
import { drawDecoration } from './draw/decoration.js';
import { drawMissile } from './draw/missile.js';

export const ATLAS_PAGE_PX = 512;
export const ATLAS_GUTTER = 2;

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas;

/** Default factory: DOM canvas when available, OffscreenCanvas otherwise. */
export function defaultCanvasFactory(): CanvasFactory | null {
  const g = globalThis as unknown as {
    document?: { createElement(t: 'canvas'): HTMLCanvasElement };
    OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas;
  };
  if (g.document && typeof g.document.createElement === 'function') {
    return (w, h) => {
      const c = g.document!.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    };
  }
  if (g.OffscreenCanvas) return (w, h) => new g.OffscreenCanvas!(w, h);
  return null;
}

const DRAWERS: Record<ArtCategory, DrawFn> = {
  unit: drawUnit,
  building: drawBuilding,
  item: drawItem,
  decoration: drawDecoration,
  missile: drawMissile,
};

export interface AtlasEntry {
  key: string;
  cat: ArtCategory;
  page: number;
  /** slot index inside the page (row-major) */
  slot: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** px from the sprite's ground anchor to the slot's left / bottom edge */
  anchorX: number;
  anchorY: number;
  box: number;
}

export class SpriteAtlas {
  readonly pages: (HTMLCanvasElement | OffscreenCanvas)[] = [];
  private ctxs: (Ctx2D | null)[] = [];
  private entries = new Map<string, AtlasEntry>();
  /** slots used per page */
  private counts: number[] = [];
  /** keys registered but not yet baked */
  private pending: { key: string; spec: DrawSpec }[] = [];
  private factory: CanvasFactory;
  private baked = false;
  /** true once bakeAll() completed */
  get isBaked(): boolean { return this.baked; }
  /** cache key -> entry, so identical specs share one slot */
  private variants = new Map<string, string>();

  constructor(factory?: CanvasFactory) {
    const f = factory ?? defaultCanvasFactory();
    if (!f) throw new Error('no canvas implementation available for the sprite atlas');
    this.factory = f;
  }

  /** Register a sprite. Returns its atlas key. Cheap; baking is deferred. */
  register(cat: ArtCategory, id: string, opts: { race?: string; shape?: string; hero?: boolean; fly?: boolean; ghost?: boolean } = {}): string {
    const key = bakeKey(cat, id, opts);
    if (this.entries.has(key) || this.pending.some((p) => p.key === key)) return key;
    const spec: DrawSpec = {
      key,
      cat,
      id,
      shape: shapeFor(id, cat, opts.shape),
      race: opts.race ?? 'neutral',
      pal: racePalette(opts.race ?? 'neutral'),
      size: slotSize(cat, opts.hero),
      hero: cat === 'building' ? opts.ghost === true : opts.hero,
      fly: opts.fly,
    };
    this.pending.push({ key, spec });
    return key;
  }

  /** Convenience for the renderer: register-if-needed then resolve. */
  resolve(cat: ArtCategory, id: string, opts: Parameters<SpriteAtlas['register']>[2] = {}): AtlasEntry | null {
    const key = this.register(cat, id, opts);
    if (!this.entries.has(key)) this.bakePending();
    return this.entries.get(key) ?? null;
  }

  entry(key: string): AtlasEntry | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** All registered keys (baked or pending). */
  keys(): string[] {
    const all = new Set<string>(this.entries.keys());
    for (const p of this.pending) all.add(p.key);
    return [...all].sort();
  }

  stats(): { pages: number; sprites: number; slotsPerPage: Record<number, number> } {
    return { pages: this.pages.length, sprites: this.entries.size, slotsPerPage: this.counts.slice(0, this.pages.length) };
  }

  /* ---------------- baking ---------------- */

  /** Bake everything registered so far. Idempotent. */
  bakeAll(): void {
    this.bakePending();
    this.baked = true;
  }

  private bakePending(): void {
    if (this.pending.length === 0) return;
    const list = this.pending.splice(0, this.pending.length);
    for (const { key, spec } of list) {
      const box = spec.size;
      const { page, slot, sx, sy } = this.allocate(box);
      const ctx = this.pageCtx(page);
      if (ctx) {
        ctx.save();
        // Slot origin is top-left; the art's baseline sits at the slot bottom
        // minus a small margin so shadows have room.
        ctx.translate(sx + box / 2, sy + box - Math.max(2, box * 0.06));
        DRAWERS[spec.cat](ctx, spec, box);
        ctx.restore();
      }
      this.entries.set(key, {
        key, cat: spec.cat, page, slot, sx, sy, sw: box, sh: box,
        anchorX: box / 2,
        anchorY: box - Math.max(2, box * 0.06),
        box,
      });
    }
  }

  /** Row-major slot allocation, one page at a time (pages are homogeneous). */
  private allocate(box: number): { page: number; slot: number; sx: number; sy: number } {
    const perSide = Math.max(1, Math.floor((ATLAS_PAGE_PX - ATLAS_GUTTER) / (box + ATLAS_GUTTER)));
    const perPage = perSide * perSide;
    let page = this.pages.length - 1;
    if (page < 0) { this.newPage(); page = 0; }
    else if (this.counts[page] >= perPage) { this.newPage(); page = this.pages.length - 1; }
    const slot = this.counts[page];
    this.counts[page] = slot + 1;
    const col = slot % perSide;
    const row = Math.floor(slot / perSide);
    return { page, slot, sx: ATLAS_GUTTER + col * (box + ATLAS_GUTTER), sy: ATLAS_GUTTER + row * (box + ATLAS_GUTTER) };
  }

  private newPage(): void {
    this.pages.push(this.factory(ATLAS_PAGE_PX, ATLAS_PAGE_PX));
    this.ctxs.push(null);
    this.counts.push(0);
  }

  private pageCtx(page: number): Ctx2D | null {
    let c = this.ctxs[page];
    if (c === null || c === undefined) {
      const cv = this.pages[page] as unknown as { getContext(t: '2d'): Ctx2D | null };
      c = cv.getContext('2d');
      this.ctxs[page] = c ?? null;
    }
    return c;
  }

  /** True once at least one page exists (i.e. safe to blit). */
  ready(): boolean {
    return this.pages.length > 0;
  }

  /** Free GPU/CPU backing stores. */
  dispose(): void {
    for (const p of this.pages) {
      const cv = p as unknown as { width: number; height: number };
      cv.width = 1; cv.height = 1;
    }
    this.pages.length = 0;
    this.ctxs.length = 0;
    this.entries.clear();
    this.pending.length = 0;
    this.variants.clear();
    this.counts.length = 0;
    this.baked = false;
  }
}

export function slotSize(cat: ArtCategory, hero?: boolean): number {
  if (cat === 'unit') return hero ? HERO_SLOT_PX : SLOT_PX.unit;
  return SLOT_PX[cat];
}

/** Stable atlas key: category + id (+ race/variant suffixes). */
export function bakeKey(cat: ArtCategory, id: string, opts: { race?: string; hero?: boolean; ghost?: boolean } = {}): string {
  let k = spriteKey(cat, id);
  if (cat === 'building') {
    k += `@${opts.race ?? 'n'}`;
    if (opts.ghost) k += '#scaffold';
  } else if (cat === 'unit') {
    k += `@${opts.race ?? 'n'}`;
    if (opts.hero) k += '#hero';
  }
  return k;
}

/**
 * Blit a baked sprite. Falls back to a magenta placeholder box when the key is
 * unknown so missing art is obvious rather than invisible.
 */
export function drawSprite(
  atlas: SpriteAtlas,
  ctx: Ctx2D,
  key: string,
  x: number,
  y: number,
  flip = false,
  scale = 1,
): boolean {
  const e = atlas.entry(key);
  if (!e) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,0,255,0.35)';
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - 8, y - 16, 16, 16);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return false;
  }
  const page = atlas.pages[e.page] as unknown as { width: number; height: number };
  const dw = e.sw * scale;
  const dh = e.sh * scale;
  ctx.save();
  if (flip) {
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(page as never, e.sx, e.sy, e.sw, e.sh, -e.anchorX * scale, -e.anchorY * scale, dw, dh);
  } else {
    ctx.drawImage(page as never, e.sx, e.sy, e.sw, e.sh, x - e.anchorX * scale, y - e.anchorY * scale, dw, dh);
  }
  ctx.restore();
  return true;
}

/** Silhouette-only blit used for team-colour tinting and selection masks. */
export function drawSpriteSilhouette(
  atlas: SpriteAtlas,
  ctx: Ctx2D,
  key: string,
  x: number,
  y: number,
  color: string,
  alpha: number,
): void {
  const e = atlas.entry(key);
  if (!e) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = color;
  ctx.fillRect(x - e.anchorX, y - e.anchorY, e.sw, e.sh);
  ctx.restore();
}

/** Pre-register the whole stock roster so the atlas is warm before frame 1. */
export function registerStock(atlas: SpriteAtlas, ids: Partial<Record<ArtCategory, string[]>>): void {
  for (const cat of Object.keys(ids) as ArtCategory[]) {
    for (const id of ids[cat] ?? []) {
      atlas.register(cat, id, { race: guessRace(id), hero: cat === 'unit' && isHeroId(id) });
    }
  }
  atlas.bakeAll();
}

const RACE_HINTS: [RegExp, string][] = [
  [/peasant|footman|rifleman|knight$|church|barracks_al|town_hall|keep|castle|farm_al|tower_al|arcane_tower|blacksmith/, 'human'],
  [/grunt|peon|warchanter|raider|shaman|witch_doctor|tauren|catapult|great_hall|stronghold|orc_barracks|war_mill|spirit_lodge|watchtower_orc/, 'orc'],
  [/ghoul|abom|fiend|skeleton|meat_wagon|crypt|ziggurat|necropolis|lich|death_knight|dread_lord|gargoyle|statue/, 'undead'],
  [/huntress|archer_ne|dryad|mountain_giant|hippogryph|warden|keeper|priestess|tree_of|moon_well|ancient_|chimaera/, 'night_elf'],
];

export function guessRace(id: string): string {
  for (const [re, r] of RACE_HINTS) if (re.test(id)) return r;
  return 'neutral';
}

/** Parse a key back into parts (debug overlay helper). */
export function splitKey(key: string): { cat: ArtCategory | null; id: string; race: string; flags: string[] } {
  const base = parseSpriteKey(key.split('@')[0]);
  const at = key.indexOf('@');
  const hash = key.indexOf('#');
  return {
    cat: base?.cat ?? null,
    id: base?.id ?? key,
    race: at >= 0 ? (hash >= 0 ? key.slice(at + 1, hash) : key.slice(at + 1)) : '',
    flags: hash >= 0 ? key.slice(hash + 1).split('#') : [],
  };
}
