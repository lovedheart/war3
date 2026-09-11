import { ff, fn } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
const q = new QuadTree(0,0,W,W,4);
q.insert(3, ff(-40), ff(500), ff(0.5));
for (const r of [10, 20, 60, 120]) console.log('r',r,'->',q.query(ff(127), ff(127), ff(r), []));
console.log('from 127,127 to clamped point dist', fn(ff(127)- (W - ff(0.5))));
