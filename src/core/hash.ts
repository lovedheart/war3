/**
 * FNV-1a 32/128-ish rolling hash used for state-hash regression tests and
 * replay divergence detection. Feed integers in a canonical order.
 */
export class Hasher {
  private h = 0x811c9dc5 >>> 0;
  private n = 0;

  int(v: number): this {
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 0x01000193) >>> 0;
      x >>= 8;
    }
    this.n++;
    return this;
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i) & 0xff;
      this.h = Math.imul(this.h, 0x01000193) >>> 0;
      this.h ^= (s.charCodeAt(i) >>> 8) & 0xff;
      this.h = Math.imul(this.h, 0x01000193) >>> 0;
    }
    this.n++;
    return this;
  }

  get count(): number {
    return this.n;
  }

  digest(): number {
    return this.h >>> 0;
  }

  hex(): string {
    return this.digest().toString(16).padStart(8, '0');
  }
}
