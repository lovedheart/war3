/**
 * Building art: WC3-style 3/4 view — foundation slab, front wall with a door,
 * side wall in perspective, pitched or flat crenellated roof, plus a banner.
 * Under-construction buildings are drawn as a translucent timber skeleton.
 */
import type { DrawFn } from './spec.js';
import type { RacePalette } from '../palette.js';
import { racePalette, shadeHex, tintHex, withAlpha } from '../palette.js';
import { OUTLINE, banner, circle, crenels, ellipse, glow, poly, rect, rrect, shape, vgrad } from './common.js';

const ss = (ctx: CanvasRenderingContext2D, c: string, w: number): void => {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
};

interface Kind {
  /** tower-like (tall, spire) */
  tower?: boolean;
  hall?: boolean;
  farm?: boolean;
  mine?: boolean;
  organic?: boolean;
  altar?: boolean;
  market?: boolean;
  noRoof?: boolean;
  rise?: number;
}

const KINDS: Record<string, Kind> = {
  keep: { hall: true, rise: 0.5 },
  barracks: {}, strength: {}, shop_orc: {}, neruban: {}, watchtower_orc: {},
  farm: { farm: true },
  church: { tower: true, rise: 0.85 },
  forge: { rise: 0.42 },
  tower: { tower: true, rise: 1.05 },
  watchtower: { tower: true, rise: 0.95 },
  arcane: { tower: true, rise: 0.8 },
  great_hall: { hall: true, rise: 0.55 },
  altar_orc: { altar: true },
  spirit_lodge: { organic: true },
  crypt: { rise: 0.4 },
  ziggurat: { tower: true, rise: 0.9 },
  tomb: { rise: 0.55 },
  slaughter: { rise: 0.35 },
  temple_dark: { hall: true, rise: 0.62 },
  tree_life: { organic: true, rise: 0.7 },
  moonwell: { organic: true, altar: true },
  hunter_moon: { organic: true },
  ancient_protector: { organic: true, rise: 0.5 },
  chimera_across: { organic: true },
  goldmine: { mine: true },
  neutral_altar: { altar: true },
  market: { market: true },
  ruins: {},
};

export const drawBuilding: DrawFn = (ctx, spec, size) => {
  const s = size;
  const p = spec.pal ?? racePalette(spec.race);
  const k = KINDS[spec.shape] ?? {};
  // `spec.hero` doubles as the "under construction" ghost flag for buildings.
  if (spec.hero === true) { drawSkeleton(ctx, s, p); return; }

  const bw = s * 0.86;      // front width
  const bh = s * (k.tower ? 0.62 : 0.42); // front wall height
  const depth = s * 0.16;   // perspective offset

  /* foundation */
  shape(ctx, shadeHex(p.wallShade, 0.35), () => {
    poly(ctx, [-bw / 2, -bh * 0.06, bw / 2, -bh * 0.06, bw / 2 + depth, bh * 0.1, -bw / 2 + depth, bh * 0.1]);
  }, OUTLINE, 1.6);

  /* side wall (right face) */
  shape(ctx, p.wallShade, () => {
    poly(ctx, [bw / 2, -bh, bw / 2 + depth, -bh + bh * 0.16, bw / 2 + depth, bh * 0.1, bw / 2, 0]);
  }, OUTLINE, 1.4);

  /* front wall */
  shape(ctx, vgrad(ctx, 0, -bh, bw, bh, tintHex(p.wall, 0.1), p.wallShade), () => {
    rect(ctx, -bw / 2, -bh, bw, bh);
  }, OUTLINE, 1.6);

  if (k.organic) barkTexture(ctx, bw, bh, p);
  else stoneTexture(ctx, bw, bh, p);

  /* roof */
  const roofY = -bh;
  if (k.tower) {
    // conical spire
    shape(ctx, vgrad(ctx, 0, roofY - s * k.rise!, bw, s * k.rise!, tintHex(p.roof, 0.2), p.roofShade), () => {
      poly(ctx, [-bw * 0.56, roofY, bw * 0.56 + depth * 0.6, roofY - bh * 0.1, 0, roofY - s * k.rise!]);
    }, OUTLINE, 1.6);
    // pennant
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bw * 0.02, roofY - s * k.rise!);
    ctx.lineTo(bw * 0.02, roofY - s * k.rise! - s * 0.12);
    ss(ctx, OUTLINE, 1.6); ctx.stroke();
    banner(ctx, bw * 0.02, roofY - s * k.rise! - s * 0.12, s * 0.1, s * 0.13, p.cloth, p.clothShade);
    ctx.restore();
    windowSlit(ctx, 0, roofY - s * k.rise! * 0.45, s, p);
  } else if (k.noRoof) {
    crenels(ctx, -bw / 2, roofY, bw, s * 0.055, p.wallShade);
  } else {
    // pitched roof with a ridge
    const rise = s * (k.rise ?? 0.45);
    shape(ctx, p.roofShade, () => {
      poly(ctx, [-bw * 0.54, roofY, bw * 0.54 + depth, roofY - bh * 0.12, bw * 0.3 + depth, roofY - rise, -bw * 0.3, roofY - rise + bh * 0.12]);
    }, OUTLINE, 1.5);
    shape(ctx, vgrad(ctx, 0, roofY - rise, bw, rise, tintHex(p.roof, 0.15), p.roofShade), () => {
      poly(ctx, [-bw * 0.54, roofY, bw * 0.54, roofY - bh * 0.06, bw * 0.3, roofY - rise, -bw * 0.3, roofY - rise]);
    }, OUTLINE, 1.5);
    // ridge tiles
    ctx.beginPath();
    ctx.moveTo(-bw * 0.3, roofY - rise);
    ctx.lineTo(bw * 0.3, roofY - rise + bh * 0.06);
    ss(ctx, shadeHex(p.roofShade, 0.4), Math.max(1.2, s * 0.018)); ctx.stroke();
    if (k.hall) {
      // gable dormer windows
      for (const dx of [-0.24, 0.06]) windowSlit(ctx, bw * dx, roofY - rise * 0.45, s, p);
    }
  }

  /* door */
  if (!k.mine && !k.tower) {
    const dw = bw * 0.16, dh = bh * 0.62;
    shape(ctx, shadeHex(p.wood, 0.25), () => {
      ctx.moveTo(-dw / 2, 0); ctx.lineTo(-dw / 2, -dh * 0.7);
      ctx.quadraticCurveTo(0, -dh * 1.15, dw / 2, -dh * 0.7); ctx.lineTo(dw / 2, 0);
      ctx.closePath();
    }, OUTLINE, 1.4);
    ctx.save();
    ss(ctx, shadeHex(p.metalDark, 0.2), 1);
    ctx.beginPath();
    ctx.moveTo(-dw / 2, -dh * 0.45); ctx.lineTo(dw / 2, -dh * 0.45);
    ctx.stroke();
    ctx.restore();
  }

  /* special features */
  if (k.farm) farmBits(ctx, s, bw, bh, p);
  if (k.mine) mineBits(ctx, s, bw, bh, p);
  if (k.altar) altarBits(ctx, s, bw, bh, p);
  if (k.market) marketBits(ctx, s, bw, bh, p);
  if (spec.shape === 'forge') forgeBits(ctx, s, bw, bh, p);
  if (spec.shape === 'slaughter') slaughterBits(ctx, s, bw, bh, p);
  if (spec.shape === 'tree_life' || spec.shape === 'ancient_protector' || spec.shape === 'hunter_moon' || spec.shape === 'chimera_across' || spec.shape === 'moonwell') treeCrown(ctx, s, bw, bh, p);
  if (spec.shape === 'spirit_lodge') totemPoles(ctx, s, bw, bh, p);
  if (spec.shape === 'ziggurat') stepsOfZiggurat(ctx, s, bw, bh, p);
  if (spec.shape === 'tomb') obelisk(ctx, s, bw, bh, p);
  if (spec.shape === 'temple_dark') darkSpikes(ctx, s, bw, bh, p);
  if (k.tower) towerGun(ctx, s, bw, bh, p);

  /* faction banner on the front wall */
  if (!k.mine && !k.farm) {
    banner(ctx, -bw * 0.42, -bh * 0.98, bw * 0.15, bh * 0.5, p.banner, p.clothShade);
  }
};

/* ------------------------------------------------------------------ */
/* construction skeleton                                              */
/* ------------------------------------------------------------------ */

function drawSkeleton(ctx: CanvasRenderingContext2D, s: number, p: RacePalette): void {
  const bw = s * 0.8, bh = s * 0.42, depth = s * 0.14;
  ctx.save();
  ctx.globalAlpha = 0.42;
  shape(ctx, withAlpha(p.wood, 0.5), () => rect(ctx, -bw / 2, -bh, bw, bh));
  ctx.restore();
  // vertical posts
  ctx.save();
  ss(ctx, '#c9a25a', Math.max(1.4, s * 0.018));
  for (const x of [-bw / 2, -bw / 6, bw / 6, bw / 2]) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -bh); ctx.stroke();
  }
  // horizontals
  for (const y of [0, -bh * 0.5, -bh]) {
    ctx.beginPath(); ctx.moveTo(-bw / 2, y); ctx.lineTo(bw / 2 + depth, y + bh * 0.16); ctx.stroke();
  }
  // diagonals
  ss(ctx, '#a9853f', Math.max(1, s * 0.012));
  ctx.beginPath();
  ctx.moveTo(-bw / 2, 0); ctx.lineTo(0, -bh);
  ctx.moveTo(0, 0); ctx.lineTo(bw / 2, -bh);
  ctx.stroke();
  ctx.restore();
  // scaffolding poles with platform
  ctx.save();
  ctx.globalAlpha = 0.85;
  ss(ctx, '#8a6b34', Math.max(1.2, s * 0.014));
  ctx.beginPath();
  ctx.moveTo(-bw * 0.56, 0); ctx.lineTo(-bw * 0.56, -bh * 1.25);
  ctx.moveTo(bw * 0.56, 0); ctx.lineTo(bw * 0.56, -bh * 1.25);
  ctx.stroke();
  ctx.fillStyle = '#b08d48';
  ctx.fillRect(-bw * 0.58, -bh * 1.3, bw * 1.16, s * 0.025);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* textures & details                                                   */
/* ------------------------------------------------------------------ */

function stoneTexture(ctx: CanvasRenderingContext2D, bw: number, bh: number, p: RacePalette): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(-bw / 2, -bh, bw, bh); ctx.clip();
  ss(ctx, shadeHex(p.wallShade, 0.45), 1);
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = -bh + (r * bh) / rows;
    ctx.beginPath(); ctx.moveTo(-bw / 2, y); ctx.lineTo(bw / 2, y); ctx.stroke();
    const off = r % 2 ? bw * 0.09 : 0;
    for (let c = 0; c < 6; c++) {
      const x = -bw / 2 + off + (c * bw) / 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh / rows); ctx.stroke();
    }
  }
  ctx.restore();
}

function barkTexture(ctx: CanvasRenderingContext2D, bw: number, bh: number, p: RacePalette): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(-bw / 2, -bh, bw, bh); ctx.clip();
  ss(ctx, shadeHex(p.wood, 0.45), 1.2);
  for (let i = 0; i < 7; i++) {
    const x = -bw / 2 + (i * bw) / 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + bw * 0.02, -bh * 0.5, x, -bh);
    ctx.stroke();
  }
  ctx.restore();
}

function windowSlit(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, p: RacePalette): void {
  shape(ctx, withAlpha(p.accent, 0.85), () => rrect(ctx, x - s * 0.022, y - s * 0.05, s * 0.044, s * 0.1, s * 0.02), OUTLINE, 1);
  glow(ctx, x, y, s * 0.06, p.accent, 0.35);
}

function farmBits(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, _p: RacePalette): void {
  // hay bale + fence
  shape(ctx, '#d9bd63', () => ellipse(ctx, -bw * 0.3, -bh * 0.12, s * 0.075, s * 0.05));
  ctx.save();
  ss(ctx, '#8a6b34', 1.4);
  for (let i = 0; i < 4; i++) {
    const x = bw * 0.08 + i * s * 0.06;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -bh * 0.3); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(bw * 0.08, -bh * 0.22); ctx.lineTo(bw * 0.08 + s * 0.18, -bh * 0.22); ctx.stroke();
  ctx.restore();
}

function mineBits(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, _p: RacePalette): void {
  // rock mound with a lit cave mouth and gold veins
  shape(ctx, '#5c5a58', () => {
    ctx.moveTo(-bw * 0.5, 0);
    ctx.quadraticCurveTo(-bw * 0.34, -bh * 1.5, 0, -bh * 1.6);
    ctx.quadraticCurveTo(bw * 0.36, -bh * 1.5, bw * 0.5, 0);
    ctx.closePath();
  }, OUTLINE, 1.6);
  shape(ctx, '#151a20', () => {
    ctx.moveTo(-bw * 0.14, 0);
    ctx.quadraticCurveTo(0, -bh * 0.8, bw * 0.14, 0);
    ctx.closePath();
  }, '#2a2a30', 1.2);
  for (const [vx, vy] of [[-0.3, -0.7], [0.22, -0.95], [0.34, -0.5], [-0.12, -1.15]] as const) {
    glow(ctx, bw * vx, bh * vy, s * 0.05, '#ffd45e', 0.85);
    shape(ctx, '#ffd45e', () => rect(ctx, bw * vx - s * 0.015, bh * vy - s * 0.012, s * 0.03, s * 0.024), '#8a6a1a', 0.8);
  }
}

function altarBits(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  shape(ctx, tintHex(p.wall, 0.1), () => poly(ctx, [-bw * 0.34, 0, bw * 0.34, 0, bw * 0.26, -bh * 0.34, -bw * 0.26, -bh * 0.34]));
  shape(ctx, tintHex(p.wall, 0.18), () => poly(ctx, [-bw * 0.24, -bh * 0.34, bw * 0.24, -bh * 0.34, bw * 0.18, -bh * 0.62, -bw * 0.18, -bh * 0.62]));
  glow(ctx, 0, -bh * 0.86, s * 0.2, p.accent, 0.7);
  shape(ctx, p.accent, () => poly(ctx, [0, -bh * 1.15, s * 0.05, -bh * 0.86, -s * 0.05, -bh * 0.86]));
}

function marketBits(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  // striped awning
  ctx.save();
  const aw = bw * 0.9, ah = bh * 0.3;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#d8d2c0' : '#b04a3a';
    ctx.fillRect(-aw / 2 + (i * aw) / 6, -bh * 1.02, aw / 6, ah);
  }
  ss(ctx, OUTLINE, 1);
  ctx.strokeRect(-aw / 2, -bh * 1.02, aw, ah);
  ctx.restore();
  for (const x of [-bw * 0.42, bw * 0.42]) {
    ctx.fillStyle = p.wood; ctx.fillRect(x - s * 0.012, -bh * 1.05, s * 0.024, bh);
  }
  void s;
}

function forgeBits(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  // chimney with ember glow
  shape(ctx, p.wallShade, () => rect(ctx, bw * 0.22, -bh * 1.9, bw * 0.14, bh * 1.1));
  glow(ctx, bw * 0.29, -bh * 1.95, s * 0.09, '#ff8a3c', 0.7);
  // anvil silhouette
  shape(ctx, p.metalDark, () => poly(ctx, [-bw * 0.3, -bh * 0.1, -bw * 0.12, -bh * 0.1, -bw * 0.16, -bh * 0.28, -bw * 0.26, -bh * 0.28]));
}

function slaughterBits(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, _p: RacePalette): void {
  shape(ctx, '#9c4a4a', () => poly(ctx, [bw * 0.2, -bh * 0.2, bw * 0.42, -bh * 0.2, bw * 0.36, -bh * 0.9, bw * 0.26, -bh * 0.9]));
  ctx.save();
  ss(ctx, '#c47a72', 1.4);
  ctx.beginPath(); ctx.moveTo(bw * 0.3, -bh * 0.9); ctx.lineTo(bw * 0.3, -bh * 1.2); ctx.stroke();
  ctx.restore();
  void s;
}

function treeCrown(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  const leafA = specLeaf(p);
  for (const [cx, cy, r] of [[-0.22, -1.5, 0.26], [0.2, -1.62, 0.3], [0, -1.9, 0.28], [-0.05, -1.25, 0.22]] as const) {
    shape(ctx, leafA, () => ellipse(ctx, bw * cx, bh * cy, s * r * 0.6, s * r * 0.44), OUTLINE, 1.4);
  }
  glow(ctx, 0, -bh * 1.5, s * 0.14, p.accent, 0.3);
}

function specLeaf(p: RacePalette): string {
  if (p.roof === RACE_ROOF_UD) return '#4a5f52';
  return shadeHex(p.roof, 0.05);
}
const RACE_ROOF_UD = '#4a5568';

function totemPoles(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  for (const x of [-bw * 0.36, bw * 0.36]) {
    shape(ctx, p.wood, () => rect(ctx, x - s * 0.03, -bh * 1.7, s * 0.06, bh * 1.7));
    shape(ctx, '#d95f3b', () => poly(ctx, [x - s * 0.05, -bh * 1.7, x + s * 0.05, -bh * 1.7, x, -bh * 2.0]), OUTLINE, 1);
    shape(ctx, '#e8d9a0', () => circle(ctx, x, -bh * 1.45, s * 0.025));
  }
}

function stepsOfZiggurat(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    shape(ctx, i % 2 ? p.wall : tintHex(p.wall, 0.1), () => {
      rect(ctx, -bw * (0.42 - t * 0.1), -bh - i * bh * 0.34, bw * (0.84 - t * 0.2), bh * 0.36);
    }, OUTLINE, 1.2);
  }
  glow(ctx, 0, -bh * 2.05, s * 0.1, p.accent, 0.6);
}

function obelisk(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  shape(ctx, tintHex(p.wall, 0.12), () => poly(ctx, [-bw * 0.07, -bh * 0.6, bw * 0.07, -bh * 0.6, bw * 0.045, -bh * 2.1, -bw * 0.045, -bh * 2.1]), OUTLINE, 1.4);
  glow(ctx, 0, -bh * 2.15, s * 0.08, p.accent, 0.7);
}

function darkSpikes(ctx: CanvasRenderingContext2D, s: number, bw: number, bh: number, p: RacePalette): void {
  for (const x of [-0.4, -0.14, 0.14, 0.4]) {
    shape(ctx, p.wallShade, () => poly(ctx, [bw * x - s * 0.025, -bh * 0.9, bw * x + s * 0.025, -bh * 0.9, bw * x, -bh * 1.7]), OUTLINE, 1.2);
  }
  glow(ctx, 0, -bh * 1.1, s * 0.12, p.accent, 0.4);
}

function towerGun(ctx: CanvasRenderingContext2D, s: number, _bw: number, bh: number, p: RacePalette): void {
  // small ballista / spire emitter at the top so towers read as attackers
  ctx.save();
  ctx.translate(0, -bh * 1.02);
  shape(ctx, p.wood, () => rect(ctx, -s * 0.06, -s * 0.03, s * 0.12, s * 0.06));
  ss(ctx, p.metalDark, Math.max(1.2, s * 0.014));
  ctx.beginPath();
  ctx.moveTo(-s * 0.09, -s * 0.05); ctx.lineTo(s * 0.09, -s * 0.05);
  ctx.stroke();
  ctx.restore();
}
