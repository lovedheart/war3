import { createGame, spawnUnit, unitSpec } from '../src/sim/index.js';
import { ff } from '../src/core/fixed.js';
const g = createGame({ seed: 7, size: 48, players: [
  { id: 1, race: 'human', name: 'P1' }, { id: 2, race: 'orc', name: 'P2' } ] });
const w:any = g.world;
w.spawnUnitById = (id:string,x:number,y:number,p:number)=>{
  const def=(w as any).gameData.units.get(id); if(!def) return 0xffffffff;
  return spawnUnit(w, unitSpec(def), x, y, p);
};
g.update(1);
let hall=-1; for(const e of w.live){ const b=w.stores.building.get(e); if(b?.buildingId==='town_hall') hall=e; }
console.log('hall', hall.toString(16), 'supplyCap', w.players[1].supplyCap, 'gold', (w.players[1].gold/65536));
g.command({k:'train', player:1, building:hall, unitId:'footman'});
g.update(700);
console.log('queue after:', JSON.stringify(w.stores.building.get(hall)?.trainQueue));
let footmen=0; for(const e of w.live){ if(w.stores.stats.get(e)?.id==='footman') footmen++; }
console.log('footmen:', footmen, 'gold now', (w.players[1].gold/65536));
process.exit(0);
