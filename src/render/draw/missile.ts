/**
 * Projectiles / missiles. Drawn pointing along +x (the renderer rotates the
 * sprite to the velocity heading), centred on (0,0).
 */
import type { DrawFn } from './spec.js';
import { racePalette, tintHex, withAlpha } from '../palette.js';
import { OUTLINE, circle, ellipse, glow, poly, shape } from './common.js';

const ss = (ctx: CanvasRenderingContext2D, c: string, w: number): void => {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
};

export const drawMissile: DrawFn = (ctx, spec, size) => {
  const s = size;
  const p = spec.pal ?? racePalette(spec.race);

  switch (spec.shape) {
    case 'arrow':
    case 'bolt': {
      const len = s * 0.85;
      ss(ctx, '#d8cfae', Math.max(1.2, s * 0.06));
      ctx.beginPath(); ctx.moveTo(-len * 0.5, 0); ctx.lineTo(len * 0.34, 0); ctx.stroke();
      shape(ctx, p.metalDark, () => poly(ctx, [len * 0.3, -s * 0.07, len * 0.55, 0, len * 0.3, s * 0.07]), OUTLINE, 1);
      // fletching
      ss(ctx, '#e8e0cc', Math.max(1, s * 0.04));
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, -s * 0.07); ctx.lineTo(-len * 0.32, 0); ctx.lineTo(-len * 0.5, s * 0.07);
      ctx.stroke();
      break;
    }
    case 'spear': {
      const len = s * 1.1;
      ctx.fillStyle = p.wood;
      ctx.fillRect(-len * 0.5, -s * 0.045, len * 0.86, s * 0.09);
      shape(ctx, p.metal, () => poly(ctx, [len * 0.32, -s * 0.1, len * 0.55, 0, len * 0.32, s * 0.1]), OUTLINE, 1.1);
      break;
    }
    case 'cannon': {
      glow(ctx, 0, 0, s * 0.34, '#000000', 0.25);
      shape(ctx, '#3a3a40', () => circle(ctx, 0, 0, s * 0.2), OUTLINE, 1.4);
      shape(ctx, '#6e6e78', () => circle(ctx, -s * 0.05, -s * 0.05, s * 0.08));
      break;
    }
    case 'fireball':
    case 'flame_strike':
    case 'green_ball': {
      const col = spec.shape === 'green_ball' ? '#7ad84a' : '#ff8a3c';
      const core = spec.shape === 'green_ball' ? '#e0ffc0' : '#ffe08a';
      glow(ctx, 0, 0, s * 0.5, col, 0.75);
      shape(ctx, col, () => circle(ctx, 0, 0, s * 0.2), OUTLINE, 1);
      shape(ctx, core, () => circle(ctx, s * 0.03, -s * 0.02, s * 0.1));
      // trailing flame
      shape(ctx, withAlpha(col, 0.6), () => poly(ctx, [-s * 0.16, -s * 0.12, -s * 0.6, 0, -s * 0.16, s * 0.12]));
      break;
    }
    case 'magic_missile': {
      glow(ctx, 0, 0, s * 0.46, p.accent, 0.8);
      shape(ctx, tintHex(p.accent, 0.5), () => ellipse(ctx, 0, 0, s * 0.22, s * 0.13), OUTLINE, 1);
      shape(ctx, '#ffffff', () => circle(ctx, s * 0.04, 0, s * 0.07));
      shape(ctx, withAlpha(p.accent, 0.45), () => poly(ctx, [-s * 0.18, -s * 0.1, -s * 0.62, 0, -s * 0.18, s * 0.1]));
      break;
    }
    case 'ice_shard': {
      glow(ctx, 0, 0, s * 0.34, '#8fd0ff', 0.6);
      shape(ctx, '#dff2ff', () => poly(ctx, [-s * 0.22, -s * 0.09, s * 0.3, -s * 0.03, s * 0.42, 0, s * 0.3, s * 0.03, -s * 0.22, s * 0.09]), OUTLINE, 1.1);
      break;
    }
    case 'acid': {
      glow(ctx, 0, 0, s * 0.3, '#b6e04a', 0.55);
      shape(ctx, '#8ab63a', () => ellipse(ctx, 0, 0, s * 0.17, s * 0.13), OUTLINE, 1);
      shape(ctx, '#e0ffb0', () => circle(ctx, -s * 0.04, -s * 0.03, s * 0.05));
      break;
    }
    case 'whirlwind': {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, s * (0.36 - i * 0.08), s * (0.14 - i * 0.03), i * 0.5, 0, Math.PI * 2);
        ss(ctx, withAlpha('#dfe8ec', 0.7 - i * 0.15), Math.max(1.2, s * 0.05));
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'blizzard': {
      // snowflake
      ss(ctx, '#dff2ff', Math.max(1.2, s * 0.05));
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(-Math.cos(a) * s * 0.3, -Math.sin(a) * s * 0.3);
        ctx.lineTo(Math.cos(a) * s * 0.3, Math.sin(a) * s * 0.3);
      }
      ctx.stroke();
      glow(ctx, 0, 0, s * 0.24, '#8fd0ff', 0.6);
      break;
    }
    default: {
      glow(ctx, 0, 0, s * 0.36, p.accent, 0.6);
      shape(ctx, tintHex(p.accent, 0.3), () => circle(ctx, 0, 0, s * 0.15), OUTLINE, 1);
      break;
    }
  }
};
