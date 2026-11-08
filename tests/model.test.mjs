import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {layoutTree,lineage} = require('../app/src/main/assets/ui/model.js');
const nodes = [
 {id:'a',parent_id:null,status:'live',seq:1},
 {id:'b',parent_id:'a',status:'live',seq:2},
 {id:'c',parent_id:'a',status:'live',seq:3},
 {id:'d',parent_id:'b',status:'live',seq:4},
 {id:'e',parent_id:'c',status:'archived',seq:5},
];
test('a branching tree has non-overlapping cards, lineage order, and a highlighted trunk', () => {
 const {positions,trunkIds} = layoutTree(nodes,'d');
 assert.deepEqual(lineage(nodes,'d').map(n=>n.id),['a','b','d']);
 assert.deepEqual([...trunkIds],['a','b','d']);
 assert.equal(positions.size,4);
 assert.ok(positions.get('b').x < positions.get('c').x);
 const values=[...positions.values()];
 for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++) {
  const a=values[i],b=values[j];
  assert.ok(Math.abs(a.x-b.x)>=170 || Math.abs(a.y-b.y)>=83);
 }
});
test('collapse hides only descendants and archived nodes can be recovered in the view', () => {
 const collapsed=layoutTree(nodes,'d',new Set(['b']));
 assert.ok(!collapsed.positions.has('d'));
 assert.ok(collapsed.positions.has('c'));
 assert.equal(collapsed.positions.get('b').children,1);
 assert.ok(layoutTree(nodes,'d',new Set(),true).positions.has('e'));
});
test('multiple roots and empty trees are supported', () => {
 assert.equal(layoutTree([]).positions.size,0);
 const {positions}=layoutTree([{id:'a',seq:1,status:'live'},{id:'b',seq:2,status:'live'}]);
 assert.notEqual(positions.get('a').x,positions.get('b').x);
});
