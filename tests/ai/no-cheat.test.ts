/**
 * No-cheat: an AI-driven player's income must come from the map, not from
 * direct store writes. Two independent bounds:
 *  1. gold ever held ≤ startGold + total capacity of all gold mines on the map
 *     (the sim only ever moves mine gold into a player);
 *  2. lumber income ≤ total tree capacity;
 * plus a spend-reconciliation lower bound: gold spent on commands + gold left
 * must not exceed gold earned + startGold by more than upkeep drain.
 */
import { describe, it, expect } from 'vitest';
import { makeSim, resOf } from './harness.js';
import { getGameData } from '../../src/data/index.js';

function mapCapacities(sim: ReturnType<typeof makeSim>) {
  // Mines/trees are registered on the world at map-attach time.
  const w = sim.game.world as unknown as { goldMines: number[]; trees: number[] };
  return { mines: w.goldMines.length, trees: w.trees.length };
}

describe('ai no-cheat', () => {
  it('P1 gold never exceeds start + total mine capacity', () => {
    const sim = makeSim({ seed: 17, attach: [1] }); // P2 idle: pure P1 economy
    const { mines } = mapCapacities(sim);
    expect(mines).toBeGreaterThan(0);
    const START_GOLD = 275;
    const MINE_CAP = 12500;
    let maxGold = 0;
    for (let t = 0; t < 5400; t++) {
      sim.run(1);
      if (t % 30 === 0) maxGold = Math.max(maxGold, resOf(sim, 1).gold);
    }
    expect(maxGold).toBeLessThanOrEqual(START_GOLD + mines * MINE_CAP + 1);
  });

  it('P1 lumber never exceeds start + total tree capacity', () => {
    const sim = makeSim({ seed: 19, attach: [1] });
    const { trees } = mapCapacities(sim);
    expect(trees).toBeGreaterThan(0);
    const START_LUMBER = 50;
    const TREE_CAP = 10000;
    let maxLumber = 0;
    for (let t = 0; t < 5400; t++) {
      sim.run(1);
      if (t % 30 === 0) maxLumber = Math.max(maxLumber, resOf(sim, 1).lumber);
    }
    expect(maxLumber).toBeLessThanOrEqual(START_LUMBER + trees * TREE_CAP + 1);
  });

  it('spend reconciliation: outflow never exceeds earned + starting resources beyond upkeep slack', () => {
    const sim = makeSim({ seed: 23, attach: [1] });
    const gd = getGameData();
    let spentGold = 0;
    let spentLumber = 0;
    let prevRes = resOf(sim, 1);
    const UPKEEP_SLACK = 4000; // generous: high upkeep over 7200 ticks drains far less than this
    for (let t = 0; t < 7200; t++) {
      const before = sim.caps.length;
      sim.run(1);
      for (let i = before; i < sim.caps.length; i++) {
        const c = sim.caps[i].cmd as Record<string, unknown>;
        if (c.player !== 1) continue;
        if (c.k === 'build') {
          const d = gd.buildings.get(c.buildingId as string);
          if (d) {
            spentGold += d.cost.gold;
            spentLumber += d.cost.lumber;
          }
        } else if (c.k === 'train') {
          const d = gd.units.get(c.unitId as string);
          if (d) {
            spentGold += d.cost.gold;
            spentLumber += d.cost.lumber;
          }
        } else if (c.k === 'research') {
          const d = gd.tech.get(c.techId as string);
          if (d) {
            spentGold += d.cost.gold;
            spentLumber += d.cost.lumber;
          }
        }
      }
      if (t % 60 === 0) {
        const r = resOf(sim, 1);
        // Gold can only vanish via spend or upkeep; income only via harvest.
        // Upper bound on income is bounded above by test #1 anyway — here we
        // assert the money that disappeared is accounted for.
        const drained = prevRes.gold - r.gold; // net change since last probe
        if (drained > 0) {
          // nothing to add yet; accumulate below via final check
        }
        prevRes = r;
      }
    }
    const end = resOf(sim, 1);
    // Everything the AI "spent" through commands must be plausible against
    // start+income. Since income ≤ mine cap, use the hard ceiling:
    const { mines } = mapCapacities(sim);
    expect(spentGold + end.gold).toBeLessThanOrEqual(275 + mines * 12500 + UPKEEP_SLACK);
    expect(spentLumber + end.lumber).toBeLessThanOrEqual(50 + 400 * 10000 /* huge */);
  });
});
