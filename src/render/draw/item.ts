/**
 * Item icons (32px atlas slots): potions, scrolls, weapons, armour, tomes,
 * orbs and recipes. Drawn centred on (0,0) inside a box of `size` px.
 */
import type { DrawFn } from './spec.js';
import { racePalette, shadeHex, tintHex, withAlpha } from '../palette.js';
import { OUTLINE, circle, glow, poly, rect, rrect, shape } from './common.js';

const ss = (ctx: CanvasRenderingContext2D, c: string, w: number): void => {
  ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
};

/** Dark rounded plaque behind every icon so items read on any terrain. */
function plaque(ctx: CanvasRenderingContext2D, s: number): void {
  shape(ctx, '#2a2b31', () => rrect(ctx, -s * 0.46, -s * 0.92, s * 0.92, s * 0.9, s * 0.1), '#0d0e11', 1.6);
  shape(ctx, withAlpha('#ffffff', 0.06), () => rrect(ctx, -s * 0.4, -s * 0.86, s * 0.8, s * 0.3, s * 0.07));
}

const RARITY_BY_SHAPE: Record<string, string> = {
  potion_hp: '#e05a5a', potion_mp: '#4f8fe0', scroll_tp: '#c8b070', scroll_regen: '#d8cfa8',
  claymore: '#dfe4ee', shield: '#9fb6d8', ring: '#ffd45e', gem: '#7ce0ff', wand: '#b98fe0',
  tome: '#e0c07a', boots: '#c9a25a', orb: '#9a5fd8', crown: '#ffd45e', hammer_itm: '#c8c8c8',
  recipe: '#e8dcc0', permanent_str: '#ff7a5a', permanent_agi: '#7ee07e', permanent_int: '#6aa8ff',
};

export const drawItem: DrawFn = (ctx, spec, size) => {
  const s = size;
  const rarity = RARITY_BY_SHAPE[spec.shape] ?? '#cfcfcf';
  plaque(ctx, s);
  ctx.save();
  glow(ctx, 0, -s * 0.48, s * 0.4, rarity, 0.22);
  ctx.restore();

  switch (spec.shape) {
    case 'potion_hp':
    case 'potion_mp':
    case 'permanent_str':
    case 'permanent_agi':
    case 'permanent_int': {
      const liquid = spec.shape === 'potion_hp' ? '#e05a5a'
        : spec.shape === 'potion_mp' ? '#4f8fe0'
        : spec.shape === 'permanent_str' ? '#ff7a5a'
        : spec.shape === 'permanent_agi' ? '#7ee07e' : '#6aa8ff';
      // flask
      shape(ctx, withAlpha('#dff2ff', 0.35), () => {
        ctx.moveTo(-s * 0.2, -s * 0.34);
        ctx.lineTo(-s * 0.2, -s * 0.5);
        ctx.quadraticCurveTo(-s * 0.3, -s * 0.62, -s * 0.26, -s * 0.78);
        ctx.quadraticCurveTo(0, -s * 0.98, s * 0.26, -s * 0.78);
        ctx.quadraticCurveTo(s * 0.3, -s * 0.62, s * 0.2, -s * 0.5);
        ctx.lineTo(s * 0.2, -s * 0.34);
        ctx.closePath();
      }, OUTLINE, 1.4);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-s * 0.19, -s * 0.4);
      ctx.lineTo(-s * 0.19, -s * 0.52);
      ctx.quadraticCurveTo(-s * 0.27, -s * 0.6, -s * 0.22, -s * 0.7);
      ctx.lineTo(s * 0.22, -s * 0.7);
      ctx.quadraticCurveTo(s * 0.27, -s * 0.6, s * 0.19, -s * 0.52);
      ctx.lineTo(s * 0.19, -s * 0.4);
      ctx.closePath();
      ctx.fillStyle = liquid; ctx.fill();
      ctx.restore();
      shape(ctx, '#8a6b34', () => rect(ctx, -s * 0.09, -s * 0.94, s * 0.18, s * 0.1));
      glow(ctx, 0, -s * 0.55, s * 0.22, liquid, 0.5);
      break;
    }
    case 'scroll_tp':
    case 'scroll_regen': {
      const ink = spec.shape === 'scroll_tp' ? '#7a5ad8' : '#3a8a4a';
      shape(ctx, '#efe4c4', () => rrect(ctx, -s * 0.3, -s * 0.8, s * 0.6, s * 0.5, s * 0.04), OUTLINE, 1.4);
      ctx.save();
      ss(ctx, ink, 1.2);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.2, -s * 0.7 + i * s * 0.12);
        ctx.lineTo(s * 0.16, -s * 0.7 + i * s * 0.12);
        ctx.stroke();
      }
      ctx.restore();
      shape(ctx, '#c9a25a', () => rect(ctx, -s * 0.34, -s * 0.84, s * 0.68, s * 0.08));
      shape(ctx, '#c9a25a', () => rect(ctx, -s * 0.34, -s * 0.36, s * 0.68, s * 0.08));
      break;
    }
    case 'claymore':
    case 'hammer_itm': {
      if (spec.shape === 'claymore') {
        ctx.save();
        ctx.translate(0, -s * 0.5);
        ctx.rotate(-0.7);
        shape(ctx, '#eef2f8', () => poly(ctx, [-s * 0.05, s * 0.28, s * 0.05, s * 0.28, s * 0.04, -s * 0.36, 0, -s * 0.46, -s * 0.04, -s * 0.36]), OUTLINE, 1.4);
        ctx.fillStyle = '#8a93a6'; ctx.fillRect(-s * 0.14, s * 0.26, s * 0.28, s * 0.05);
        ctx.fillStyle = '#6b4a28'; ctx.fillRect(-s * 0.035, s * 0.3, s * 0.07, s * 0.16);
        ctx.restore();
      } else {
        shape(ctx, '#8a6b34', () => rect(ctx, -s * 0.035, -s * 0.78, s * 0.07, s * 0.46));
        shape(ctx, '#b8bcc8', () => poly(ctx, [-s * 0.26, -s * 0.78, s * 0.26, -s * 0.78, s * 0.2, -s * 0.58, -s * 0.2, -s * 0.58]), OUTLINE, 1.4);
      }
      break;
    }
    case 'shield': {
      shape(ctx, '#9fb6d8', () => {
        ctx.moveTo(-s * 0.28, -s * 0.82);
        ctx.lineTo(s * 0.28, -s * 0.82);
        ctx.lineTo(s * 0.28, -s * 0.5);
        ctx.quadraticCurveTo(s * 0.28, -s * 0.28, 0, -s * 0.2);
        ctx.quadraticCurveTo(-s * 0.28, -s * 0.28, -s * 0.28, -s * 0.5);
        ctx.closePath();
      }, OUTLINE, 1.5);
      shape(ctx, '#dfe8f4', () => poly(ctx, [0, -s * 0.76, s * 0.1, -s * 0.52, 0, -s * 0.3, -s * 0.1, -s * 0.52]), OUTLINE, 1);
      break;
    }
    case 'ring': {
      ctx.beginPath();
      ctx.arc(0, -s * 0.52, s * 0.2, 0, Math.PI * 2);
      ss(ctx, '#ffd45e', Math.max(2.4, s * 0.09));
      ctx.stroke();
      shape(ctx, '#7ce0ff', () => poly(ctx, [0, -s * 0.82, s * 0.09, -s * 0.7, 0, -s * 0.62, -s * 0.09, -s * 0.7]), OUTLINE, 1);
      break;
    }
    case 'gem': {
      shape(ctx, '#7ce0ff', () => poly(ctx, [0, -s * 0.86, s * 0.22, -s * 0.6, 0, -s * 0.26, -s * 0.22, -s * 0.6]), OUTLINE, 1.4);
      shape(ctx, withAlpha('#ffffff', 0.55), () => poly(ctx, [0, -s * 0.82, s * 0.1, -s * 0.6, 0, -s * 0.5]), '#7ce0ff', 0.8);
      break;
    }
    case 'wand': {
      ctx.save();
      ctx.translate(0, -s * 0.5);
      ctx.rotate(-0.6);
      shape(ctx, '#6b4a28', () => rect(ctx, -s * 0.03, -s * 0.34, s * 0.06, s * 0.62), OUTLINE, 1.2);
      ctx.restore();
      glow(ctx, s * 0.2, -s * 0.8, s * 0.16, '#b98fe0', 0.8);
      shape(ctx, '#e0ccff', () => circle(ctx, s * 0.2, -s * 0.8, s * 0.07), OUTLINE, 1);
      break;
    }
    case 'tome': {
      shape(ctx, '#8a5a2a', () => rrect(ctx, -s * 0.3, -s * 0.82, s * 0.6, s * 0.5, s * 0.04), OUTLINE, 1.5);
      shape(ctx, '#efe4c4', () => rect(ctx, -s * 0.24, -s * 0.78, s * 0.5, s * 0.42), '#8a7a55', 1);
      shape(ctx, '#ffd45e', () => poly(ctx, [0, -s * 0.74, s * 0.08, -s * 0.58, -s * 0.08, -s * 0.58]), OUTLINE, 1);
      break;
    }
    case 'boots': {
      shape(ctx, '#c9a25a', () => {
        ctx.moveTo(-s * 0.26, -s * 0.34);
        ctx.lineTo(-s * 0.26, -s * 0.6);
        ctx.quadraticCurveTo(-s * 0.2, -s * 0.7, -s * 0.06, -s * 0.62);
        ctx.lineTo(s * 0.24, -s * 0.44);
        ctx.quadraticCurveTo(s * 0.3, -s * 0.34, s * 0.2, -s * 0.32);
        ctx.closePath();
      }, OUTLINE, 1.4);
      shape(ctx, '#ffe9a8', () => poly(ctx, [s * 0.16, -s * 0.5, s * 0.34, -s * 0.44, s * 0.16, -s * 0.36]), OUTLINE, 1);
      break;
    }
    case 'orb': {
      glow(ctx, 0, -s * 0.55, s * 0.34, '#9a5fd8', 0.6);
      shape(ctx, '#9a5fd8', () => circle(ctx, 0, -s * 0.55, s * 0.22), OUTLINE, 1.4);
      shape(ctx, withAlpha('#e8d4ff', 0.7), () => circle(ctx, -s * 0.07, -s * 0.62, s * 0.07));
      break;
    }
    case 'crown': {
      shape(ctx, '#ffd45e', () => {
        poly(ctx, [-s * 0.3, -s * 0.4, -s * 0.3, -s * 0.68, -s * 0.15, -s * 0.52, 0, -s * 0.76, s * 0.15, -s * 0.52, s * 0.3, -s * 0.68, s * 0.3, -s * 0.4]);
      }, OUTLINE, 1.4);
      shape(ctx, '#e05a5a', () => circle(ctx, 0, -s * 0.48, s * 0.05));
      break;
    }
    case 'recipe': {
      shape(ctx, '#e8dcc0', () => rrect(ctx, -s * 0.3, -s * 0.8, s * 0.6, s * 0.52, s * 0.05), OUTLINE, 1.4);
      ctx.save();
      ss(ctx, '#8a6b34', 1.2);
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, -s * 0.66); ctx.lineTo(s * 0.18, -s * 0.66);
      ctx.moveTo(-s * 0.18, -s * 0.52); ctx.lineTo(s * 0.1, -s * 0.52);
      ctx.stroke();
      ctx.restore();
      shape(ctx, '#ffd45e', () => circle(ctx, s * 0.16, -s * 0.38, s * 0.06), '#8a6a1a', 1);
      break;
    }
    default: {
      shape(ctx, rarity, () => circle(ctx, 0, -s * 0.55, s * 0.2), OUTLINE, 1.4);
      break;
    }
  }
  void tintHex; void racePalette; void shadeHex;
};
