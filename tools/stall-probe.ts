/**
 * Where-does-it-stall probe. Runs one system at a time so a hang inside a
 * single system is attributable without bisecting by hand.
 *
 *   npx tsx tools/stall-probe.ts
 */
import { createGame } from '../src/sim/index.js';

const game = createGame({
  seed: 7,
  players: [
    { id: 1, race: 'human', name: 'P1' },
    { id: 2, race: 'orc', name: 'P2' },
  ],
});
const w = game.world as unknown as { systems: Array<(w: never, t: number) => void>; live: number[] };
const all = w.systems.slice();
w.systems = [];

let lastTick = -1;
const watchdog = setInterval(() => {
  const cur = (game.world as unknown as { tick: number }).tick;
  process.stderr.write(`\n[watchdog] stalled at tick ${cur} (last completed ${lastTick})\n`);
  process.exit(7);
}, 8000);

for (let i = 0; i < all.length; i++) {
  w.systems = [all[i]];
  const name = all[i].name || `anon#${i}`;
  process.stderr.write(`system[${i}] ${name} ... `);
  try {
    game.update(30);
    lastTick = (game.world as unknown as { tick: number }).tick;
    process.stderr.write(`ok (tick=${lastTick}, live=${w.live.length})\n`);
  } catch (e) {
    process.stderr.write(`THREW: ${(e as Error).message}\n`);
  }
}
clearInterval(watchdog);
w.systems = all;
process.stderr.write('full pipeline 60 ticks ... ');
game.update(60);
process.stderr.write(`ok tick=${(game.world as unknown as { tick: number }).tick}\n`);
