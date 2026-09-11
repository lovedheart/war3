import { createGame } from '../src/sim/index.js';
const g = createGame({ seed: 7, size: 64, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
for(let t=0;t<10;t++) g.update(1);
const w:any=g.world;
for(const b of w.dropoffs.gold){ const tr=w.stores.transform.get(b); console.log('dropoff', (b>>>0).toString(16), (tr.x/65536).toFixed(1),(tr.y/65536).toFixed(1), w.stores.building.get(b)?.buildingId, 'built=',w.stores.building.get(b)?.built); }
process.exit(0);
