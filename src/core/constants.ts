/**
 * Shared constants: timing, space units and global tuning.
 *
 * Unit convention: 1 game distance unit == 1 tile == ff(1) fixed.
 * WC3 terrain tiles are ~64px at 1x zoom, so TILE_SIZE_PX is render-only
 * and never enters simulation math.
 */
import { ff } from './fixed.js';

/** Logic ticks per second (WC3 runs ~30 logic ticks/s). */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

/** One terrain tile edge, in game units. */
export const TILE_UNITS = 1;
export const TILE_SIZE_PX = 64;
export const GRID_PER_TILE = 1;

export const MAX_PLAYERS = 12;
export const NEUTRAL_PASSIVE_PLAYER = 11;
export const NEUTRAL_AGGRESSIVE_PLAYER = 12;
export const PLAYER_NONE = 0;

/** Combat timing. */
export const DEFAULT_ATTACK_POINT = ff(0.5);
export const DEFAULT_BACKSTOP = ff(0.3);
export const CORPSE_DECAY = ff(10);
export const RUIN_DECAY = ff(60);

/** Chase leash: how far from the order target before returning. */
export const CHASE_LEASH = ff(24);
/** Acquire range beyond attack range for auto-acquire. */
export const ACQUIRE_EXTRA = ff(2);

/** Movement. */
export const DEFAULT_TURN_RATE = ff(360);

/** Economy. */
export const STARTING_WORKERS = 4;
export const GOLD_MINE_CAPACITY = 1250;
export const WORKER_CARRY_DEFAULT = 10;
export const UPKEEP_LOW_THRESHOLD = 50;
export const UPKEEP_HIGH_THRESHOLD = 80;
export const UPKEEP_LOW_GOLD_DRAIN = 7;
export const UPKEEP_HIGH_GOLD_DRAIN = 17;
export const UPKEEP_LOW_INCOME_FACTOR = 0.5;
export const UPKEEP_HIGH_INCOME_FACTOR = 0.3;

/** Hero. */
export const HERO_MAX_LEVEL = 10;
export const ITEM_SLOTS = 6;
export const REVIVE_TIME_BASE = ff(45); // + 5s per hero level

/** Fog of war states. */
export const FOG_UNEXPLORED = 0;
export const FOG_EXPIRED = 1; // previously seen, no live vision
export const FOG_VISIBLE = 2;

/** Command queue limits. */
export const MAX_QUEUED_ORDERS = 32;
export const MAX_SELECTION_GROUP = 12;
