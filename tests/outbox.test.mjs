import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const host={window:{},crypto:globalThis.crypto};
vm.runInNewContext(readFileSync(new URL('../app/src/main/assets/ui/outbox.js',import.meta.url),'utf8'),host);
const Q=host.window.KaipiOutbox;
const snapshot=(latest=null,extra={})=>({session:'s',leaf:null,trunk:null,pending:[],busy:false,latest_attempt:latest,...extra});
const body={text:'A',attachments:[{name:'original.txt',data:'frozen'}],explore:false};
test('a queued dependency advances only for an identified successful attempt at its current leaf',()=>{
 const q=Q.empty('s');Q.begin(q,snapshot(),body);
 assert.equal(Q.observe(q,snapshot({id:'a',parent_id:null,input:'A',status:'live'},{busy:true})),false);
 assert.equal(q.turn.status,'running');
 assert.equal(Q.observe(q,snapshot({id:'a',parent_id:null,input:'A',status:'live'},{leaf:'a',trunk:'a'})),true);
 assert.equal(q.turn.status,'succeeded');assert.equal(q.turn.body.attachments[0].data,'frozen');
 assert.equal(Q.observe(q,snapshot({id:'a',parent_id:null,input:'A',status:'live'},{leaf:'a',trunk:'a'})),false);
});
test('failed attempts retain the original attachments, count manual retries, and keep pending messages',()=>{
 const q=Q.empty('s');q.items.push({id:'b',body:{text:'B',attachments:[],explore:false}});Q.begin(q,snapshot(),body);
 let before;
 for(let i=1;i<=3;i++){
  const a={id:'attempt-'+i,parent_id:null,input:'A',status:'aborted'};before=snapshot(a);
  assert.equal(Q.observe(q,before),false);assert.equal(q.turn.status,'failed');assert.equal(q.turn.attempts,i);
  assert.equal(q.items.length,1);assert.equal(q.turn.body.attachments[0].data,'frozen');
  if(i<3)Q.begin(q,before,q.turn.body,true);
 }
 assert.equal(body.attachments.length,1);
});
test('recovery never treats an unchanged or unrelated log as proof that a request succeeded',()=>{
 const q=Q.empty('s');const old={id:'old',parent_id:null,input:'earlier',status:'live'};
 Q.begin(q,snapshot(old,{leaf:'old',trunk:'old'}),body);
 assert.equal(Q.observe(q,snapshot(old,{leaf:'old',trunk:'old'}),true),false);
 assert.equal(q.turn.status,'unknown');assert.equal(q.paused,'unknown');
 assert.equal(Q.observe(q,snapshot({id:'other',parent_id:'wrong',input:'A',status:'live'},{leaf:'other'}),true),false);
});
test('a stop request that races successful completion holds the queue until explicit resume',()=>{
 const q=Q.empty('s');Q.begin(q,snapshot(),body);q.turn.stop=true;
 Q.observe(q,snapshot({id:'a',parent_id:null,input:'A',status:'live'},{leaf:'a',trunk:'a'}));
 assert.equal(q.turn.status,'succeeded');assert.equal(q.paused,'stopped');
});
test('changing context preserves the queued messages and pauses them',()=>{
 const q=Q.empty('s');q.items.push({id:'b',body:{text:'B',attachments:[]}});q.anchor=Q.position(snapshot());
 Q.observe(q,snapshot(null,{leaf:'another'}));assert.equal(q.paused,'context');assert.equal(q.items.length,1);
 assert.equal(Q.observe(q,snapshot(null,{session:'different'}),true),false);
});
test('a recovered completed request may release its dependencies, without replaying the original input',()=>{
 const q=Q.empty('s');Q.begin(q,snapshot(),body);const recovered=Q.clone(q);
 Q.observe(recovered,snapshot({id:'accepted',parent_id:null,input:'A',status:'live'},{leaf:'accepted',trunk:'accepted'}),true);
 assert.equal(recovered.turn.status,'succeeded');assert.equal(recovered.turn.attempts,1);
});
