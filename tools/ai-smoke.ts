import { createGame } from '../src/sim/index.js';
const g = createGame({ seed: 7, size: 64, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
g.update(1); const s0=g.snapshot(); const hall=s0.buildings.find(b=>b.player===1&&b.id==='town_hall')!;
for(let i=0;i<5;i++) g.command({k:'train',player:1,building:hall.eid,unitId:'peasant'});
let ev=0; let last='';
for(let t=0;t<=4000&&ev<8;t++){ g.update(1); const s=g.snapshot();
 const sig=s.units.filter(u=>u.player===1).map(u=>`${u.id}:${(u.eid>>>0).toString(16)}`).sort().join();
 if(sig!==last){ console.log(`t=${t} ${sig}`); last=sig; ev++; } }
process.exit(0);
