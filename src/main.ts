/**
 * Vite entry point. Thin by design: everything meaningful lives in
 * `src/app/bootstrap.ts` so the same wiring can be driven headless in tests.
 */
import { createApp } from './app/bootstrap.js';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #game canvas');
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') ?? 12345) || 12345;
  const size = Number(params.get('size') ?? 96) || 96;
  const race = params.get('race') === 'orc' ? 'orc' : 'human';
  // ?campaign=human-01 plays a hand-authored level instead of a skirmish.
  const campaign = params.get('campaign');
  const app = createApp({
    canvas,
    seed,
    size,
    race,
    debug: params.get('debug') === '1',
    ...(campaign ? { campaign: { levelId: campaign } } : {}),
  });
  // Handy for debugging from the console; also lets the UI layer reach the app.
  (window as unknown as { __war3?: unknown }).__war3 = app;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
