import { createGame, spawnUnit } from '../src/sim/index.js';
import { getGameData } from '../src/data/index.js';
const g = createGame({ seed: 7, size: 64, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
const w:any=g.world; const gd=getGameData();
w.spawnUnitById = (id:string,x:number,y:number,p:number)=>{ const d=gd.units.get(id)!; return spawnUnit(w,{id,radius:d.stats.radius??0.4,hp:d.stats.hp,armor:d.stats.armor,armorType:d.stats.armorType,speed:d.stats.speed,vision:d.stats.vision??4,damage:d.damage,popUpkeep:d.cost.popUpkeep??1} as any,x,y,p); };
g.update(1); const s0=g.snapshot(); const hall=s0.buildings.find(b=>b.player===1&&b.id==='town_hall')!;
for(let i=0;i<5;i++) g.command({k:'train',player:1,building:hall.eid,unitId:'peasant'});
let prev=-1;
for(let t=0;t<=2000;t++){ g.update(1); const n=g.snapshot().units.filter(u=>u.player===1&&u.id==='peasant').length; if(n!==prev){console.log(`t=${t} n=${n}`); prev=n;} }
process.exit(0);
