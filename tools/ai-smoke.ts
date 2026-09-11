import { createGame } from '../src/sim/index.js';
import { createAiController } from '../src/ai/index.js';
const g = createGame({ seed: 7, size: 64, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
const a1=createAiController(g,1,'normal'); const a2=createAiController(g,2,'normal');
for(let t=0;t<7200;t++){ a1.update();a2.update();g.update(1); if(t%900===0){ const s=g.snapshot();
 const u=s.units.filter(x=>x.player===1); const b=s.buildings.filter(x=>x.player===1&&x.built);
 console.log(`t=${t} ${a1.state} g=${Math.round(s.resources[0].gold)} w=${Math.round(s.resources[0].lumber)} army=${u.filter(x=>x.id!=='peasant').length} pop=${s.resources[0].supplyUsed}/${s.resources[0].supplyCap} [${b.map(x=>x.id).join(',')}]`);} }
process.exit(0);
