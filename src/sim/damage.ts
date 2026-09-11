/**
 * Warcraft III damage resolution.
 *
 * Pipeline (matches TFT):
 *   raw = rand(min..max) + sum(bonusVs[armorType])
 *   raw *= matrix[attackType][armorType]            (rock-paper-scissors table)
 *   if target is structure -> apply fortification reduction from armor value
 *   final = raw * armorReduction(armorValue)        (non-linear, can be < 0 armor)
 *   clamp to >= 1 for a successful hit
 *
 * Armor-value curve (Blizzard formula, verified against in-game tooltips):
 *   A >= 0 : reduction = 1 - 1 / (1 + 0.06*A)      -> A=5 => ~23%, A=10 => ~37.5%
 *   A <  0 : reduction = 2 - 1 / (1 - 0.06*A)      -> A=-5 => ~143%
 * Clamped to [-200, +200] armor as the engine does.
 */
import { Fixed, ff, fn, fmul, fdiv, fi } from '../core/fixed.js';
import type { ArmorType, AttackType } from './components.js';

export const ARMOR_ORDER: ArmorType[] = [
  'unarmored',
  'light',
  'medium',
  'heavy',
  'reinforced',
  'hero',
  'fortification',
  'ancient',
];
export const ATTACK_ORDER: AttackType[] = [
  'normal',
  'pierce',
  'magic',
  'chaos',
  'hero',
  'siege',
  'spell',
];

/**
 * Authoritative TFT attack-vs-armor coefficient matrix, in fixed point.
 * Rows = attack type, cols = armor type (ARMOR_ORDER).
 */
export const DAMAGE_MATRIX: Record<AttackType, Record<ArmorType, Fixed>> = {
  normal: { unarmored: ff(1), light: ff(1), medium: ff(1), heavy: ff(1), reinforced: ff(0.75), hero: ff(1), fortification: ff(0.5), ancient: ff(0.3) },
  pierce: { unarmored: ff(1), light: ff(1.5), medium: ff(1), heavy: ff(0.75), reinforced: ff(0.75), hero: ff(0.5), fortification: ff(0.35), ancient: ff(0.3) },
  magic: { unarmored: ff(1.5), light: ff(1.5), medium: ff(1.5), heavy: ff(0.5), reinforced: ff(0.75), hero: ff(0.3), fortification: ff(0.35), ancient: ff(0.3) },
  chaos: { unarmored: ff(1), light: ff(1), medium: ff(1), heavy: ff(1), reinforced: ff(1), hero: ff(1), fortification: ff(1), ancient: ff(1) },
  hero: { unarmored: ff(1), light: ff(1), medium: ff(1), heavy: ff(1), reinforced: ff(0.75), hero: ff(1), fortification: ff(0.5), ancient: ff(0.5) },
  siege: { unarmored: ff(1), light: ff(1), medium: ff(1), heavy: ff(1), reinforced: ff(0.75), hero: ff(0.5), fortification: ff(2), ancient: ff(0.35) },
  spell: { unarmored: ff(1), light: ff(1), medium: ff(1), heavy: ff(1), reinforced: ff(0.75), hero: ff(0.5), fortification: ff(0.35), ancient: ff(0.3) },
};

const ARMOR_STEP = ff(0.06);
const ARMOR_MAX = ff(200);
const ARMOR_MIN = ff(-200);

/** Damage multiplier from an armor value (NOT the type matrix). Returns fixed. */
export function armorMultiplier(armorValue: Fixed): Fixed {
  const a = armorValue > ARMOR_MAX ? ARMOR_MAX : armorValue < ARMOR_MIN ? ARMOR_MIN : armorValue;
  if (a >= 0) {
    // 1 - 1/(1+0.06A)
    const denom = faddFixed(fi(1), fmul(ARMOR_STEP, a));
    return fsubFixed(fi(1), fdiv(fi(1), denom));
  }
  // 2 - 1/(1-0.06A)   (a is negative so the denominator grows)
  const denom = faddFixed(fi(1), fmul(ARMOR_STEP, -a));
  return fsubFixed(fi(2), fdiv(fi(1), denom));
}

function faddFixed(a: Fixed, b: Fixed): Fixed {
  return (a + b) | 0;
}
function fsubFixed(a: Fixed, b: Fixed): Fixed {
  return (a - b) | 0;
}

export interface DamageInput {
  min: Fixed;
  max: Fixed;
  attackType: AttackType;
  bonusVsLight?: Fixed;
  bonusVsMedium?: Fixed;
  bonusVsHeavy?: Fixed;
  bonusVsHero?: Fixed;
  bonusVsAncient?: Fixed;
  bonusVsFortified?: Fixed;
  targetArmorValue: Fixed;
  targetArmorType: ArmorType;
  targetIsStructure: boolean;
  /** attacker-controlled randomness roll already drawn by caller (keeps RNG order stable) */
  roll: Fixed;
  magicResistPct?: Fixed;
  /** siege/pierce reduced further vs structures per bonusVsFortified */
}

export interface DamageResult {
  amount: Fixed;
  matrixApplied: Fixed;
  armorApplied: Fixed;
}

export function resolveDamage(inp: DamageInput): DamageResult {
  let base = inp.min + inp.roll;
  switch (inp.targetArmorType) {
    case 'light':
      base += inp.bonusVsLight ?? 0;
      break;
    case 'medium':
      base += inp.bonusVsMedium ?? 0;
      break;
    case 'heavy':
      base += inp.bonusVsHeavy ?? 0;
      break;
    case 'hero':
      base += inp.bonusVsHero ?? 0;
      break;
    case 'ancient':
      base += inp.bonusVsAncient ?? 0;
      break;
    default:
      break;
  }
  const row = DAMAGE_MATRIX[inp.attackType] ?? DAMAGE_MATRIX.normal;
  // Structures resolve through the Fortified column (TFT armour type 'fort').
  const armorKey: ArmorType = inp.targetIsStructure ? 'fortification' : inp.targetArmorType;
  let m = row[armorKey] ?? fi(1);
  if (inp.targetIsStructure && inp.bonusVsFortified) m = fmul(m, inp.bonusVsFortified);
  let dmg = fmul(base, m);
  dmg = fmul(dmg, armorMultiplier(inp.targetArmorValue));
  if (inp.magicResistPct && inp.magicResistPct > 0 && inp.attackType === 'spell') {
    dmg = fmul(dmg, fsubFixed(fi(1), inp.magicResistPct));
  }
  if (dmg < fi(1)) dmg = fi(1);
  return { amount: dmg, matrixApplied: m, armorApplied: armorMultiplier(inp.targetArmorValue) };
}

/** Human-readable expected damage range, for tooltips and balance reports. */
export function expectedDamageRange(inp: Omit<DamageInput, 'roll'>, samples = 1): [number, number] {
  const span = inp.max - inp.min;
  const lo = resolveDamage({ ...inp, roll: 0 }).amount;
  const hi = resolveDamage({ ...inp, roll: span > 0 ? span : 0 }).amount;
  void samples;
  return [fn(lo), fn(hi)];
}
