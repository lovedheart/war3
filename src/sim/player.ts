/** Per-player state: resources, supply, tech, allies, victory condition. */
import { Fixed, fi } from '../core/fixed.js';
import { UPKEEP_LOW_THRESHOLD, UPKEEP_HIGH_THRESHOLD } from '../core/constants.js';

export type Race = 'human' | 'orc' | 'undead' | 'night_elf' | 'neutral';

export interface PlayerAllyMask {
  /** bit i set => allied with player i (shared vision + no friendly fire) */
  bits: number;
}

export class PlayerState {
  gold = fi(0);
  lumber = fi(0);
  /** population used / supplied */
  supplyUsed = 0;
  supplyCap = 0;
  upkeep: 0 | 1 | 2 = 0;
  race: Race = 'human';
  name = '';
  active = true;
  defeated = false;
  ally: PlayerAllyMask = { bits: 0 };
  /** tech ids researched, insertion order preserved for UI but sorted for hash */
  techs: string[] = [];
  /** per-tech completion tick */
  techDoneTick = new Map<string, number>();
  /** buildings/halls by tier, used to gate training */
  hallTier = 1;
  /** hero slots available from altars */
  altars: number[] = [];
  /** accumulated income accounting for balance reports */
  goldEarned = fi(0);
  lumberEarned = fi(0);
  goldSpent = fi(0);
  lumberSpent = fi(0);
  kills = 0;
  losses = 0;
  score = 0;

  constructor(
    readonly id: number,
    race: Race,
    startGold: Fixed,
    startLumber: Fixed,
  ) {
    this.race = race;
    this.gold = startGold;
    this.lumber = startLumber;
  }

  /** WC3 upkeep: >50 pop = -7g/tick-cycle at 50%, >80 = -17g at 30%. */
  computeUpkeep(): 0 | 1 | 2 {
    if (this.supplyUsed > UPKEEP_HIGH_THRESHOLD) return 2;
    if (this.supplyUsed > UPKEEP_LOW_THRESHOLD) return 1;
    return 0;
  }

  incomeFactor(): Fixed {
    // expressed in fixed: none = 65536, low = 32768 (~50%), high = 19661 (~30%)
    return this.upkeep === 2 ? 19661 : this.upkeep === 1 ? 32768 : 65536;
  }

  hasTech(id: string): boolean {
    return this.techs.includes(id);
  }

  addTech(id: string, tick: number): void {
    if (!this.hasTech(id)) {
      this.techs.push(id);
      this.techs.sort();
      this.techDoneTick.set(id, tick);
    }
  }

  canAfford(gold: Fixed, lumber: Fixed): boolean {
    return this.gold >= gold && this.lumber >= lumber;
  }

  spend(gold: Fixed, lumber: Fixed): void {
    this.gold -= gold;
    this.lumber -= lumber;
    this.goldSpent += gold;
    this.lumberSpent += lumber;
  }

  earn(kind: 'gold' | 'lumber', amount: Fixed): void {
    if (kind === 'gold') {
      const taxed = ((amount * this.incomeFactor()) >> 16) | 0;
      this.gold += taxed;
      this.goldEarned += taxed;
    } else {
      this.lumber += amount;
      this.lumberEarned += amount;
    }
  }

  supplyFree(): number {
    return this.supplyCap - this.supplyUsed;
  }
}

export function isAllied(a: PlayerState, b: PlayerState): boolean {
  if (a.id === b.id) return true;
  return (a.ally.bits & (1 << b.id)) !== 0;
}

export function isEnemy(a: PlayerState, b: PlayerState): boolean {
  return !isAllied(a, b);
}
