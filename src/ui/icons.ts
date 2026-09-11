/**
 * Procedural HUD icons. There is no icon art, so every button/portrait/slot
 * draws a small deterministic glyph: a race-tinted plate plus a silhouette
 * derived from the unit/building/item id. Deterministic (no RNG) so two runs
 * render identical pixels.
 */
import { fn } from '../core/fixed.js';
import { getGameData } from '../data/index.js';
import { PLAYER_COLORS, RACES } from '../render/palette.js';

export type Ctx2D = CanvasRenderingContext2D;

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const GROUND = '#141a12';
const INK = '#e9e2cd';

function plate(ctx: Ctx2D, size: number, tint: string): void {
  const g = ctx.createLinearGradient?.(0, 0, 0, size);
  if (g) {
    g.addColorStop(0, mix(tint, '#ffffff', 0.28));
    g.addColorStop(1, mix(tint, '#000000', 0.55));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = tint;
  }
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, size * 0.68, size, size * 0.32);
}

/** Hex mix, clamped. Accepts '#rgb' / '#rrggbb'. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const k = Math.min(1, Math.max(0, t));
  const c = [0, 1, 2].map((i) => Math.round(pa[i] + (pb[i] - pa[i]) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function parseHex(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Race/player tint for an id. */
export function tintFor(id: string, player?: number): string {
  const gd = getGameData();
  const def = gd.units.get(id) ?? gd.buildings.get(id);
  const race = (def as { race?: string } | undefined)?.race;
  const pal = race ? (RACES as Record<string, { accent?: string; banner?: string }>)[race] : undefined;
  if (player && PLAYER_COLORS[player]) return PLAYER_COLORS[player];
  return pal?.accent ?? pal?.banner ?? '#6b7a5a';
}

/**
 * Paint an icon for `id` into a `size`×`size` context. The glyph is chosen by
 * keyword so infantry/machines/walkers/towers/shops read differently.
 */
export function paintIcon(ctx: Ctx2D, id: string, size: number, player?: number): void {
  const tint = tintFor(id, player);
  ctx.clearRect(0, 0, size, size);
  plate(ctx, size, tint);
  ctx.fillStyle = GROUND;
  ctx.fillRect(size * 0.08, size * 0.74, size * 0.84, size * 0.2);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1, size / 16);
  ctx.lineJoin = 'round';
  const S = size;
  const h = hashId(id);
  switch (glyphFor(id)) {
    case 'walker':
      body(ctx, S, 0.34, 0.3);
      head(ctx, S, 0.5, 0.26, 0.11);
      legs(ctx, S);
      break;
    case 'ranged':
      body(ctx, S, 0.36, 0.28);
      head(ctx, S, 0.5, 0.26, 0.1);
      legs(ctx, S);
      bar(ctx, S, 0.42, 0.44, 0.78, 0.3);
      break;
    case 'mounted':
      ctx.beginPath();
      ctx.ellipse(S * 0.5, S * 0.62, S * 0.26, S * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      bar(ctx, S, 0.3, 0.62, 0.34, 0.78);
      bar(ctx, S, 0.66, 0.62, 0.7, 0.78);
      head(ctx, S, 0.42, 0.3, 0.1);
      bar(ctx, S, 0.48, 0.2, 0.72, 0.34);
      break;
    case 'flyer':
      ctx.beginPath();
      ctx.moveTo(S * 0.5, S * 0.3);
      ctx.lineTo(S * 0.16, S * 0.58);
      ctx.lineTo(S * 0.5, S * 0.52);
      ctx.lineTo(S * 0.84, S * 0.58);
      ctx.closePath();
      ctx.fill();
      head(ctx, S, 0.5, 0.26, 0.09);
      break;
    case 'machine':
      ctx.fillRect(S * 0.3, S * 0.44, S * 0.4, S * 0.26);
      bar(ctx, S, 0.5, 0.46, 0.82, 0.34);
      wheel(ctx, S, 0.36, 0.74);
      wheel(ctx, S, 0.64, 0.74);
      break;
    case 'tower':
      ctx.beginPath();
      ctx.moveTo(S * 0.36, S * 0.78);
      ctx.lineTo(S * 0.36, S * 0.34);
      ctx.lineTo(S * 0.5, S * 0.2);
      ctx.lineTo(S * 0.64, S * 0.34);
      ctx.lineTo(S * 0.64, S * 0.78);
      ctx.closePath();
      ctx.fill();
      break;
    case 'hall':
      ctx.fillRect(S * 0.24, S * 0.44, S * 0.52, S * 0.34);
      roof(ctx, S, 0.2, 0.44, 0.8);
      battlements(ctx, S, 0.24, 0.76, 0.44);
      break;
    case 'house':
      ctx.fillRect(S * 0.3, S * 0.5, S * 0.4, S * 0.28);
      roof(ctx, S, 0.26, 0.5, 0.74);
      break;
    case 'shop':
      ctx.fillRect(S * 0.28, S * 0.46, S * 0.44, S * 0.32);
      bar(ctx, S, 0.28, 0.46, 0.72, 0.4);
      head(ctx, S, 0.5, 0.36, 0.08);
      break;
    case 'farm':
      bar(ctx, S, 0.3, 0.78, 0.3, 0.44);
      bar(ctx, S, 0.7, 0.78, 0.7, 0.44);
      bar(ctx, S, 0.3, 0.5, 0.7, 0.5);
      bar(ctx, S, 0.3, 0.64, 0.7, 0.64);
      break;
    case 'flask':
      ctx.beginPath();
      ctx.moveTo(S * 0.44, S * 0.24);
      ctx.lineTo(S * 0.56, S * 0.24);
      ctx.lineTo(S * 0.62, S * 0.5);
      ctx.lineTo(S * 0.62, S * 0.74);
      ctx.lineTo(S * 0.38, S * 0.74);
      ctx.lineTo(S * 0.38, S * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'sword':
      bar(ctx, S, 0.5, 0.78, 0.5, 0.22);
      bar(ctx, S, 0.36, 0.6, 0.64, 0.6);
      break;
    case 'scroll':
      ctx.fillRect(S * 0.32, S * 0.26, S * 0.36, S * 0.5);
      ctx.clearRect(S * 0.36, S * 0.34, S * 0.28, S * 0.06);
      ctx.clearRect(S * 0.36, S * 0.46, S * 0.28, S * 0.06);
      break;
    default:
      // generic token: disc with a notched quadrant keyed by the id hash
      ctx.beginPath();
      ctx.arc(S * 0.5, S * 0.52, S * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.clearRect(S * 0.5, S * 0.28, S * 0.24 * (0.4 + ((h >>> 3) & 7) * 0.08), S * 0.24);
      break;
  }
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

export type Glyph =
  | 'walker' | 'ranged' | 'mounted' | 'flyer' | 'machine' | 'tower'
  | 'hall' | 'house' | 'shop' | 'farm' | 'flask' | 'sword' | 'scroll' | 'token';

const WORDS: [RegExp, Glyph][] = [
  [/peasant|peon|worker|acolyte|wisp|servant|drone| peasant/, 'walker'],
  [/footman|grunt|knight|archer|raider|ne_(cat|pro|hir)|marine|ritual|oracle|witch|priest|sorceress|shaman|witchdoctor|headhunter|axethrow|spearm|sword|dread|guard|sentinel|huntress|dryad|profane| Init/, 'ranged'],
  [/knight|raider|templar|lord|paladin|chariot|wolf|rider|centaur|devour/, 'mounted'],
  [/dragon|gryphon|wyvern|bat|hippogriff|crow|faerie|phoenix|bird|flying|airship|balrog|imp|naga_?watcher|sprite/, 'flyer'],
  [/machine|siege|catapult|ballista|tank|wagon|gyro|steam|destroyer|ship|boat|frigate|gunboat|tinker/, 'machine'],
  [/tower|minaret|ziggurat|spire|obelisk|stand|Sentinel/, 'tower'],
  [/hall|castle|fortress|stronghold|necropolis|throne|citadel|town/, 'hall'],
  [/farm|burrow|hoon|moon_well|well|shrine|vault|attic|room/, 'house'],
  [/mill|smith|workshop|shop|altar|temple|sanctum|academy|menagerie|slaugden|war_quarter|greathall|store|lab/, 'shop'],
];

/** Choose a glyph from the id's keywords. */
export function glyphFor(id: string): Glyph {
  const s = id.toLowerCase();
  if (/^(ckng|clss|pots|scro|book|gems|orb|ring|amul|tome|npow|nwiz|nexp|regen|invu|slom|firb|csum)/.test(s)) {
    return /^(scro|tome|book)/.test(s) ? 'scroll' : /^(ckng|clss|orb|ring|amul)/.test(s) ? 'sword' : 'flask';
  }
  for (const [re, g] of WORDS) if (re.test(s)) return g;
  if (/mill|lumber/.test(s)) return 'farm';
  if (/building|barracks|silo|stable/.test(s)) return 'shop';
  return 'token';
}

/* ---- tiny primitives -------------------------------------------------- */
function body(ctx: Ctx2D, S: number, cx: number, cy: number): void {
  ctx.fillRect(S * (cx - 0.02), S * cy, S * 0.14, S * 0.34);
}
function head(ctx: Ctx2D, S: number, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(S * cx, S * cy, S * r, 0, Math.PI * 2);
  ctx.fill();
}
function legs(ctx: Ctx2D, S: number): void {
  bar(ctx, S, 0.44, 0.66, 0.38, 0.8);
  bar(ctx, S, 0.5, 0.66, 0.58, 0.8);
}
function bar(ctx: Ctx2D, S: number, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(S * x1, S * y1);
  ctx.lineTo(S * x2, S * y2);
  ctx.stroke();
}
function roof(ctx: Ctx2D, S: number, x1: number, y: number, x2: number): void {
  ctx.beginPath();
  ctx.moveTo(S * x1, S * y);
  ctx.lineTo(S * 0.5, S * (y - 0.2));
  ctx.lineTo(S * x2, S * y);
  ctx.closePath();
  ctx.fill();
}
function battlements(ctx: Ctx2D, S: number, x1: number, x2: number, y: number): void {
  const w = (x2 - x1) / 5;
  for (let i = 0; i < 3; i++) ctx.fillRect(S * (x1 + i * w * 1.6 + w * 0.2), S * (y - 0.08), S * w * 0.7, S * 0.08);
}
function wheel(ctx: Ctx2D, S: number, cx: number, cy: number): void {
  ctx.beginPath();
  ctx.arc(S * cx, S * cy, S * 0.09, 0, Math.PI * 2);
  ctx.stroke();
}

/** Fixed -> px helper kept here so UI never imports sim internals twice. */
export function fnum(x: number): number {
  return fn(x);
}
