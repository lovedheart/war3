import { createGame } from '../src/sim/index.js';
const g = createGame({ seed: 7, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
const w:any = g.world; const s=w.stores;
const dump=(label:string)=>{
  console.log('---',label,'tick',w.tick);
  for(const e of w.live){
    const st=s.stats.get(e), o=s.owner.get(e);
    if(!st||o?.player!==1) continue;
    const t=s.transform.get(e), or=s.orders.get(e), c=s.cargo.get(e);
    console.log(` ${st.id} pos=(${(t.x/65536).toFixed(1)},${(t.y/65536).toFixed(1)}) order=${or?.current?.kind} tgt=${or?.current?.targetEid?.toString(16)} carry=${c?.carrying}:${((c?.amount??0)/65536).toFixed(0)} v=(${(s.movement.get(e)?.vx??0)},${(s.movement.get(e)?.vy??0)})`);
  }
  const mines=(w as any).goldMines, drops=(w as any).dropoffs;
  console.log(' mines:',mines.map((m:number)=>{const t=s.transform.get(m);return `(${(t.x/65536).toFixed(0)},${(t.y/65536).toFixed(0)})cap=${(s.mine.get(m)?.capacity??0)/65536}`}).join(' '));
  console.log(' dropGold:',drops.gold.map((d:number)=>{const t=s.transform.get(d);return `(${(t.x/65536).toFixed(0)},${(t.y/65536).toFixed(0)})`}).join(' '),' dropWood:',drops.wood.length);
};
dump('t0'); g.update(200); dump('t200'); g.update(400); dump('t600');
