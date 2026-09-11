import { ff } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
const q = new QuadTree(0,0,W,W,4);
q.insert(1, ff(10), ff(10), ff(0.5));
q.insert(3, ff(-40), ff(500), ff(0.5));
console.log('corner r 600 ->', q.query(ff(127), ff(127), ff(600), []));
console.log('center of clamped (127.5,127.5) r2 ->', q.query(ff(127.5), ff(127.5), ff(2), []));
