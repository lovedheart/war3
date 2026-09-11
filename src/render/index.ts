/**
 * Public surface of the procedural render layer.
 *
 * The app layer should import only from here:
 *   import { Renderer, Camera } from './render';
 */
export { Renderer, type RendererOptions, type RenderStats } from './renderer.js';
export {
  drawGround, drawEntities, drawFog, drawOverlays, drawDebug,
  sortEntities, collectEntities, entityScreenPos, entityVisible, tileVisible,
  fogSource, fogPixelRect, viewerOf, selectionSet, stores, hitFlash,
  drawSelectionRing, makeImageData, ellipsePath,
  type DrawEntityItem, type FrameCtx, type Stores,
} from './layers.js';
export { Camera, MinimapTransform, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, type CameraOptions, type CameraBounds } from './camera.js';
export {
  SpriteAtlas, bakeKey, drawSprite, drawSpriteSilhouette, registerStock, guessRace, splitKey, slotSize,
  ATLAS_PAGE_PX, ATLAS_GUTTER, defaultCanvasFactory, type AtlasEntry, type CanvasFactory,
} from './atlas.js';
export {
  fogStateAt, fillFogImageData, fogTileRange, rectVisibility, fogStats, type FogSource, type FogLike,
} from './fogmask.js';
export {
  MinimapRenderer, blipColor, MINIMAP_BLIP_SIZE, type MinimapBlip, type MinimapOptions,
} from './minimap.js';
export {
  ParticleSystem, FloaterLayer,
  emitHit, emitDeath, emitBuild, emitExplosion, emitHeal, emitBlizzard, emitFlameStrike,
  type Particle, type ParticleKind, type EmitOptions, type Floater,
} from './particles.js';
export {
  PLAYER_COLORS, PLAYER_COLORS_DARK, playerColor, playerColorDark, healthBarColor,
  RACES, racePalette, TERRAIN, terrainSwatch, terrainVariant, UI, FOG_ALPHA, FOG_EXPIRED_WASH,
  hexToRgb, rgbToHex, mixHex, shadeHex, tintHex, desaturateHex, withAlpha, hash2, hashStr, rand01,
  type RaceId, type RacePalette,
} from './palette.js';
export {
  spriteKey, parseSpriteKey, shapeFor, isHeroId, footprintPx,
  SLOT_PX, HERO_SLOT_PX, UNIT_SHAPES, BUILDING_SHAPES, ITEM_SHAPES, DECORATION_SHAPES, MISSILE_SHAPES,
  type ArtCategory, type DrawSpec, type DrawFn, type Ctx2D,
} from './draw/spec.js';
export { drawUnit } from './draw/unit.js';
export { drawBuilding } from './draw/building.js';
export { drawItem } from './draw/item.js';
export { drawDecoration } from './draw/decoration.js';
export { drawMissile } from './draw/missile.js';
