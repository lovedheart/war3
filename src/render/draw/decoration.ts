/**
 * Map decorations: trees (three seasonal/blight variants), pines, rocks,
 * ruins, crystals, torches, bridges and walls. Baseline at y = 0.
 */
import type { DrawFn } from './spec.js';
import { racePalette, shadeHex, tintHex, withAlpha } from '../palette.js';
import { OUTLINE, circle, ellipse, glow, hatch, poly, rect, shape } from './common.js';

const ss = (ctx: CanvasRenderingContext2D, c: string, w: number): void => {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
};

export const drawDecoration: DrawFn = (ctx, spec, size) => {
  const s = size;
  const p = spec.pal ?? racePalette(spec.race);

  switch (spec.shape) {
    case 'tree':
    case 'tree_blight':
    case 'tree_dead': {
      const blight = spec.shape === 'tree_blight';
      const dead = spec.shape === 'tree_dead';
      const trunk = blight ? '#4a3a52' : dead ? '#5a5048' : p.woodShade;
      const leaf = blight ? '#6b4f80' : shadeHex(p.roof, 0.1);
      // trunk with a slight lean
      shape(ctx, trunk, () => {
        poly(ctx, [-s * 0.05, 0, s * 0.05, 0, s * 0.035, -s * 0.42, -s * 0.03, -s * 0.44]);
      }, OUTLINE, 1.4);
      if (dead) {
        for (const [x1, y1, x2, y2] of [[0, -0.4, -0.22, -0.6], [0, -0.46, 0.2, -0.66], [0, -0.52, -0.12, -0.72]] as const) {
          ctx.beginPath(); ctx.moveTo(s * x1, s * y1); ctx.lineTo(s * x2, s * y2);
          ss(ctx, trunk, Math.max(1.4, s * 0.022)); ctx.stroke();
        }
      } else {
        // three overlapping canopy blobs
        for (const [cx, cy, r] of [[-0.16, -0.56, 0.2], [0.15, -0.6, 0.22], [0, -0.78, 0.24]] as const) {
          shape(ctx, leaf, () => ellipse(ctx, s * cx, s * cy, s * r, s * r * 0.8), OUTLINE, 1.4);
        }
        // sun highlight
        ctx.save();
        ctx.globalAlpha = 0.22;
        shape(ctx, tintHex(leaf, 0.5), () => ellipse(ctx, s * 0.06, -s * 0.84, s * 0.12, s * 0.08));
        ctx.restore();
        if (blight) glow(ctx, 0, -s * 0.66, s * 0.22, '#9a5fd8', 0.22);
      }
      break;
    }
    case 'pine': {
      shape(ctx, p.woodShade, () => rect(ctx, -s * 0.035, -s * 0.3, s * 0.07, s * 0.3));
      for (let i = 0; i < 3; i++) {
        const t = i / 3;
        shape(ctx, shadeHex(p.roof, 0.15 + t * 0.15), () => {
          poly(ctx, [-s * (0.26 - t * 0.06), -s * (0.3 + t * 0.2), s * (0.26 - t * 0.06), -s * (0.3 + t * 0.2), 0, -s * (0.62 + t * 0.2)]);
        }, OUTLINE, 1.3);
      }
      break;
    }
    case 'shrub': {
      for (const [cx, r] of [[-0.1, 0.13], [0.09, 0.15], [0, 0.11]] as const) {
        shape(ctx, shadeHex(p.roof, 0.05), () => ellipse(ctx, s * cx, -s * 0.12, s * r, s * r * 0.8), OUTLINE, 1.2);
      }
      break;
    }
    case 'rock':
    case 'boulder': {
      shape(ctx, '#7b7876', () => {
        poly(ctx, [-s * 0.26, 0, -s * 0.18, -s * 0.2, 0, -s * 0.28, s * 0.2, -s * 0.18, s * 0.26, 0]);
      }, OUTLINE, 1.5);
      ctx.save();
      ctx.globalAlpha = 0.35;
      shape(ctx, '#a5a19c', () => poly(ctx, [-s * 0.16, -s * 0.16, 0, -s * 0.26, s * 0.06, -s * 0.18]), OUTLINE, 1);
      ctx.restore();
      break;
    }
    case 'ruins': {
      shape(ctx, '#8a8577', () => rect(ctx, -s * 0.28, -s * 0.3, s * 0.2, s * 0.3));
      shape(ctx, '#7a7466', () => rect(ctx, s * 0.04, -s * 0.46, s * 0.18, s * 0.46));
      hatch(ctx, -s * 0.28, -s * 0.3, s * 0.2, s * 0.3, '#5a554b', 6);
      shape(ctx, '#6b665c', () => poly(ctx, [-s * 0.06, 0, s * 0.04, -s * 0.14, s * 0.1, 0]));
      break;
    }
    case 'crystal': {
      glow(ctx, 0, -s * 0.4, s * 0.36, p.accent, 0.5);
      for (const [cx, h, w] of [[-0.12, 0.42, 0.07], [0.02, 0.66, 0.1], [0.16, 0.34, 0.06]] as const) {
        shape(ctx, withAlpha(tintHex(p.accent, 0.35), 0.9), () => {
          poly(ctx, [s * cx - s * w, -s * 0.04, s * cx + s * w, -s * 0.04, s * cx + s * w * 0.5, -s * h, s * cx - s * w * 0.5, -s * h * 0.8]);
        }, OUTLINE, 1.2);
      }
      break;
    }
    case 'torch': {
      shape(ctx, p.woodShade, () => rect(ctx, -s * 0.03, -s * 0.42, s * 0.06, s * 0.42));
      glow(ctx, 0, -s * 0.52, s * 0.26, '#ff9a3c', 0.7);
      shape(ctx, '#ffd45e', () => {
        ctx.moveTo(-s * 0.06, -s * 0.46);
        ctx.quadraticCurveTo(0, -s * 0.72, s * 0.06, -s * 0.46);
        ctx.closePath();
      }, '#c05a10', 1);
      break;
    }
    case 'bridge': {
      shape(ctx, p.wood, () => rect(ctx, -s * 0.5, -s * 0.14, s, s * 0.14), OUTLINE, 1.4);
      ss(ctx, shadeHex(p.wood, 0.4), 1);
      ctx.beginPath();
      for (let i = 1; i < 6; i++) { ctx.moveTo(-s * 0.5 + (i * s) / 6, -s * 0.14); ctx.lineTo(-s * 0.5 + (i * s) / 6, 0); }
      ctx.stroke();
      ss(ctx, p.metalDark, Math.max(1.4, s * 0.016));
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.2); ctx.lineTo(s * 0.5, -s * 0.2);
      ctx.stroke();
      break;
    }
    case 'wall': {
      shape(ctx, p.wall, () => rect(ctx, -s * 0.5, -s * 0.34, s, s * 0.34), OUTLINE, 1.5);
      ss(ctx, shadeHex(p.wallShade, 0.4), 1);
      ctx.beginPath();
      for (let i = 1; i < 5; i++) { ctx.moveTo(-s * 0.5 + (i * s) / 5, -s * 0.34); ctx.lineTo(-s * 0.5 + (i * s) / 5, 0); }
      ctx.moveTo(-s * 0.5, -s * 0.17); ctx.lineTo(s * 0.5, -s * 0.17);
      ctx.stroke();
      // crenels
      for (let i = 0; i < 4; i++) {
        shape(ctx, p.wallShade, () => rect(ctx, -s * 0.5 + i * s * 0.25, -s * 0.44, s * 0.13, s * 0.1), OUTLINE, 1);
      }
      break;
    }
    case 'stump': {
      shape(ctx, p.woodShade, () => ellipse(ctx, 0, -s * 0.06, s * 0.13, s * 0.07));
      shape(ctx, tintHex(p.wood, 0.2), () => ellipse(ctx, 0, -s * 0.1, s * 0.11, s * 0.05), OUTLINE, 1);
      break;
    }
    case 'monolith': {
      shape(ctx, '#6b6152', () => poly(ctx, [-s * 0.12, 0, s * 0.12, 0, s * 0.09, -s * 0.7, -s * 0.09, -s * 0.7]), OUTLINE, 1.5);
      glow(ctx, 0, -s * 0.5, s * 0.14, p.accent, 0.45);
      break;
    }
    default: {
      shape(ctx, p.woodShade, () => rect(ctx, -s * 0.04, -s * 0.3, s * 0.08, s * 0.3), OUTLINE, 1.2);
      shape(ctx, shadeHex(p.roof, 0.1), () => circle(ctx, 0, -s * 0.42, s * 0.16), OUTLINE, 1.3);
      break;
    }
  }
};
