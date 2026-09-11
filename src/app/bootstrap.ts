/**
 * App bootstrap — the only module that touches the DOM.
 *
 * Wires sim + render + input into a running game and owns the frame loop.
 * Nothing here mutates sim state except `world.view`, which is presentation-owned.
 */
import { createGame, type Game } from '../sim/index.js';
import { generateMap } from '../map/mapgen.js';
import type { Command } from '../sim/commandTypes.js';
import { Renderer } from '../render/index.js';
import { ff, type Fixed } from '../core/fixed.js';
import { FixedStepLoop } from './loop.js';
import { createInput, type InputManager, type InputDeps } from '../input/index.js';
import type { SelectableEntity } from '../input/select.js';
import { isHeroId } from '../render/draw/spec.js';
import { getGameData } from '../data/index.js';

export interface AppOptions {
  canvas: HTMLCanvasElement;
  seed?: number;
  size?: number;
  race?: 'human' | 'orc';
  /** which player this client controls */
  viewer?: number;
  debug?: boolean;
}

export interface App {
  game: Game;
  renderer: Renderer;
  input: InputManager;
  loop: FixedStepLoop;
  destroy(): void;
}

const DEFAULT_SIZE = 96;

/** Map our options onto the shape `createGame` expects (the sim owns it). */
function gameOptions(opts: AppOptions): { seed: number; map: unknown; players: { id: number; race: 'human' | 'orc'; name: string }[] } {
  const mine: 'human' | 'orc' = opts.race ?? 'human';
  const foe: 'human' | 'orc' = mine === 'human' ? 'orc' : 'human';
  const seed = opts.seed ?? 12345;
  return {
    seed,
    // `size` is not a GameOptions field, so generate the map here and pass it in
    map: generateMap({ seed, size: opts.size ?? DEFAULT_SIZE, players: 2 }),
    players: [
      { id: 1, race: mine, name: 'Player 1' },
      { id: 2, race: foe, name: 'Opponent' },
    ],
  };
}

export function createApp(opts: AppOptions): App {
  const canvas = opts.canvas;
  const viewer = opts.viewer ?? 1;
  const game = createGame(gameOptions(opts) as never);

  const renderer = new Renderer({ canvas, debug: opts.debug });
  const viewW = (canvas as unknown as { clientWidth?: number }).clientWidth || 1280;
  const viewH = (canvas as unknown as { clientHeight?: number }).clientHeight || 720;
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  renderer.resize(viewW, viewH, dpr);
  const mapW = (game.terrain as unknown as { width: number }).width;
  const mapH = (game.terrain as unknown as { height: number }).height;
  renderer.cam.setBounds(mapW, mapH);
  centerOnSpawn(renderer, game, viewer);

  const deps: InputDeps = {
    player: viewer,
    command: (cmd: Command) => game.command(cmd),
    getSelection: () => game.world.view.selection,
    setSelection: (eids) => {
      game.world.view.selection = [...eids].sort((a, b) => a - b);
    },
    entities: () => collectSelectable(game),
    screenToWorld: (sx, sy) => renderer.screenToWorld(sx, sy),
    panByPixels: (dx, dy) => {
      renderer.panByPixels(dx, dy);
      syncView(game, renderer);
    },
    zoomBy: (f) => {
      renderer.zoomBy(f);
      syncView(game, renderer);
    },
    viewport: () => ({ w: viewW, h: viewH }),
    setHover: (eid) => {
      game.world.view.hoverEid = eid;
    },
    toggleDebug: () => renderer.setDebug(!renderer.debug),
  };
  const input = createInput(deps);
  input.attach();

  const loop = new FixedStepLoop({
    update: (ticks) => {
      for (let i = 0; i < ticks; i++) {
        input.pump();
        game.update(1);
      }
    },
    render: (alpha) => {
      input.frame(1000 / 30);
      syncView(game, renderer);
      renderer.render(game, alpha);
    },
  });

  const onResize = (): void => {
    const w = (canvas as unknown as { clientWidth?: number }).clientWidth || viewW;
    const h = (canvas as unknown as { clientHeight?: number }).clientHeight || viewH;
    renderer.resize(w, h, (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1);
  };
  const onVisibility = (): void => loop.setPaused(visible() === false);
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  loop.start();

  return {
    game,
    renderer,
    input,
    loop,
    destroy() {
      loop.stop();
      input.detach();
      renderer.destroy();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}

/* ------------------------------------------------------------------ */

function visible(): boolean {
  return typeof document === 'undefined' ? true : !document.hidden;
}

function syncView(game: Game, r: Renderer): void {
  game.world.view.cameraX = r.cam.x;
  game.world.view.cameraY = r.cam.y;
  game.world.view.zoom = r.cam.zoom;
}

/** Open on the player's town hall so the first frame is never black. */
function centerOnSpawn(r: Renderer, game: Game, viewer: number): void {
  const w = game.world as unknown as {
    live: number[];
    stores: {
      transform: { get(e: number): { x: Fixed; y: Fixed } | undefined };
      owner: { get(e: number): { player: number } | undefined };
      building: { get(e: number): unknown };
    };
  };
  for (const e of w.live) {
    if (!w.stores.building.get(e)) continue;
    if (w.stores.owner.get(e)?.player !== viewer) continue;
    const t = w.stores.transform.get(e);
    if (t) {
      r.centerOn(t.x, t.y);
      syncView(game, r);
      return;
    }
  }
  const mapW = (game.terrain as unknown as { width: number }).width;
  const mapH = (game.terrain as unknown as { height: number }).height;
  r.centerOn(ff(mapW / 2), ff(mapH / 2));
  syncView(game, r);
}

/** Snapshot every entity the input layer may click or box-select. */
export function collectSelectable(game: Game): SelectableEntity[] {
  const w = game.world as unknown as {
    live: number[];
    stores: {
      transform: { get(e: number): { x: Fixed; y: Fixed; radius: Fixed } | undefined };
      owner: { get(e: number): { player: number } | undefined };
      kind: { get(e: number): { kind: number } | undefined };
      stats: { get(e: number): { id: string } | undefined };
      health: { get(e: number): { dead: boolean } | undefined };
      building: { get(e: number): unknown };
    };
  };
  const workers = workerIdSet();
  const out: SelectableEntity[] = [];
  for (const e of w.live) {
    const t = w.stores.transform.get(e);
    if (!t) continue;
    if (w.stores.health.get(e)?.dead) continue;
    const kind = w.stores.kind.get(e)?.kind ?? 0;
    if (kind > 2) continue; // decorations and missiles are not selectable
    const id = w.stores.stats.get(e)?.id ?? '';
    out.push({
      eid: e >>> 0,
      x: t.x,
      y: t.y,
      radius: t.radius,
      player: w.stores.owner.get(e)?.player ?? 0,
      kind,
      unitId: id,
      isHero: isHeroId(id),
      isWorker: workers.has(id),
      alive: true,
    });
  }
  return out;
}

let cachedWorkers: Set<string> | null = null;
function workerIdSet(): Set<string> {
  if (cachedWorkers) return cachedWorkers;
  const s = new Set<string>();
  try {
    const gd = getGameData();
    for (const r of Object.values(gd.races)) if (r.worker) s.add(r.worker);
  } catch {
    s.add('peasant').add('peon').add('acolyte').add('worker');
  }
  cachedWorkers = s;
  return s;
}
