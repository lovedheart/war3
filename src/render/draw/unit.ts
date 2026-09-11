/**
 * Unit silhouettes. Every recipe draws inside a box of `size` px with the
 * feet at y=0 and the body extending upward; x is centred on 0.
 *
 * The goal is instant readability at 64px: a footman holds a sword, a rifleman
 * a long gun, a grunt an axe, a knight is on horseback, a dragon has wings.
 */
import type { DrawFn } from './spec.js';
import type { RacePalette } from '../palette.js';
import {
  OUTLINE, axe, banner, body, bow, circle, crest, ellipse, glow, gun, helm, hatch,
  horse, legs, poly, quadruped, rect, robe, rrect, shape, staff, sword, wings,
} from './common.js';
import { racePalette, shadeHex, tintHex, withAlpha } from '../palette.js';

type C = CanvasRenderingContext2D;
const setStrokeLocal = (ctx: C, color: string, w: number): void => {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
};
const vgradLocal = (ctx: C, x: number, y: number, _w: number, h: number, a: string, b: string): CanvasGradient => {
  const g = ctx.createLinearGradient(x, y, x, y + Math.max(1, h));
  g.addColorStop(0, a); g.addColorStop(1, b); return g;
};

/** Draw the unit into a box of `size` px, feet at (0,0). */
export const drawUnit: DrawFn = (ctx, spec, size) => {
  const s = size;
  const p = spec.pal ?? racePalette(spec.race);
  const dark = (c: string): string => shadeHex(c, 0.42);
  const light = (c: string): string => tintHex(c, 0.28);

  switch (spec.shape) {
    /* ---------------- workers ---------------- */
    case 'worker': {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.86, height: 0.9 });
      // apron
      shape(ctx, tintHex(p.banner, 0.1), () => poly(ctx, [-s * 0.16, -s * 0.36, s * 0.16, -s * 0.36, s * 0.14, -s * 0.1, -s * 0.14, -s * 0.1]));
      // straw hat
      shape(ctx, '#cfa85a', () => ellipse(ctx, 0, -s * 0.62, s * 0.17, s * 0.05));
      shape(ctx, '#b8913f', () => ctx.arc(0, -s * 0.63, s * 0.09, Math.PI, 0));
      // hammer over shoulder
      ctx.save();
      ctx.translate(s * 0.2, -s * 0.34);
      ctx.rotate(-0.7);
      ctx.fillStyle = p.wood;
      ctx.fillRect(-s * 0.02, -s * 0.24, s * 0.04, s * 0.3);
      shape(ctx, p.metalDark, () => rect(ctx, -s * 0.07, -s * 0.3, s * 0.14, s * 0.08));
      ctx.restore();
      break;
    }

    /* ---------------- human ---------------- */
    case 'footman': {
      legs(ctx, s, dark(p.metalDark));
      body(ctx, s, p.metal, p.metalDark, p.skin, { bulk: 0.95 });
      // blue tabard
      shape(ctx, p.cloth, () => poly(ctx, [-s * 0.1, -s * 0.46, s * 0.1, -s * 0.46, s * 0.08, -s * 0.14, -s * 0.08, -s * 0.14]));
      // kettle helm
      shape(ctx, light(p.metal), () => ctx.arc(0, -s * 0.6, s * 0.12, Math.PI, 0));
      rect(ctx, -s * 0.13, -s * 0.6, s * 0.26, s * 0.05); ctx.fillStyle = p.metal; ctx.fill(); setStrokeLocal(ctx, OUTLINE, 1); ctx.stroke();
      crest(ctx, -s * 0.2, -s * 0.36, s * 0.07, p.cloth, p.metalDark);
      sword(ctx, s * 0.24, -s * 0.3, s * 0.42, p.metal, p.metalDark);
      // shield
      shape(ctx, p.cloth, () => ellipse(ctx, -s * 0.26, -s * 0.28, s * 0.12, s * 0.16));
      crest(ctx, -s * 0.26, -s * 0.28, s * 0.05, light(p.banner), p.clothShade);
      break;
    }
    case 'marksman': {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.82 });
      shape(ctx, p.banner, () => poly(ctx, [-s * 0.13, -s * 0.62, s * 0.13, -s * 0.62, s * 0.16, -s * 0.5, -s * 0.16, -s * 0.5]));
      gun(ctx, s * 0.1, -s * 0.32, s * 0.56, p.metalDark, p.wood);
      // powder pouch
      shape(ctx, p.wood, () => rrect(ctx, -s * 0.22, -s * 0.24, s * 0.12, s * 0.1, s * 0.03));
      break;
    }
    case 'rider': {
      horse(ctx, s, p.metalDark, shadeHex(p.metalDark, 0.3), p.cloth);
      ctx.save();
      ctx.translate(-s * 0.02, -s * 0.4);
      body(ctx, s * 0.78, p.cloth, p.clothShade, p.skin, { bulk: 0.9, height: 0.95 });
      spearOrAxe(ctx, s * 0.8, p, spec.race);
      ctx.restore();
      banner(ctx, -s * 0.34, -s * 0.72, s * 0.12, s * 0.2, p.cloth, p.clothShade);
      break;
    }
    case 'mortar': {
      legs(ctx, s, dark(p.cloth), 0.2);
      body(ctx, s, p.clothShade, shadeHex(p.clothShade, 0.3), p.skin, { bulk: 1.1, height: 0.8 });
      // barrel
      ctx.save();
      ctx.translate(s * 0.16, -s * 0.4);
      ctx.rotate(-0.6);
      shape(ctx, p.metalDark, () => rect(ctx, -s * 0.06, -s * 0.42, s * 0.12, s * 0.44));
      shape(ctx, p.metal, () => ellipse(ctx, 0, -s * 0.42, s * 0.075, s * 0.045));
      ctx.restore();
      break;
    }
    case 'knight': {
      horse(ctx, s, p.metalDark, shadeHex(p.metalDark, 0.35), light(p.cloth));
      ctx.save();
      ctx.translate(-s * 0.03, -s * 0.42);
      body(ctx, s * 0.8, p.metal, p.metalDark, p.skin, { bulk: 1, height: 0.95 });
      helm(ctx, 0, -s * 0.6, s * 0.1, light(p.metal), p.accent);
      lance(ctx, s * 0.85, p.metal, p.wood);
      ctx.restore();
      banner(ctx, -s * 0.36, -s * 0.78, s * 0.14, s * 0.24, p.cloth, p.clothShade);
      break;
    }
    case 'wizard': {
      robe(ctx, s, p.cloth, p.clothShade, 1.1);
      shape(ctx, p.cloth, () => poly(ctx, [-s * 0.16, -s * 0.62, s * 0.16, -s * 0.62, s * 0.1, -s * 0.86, -s * 0.1, -s * 0.86]));
      shape(ctx, shadeHex(p.skin, 0.05), () => circle(ctx, 0, -s * 0.62, s * 0.09));
      staff(ctx, s * 0.24, -s * 0.1, s * 0.62, p.wood, p.accent);
      break;
    }
    case 'cleric': {
      robe(ctx, s, p.banner, shadeHex(p.banner, 0.35), 1);
      shape(ctx, p.skin, () => circle(ctx, 0, -s * 0.6, s * 0.1));
      // halo
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.78, s * 0.14, s * 0.04, 0, 0, Math.PI * 2);
      setStrokeLocal(ctx, p.accent, 1.6);
      ctx.stroke();
      ctx.restore();
      // mace
      ctx.save();
      ctx.translate(s * 0.22, -s * 0.3);
      ctx.fillStyle = p.wood;
      ctx.fillRect(-s * 0.02, -s * 0.3, s * 0.04, s * 0.32);
      shape(ctx, p.metal, () => circle(ctx, 0, -s * 0.34, s * 0.07));
      ctx.restore();
      break;
    }

    /* ---------------- orc ---------------- */
    case 'grunt': {
      legs(ctx, s, shadeHex(p.wood, 0.25));
      body(ctx, s, p.skin, shadeHex(p.skin, 0.3), p.skin, { bulk: 1.22, height: 0.92 });
      // shoulder pad + tusks
      shape(ctx, p.wood, () => poly(ctx, [-s * 0.3, -s * 0.5, -s * 0.06, -s * 0.56, -s * 0.08, -s * 0.4, -s * 0.32, -s * 0.38]));
      shape(ctx, '#e8e0cc', () => poly(ctx, [-s * 0.06, -s * 0.6, -s * 0.02, -s * 0.72, -s * 0.0, -s * 0.6]));
      shape(ctx, '#e8e0cc', () => poly(ctx, [s * 0.06, -s * 0.6, s * 0.02, -s * 0.72, s * 0.0, -s * 0.6]));
      axe(ctx, s * 0.26, -s * 0.3, s * 0.5, p.metal, p.wood);
      break;
    }
    case 'axethrower': {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.95 });
      shape(ctx, p.banner, () => poly(ctx, [-s * 0.12, -s * 0.62, s * 0.12, -s * 0.62, s * 0.14, -s * 0.52, -s * 0.14, -s * 0.52]));
      axe(ctx, s * 0.28, -s * 0.44, s * 0.34, p.metal, p.wood);
      axe(ctx, -s * 0.3, -s * 0.2, s * 0.26, p.metalDark, p.woodShade);
      break;
    }
    case 'raider': {
      wolfBody(ctx, s, p.skin, shadeHex(p.skin, 0.35));
      ctx.save();
      ctx.translate(-s * 0.04, -s * 0.42);
      body(ctx, s * 0.72, p.cloth, p.clothShade, p.skin, { bulk: 0.9, height: 0.9 });
      axe(ctx, s * 0.24, -s * 0.3, s * 0.34, p.metal, p.wood);
      ctx.restore();
      break;
    }
    case 'shaman': {
      robe(ctx, s, p.cloth, p.clothShade, 1.05);
      shape(ctx, p.skin, () => circle(ctx, 0, -s * 0.6, s * 0.1));
      // feather headdress
      for (let i = -2; i <= 2; i++) {
        shape(ctx, i % 2 ? '#d95f3b' : '#e8d9a0', () => poly(ctx, [i * s * 0.05, -s * 0.68, i * s * 0.05 + s * 0.03, -s * 0.84, i * s * 0.05 - s * 0.03, -s * 0.82]), OUTLINE, 1);
      }
      staff(ctx, -s * 0.24, -s * 0.1, s * 0.56, p.wood, p.accent);
      break;
    }
    case 'wolf_rider': {
      wolfBody(ctx, s, '#6b6258', shadeHex('#6b6258', 0.4));
      ctx.save();
      ctx.translate(-s * 0.02, -s * 0.4);
      body(ctx, s * 0.7, p.cloth, p.clothShade, p.skin, { bulk: 0.85 });
      ctx.restore();
      break;
    }
    case 'catapult': {
      // wheeled frame
      ctx.save();
      shape(ctx, p.wood, () => rect(ctx, -s * 0.42, -s * 0.26, s * 0.84, s * 0.14));
      for (const wx of [-s * 0.28, s * 0.28]) {
        shape(ctx, p.woodShade, () => circle(ctx, wx, -s * 0.1, s * 0.11));
        ctx.beginPath(); circle(ctx, wx, -s * 0.1, s * 0.05); setStrokeLocal(ctx, p.metalDark, 1.4); ctx.stroke();
      }
      ctx.save();
      ctx.translate(-s * 0.05, -s * 0.28);
      ctx.rotate(-0.5);
      shape(ctx, p.woodShade, () => rect(ctx, -s * 0.09, -s * 0.44, s * 0.18, s * 0.46));
      ctx.restore();
      glow(ctx, s * 0.16, -s * 0.5, s * 0.1, '#ff8a3c', 0.5);
      ctx.restore();
      break;
    }

    /* ---------------- undead ---------------- */
    case 'ghoul': {
      legs(ctx, s, shadeHex(p.skin, 0.3), 0.12);
      // hunched spine
      shape(ctx, vgradLocal(ctx, 0, -s * 0.55, s, s * 0.45, p.skin, shadeHex(p.skin, 0.4)), () => {
        poly(ctx, [-s * 0.2, -s * 0.16, -s * 0.24, -s * 0.44, -s * 0.02, -s * 0.58, s * 0.22, -s * 0.4, s * 0.16, -s * 0.14]);
      });
      shape(ctx, tintHex(p.skin, 0.2), () => ellipse(ctx, s * 0.16, -s * 0.56, s * 0.11, s * 0.085));
      // claws
      for (const sx of [s * 0.26, -s * 0.22]) {
        ctx.beginPath();
        ctx.moveTo(sx, -s * 0.3);
        ctx.lineTo(sx + s * 0.08, -s * 0.4);
        setStrokeLocal(ctx, '#e8e0cc', 1.6);
        ctx.stroke();
      }
      // jaw teeth
      shape(ctx, '#efe7d2', () => poly(ctx, [s * 0.1, -s * 0.52, s * 0.24, -s * 0.5, s * 0.17, -s * 0.46]));
      break;
    }
    case 'crypt_fiend': {
      // spider: bulbous abdomen + 6 legs
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        const k = i % 3;
        ctx.beginPath();
        ctx.moveTo(side * s * 0.1, -s * 0.2);
        ctx.lineTo(side * s * (0.3 + k * 0.06), -s * 0.34 + k * s * 0.04);
        ctx.lineTo(side * s * (0.36 + k * 0.06), 0);
        setStrokeLocal(ctx, shadeHex(p.skin, 0.45), Math.max(1.4, s * 0.035));
        ctx.stroke();
      }
      shape(ctx, vgradLocal(ctx, 0, -s * 0.5, s, s * 0.35, p.skin, shadeHex(p.skin, 0.4)), () => ellipse(ctx, -s * 0.1, -s * 0.32, s * 0.24, s * 0.19));
      shape(ctx, shadeHex(p.skin, 0.2), () => ellipse(ctx, s * 0.2, -s * 0.3, s * 0.13, s * 0.11));
      glow(ctx, s * 0.26, -s * 0.34, s * 0.07, p.accent, 0.7);
      // spines
      for (let i = -1; i <= 1; i++) {
        shape(ctx, '#d8cfc0', () => poly(ctx, [i * s * 0.08 - s * 0.02, -s * 0.46, i * s * 0.08 + s * 0.02, -s * 0.46, i * s * 0.08, -s * 0.6]), OUTLINE, 1);
      }
      break;
    }
    case 'bone_archer': {
      legs(ctx, s, '#cfc7b4', 0.11);
      shape(ctx, '#ded6c3', () => rect(ctx, -s * 0.055, -s * 0.5, s * 0.11, s * 0.36));
      // ribs
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.1, -s * 0.44 + i * s * 0.08);
        ctx.lineTo(s * 0.1, -s * 0.44 + i * s * 0.08);
        setStrokeLocal(ctx, '#bdb4a0', 1.2);
        ctx.stroke();
      }
      shape(ctx, '#efe7d2', () => circle(ctx, 0, -s * 0.58, s * 0.1));
      ctx.fillStyle = '#1a1712';
      circle(ctx, -s * 0.035, -s * 0.59, s * 0.026); ctx.fill();
      circle(ctx, s * 0.035, -s * 0.59, s * 0.026); ctx.fill();
      bow(ctx, s * 0.24, -s * 0.36, s * 0.36, p.wood);
      break;
    }
    case 'meat_wagon': {
      shape(ctx, p.wood, () => rect(ctx, -s * 0.44, -s * 0.4, s * 0.88, s * 0.24));
      hatch(ctx, -s * 0.44, -s * 0.4, s * 0.88, s * 0.24, shadeHex(p.wood, 0.4), 7);
      for (const wx of [-s * 0.28, s * 0.26]) {
        shape(ctx, p.woodShade, () => circle(ctx, wx, -s * 0.12, s * 0.12));
      }
      // meat pile
      shape(ctx, '#9c4a4a', () => ellipse(ctx, -s * 0.05, -s * 0.48, s * 0.22, s * 0.1));
      shape(ctx, '#c47a72', () => ellipse(ctx, s * 0.08, -s * 0.52, s * 0.1, s * 0.06));
      break;
    }
    case 'frost_wyrm': {
      wings(ctx, s, -s * 0.5, withAlpha('#bfe6ff', 0.85), 1.15);
      shape(ctx, vgradLocal(ctx, 0, -s * 0.6, s, s * 0.4, '#8fd0ef', '#3f7fae'), () => {
        poly(ctx, [-s * 0.34, -s * 0.3, s * 0.2, -s * 0.42, s * 0.42, -s * 0.52, s * 0.3, -s * 0.24, -s * 0.3, -s * 0.16]);
      });
      shape(ctx, '#a9dcf2', () => ellipse(ctx, s * 0.44, -s * 0.54, s * 0.12, s * 0.08));
      // horns
      for (const o of [0, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * (0.42 + o * 0.05), -s * 0.6);
        ctx.lineTo(s * (0.36 + o * 0.05), -s * 0.74);
        setStrokeLocal(ctx, '#e8f4ff', 1.6);
        ctx.stroke();
      }
      // tail fin
      shape(ctx, withAlpha('#bfe6ff', 0.8), () => poly(ctx, [-s * 0.34, -s * 0.28, -s * 0.52, -s * 0.42, -s * 0.46, -s * 0.18]));
      break;
    }
    case 'abom': {
      legs(ctx, s, shadeHex(p.skin, 0.4), 0.18);
      body(ctx, s, p.skin, shadeHex(p.skin, 0.4), shadeHex(p.skin, 0.1), { bulk: 1.4, height: 0.85 });
      // stitches
      ctx.beginPath();
      ctx.moveTo(-s * 0.16, -s * 0.46);
      ctx.lineTo(s * 0.14, -s * 0.3);
      setStrokeLocal(ctx, shadeHex(p.skin, 0.6), 1.4);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        const t = i / 3;
        const px = -s * 0.16 + t * s * 0.3, py = -s * 0.46 + t * s * 0.16;
        ctx.moveTo(px - s * 0.03, py - s * 0.03);
        ctx.lineTo(px + s * 0.03, py + s * 0.03);
        setStrokeLocal(ctx, '#2a2620', 1.2);
        ctx.stroke();
      }
      // hooks instead of hands
      ctx.beginPath();
      ctx.arc(s * 0.3, -s * 0.28, s * 0.07, Math.PI * 0.2, Math.PI * 1.4);
      setStrokeLocal(ctx, p.metalDark, 2.4);
      ctx.stroke();
      break;
    }

    /* ---------------- night elf ---------------- */
    case 'sentinel': {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.8, height: 1.02 });
      // twin ponytails
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * s * 0.06, -s * 0.62);
        ctx.quadraticCurveTo(sx * s * 0.22, -s * 0.5, sx * s * 0.16, -s * 0.3);
        setStrokeLocal(ctx, '#3a3350', Math.max(1.4, s * 0.04));
        ctx.stroke();
      }
      // glaive
      ctx.save();
      ctx.translate(s * 0.24, -s * 0.34);
      ctx.rotate(-0.45);
      shape(ctx, p.metal, () => poly(ctx, [-s * 0.03, 0, s * 0.03, 0, s * 0.05, -s * 0.5, 0, -s * 0.62, -s * 0.05, -s * 0.5]));
      ctx.restore();
      shape(ctx, p.accent, () => ellipse(ctx, -s * 0.24, -s * 0.3, s * 0.09, s * 0.13));
      break;
    }
    case 'archer_ne': {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.78, height: 1.02 });
      hood(ctx, s, p.cloth, p.clothShade);
      bow(ctx, s * 0.24, -s * 0.38, s * 0.42, tintHex(p.wood, 0.15));
      break;
    }
    case 'dryad': {
      // deer lower half + humanoid upper
      quadruped(ctx, s * 0.8, '#b98f5e', '#7d5c37', { legs: 4, neck: 0.18 });
      ctx.save();
      ctx.translate(0, -s * 0.34);
      body(ctx, s * 0.62, p.cloth, p.clothShade, p.skin, { bulk: 0.75, height: 1 });
      ctx.restore();
      // antlers
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * s * 0.05, -s * 0.72);
        ctx.lineTo(sx * s * 0.13, -s * 0.88);
        ctx.moveTo(sx * s * 0.09, -s * 0.8);
        ctx.lineTo(sx * s * 0.18, -s * 0.84);
        setStrokeLocal(ctx, '#d8c9a8', 1.6);
        ctx.stroke();
      }
      break;
    }
    case 'bear': {
      quadruped(ctx, s, '#6f5638', '#3f3120', { legs: 4, neck: 0.2 });
      // ears
      for (const sx of [-1, 1]) {
        shape(ctx, '#6f5638', () => circle(ctx, s * 0.36 + sx * s * 0.03, -s * 0.5, s * 0.04));
      }
      break;
    }
    case 'mountain_giant': {
      legs(ctx, s, shadeHex(p.wall, 0.35), 0.22);
      body(ctx, s, p.wall, p.wallShade, p.wall, { bulk: 1.5, height: 1.05 });
      // runic glow
      glow(ctx, 0, -s * 0.36, s * 0.16, p.accent, 0.6);
      shape(ctx, p.accent, () => poly(ctx, [-s * 0.06, -s * 0.44, s * 0.06, -s * 0.44, 0, -s * 0.3]), OUTLINE, 1);
      // boulder fists
      for (const sx of [-1, 1]) shape(ctx, shadeHex(p.wall, 0.2), () => circle(ctx, sx * s * 0.34, -s * 0.26, s * 0.12));
      break;
    }
    case 'hippo': {
      wings(ctx, s * 0.9, -s * 0.44, withAlpha(p.banner, 0.8), 1);
      quadruped(ctx, s * 0.9, '#8a7ab0', '#54476f', { legs: 4, neck: 0.3 });
      // beak
      shape(ctx, '#e8c86a', () => poly(ctx, [s * 0.36, -s * 0.5, s * 0.52, -s * 0.46, s * 0.36, -s * 0.42]));
      break;
    }

    /* ---------------- neutral / epic ---------------- */
    case 'dread': {
      wings(ctx, s, -s * 0.52, withAlpha('#5a4a7a', 0.9), 1.2);
      robe(ctx, s, p.cloth, p.clothShade, 1.25);
      helm(ctx, 0, -s * 0.62, s * 0.12, '#4a4458', '#8a7fb0');
      glow(ctx, 0, -s * 0.62, s * 0.18, p.accent, 0.45);
      // scythe
      ctx.save();
      ctx.translate(s * 0.3, -s * 0.2);
      ctx.rotate(0.2);
      ctx.fillStyle = p.woodShade;
      ctx.fillRect(-s * 0.02, -s * 0.66, s * 0.04, s * 0.7);
      shape(ctx, p.metal, () => poly(ctx, [0, -s * 0.66, s * 0.26, -s * 0.6, s * 0.1, -s * 0.5]));
      ctx.restore();
      break;
    }
    case 'warden': {
      legs(ctx, s, dark(p.cloth), 0.14);
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.85, height: 1.05 });
      hood(ctx, s, shadeHex(p.cloth, 0.2), shadeHex(p.cloth, 0.5));
      // winged helmet
      for (const sx of [-1, 1]) {
        shape(ctx, '#cfd8dc', () => poly(ctx, [sx * s * 0.08, -s * 0.68, sx * s * 0.26, -s * 0.86, sx * s * 0.1, -s * 0.72]), OUTLINE, 1);
      }
      // fan of blades on back
      for (let i = -1; i <= 1; i++) {
        ctx.save();
        ctx.translate(-s * 0.18, -s * 0.44);
        ctx.rotate(i * 0.4 - 0.5);
        shape(ctx, p.metal, () => poly(ctx, [-s * 0.02, 0, s * 0.02, 0, s * 0.015, -s * 0.3, 0, -s * 0.36, -s * 0.015, -s * 0.3]), OUTLINE, 1);
        ctx.restore();
      }
      break;
    }
    case 'tinker': {
      // floating mech ball
      shape(ctx, p.metal, () => circle(ctx, 0, -s * 0.3, s * 0.24));
      shape(ctx, shadeHex(p.metal, 0.3), () => ellipse(ctx, 0, -s * 0.2, s * 0.2, s * 0.1));
      glow(ctx, 0, -s * 0.34, s * 0.1, p.accent, 0.8);
      shape(ctx, p.accent, () => circle(ctx, 0, -s * 0.34, s * 0.055));
      // propellers
      for (const sx of [-1, 1]) {
        ctx.save();
        ctx.translate(sx * s * 0.26, -s * 0.42);
        ctx.rotate(0.5 * sx);
        ctx.fillStyle = p.metalDark;
        ctx.fillRect(-s * 0.14, -s * 0.015, s * 0.28, s * 0.03);
        ctx.restore();
      }
      shape(ctx, p.skin, () => circle(ctx, 0, -s * 0.48, s * 0.09));
      break;
    }
    case 'pit': {
      legs(ctx, s, shadeHex(p.skin, 0.4), 0.2);
      body(ctx, s, p.skin, shadeHex(p.skin, 0.4), p.skin, { bulk: 1.35, height: 1 });
      // horns
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * s * 0.07, -s * 0.66);
        ctx.quadraticCurveTo(sx * s * 0.24, -s * 0.86, sx * s * 0.1, -s * 0.94);
        setStrokeLocal(ctx, '#2a2018', Math.max(1.8, s * 0.05));
        ctx.stroke();
      }
      // chest fire
      glow(ctx, 0, -s * 0.34, s * 0.14, '#ff6a1e', 0.8);
      // twin swords
      sword(ctx, s * 0.3, -s * 0.32, s * 0.4, '#ffb37a', '#8a4a20');
      sword(ctx, -s * 0.3, -s * 0.32, s * 0.4, '#ffb37a', '#8a4a20');
      break;
    }
    case 'naga': {
      // coiled tail
      shape(ctx, vgradLocal(ctx, 0, -s * 0.3, s, s * 0.3, p.skin, shadeHex(p.skin, 0.45)), () => {
        ctx.moveTo(-s * 0.3, -s * 0.02);
        ctx.quadraticCurveTo(-s * 0.42, -s * 0.3, -s * 0.05, -s * 0.26);
        ctx.quadraticCurveTo(s * 0.34, -s * 0.22, s * 0.26, -s * 0.02);
        ctx.closePath();
      });
      body(ctx, s, tintHex(p.skin, 0.12), shadeHex(p.skin, 0.25), p.skin, { bulk: 0.95, height: 1 });
      // fins
      for (const sx of [-1, 1]) {
        shape(ctx, withAlpha(tintHex(p.accent, 0.2), 0.85), () => poly(ctx, [sx * s * 0.14, -s * 0.52, sx * s * 0.34, -s * 0.66, sx * s * 0.2, -s * 0.38]), OUTLINE, 1);
      }
      trident(ctx, s, p.metal, p.wood);
      break;
    }
    case 'golem': {
      legs(ctx, s, shadeHex(p.wall, 0.4), 0.2);
      body(ctx, s, p.wall, p.wallShade, p.wall, { bulk: 1.3, height: 0.95 });
      // cracks glowing
      ctx.beginPath();
      ctx.moveTo(-s * 0.12, -s * 0.5);
      ctx.lineTo(-s * 0.02, -s * 0.36);
      ctx.lineTo(s * 0.08, -s * 0.44);
      setStrokeLocal(ctx, p.accent, 1.8);
      ctx.stroke();
      for (const sx of [-1, 1]) shape(ctx, p.wallShade, () => circle(ctx, sx * s * 0.32, -s * 0.28, s * 0.11));
      break;
    }
    case 'sprite': {
      // wispy orb with trailing tail
      glow(ctx, 0, -s * 0.42, s * 0.3, p.accent, 0.7);
      shape(ctx, withAlpha(tintHex(p.accent, 0.4), 0.95), () => circle(ctx, 0, -s * 0.42, s * 0.15));
      shape(ctx, withAlpha(p.accent, 0.5), () => poly(ctx, [-s * 0.08, -s * 0.34, s * 0.08, -s * 0.34, 0, -s * 0.02]));
      break;
    }
    case 'bat': {
      wings(ctx, s * 0.9, -s * 0.4, withAlpha('#4a3a58', 0.9), 1.1);
      shape(ctx, '#3a2e44', () => ellipse(ctx, 0, -s * 0.4, s * 0.1, s * 0.12));
      // ears
      for (const sx of [-1, 1]) shape(ctx, '#3a2e44', () => poly(ctx, [sx * s * 0.05, -s * 0.48, sx * s * 0.1, -s * 0.64, sx * s * 0.0, -s * 0.52]), OUTLINE, 1);
      glow(ctx, 0, -s * 0.38, s * 0.06, '#ff5a5a', 0.9);
      break;
    }

    /* ---------------- heroes ---------------- */
    case 'hero_human': {
      legs(ctx, s, dark(p.metalDark));
      body(ctx, s, p.metal, p.metalDark, p.skin, { bulk: 1.05, height: 1 });
      shape(ctx, p.cloth, () => poly(ctx, [-s * 0.12, -s * 0.5, s * 0.12, -s * 0.5, s * 0.1, -s * 0.12, -s * 0.1, -s * 0.12]));
      helm(ctx, 0, -s * 0.64, s * 0.12, light(p.metal), p.accent);
      // cape
      shape(ctx, p.cloth, () => poly(ctx, [-s * 0.16, -s * 0.54, -s * 0.34, -s * 0.1, -s * 0.06, -s * 0.16]), OUTLINE, 1.2);
      sword(ctx, s * 0.28, -s * 0.34, s * 0.52, '#fff3c4', '#8a6a1a');
      shape(ctx, p.cloth, () => ellipse(ctx, -s * 0.28, -s * 0.3, s * 0.13, s * 0.17));
      crest(ctx, -s * 0.28, -s * 0.3, s * 0.06, p.accent, p.clothShade);
      break;
    }
    case 'hero_orc': {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.skin, shadeHex(p.skin, 0.35), p.skin, { bulk: 1.2, height: 0.98 });
      // pauldron spikes
      for (let i = 0; i < 3; i++) {
        shape(ctx, p.metalDark, () => poly(ctx, [-s * 0.3 + i * s * 0.07, -s * 0.52, -s * 0.26 + i * s * 0.07, -s * 0.68, -s * 0.24 + i * s * 0.07, -s * 0.5]), OUTLINE, 1);
      }
      // war axe
      ctx.save();
      ctx.translate(s * 0.3, -s * 0.34);
      ctx.rotate(0.25);
      ctx.fillStyle = p.wood;
      ctx.fillRect(-s * 0.03, -s * 0.5, s * 0.06, s * 0.62);
      shape(ctx, p.metal, () => poly(ctx, [0, -s * 0.56, s * 0.22, -s * 0.44, 0, -s * 0.32]));
      shape(ctx, p.metal, () => poly(ctx, [0, -s * 0.56, -s * 0.22, -s * 0.44, 0, -s * 0.32]));
      ctx.restore();
      // red face paint
      shape(ctx, '#b03a2a', () => rect(ctx, -s * 0.07, -s * 0.66, s * 0.14, s * 0.03));
      break;
    }
    case 'hero_undead': {
      robe(ctx, s, p.cloth, p.clothShade, 1.3);
      // frozen crown
      for (let i = -2; i <= 2; i++) {
        shape(ctx, '#bfe6ff', () => poly(ctx, [i * s * 0.06 - s * 0.02, -s * 0.7, i * s * 0.06 + s * 0.02, -s * 0.7, i * s * 0.06, -s * 0.86]), OUTLINE, 1);
      }
      glow(ctx, 0, -s * 0.66, s * 0.16, p.accent, 0.6);
      shape(ctx, '#0d1420', () => circle(ctx, 0, -s * 0.66, s * 0.09));
      // frostmourne
      sword(ctx, s * 0.3, -s * 0.36, s * 0.56, '#dff2ff', '#5a7a9a');
      break;
    }
    case 'hero_ne': {
      legs(ctx, s, dark(p.cloth), 0.14);
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 0.85, height: 1.06 });
      hood(ctx, s, p.cloth, p.clothShade);
      // star sigil
      glow(ctx, 0, -s * 0.36, s * 0.14, p.accent, 0.7);
      // glaive thrower arm
      shape(ctx, p.metal, () => poly(ctx, [s * 0.2, -s * 0.44, s * 0.26, -s * 0.44, s * 0.24, -s * 0.16]), OUTLINE, 1);
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(-s * 0.2, -s * 0.5);
        ctx.rotate(-0.6 + i * 0.5);
        shape(ctx, '#dfe8ec', () => poly(ctx, [-s * 0.015, 0, s * 0.015, 0, 0, -s * 0.34]), OUTLINE, 1);
        ctx.restore();
      }
      break;
    }
    case 'hero_neutral': {
      legs(ctx, s, dark(p.cloth), 0.16);
      body(ctx, s, p.cloth, p.clothShade, p.skin, { bulk: 1.1, height: 0.98 });
      shape(ctx, '#b8923f', () => ellipse(ctx, 0, -s * 0.5, s * 0.2, s * 0.06));
      // tankard + belt
      shape(ctx, p.metalDark, () => rrect(ctx, s * 0.2, -s * 0.34, s * 0.14, s * 0.16, s * 0.03));
      shape(ctx, shadeHex(p.banner, 0.2), () => rect(ctx, -s * 0.2, -s * 0.24, s * 0.4, s * 0.05));
      break;
    }

    /* ---------------- fallback ---------------- */
    default: {
      legs(ctx, s, dark(p.cloth));
      body(ctx, s, p.cloth, p.clothShade, p.skin, {});
      sword(ctx, s * 0.24, -s * 0.3, s * 0.4, p.metal, p.metalDark);
      break;
    }
  }

  if (spec.fly) {
    // faint downwash ring under flying units
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ellipse(ctx, 0, 0, s * 0.3, s * 0.09);
    setStrokeLocal(ctx, '#ffffff', 1);
    ctx.stroke();
    ctx.restore();
  }
};

/* ------------------------------------------------------------------ */
/* local helpers                                                      */
/* ------------------------------------------------------------------ */

function spearOrAxe(ctx: CanvasRenderingContext2D, s: number, p: RacePalette, race: string): void {
  if (race === 'orc') axe(ctx, s * 0.26, -s * 0.3, s * 0.36, p.metal, p.wood);
  else {
    ctx.save();
    ctx.translate(s * 0.24, -s * 0.3);
    ctx.rotate(-0.35);
    ctx.fillStyle = p.wood;
    ctx.fillRect(-s * 0.02, -s * 0.5, s * 0.04, s * 0.6);
    shape(ctx, p.metal, () => poly(ctx, [-s * 0.05, -s * 0.5, s * 0.05, -s * 0.5, 0, -s * 0.68]), OUTLINE, 1);
    ctx.restore();
  }
}

function lance(ctx: CanvasRenderingContext2D, s: number, metal: string, wood: string): void {
  ctx.save();
  ctx.translate(s * 0.2, -s * 0.34);
  ctx.rotate(-0.25);
  ctx.fillStyle = wood;
  ctx.fillRect(-s * 0.022, -s * 0.72, s * 0.044, s * 0.86);
  shape(ctx, metal, () => poly(ctx, [-s * 0.05, -s * 0.72, s * 0.05, -s * 0.72, 0, -s * 0.92]), OUTLINE, 1);
  ctx.restore();
  banner(ctx, -s * 0.1, -s * 0.98, s * 0.1, s * 0.16, '#ffffff', metal);
}

function wolfBody(ctx: CanvasRenderingContext2D, s: number, fur: string, furDark: string): void {
  quadruped(ctx, s, fur, furDark, { legs: 4, neck: 0.26 });
  // hackles
  for (let i = 0; i < 5; i++) {
    const x = -s * 0.24 + i * s * 0.11;
    shape(ctx, furDark, () => poly(ctx, [x - s * 0.02, -s * 0.34, x + s * 0.02, -s * 0.34, x, -s * 0.44]), OUTLINE, 0.8);
  }
}

function hood(ctx: CanvasRenderingContext2D, s: number, top: string, bottom: string): void {
  shape(ctx, top, () => {
    ctx.moveTo(-s * 0.15, -s * 0.5);
    ctx.quadraticCurveTo(0, -s * 0.82, s * 0.15, -s * 0.5);
    ctx.quadraticCurveTo(0, -s * 0.58, -s * 0.15, -s * 0.5);
  });
  ctx.save();
  ctx.globalAlpha = 0.85;
  shape(ctx, bottom, () => ellipse(ctx, 0, -s * 0.6, s * 0.075, s * 0.06));
  ctx.restore();
}

function trident(ctx: CanvasRenderingContext2D, s: number, metal: string, wood: string): void {
  ctx.save();
  ctx.translate(s * 0.26, -s * 0.2);
  ctx.rotate(-0.2);
  ctx.fillStyle = wood;
  ctx.fillRect(-s * 0.022, -s * 0.62, s * 0.044, s * 0.66);
  shape(ctx, metal, () => poly(ctx, [-s * 0.12, -s * 0.62, -s * 0.08, -s * 0.62, -s * 0.1, -s * 0.82]), OUTLINE, 1);
  shape(ctx, metal, () => poly(ctx, [-s * 0.02, -s * 0.62, s * 0.02, -s * 0.62, 0, -s * 0.86]), OUTLINE, 1);
  shape(ctx, metal, () => poly(ctx, [s * 0.08, -s * 0.62, s * 0.12, -s * 0.62, s * 0.1, -s * 0.82]), OUTLINE, 1);
  ctx.restore();
}
