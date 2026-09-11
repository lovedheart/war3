import { ff } from '../src/core/fixed.js';
import { QuadTree } from '../src/map/quadtree.js';
const W = ff(128);
function probe(cap: number, xs: number[]) {
  const q = new QuadTree(0,0,W,W,cap);
  for (let i=0;i<xs.length;i++) q.insert(i+1, ff(xs[i]), ff(xs[i]), ff(0.5));
  console.log('cap',cap,'n',xs.length,'->',q.query(ff(64),ff(64),ff(200),[]).length, 'expected', xs.length);
}
probe(4, Array.from({length:20},(_,i)=>(i*7)%128));
probe(4, Array.from({length:200},(_,i)=>(i*7)%128));
probe(8, Array.from({length:1000},(_,i)=>(i*37)%128));
// duplicates of one eid across a subdivided tree
const q = new QuadTree(0,0,W,W,4);
for (let i=0;i<50;i++) q.insert(7, ff((i*13)%128), ff((i*29)%128), ff(0.5));
console.log('dup query count', q.query(ff(64),ff(64),ff(200),[]), 'size', q.size);
