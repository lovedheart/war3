import { ff } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
function probe(label: string, cap: number, depth: number) {
  const q = new QuadTree(0,0,W,W,cap,depth);
  q.insert(1, ff(10), ff(10), ff(0.5));
  q.insert(3, ff(-40), ff(500), ff(0.5));
  console.log(label, 'r2 ->', q.query(ff(127.5), ff(127.5), ff(2), []), 'wide ->', q.query(ff(127.5), ff(127.5), ff(200), []));
}
probe('depth0', 4, 0);
probe('depth7', 4, 7);
probe('depth8', 4, 8);
