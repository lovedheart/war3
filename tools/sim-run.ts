import { createGame } from '../src/sim/index.js';
const g = createGame({ seed: 7, players: [{id:1,race:'human',name:'P1'},{id:2,race:'orc',name:'P2'}] });
console.log('t0 units', g.snapshot().units.length, 'blds', g.snapshot().buildings.length);
g.update(900);
const s=g.snapshot();
console.log('t900 units', s.units.length, JSON.stringify(s.resources));
