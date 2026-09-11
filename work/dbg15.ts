import { ff } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
const q = new QuadTree(0,0,W,W,4);
q.insert(3, ff(-40), ff(500), ff(0.5));
for (let r = 126; r <= 131; r++) console.log('r',r,'->',q.query(ff(127.5), ff(127.5), ff(r), []));
