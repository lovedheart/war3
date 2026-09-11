import { ff } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
const q = new QuadTree(0,0,W,W,4);
q.insert(1, ff(10), ff(10), ff(0.5));
q.insert(3, ff(-40), ff(500), ff(0.5));
for (const r of [2, 4, 8, 16]) console.log('corner r', r, '->', q.query(ff(127), ff(127), ff(r), []));
console.log('all', q.all([]));
