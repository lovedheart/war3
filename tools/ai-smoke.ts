import { createGame, spawnUnit, unitSpec } from '../src/sim/index.js';
const g = createGame({ seed: 7, size: 64, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
const w:any=g.world;
w.spawnUnitById = (id:string,x:number,y:number,p:number)=>{ const def=(w as any).gameData.units.get(id); if(!def) return 0xffffffff; return spawnUnit(w, unitSpec(def), x, y, p); };
g.update(1); const s0=g.snapshot(); const hall=s0.buildings.find(b=>b.player===1&&b.id==='town_hall')!;
for(let i=0;i<5;i++) g.command({k:'train',player:1,building:hall.eid,unitId:'peasant'});
let prev=-1; let ev=0;
for(let t=0;t<=3000&&ev<8;t++){ g.update(1); const n=g.snapshot().units.filter(u=>u.player===1&&u.id==='peasant').length; if(n!==prev){console.log(`t=${t} n=${n}`); prev=n; ev++;} }
process.exit(0);
