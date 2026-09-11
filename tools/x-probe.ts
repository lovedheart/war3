import { createGame, spawnUnit, unitSpec } from '../src/sim/index.js';
const g = createGame({ seed: 7, size: 48, players: [
  { id: 1, race: 'human', name: 'P1' }, { id: 2, race: 'orc', name: 'P2' } ] });
const w:any = g.world;
w.spawnUnitById = (id:string,x:number,y:number,p:number)=>{
  const def=(w as any).gameData.units.get(id); if(!def) return 0xffffffff;
  return spawnUnit(w, unitSpec(def), x, y, p);
};
g.update(1);
let hall=-1; for(const e of w.live){ const b=w.stores.building.get(e); if(b?.buildingId==='town_hall') hall=e; }
g.command({k:'train', player:1, building:hall, unitId:'footman'});
for (let t=0;t<605;t++) g.update(1);
console.log('605 done live=', w.live.length);
// Wrap world.tickOnce with a per-tick wall-clock budget to catch the runaway tick.
const oTick = w.tickOnce.bind(w);
try {
  for (let t=0;t<600;t++){
    const a=process.hrtime.bigint(); oTick(); const d=Number(process.hrtime.bigint()-a)/1e6;
    if (d>1000) throw new Error('tick '+w.tick+' took '+d.toFixed(0)+'ms live='+w.live.length);
  }
  console.log('END @'+w.tick);
} catch(e:any){ console.log('THROW: '+e.message); }
process.exit(0);
