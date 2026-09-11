/**
 * Which spells need the player to pick a ground point.
 *
 * Shared by the command card (decides whether to ask the app for a point) and
 * by tests that pin the classification against the data table.
 */
const POSITIONAL = ['aoe', 'summon', 'flameStrike', 'clusterRockets', 'line', 'cone', 'teleport'];

export function needsAim(def: { radius?: number; effects?: { kind: string }[] } | undefined): boolean {
  if (!def) return false;
  if ((def.radius ?? 0) > 0) return true;
  return (def.effects ?? []).some((e) => POSITIONAL.includes(e.kind));
}
