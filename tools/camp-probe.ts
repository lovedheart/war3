import { startLevel, eidsOf, atTile } from '../src/campaign/index.js';
const g = startLevel('human-01', 7);
const w = g.world as any;
const mines: number[] = w.goldMines;
g.update(1);
const peas = eidsOf(g, 1, 'peasant');
peas.slice(0,3).forEach((p,i)=>g.command({k:'harvest',player:1,worker:p,target:mines[Math.min(i,mines.length-1)],kind:'gold'}));
g.command({k:'harvest',player:1,worker:peas[3],target:w.trees[0],kind:'wood'});
let built=false,last=-1,farms=0;
for (let t=0;t<40000;t++){
  const s=g.snapshot();
  if (!built && s.resources[0].gold>=220 && s.resources[0].lumber>=80){ g.command({k:'build',player:1,worker:peas[3],buildingId:'barracks_human',at:atTile(12,20)}); }
  built=s.buildings.some(b=>b.id==='barracks_human'&&b.built);
  if (built){
    const bar=s.buildings.find(b=>b.id==='barracks_human')!.eid;
    const q=w.stores.building.get(bar)?.trainQueue?.length ?? 0;
    if (g.players[1].supplyCap-g.players[1].supplyUsed < 4 && g.players[1].gold>300) { g.command({k:'build',player:1,worker:peas[3],buildingId:'farm',at:atTile(12+farms*2,22)}); farms++; }
    if (q===0 && g.players[1].gold>=200 && t-last>=600){ g.command({k:'train',player:1,building:bar,unitId:'footman'}); last=t; }
    if (t>9000){ const units=eidsOf(g,1,'footman').slice(0,12); if(units.length) g.command({k:'move',player:1,units,to:atTile(24,8),mode:'attackMove'}); }
  }
  if (!s.units.some(u=>u.player===2) && !s.buildings.some(b=>b.player===2)) { console.log('ENEMY DEAD at tick', t); break; }
  g.update(1);
}
console.log('foeBlds', g.snapshot().buildings.filter(b=>b.player===2).map(b=>b.id+':'+Math.round(b.hp)).join(','), 'tick', g.world.tick);
process.exit(0);
