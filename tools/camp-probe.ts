import { startLevel, updateLevel, eidsOf } from '../src/campaign/index.js';
const g = startLevel('human-04', 7); const w=g.world as any;
for (let t=0;t<25000;t++) updateLevel(g,1);
const grunts=g.snapshot().units.filter(u=>u.player===2&&u.id==='grunt');
const foot=g.snapshot().units.filter(u=>u.player===1&&u.id==='footman');
console.log('footmen',foot.length,'grunts',grunts.length);
if (foot.length) for (const f of grunts.slice(0,4)) { const t=w.stores.transform.get(f.eid); let bd=1e9,bn='none'; for(const m of foot){const mt=w.stores.transform.get(m.eid); const d=Math.hypot(mt.x-t.x,mt.y-t.y)/65536; if(d<bd){bd=d;bn=m.id;}} console.log('grunt',(t.x/65536).toFixed(1),(t.y/65536).toFixed(1),'nearestFootman',bn,bd.toFixed(1)); }
process.exit(0);
