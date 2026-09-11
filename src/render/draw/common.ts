/**
 * Primitive helpers shared by every draw function.
 *
 * Convention: a draw function receives a context already translated so that
 * (0,0) is the sprite's ground anchor (feet / building centre) and must paint
 * inside a box of `size` px centred horizontally, extending upward.
 */
import type { Ctx2D } from './spec.js';
import { withAlpha } from '../palette.js';

export const OUTLINE = '#1a1712';
export const OUTLINE_W = 1.6;

export function setStroke(ctx: Ctx2D, color: string, w = OUTLINE_W): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

/** Filled + outlined path helper: pass a closure that builds the path. */
export function shape(ctx: Ctx2D, fill: string | CanvasGradient, build: () => void, outline = OUTLINE, lw = OUTLINE_W): void {
  ctx.save();
  build();
  ctx.fillStyle = fill;
  ctx.fill();
  setStroke(ctx, outline, lw);
  ctx.stroke();
  ctx.restore();
}

export function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

export function rrect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function circle(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2);
}

export function ellipse(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

export function poly(ctx: Ctx2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** Vertical two-stop gradient fill inside a rect. */
export function vgrad(ctx: Ctx2D, x: number, y: number, _w: number, h: number, top: string, bottom: string): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/** Contact shadow ellipse under an entity. */
export function shadowBlob(ctx: Ctx2D, rx: number, ry: number, alpha = 0.38): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000000';
  ellipse(ctx, 0, 0, rx, ry);
  ctx.fill();
  ctx.restore();
}

/** WC3-style pennant banner hanging on a wall, tinted with the player colour. */
export function banner(ctx: Ctx2D, x: number, y: number, w: number, h: number, cloth: string, edge: string): void {
  ctx.save();
  poly(ctx, [x, y, x + w, y, x + w, y + h, x + w / 2, y + h * 0.78, x, y + h]);
  ctx.fillStyle = cloth;
  ctx.fill();
  setStroke(ctx, edge, 1);
  ctx.stroke();
  // highlight fold
  ctx.globalAlpha = 0.25;
  poly(ctx, [x + w * 0.15, y, x + w * 0.45, y, x + w * 0.45, y + h * 0.9, x + w * 0.3, y + h * 0.7]);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

/** Small heraldic shield used as the faction emblem on units/buildings. */
export function crest(ctx: Ctx2D, cx: number, cy: number, r: number, fill: string, ring: string): void {
  ctx.save();
  poly(ctx, [cx - r, cy - r, cx + r, cy - r, cx + r, cy + r * 0.25, cx, cy + r * 1.15, cx - r, cy + r * 0.25]);
  ctx.fillStyle = fill;
  ctx.fill();
  setStroke(ctx, ring, 1);
  ctx.stroke();
  ctx.restore();
}

/** Gold hero badge with level digit drawn at (cx, cy). */
export function heroBadge(ctx: Ctx2D, cx: number, cy: number, r: number, level: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  // 8-point star
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const rr = i % 2 === 0 ? r : r * 0.55;
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffd45e';
  ctx.fill();
  setStroke(ctx, '#6b4b00', 1);
  ctx.stroke();
  if (level > 0) {
    ctx.fillStyle = '#2a1c00';
    ctx.font = `bold ${Math.round(r * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(level), 0, r * 0.08);
  }
  ctx.restore();
}

/** Diagonal hatch fill (scaffolding / construction). */
export function hatch(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string, step = 8): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  setStroke(ctx, color, 1);
  ctx.beginPath();
  for (let i = -h; i < w + h; i += step) {
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

/** Dither speckle over a rect using a stable hash (no RNG state). */
export function speckle(
  ctx: Ctx2D, x: number, y: number, w: number, h: number,
  color: string, count: number, seedX: number, seedY: number, dot = 1.5,
): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const hx = hashi(seedX + i * 37, seedY + i * 91);
    const hy = hashi(seedX - i * 53, seedY + i * 17);
    ctx.fillRect(x + (hx % Math.max(1, w | 0)), y + (hy % Math.max(1, h | 0)), dot, dot);
  }
  ctx.restore();
}

function hashi(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  return (h ^ (h >>> 16)) & 0x7fffffff;
}

/** Soft radial glow (used by magic, torches, spell indicators). */
export function glow(ctx: Ctx2D, cx: number, cy: number, r: number, color: string, alpha = 0.5): void {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.5, r));
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  circle(ctx, cx, cy, r);
  ctx.fill();
  ctx.restore();
}

/** Ground contact ellipse for buildings (foundation slab). */
export function foundation(ctx: Ctx2D, w: number, h: number, top: string, bottom: string): void {
  shape(ctx, bottom, () => {
    poly(ctx, [-w / 2, -h * 0.06, w / 2, -h * 0.06, w * 0.44, h * 0.12, -w * 0.44, h * 0.12]);
  }, OUTLINE, 1.4);
  ctx.save();
  poly(ctx, [-w / 2, -h * 0.06, w / 2, -h * 0.06, w * 0.44, h * 0.12, -w * 0.44, h * 0.12]);
  ctx.fillStyle = vgrad(ctx, 0, -h * 0.06, w, h * 0.18, top, bottom);
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.restore();
}

/** Crenellated parapet along a wall top edge. */
export function crenels(ctx: Ctx2D, x: number, y: number, w: number, merlon: number, fill: string): void {
  const n = Math.max(2, Math.floor(w / (merlon * 2)));
  const step = w / n;
  ctx.save();
  ctx.fillStyle = fill;
  for (let i = 0; i < n; i++) {
    const mx = x + i * step;
    ctx.fillRect(mx, y - merlon, step * 0.55, merlon);
  }
  setStroke(ctx, OUTLINE, 1);
  for (let i = 0; i < n; i++) {
    const mx = x + i * step;
    ctx.strokeRect(mx, y - merlon, step * 0.55, merlon);
  }
  ctx.restore();
}

/** Pointed roof over a building footprint. */
export function roofPeak(ctx: Ctx2D, w: number, yBase: number, rise: number, front: string, side: string): void {
  const half = w / 2;
  shape(ctx, side, () => poly(ctx, [-half * 0.98, yBase, half * 0.98, yBase, half * 0.5, yBase - rise, -half * 0.5, yBase - rise]));
  shape(ctx, front, () => poly(ctx, [-half * 0.5, yBase - rise, half * 0.5, yBase - rise, 0, yBase - rise - rise * 0.55]));
}

/** Simple humanoid torso+head silhouette used as base by most unit shapes. */
export function body(
  ctx: Ctx2D, s: number, cloth: string, clothDark: string, skin: string,
  opts: { bulk?: number; height?: number } = {},
): { headY: number; shoulderY: number; bw: number } {
  const bulk = opts.bulk ?? 1;
  const hh = opts.height ?? 1;
  const bw = s * 0.34 * bulk;
  const bodyTop = -s * 0.52 * hh;
  const bodyBot = -s * 0.1;
  shape(ctx,vgrad(ctx, 0, bodyTop, bw, bodyBot - bodyTop, cloth, clothDark), () => {
    poly(ctx, [-bw, bodyTop + s * 0.06, bw, bodyTop + s * 0.06, bw * 0.82, bodyBot, -bw * 0.82, bodyBot]);
  });
  const headY = bodyTop - s * 0.09;
  shape(ctx, skin, () => circle(ctx, 0, headY, s * 0.115));
  const shoulderY = bodyTop + s * 0.02;
  return { headY, shoulderY, bw };
}

/** Legs: two tapered stumps. */
export function legs(ctx: Ctx2D, s: number, color: string, spread = 0.16): void {
  for (const sign of [-1, 1]) {
    shape(ctx, color, () => poly(ctx, [sign * s * spread - s * 0.05, -s * 0.12, sign * s * spread + s * 0.05, -s * 0.12, sign * s * spread + s * 0.045, 0, sign * s * spread - s * 0.045, 0]), OUTLINE, 1.1);
  }
}

/** Blade weapon drawn from (x,y) toward up-right. */
export function sword(ctx: Ctx2D, x: number, y: number, len: number, metal: string, metalDark: string, hilt = '#5a4632'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5);
  shape(ctx, metal, () => poly(ctx, [-len * 0.06, 0, len * 0.06, 0, len * 0.045, -len * 0.86, 0, -len, -len * 0.045, -len * 0.86]));
  ctx.fillStyle = metalDark;
  ctx.fillRect(-len * 0.2, -len * 0.02, len * 0.4, len * 0.06);
  ctx.fillStyle = hilt;
  ctx.fillRect(-len * 0.04, 0, len * 0.08, len * 0.2);
  ctx.restore();
}

/** Axe head + haft. */
export function axe(ctx: Ctx2D, x: number, y: number, len: number, metal: string, wood: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);
  ctx.fillStyle = wood;
  ctx.fillRect(-len * 0.035, -len * 0.9, len * 0.07, len);
  setStroke(ctx, OUTLINE, 1);
  ctx.strokeRect(-len * 0.035, -len * 0.9, len * 0.07, len);
  shape(ctx, metal, () => poly(ctx, [0, -len * 0.9, len * 0.34, -len * 0.78, len * 0.34, -len * 0.52, 0, -len * 0.6]));
  ctx.restore();
}

/** Bow or crossbow arc. */
export function bow(ctx: Ctx2D, x: number, y: number, len: number, wood: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.arc(0, -len * 0.5, len * 0.5, -Math.PI * 0.85, Math.PI * 0.85, true);
  setStroke(ctx, wood, Math.max(1.4, len * 0.06));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len * 0.06, -len);
  ctx.lineTo(len * 0.06, 0);
  setStroke(ctx, '#e8e2cf', 0.9);
  ctx.stroke();
  ctx.restore();
}

/** Long gun barrel (musket/rifle). */
export function gun(ctx: Ctx2D, x: number, y: number, len: number, metal: string, wood: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.fillStyle = wood;
  ctx.fillRect(-len * 0.1, -len * 0.06, len * 0.34, len * 0.12);
  ctx.fillStyle = metal;
  ctx.fillRect(len * 0.1, -len * 0.045, len * 0.9, len * 0.09);
  setStroke(ctx, OUTLINE, 1);
  ctx.strokeRect(len * 0.1, -len * 0.045, len * 0.9, len * 0.09);
  ctx.restore();
}

/** Staff with glowing tip. */
export function staff(ctx: Ctx2D, x: number, y: number, len: number, wood: string, glowColor: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.16);
  ctx.fillStyle = wood;
  ctx.fillRect(-len * 0.035, -len, len * 0.07, len);
  setStroke(ctx, OUTLINE, 1);
  ctx.strokeRect(-len * 0.035, -len, len * 0.07, len);
  glow(ctx, 0, -len * 1.05, len * 0.24, glowColor, 0.75);
  shape(ctx, glowColor, () => circle(ctx, 0, -len * 1.05, len * 0.09));
  ctx.restore();
}

/** Pair of wings (dragons, bats, gargoyle, Naga hydra-ish silhouettes). */
export function wings(ctx: Ctx2D, s: number, y: number, membrane: string, span = 1): void {
  for (const sign of [-1, 1]) {
    shape(ctx, membrane, () => {
      poly(ctx, [
        sign * s * 0.08, y,
        sign * s * 0.62 * span, y - s * 0.42,
        sign * s * 0.7 * span, y - s * 0.12,
        sign * s * 0.44 * span, y - s * 0.02,
        sign * s * 0.6 * span, y + s * 0.1,
        sign * s * 0.2 * span, y + s * 0.12,
      ]);
    }, OUTLINE, 1.2);
  }
}

/** Four-legged animal body (wolf, bear, deer, hippogryph body). */
export function quadruped(ctx: Ctx2D, s: number, fur: string, furDark: string, opts: { legs?: number; neck?: number } = {}): { backY: number; headX: number } {
  const legN = opts.legs ?? 4;
  const neck = opts.neck ?? 0.3;
  const bl = -s * 0.3, br = s * 0.3;
  shape(ctx,vgrad(ctx, 0, -s * 0.46, s, s * 0.3, fur, furDark), () => {
    poly(ctx, [bl, -s * 0.3, br, -s * 0.3, br * 0.92, -s * 0.12, bl * 0.92, -s * 0.12]);
  });
  const legW = s * 0.055;
  for (let i = 0; i < legN; i++) {
    const lx = bl * 0.85 + (i / Math.max(1, legN - 1)) * (br * 1.7 - bl * 0.85);
    shape(ctx, furDark, () => poly(ctx, [lx - legW, -s * 0.14, lx + legW, -s * 0.14, lx + legW * 0.8, 0, lx - legW * 0.8, 0]), OUTLINE, 1);
  }
  const backY = -s * 0.32;
  const headX = br + s * 0.12;
  shape(ctx, fur, () => poly(ctx, [br * 0.7, backY, headX, backY - s * neck, headX + s * 0.08, backY - s * neck + s * 0.06, br * 0.85, backY + s * 0.1]));
  shape(ctx, fur, () => ellipse(ctx, headX + s * 0.06, backY - s * neck + s * 0.03, s * 0.1, s * 0.075));
  return { backY, headX };
}

/** Horse body for riders (rider sits at (-s*0.02, -s*0.5)). */
export function horse(ctx: Ctx2D, s: number, coat: string, coatDark: string, mane: string): { seatY: number } {
  shape(ctx,vgrad(ctx, 0, -s * 0.5, s, s * 0.32, coat, coatDark), () => {
    poly(ctx, [-s * 0.36, -s * 0.34, s * 0.24, -s * 0.36, s * 0.3, -s * 0.2, -s * 0.3, -s * 0.16]);
  });
  for (const lx of [-s * 0.3, -s * 0.14, s * 0.1, s * 0.24]) {
    shape(ctx, coatDark, () => poly(ctx, [lx - s * 0.04, -s * 0.2, lx + s * 0.04, -s * 0.2, lx + s * 0.035, 0, lx - s * 0.035, 0]), OUTLINE, 1);
  }
  // neck + head
  shape(ctx, coat, () => poly(ctx, [s * 0.18, -s * 0.36, s * 0.42, -s * 0.62, s * 0.5, -s * 0.56, s * 0.3, -s * 0.3]));
  shape(ctx, coat, () => ellipse(ctx, s * 0.47, -s * 0.6, s * 0.1, s * 0.06));
  shape(ctx, mane, () => poly(ctx, [s * 0.2, -s * 0.38, s * 0.38, -s * 0.64, s * 0.32, -s * 0.62, s * 0.16, -s * 0.36]), OUTLINE, 1);
  // tail
  shape(ctx, mane, () => poly(ctx, [-s * 0.36, -s * 0.34, -s * 0.52, -s * 0.16, -s * 0.42, -s * 0.16, -s * 0.3, -s * 0.28]), OUTLINE, 1);
  return { seatY: -s * 0.4 };
}

/** Cloak/robe cone (casters, heroes). */
export function robe(ctx: Ctx2D, s: number, top: string, bottom: string, flare = 1): void {
  shape(ctx,vgrad(ctx, 0, -s * 0.56, s, s * 0.5, top, bottom), () => {
    poly(ctx, [-s * 0.14, -s * 0.56, s * 0.14, -s * 0.56, s * 0.26 * flare, -s * 0.02, -s * 0.26 * flare, -s * 0.02]);
  });
}

/** Horned helmet cap. */
export function helm(ctx: Ctx2D, cx: number, cy: number, r: number, metal: string, horn: string): void {
  shape(ctx, metal, () => ctx.arc(cx, cy, r, Math.PI, 0));
  ctx.beginPath();
  ctx.rect(cx - r, cy - r * 0.1, r * 2, r * 0.4);
  ctx.fillStyle = metal;
  ctx.fill();
  setStroke(ctx, OUTLINE, 1);
  ctx.stroke();
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sign * r * 0.9, cy - r * 0.2);
    ctx.quadraticCurveTo(cx + sign * r * 1.8, cy - r * 1.1, cx + sign * r * 1.1, cy - r * 1.5);
    setStroke(ctx, horn, Math.max(1.2, r * 0.28));
    ctx.stroke();
  }
}
