import { ff } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
const q = new QuadTree(0,0,W,W,4);
q.insert(3, ff(-40), ff(500), ff(0.5));
for (let r = 0; r <= 8; r++) console.log('solo r',r,'->',q.query(ff(127.5), ff(127.5), ff(r), []));
console.log('all', q.all([]), 'size', q.size);
