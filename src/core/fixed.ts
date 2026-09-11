/**
 * Deterministic fixed-point arithmetic.
 *
 * The simulation MUST be bit-reproducible across runs (for replays, lockstep
 * and headless regression hashes). IEEE-754 doubles are not safe for that
 * across engines, so all gameplay state uses 16.16 two's-complement fixed point.
 *
 * SCALE = 65536  -> resolution ~1.5e-5, range +-32768. Plenty for RTS values.
 */
export const FP_SHIFT = 16;
export const FP_SCALE = 1 << FP_SHIFT; // 65536
export const FP_ONE = FP_SCALE;
export const FP_HALF = FP_SCALE >> 1;

/** Fixed-point saturates at int32 bounds; see ff(). */
export const INT_MAX = 2147483647;
export const INT_MIN = -2147483648;

export type Fixed = number; // integer, always a multiple relationship of 1/65536

const CACHE_BITS = 9;
const CACHE_SIZE = 1 << CACHE_BITS;
const CACHE_LO = -(CACHE_SIZE >> 1);
const intCache: Fixed[] = [];
for (let i = 0; i < CACHE_SIZE; i++) intCache[i] = (i + CACHE_LO) << FP_SHIFT;

/** Convert an integer to fixed. */
export function fi(n: number): Fixed {
  const i = n | 0;
  if (i >= CACHE_LO && i < CACHE_LO + CACHE_SIZE) return intCache[i - CACHE_LO];
  return i * FP_SCALE;
}

/** Convert a JS number (possibly fractional) to fixed. Use only at load time. */
export function ff(n: number): Fixed {
  const v = Math.round(n * FP_SCALE);
  // `| 0` wraps past int32, which would silently turn e.g. a 100k-gold
  // threshold into a negative number and invert every comparison against it.
  if (v > INT_MAX) return INT_MAX;
  if (v < INT_MIN) return INT_MIN;
  return v | 0;
}

/** Convert fixed to a JS number. NEVER use inside the sim loop for state. */
export function fn(x: Fixed): number {
  return x / FP_SCALE;
}

export function fadd(a: Fixed, b: Fixed): Fixed {
  return (a + b) | 0;
}

export function fsub(a: Fixed, b: Fixed): Fixed {
  return (a - b) | 0;
}

/** Multiply two fixed values with correct rounding. */
export function fmul(a: Fixed, b: Fixed): Fixed {
  const p = a * b; // |a*b| < 2^62 in practice -> exact double mantissa
  // NOTE: `>>` is forbidden here — it coerces to int32 and silently discards
  // everything above bit 31, so any product >= 2^48 (i.e. |operand| >= 1024)
  // would come back as 0. Truncating division is the correct 53-bit-safe shift.
  const r = p >= 0 ? Math.floor((p + FP_HALF) / FP_SCALE) : Math.ceil((p - FP_HALF) / FP_SCALE);
  return r | 0;
}

/** Divide two fixed values. Returns 0 on divide-by-zero (callers must guard). */
export function fdiv(a: Fixed, b: Fixed): Fixed {
  if (b === 0) return 0;
  // (a << 16) / b using splitting to stay inside double precision.
  const hi = a >> FP_SHIFT;
  const lo = a & (FP_SCALE - 1);
  return (((hi * FP_SCALE) / b) * FP_SCALE + (lo * FP_SCALE) / b) | 0;
}

/** Integer division of fixed by a plain integer count (cheap average). */
export function fdivi(a: Fixed, n: number): Fixed {
  return n === 0 ? 0 : Math.round(a / n) | 0;
}

export function fneg(a: Fixed): Fixed {
  return -a | 0;
}

export function fabs(a: Fixed): Fixed {
  return a < 0 ? -a : a;
}

export function fmin(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function fmax(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}

export function fclamp(v: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return v < lo ? lo : v > hi ? hi : v;
}

export function fcmp(a: Fixed, b: Fixed): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** floor(fixed) as integer */
export function ffloor(x: Fixed): number {
  return x >> FP_SHIFT;
}

/** round(fixed) as integer */
export function fround(x: Fixed): number {
  return (x + FP_HALF) >> FP_SHIFT;
}

/**
 * Integer square root of a fixed value, returning fixed.
 * Newton iterations on a double seed, then verified downward so the result is
 * deterministic and never overestimates sqrt by more than 1 LSB.
 */
export function fsqrt(x: Fixed): Fixed {
  if (x <= 0) return 0;
  let r = Math.round(Math.sqrt(x * FP_SCALE));
  // Correct toward the true fixed-point sqrt within +-2 LSB deterministically.
  for (let i = 0; i < 3; i++) {
    const q = fdivi(fmul(r, r), FP_ONE);
    if (q === x) break;
    r = ((r + fdiv(x, r) ) >> 1) | 0;
    if (r <= 0) return 1;
  }
  while (fmul(r, r) > x) r--;
  while (fmul(r + 1, r + 1) <= x) r++;
  return r | 0;
}

/** Squared distance between two fixed points (fixed). Avoids one sqrt. */
export function fdist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  const dx = fsub(ax, bx);
  const dy = fsub(ay, by);
  return fadd(fmul(dx, dx), fmul(dy, dy));
}

export function fdist(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  return fsqrt(fdist2(ax, ay, bx, by));
}

/** Format for debug output. */
export function fstr(x: Fixed, digits = 2): string {
  return fn(x).toFixed(digits);
}
