/**
 * Colour tables for the renderer.
 *
 * Everything here is a plain string / number table so it can be imported in
 * node (unit tests) without a DOM. Terrain ids are duplicated as literals on
 * purpose: `src/map` is owned by another module and must not be imported here.
 */
import { TILE_GROUND, TILE_GRASS, TILE_DIRT, TILE_CLIFF, TILE_WATER, TILE_ROCK, TILE_BLIGHT, TILE_SNOW, TILE_WALL } from '../map/terrain.js';

/* ------------------------------------------------------------------ */
/* Player colours — WC3 race-selection palette (12 players).           */
/* ------------------------------------------------------------------ */

export const PLAYER_COLORS = [
  '#c8c8c8', // 0  neutral (unused)
  '#e08e45', // 1  maroon/orange
  '#0d7ff9', // 2  azure
  '#f9d923', // 3  yellow
  '#2fd42f', // 4  green
  '#b857c6', // 5  purple
  '#12c3c9', // 6  teal
  '#f2545d', // 7  red
  '#f7f7f7', // 8  white
  '#8b5a2b', // 9  brown
  '#2b3a6b', // 10 dark navy
  '#a6e000', // 11 lime
] as const;

/** Darker shade used for outlines / banners of the same player slot. */
export const PLAYER_COLORS_DARK = [
  '#6b6b6b',
  '#7d4a1c',
  '#0a3f80',
  '#8a7709',
  '#16681a',
  '#5d2a66',
  '#0a6d72',
  '#8a1f28',
  '#8f8f8f',
  '#4a2f16',
  '#141d3a',
  '#5a7a00',
] as const;

export function playerColor(player: number): string {
  const p = player | 0;
  return PLAYER_COLORS[p] ?? PLAYER_COLORS[0];
}

export function playerColorDark(player: number): string {
  const p = player | 0;
  return PLAYER_COLORS_DARK[p] ?? PLAYER_COLORS_DARK[0];
}

/** Health-bar tint per owner (WC3 colours bars by player colour). */
export function healthBarColor(player: number): string {
  if (player === NEUTRAL_PASSIVE || player === NEUTRAL_AGGRESSIVE || player === 0) return '#9aa0a6';
  return playerColor(player);
}

export const NEUTRAL_PASSIVE = 11;
export const NEUTRAL_AGGRESSIVE = 12;

/* ------------------------------------------------------------------ */
/* Races                                                              */
/* ------------------------------------------------------------------ */

export type RaceId = 'human' | 'orc' | 'undead' | 'night_elf' | 'neutral';

export interface RacePalette {
  /** primary wall / body colour of structures */
  wall: string;
  wallShade: string;
  roof: string;
  roofShade: string;
  /** timber / scaffolding */
  wood: string;
  woodShade: string;
  /** unit cloth */
  cloth: string;
  clothShade: string;
  /** metal (swords, armour plates) */
  metal: string;
  metalDark: string;
  /** skin tone */
  skin: string;
  /** glow / magic accent */
  accent: string;
  /** banner cloth before player tinting */
  banner: string;
}

export const RACES: Record<RaceId, RacePalette> = {
  human: {
    wall: '#8d8fa6', wallShade: '#5b5d75', roof: '#a03c3c', roofShade: '#662222',
    wood: '#7a5a34', woodShade: '#4a3620', cloth: '#3f6bc0', clothShade: '#24406f',
    metal: '#dfe4ee', metalDark: '#8b93a6', skin: '#e0b48c', accent: '#ffd45e', banner: '#c9ccd8',
  },
  orc: {
    wall: '#6f6a4a', wallShade: '#41402c', roof: '#7c4a2a', roofShade: '#4a2a16',
    wood: '#6b4a28', woodShade: '#3d2a16', cloth: '#8a3f2f', clothShade: '#57271d',
    metal: '#b9bda8', metalDark: '#6f7261', skin: '#7ea45c', accent: '#ff8a3c', banner: '#8f7a4a',
  },
  undead: {
    wall: '#5d6470', wallShade: '#333944', roof: '#4a5568', roofShade: '#282f3b',
    wood: '#4d4438', woodShade: '#2e281f', cloth: '#6f4f9c', clothShade: '#3d2b58',
    metal: '#aab3bd', metalDark: '#5e6772', skin: '#c8d6cf', accent: '#7ce0ff', banner: '#6b7a8f',
  },
  night_elf: {
    wall: '#6b5a7a', wallShade: '#3e3348', roof: '#3f6b58', roofShade: '#25413a',
    wood: '#5a4632', woodShade: '#332718', cloth: '#4a7a8c', clothShade: '#2b4752',
    metal: '#cfd8dc', metalDark: '#7d8b90', skin: '#b9c8d8', accent: '#9fe8ff', banner: '#7a6b8f',
  },
  neutral: {
    wall: '#7a7268', wallShade: '#4a453e', roof: '#6b6152', roofShade: '#3d372e',
    wood: '#6b5636', woodShade: '#3f3220', cloth: '#8a8577', clothShade: '#55524a',
    metal: '#c4c4bb', metalDark: '#75756d', skin: '#a89a86', accent: '#e8d48a', banner: '#8a8577',
  },
};

export function racePalette(race: string | undefined): RacePalette {
  return RACES[(race ?? 'neutral') as RaceId] ?? RACES.neutral;
}

/* ------------------------------------------------------------------ */
/* Terrain                                                            */
/* ------------------------------------------------------------------ */

export interface TerrainSwatch {
  base: string;
  light: string;
  dark: string;
  /** speckle colour mixed into the dither */
  speck: string;
}

export const TERRAIN: TerrainSwatch[] = [
  { base: '#6d7a44', light: '#84934f', dark: '#4d5730', speck: '#a8b06a' }, // ground
  { base: '#54752f', light: '#6d9440', dark: '#3a5322', speck: '#93bd5a' }, // grass
  { base: '#7a5f3c', light: '#94764c', dark: '#55401f', speck: '#b08a5c' }, // dirt
  { base: '#7d7466', light: '#9a9183', dark: '#4f493f', speck: '#bcb4a4' }, // cliff
  { base: '#2b5c86', light: '#3f7fae', dark: '#1b3d5c', speck: '#8fc6e8' }, // water
  { base: '#5c5a58', light: '#7b7876', dark: '#3b3a38', speck: '#9d9996' }, // rock
  { base: '#4a3a58', light: '#61496f', dark: '#2f2438', speck: '#8a6ba0' }, // blight
  { base: '#dfe8f0', light: '#ffffff', dark: '#b3c2cf', speck: '#a9d4f0' }, // snow
  { base: '#3a3a40', light: '#54545c', dark: '#222226', speck: '#6e6e78' }, // wall
];

export function terrainSwatch(tileId: number): TerrainSwatch {
  return TERRAIN[tileId] ?? TERRAIN[TILE_GROUND];
}

/** Tile ids that should be drawn with an animated/specular treatment. */
export const IS_WATER = TILE_WATER;
export const IS_CLIFF = TILE_CLIFF;

/* ------------------------------------------------------------------ */
/* UI / overlay                                                       */
/* ------------------------------------------------------------------ */

export const UI = {
  outline: '#1a1712',
  shadow: 'rgba(0,0,0,0.38)',
  selectionRing: '#4be04b',
  selectionRingSoft: 'rgba(120,255,120,0.35)',
  hoverRing: '#ffe08a',
  hpBack: '#160d0d',
  hpLow: '#ff3b30',
  hpFlash: '#ffffff',
  mpBar: '#3aa0ff',
  xpBar: '#efe07a',
  heroBadge: '#ffd45e',
  ghostOk: 'rgba(90,235,120,0.45)',
  ghostOkLine: '#5beb78',
  ghostBad: 'rgba(255,70,70,0.40)',
  ghostBadLine: '#ff5a5a',
  ghostNeutral: 'rgba(200,210,230,0.35)',
  scaffold: '#c9a25a',
  textShadow: '#000000',
  dmgPlayer: '#ffffff',
  dmgSelf: '#ff6b6b',
  crit: '#ffd45e',
  indicator: 'rgba(255,225,120,0.85)',
  fogUnexplored: '#000000',
} as const;

/** Per-tile fog overlay alpha (unexplored / expired / visible). */
export const FOG_ALPHA: [number, number, number] = [1, 0.55, 0];
/** Extra colour wash applied to "expired" tiles to desaturate them. */
export const FOG_EXPIRED_WASH = 'rgba(18,20,26,0.42)';

/* ------------------------------------------------------------------ */
/* Colour helpers (pure, unit-testable)                               */
/* ------------------------------------------------------------------ */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h.slice(0, 6), 16) | 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number): string => (n < 0 ? 0 : n > 255 ? 255 : n | 0).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two hex colours, `t` in 0..1 toward `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

/** Multiply a hex colour toward black (`amount` 0..1). */
export function shadeHex(hex: string, amount: number): string {
  return mixHex(hex, '#000000', amount);
}

/** Mix toward white. */
export function tintHex(hex: string, amount: number): string {
  return mixHex(hex, '#ffffff', amount);
}

/** Desaturated version, used for "previously seen" terrain tinting. */
export function desaturateHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const l = (r * 299 + g * 587 + b * 114) / 1000;
  return mixHex(hex, rgbToHex(l, l, l), amount < 0 ? 0 : amount > 1 ? 1 : amount);
}

/** rgba() string from a hex colour plus alpha. */
export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------------------------------------------------ */
/* Deterministic noise (render-only; never touches sim RNG)            */
/* ------------------------------------------------------------------ */

/** Stable hash of two integers -> 0..255. Same output every run. */
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return (h ^ (h >>> 16)) & 255;
}

/** Stable hash of a string -> uint32. */
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pseudo-random in [0,1) derived from a seed integer. */
export function rand01(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h >>> 8) / 16777216;
}

/** Ground tile id -> deterministic variant index 0..3 (texture selection). */
export function terrainVariant(tx: number, ty: number, tileId: number): number {
  return hash2(tx * 3 + tileId, ty * 5 - tileId) & 3;
}

/** Reference so tree-shaking keeps the tile constants meaningful. */
export const TERRAIN_IDS = {
  ground: TILE_GROUND, grass: TILE_GRASS, dirt: TILE_DIRT, cliff: TILE_CLIFF,
  water: TILE_WATER, rock: TILE_ROCK, blight: TILE_BLIGHT, snow: TILE_SNOW, wall: TILE_WALL,
} as const;
