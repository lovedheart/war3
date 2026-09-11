import { startLevel, eidsOf } from '../src/campaign/index.js';
const g = startLevel('human-01', 7);
const w = g.world as any;
const mines: number[] = w.goldMines;
g.update(1);
const peas = eidsOf(g, 1, 'peasant');
peas.slice(0,3).forEach((p,i)=>g.command({k:'harvest',player:1,worker:p,target:mines[Math.min(i,mines.length-1)],kind:'gold'}));
g.command({k:'harvest',player:1,worker:peas[3],target:w.trees[0],kind:'wood'});
let site=0,built=false,trains=0;
for (let t=0;t<40000;t++){
  const s=g.snapshot();
  if (!site && s.resources[0].gold>=220 && s.resources[0].lumber>=80){ g.command({k:'build',player:1,worker:peas[3],buildingId:'barracks_human',at:{x:Math.round(12.5*65536),y:Math.round(20.5*65536)}}); site=1; }
  if (site && !built) built=g.snapshot().buildings.some(b=>b.id==='barracks_human'&&b.built);
  if (built){
    const bar=g.snapshot().buildings.find(b=>b.id==='barracks_human')!.eid;
    const q=w.stores.building.get(bar)?.trainQueue?.length ?? 0;
    if (q===0 && trains<6 && g.players[1].gold>400){ g.command({k:'train',player:1,building:bar,unitId:'footman'}); trains++; }
    if (t%300===0) console.log('t',t,'queueLen',q,'headRem',w.stores.building.get(bar)?.trainQueue?.[0]?.remaining,'units',g.snapshot().units.map(u=>u.id).join(','));
  }
  g.update(1);
}
process.exit(0);
