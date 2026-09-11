import { createSkirmishWorld } from '../src/sim/index.js';
import { generateMap } from '../src/map/mapgen.js';
const g = generateMap({ seed: 1234, size: 64, players: 2 });
const w = createSkirmishWorld({ seed: 1234, mapJson: { name:'t', size:[g.terrain.width,g.terrain.height], tiles: [], spawns: g.spawns.map(p=>[Math.floor(p.x/65536),Math.floor(p.y/65536)]), mines: g.mines.map(m=>[Math.floor(m.x/65536),Math.floor(m.y/65536),m.capacity]), trees: [] } });
const snap = () => {
  const s = (w.world as any).stores;
  const units:any[]=[], blds:any[]=[];
  for (const e of w.world.live) {
    const st=s.stats.get(e), b=s.building?.get(e);
    if (b) blds.push(b.buildingId);
    else if (st) units.push(st.id);
  }
  return {units,blds};
};
console.log('t0', JSON.stringify(snap()));
w.world.run(600);
console.log('t600', JSON.stringify(snap()));
const ps=(w.world as any).players;
console.log('p1 gold/lumber', ps[1].gold/65536, ps[1].lumber/65536, 'supply', ps[1].supplyUsed, '/', ps[1].supplyCap);
