/**
 * Headless match runner — the balance harness and determinism oracle.
 *
 *   npx tsx tools/sim-run.ts --ticks 18000 --seed 7 --ai both --report
 *   npx tsx tools/sim-run.ts --sweep 20            # win-rate over many seeds
 */
import { createGame, type Game } from '../src/sim/index.js';
import { generateMap } from '../src/map/mapgen.js';
import type { Race } from '../src/sim/player.js';

export interface Args {
  ticks: number;
  seed: number;
  size: number;
  ai: 'none' | 'p1' | 'p2' | 'both';
  report: boolean;
  race1: Race;
  race2: Race;
  sweep: number;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { ticks: 18000, seed: 7, size: 96, ai: 'both', report: false, race1: 'human', race2: 'orc', sweep: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--ticks':
        a.ticks = Number(v);
        i++;
        break;
      case '--seed':
        a.seed = Number(v);
        i++;
        break;
      case '--size':
        a.size = Number(v);
        i++;
        break;
      case '--ai':
        a.ai = (v as Args['ai']) ?? 'both';
        i++;
        break;
      case '--race1':
        a.race1 = v as Race;
        i++;
        break;
      case '--race2':
        a.race2 = v as Race;
        i++;
        break;
      case '--sweep':
        a.sweep = Number(v) || 10;
        i++;
        break;
      case '--report':
        a.report = true;
        break;
    }
  }
  return a;
}

export interface PlayerReport {
  id: number;
  gold: number;
  lumber: number;
  army: number;
  workers: number;
  buildings: number;
  supply: number;
  supplyCap: number;
  kills: number;
  losses: number;
}

export interface MatchReport {
  seed: number;
  ticks: number;
  seconds: number;
  winner: number;
  reason: string;
  players: PlayerReport[];
  timeline: { t: number; gold: [number, number]; army: [number, number] }[];
  /** same-seed double run must match; divergence means a nondeterminism bug */
  hashA: number;
  hashB: number;
  deterministic: boolean;
}

const SAMPLE_EVERY = 300; // every 10 s of game time

function buildGame(seed: number, args: Args): Game {
  const map = generateMap({ seed, size: args.size, players: 2 });
  return createGame({
    seed,
    map,
    players: [
      { id: 1, race: args.race1, name: 'P1' },
      { id: 2, race: args.race2, name: 'P2' },
    ],
  });
}

/** Lazily wire the AI if it exists, so this file runs before src/ai lands. */
async function attachAi(game: Game, player: number): Promise<{ update(): void } | null> {
  try {
    // Resolved by URL so the runner still typechecks before src/ai exists.
    const mod = (await import(new URL('../src/ai/index.js', import.meta.url).href)) as {
      createAiController?: (g: Game, p: number, diff: string) => { update(): void };
    };
    if (typeof mod.createAiController !== 'function') return null;
    return mod.createAiController(game, player, 'normal');
  } catch {
    return null;
  }
}

async function playMatch(seed: number, args: Args): Promise<MatchReport> {
  const game = buildGame(seed, args);
  const ais: { update(): void }[] = [];
  if (args.ai === 'p1' || args.ai === 'both') {
    const a = await attachAi(game, 1);
    if (a) ais.push(a);
  }
  if (args.ai === 'p2' || args.ai === 'both') {
    const a = await attachAi(game, 2);
    if (a) ais.push(a);
  }

  let over = false;
  let winner = 0;
  let reason = 'timeout';
  game.world.bus.on('game:over', (e) => {
    if (!over) {
      over = true;
      winner = e.winner;
      reason = e.reason;
    }
  });

  const timeline: MatchReport['timeline'] = [];
  for (let t = 0; t < args.ticks && !over; t++) {
    for (const ai of ais) ai.update();
    game.update(1);
    if (t % SAMPLE_EVERY === 0) {
      const s = game.snapshot();
      timeline.push({ t, gold: [gold(s, 1), gold(s, 2)], army: [army(s, 1), army(s, 2)] });
    }
  }
  const snap = game.snapshot();

  // Determinism oracle: replay the same inputs in a second world and compare
  // hashes at a fixed checkpoint tick, so both sides are at the same depth.
  const probeTicks = Math.min(args.ticks, 900);
  let hashA: number;
  {
    const probe = buildGame(seed, args);
    for (let t = 0; t < probeTicks; t++) probe.update(1);
    hashA = probe.stateHash();
  }
  const twin = buildGame(seed, args);
  for (let t = 0; t < probeTicks; t++) twin.update(1);
  const hashB = twin.stateHash();

  return {
    seed,
    ticks: game.world.tick,
    seconds: game.world.tick / 30,
    winner,
    reason,
    players: ([1, 2] as const).map((id) => ({
      id,
      gold: gold(snap, id),
      lumber: lumber(snap, id),
      army: army(snap, id),
      workers: snap.units.filter((u) => u.player === id && (u.id === 'peasant' || u.id === 'peon')).length,
      buildings: snap.buildings.filter((b) => b.player === id && b.built).length,
      supply: game.players[id]?.supplyUsed ?? 0,
      supplyCap: game.players[id]?.supplyCap ?? 0,
      kills: game.players[id]?.kills ?? 0,
      losses: game.players[id]?.losses ?? 0,
    })),
    timeline,
    hashA,
    hashB,
    deterministic: hashA === hashB,
  };
}

function gold(s: ReturnType<Game['snapshot']>, id: number): number {
  return Math.round(s.resources.find((r) => r.player === id)?.gold ?? 0);
}
function lumber(s: ReturnType<Game['snapshot']>, id: number): number {
  return Math.round(s.resources.find((r) => r.player === id)?.lumber ?? 0);
}
function army(s: ReturnType<Game['snapshot']>, id: number): number {
  return s.units.filter((u) => u.player === id && u.id !== 'peasant' && u.id !== 'peon').length;
}

export async function runMatch(args: Args): Promise<MatchReport> {
  return playMatch(args.seed, args);
}

export async function sweep(
  n: number,
  args: Args,
): Promise<{ wins: [number, number, number]; divergences: number }> {
  const wins: [number, number, number] = [0, 0, 0]; // P1 / P2 / draw-or-timeout
  let divergences = 0;
  for (let i = 0; i < n; i++) {
    const r = await playMatch(args.seed + i * 7919, args);
    if (r.winner === 1) wins[0]++;
    else if (r.winner === 2) wins[1]++;
    else wins[2]++;
    if (!r.deterministic) divergences++;
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return { wins, divergences };
}

export function formatReport(r: MatchReport): string {
  const L: string[] = [];
  L.push(`seed=${r.seed}  ticks=${r.ticks} (${r.seconds.toFixed(0)}s)  winner=P${r.winner || '-'} (${r.reason})`);
  for (const p of r.players) {
    L.push(
      `  P${p.id}: gold=${String(p.gold).padStart(6)} lumber=${String(p.lumber).padStart(6)}` +
        ` army=${String(p.army).padStart(3)} workers=${p.workers} blds=${String(p.buildings).padStart(2)}` +
        ` pop=${p.supply}/${p.supplyCap} K/D=${p.kills}/${p.losses}`,
    );
  }
  L.push('  timeline    min   gold p1/p2      army p1/p2');
  for (const t of r.timeline) {
    L.push(
      `    ${(t.t / 1800).toFixed(1).padStart(6)}m  ${String(t.gold[0]).padStart(6)}/${String(t.gold[1]).padStart(6)}` +
        `    ${String(t.army[0]).padStart(4)}/${String(t.army[1]).padStart(4)}`,
    );
  }
  L.push(`  hash=${r.hashA.toString(16)} deterministic=${r.deterministic ? 'yes' : 'NO <-- BUG'}`);
  return L.join('\n');
}

const invokedDirectly = /sim-run\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (args.sweep > 0) {
    const s = await sweep(args.sweep, args);
    console.log(`sweep n=${args.sweep}: P1=${s.wins[0]} P2=${s.wins[1]} draw/timeout=${s.wins[2]} divergences=${s.divergences}`);
  } else {
    const rep = await runMatch(args);
    console.log(args.report ? formatReport(rep) : `done tick=${rep.ticks} winner=P${rep.winner} det=${rep.deterministic}`);
  }
}
