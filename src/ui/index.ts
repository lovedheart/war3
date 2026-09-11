/**
 * HUD entry point. Everything above the canvas world layer lives here:
 * resource bar, command card, selection info, minimap panel, tooltips, alerts.
 * The HUD is strictly read-only against the simulation — every interaction
 * leaves through `dispatch(Command)`.
 */
export { createHud } from './hud.js';
export type { Hud, HudOptions, UiMount } from './hud.js';
export type { PlacementRequest, PendingTarget, CardSelection, SelRecord } from './commandcard.js';
export { CommandCard } from './commandcard.js';
export { injectStyles, CSS, STYLE_ID } from './styles.js';
export { paintIcon, glyphFor, hashId, tintFor } from './icons.js';
export {
  createTooltip,
  unitTip,
  buildingTip,
  techTip,
  abilityTip,
  itemTip,
  costText,
} from './tooltip.js';
export type { Tooltip, TipLine } from './tooltip.js';
