/** View state — owned by the presentation layer, read-only for the sim. */
import type { Fixed } from '../core/fixed.js';

export interface ViewState {
  cameraX: Fixed;
  cameraY: Fixed;
  zoom: Fixed;
  /** selected entity ids, ascending eid order */
  selection: number[];
  hoverEid: number;
}
