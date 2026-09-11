import { createGame, spawnUnit, unitSpec } from '../src/sim/index.js';
import { Store } from '../src/ecs/store.js';
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
let calls=0; let where='';
const proto = Store.prototype as any;
for (const m of ['get','add','has','remove']) {
  const orig = proto[m];
  proto[m] = function(...a:any[]){ if(++calls > 5_000_000 && !where){ where = m+' budget blown at tick '+w.tick; throw new Error(where);} return orig.apply(this,a); };
}
try { for (let t=0;t<600;t++) g.update(1); console.log('DONE calls='+calls); }
catch(e:any){ console.log('STOP:', e.message, 'calls='+calls); }
process.exit(0);
