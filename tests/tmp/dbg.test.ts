import { describe, expect, it } from 'vitest';
import { Terrain } from '../../src/map/terrain.js';
describe('dbg', () => {
  it('basic', () => {
    const t = new Terrain(8, 8);
    console.log('tile(5,5)=', t.tile(5,5), 'walk=', t.walkable(5,5));
    console.log('tiles[45]=', t.tiles[45], 'len=', t.tiles.length);
    console.log('tileToWorld(3)=', t.tileToWorld(3));
    t.setTile(2,2,4);
    console.log('after water setTile walk(2,2)=', t.walkable(2,2));
    expect(true).toBe(true);
  });
});
