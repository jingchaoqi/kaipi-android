/** Real core/logs and IndexedDB. Deterministic local provider; no paid model calls. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const server=spawn(process.env.KAIPI_TEST_PYTHON||'python3',['scripts/preview.py','--retry-fixture','--queue-fixture','--port','0'],{stdio:['ignore','pipe','inherit']});
let browser,page;
try {
 const url=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('exit',reject);});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||undefined,headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 // Exercise the same missing APIs observed on the installed Android 11 WebView 83.
 await page.addInitScript(()=>{Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true});Element.prototype.replaceChildren=undefined;Array.prototype.at=undefined;});
 const errors=[],turns=[],retries=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/rpc')){const b=r.postDataJSON();if(b.op==='turn')turns.push(b);if(b.op==='retry')retries.push(b);}});
 const send=async text=>{await page.fill('#draft',text);await page.click('#send');await page.waitForFunction(()=>document.getElementById('composer').getAttribute('aria-busy')==='false');};
 const idle=()=>page.waitForFunction(()=>document.getElementById('connection').hidden&&document.getElementById('composer').getAttribute('aria-busy')==='false'&&document.getElementById('stop-generation').hidden&&!document.getElementById('live-turn')&&document.getElementById('send').getAttribute('aria-label')==='发送消息');
 const failed=()=>page.waitForFunction(()=>!!document.querySelector('.retry-panel')&&!document.getElementById('live-turn')&&!document.querySelector('.retry-button')?.disabled);
 const queueCount=n=>page.waitForFunction(n=>document.querySelectorAll('.queued-message').length===n,n);
 await mkdir('app/build/reports/gui-queue',{recursive:true});
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('connection').hidden);

 // One active request + three pending. A fourth draft is never sent automatically.
 await send('queue-order A');await page.waitForSelector('#live-turn');
 const controls=await page.evaluate(()=>['stop-generation','send'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {width:r.width,height:r.height,top:r.top};}));
 assert.equal(controls[0].width,44);assert.equal(controls[0].height,44);assert.equal(controls[1].height,44);assert.equal(controls[0].top,controls[1].top);
 for(const text of ['queue-order B','queue-order C','queue-order D'])await send(text);
 await queueCount(3);await page.fill('#draft','这只是未提交的草稿');
 assert.equal(await page.getAttribute('#send','aria-label'),'队列已满');assert.equal(await page.locator('#send').isDisabled(),true);
 await page.screenshot({path:'app/build/reports/gui-queue/full-light.png',animations:'disabled'});
 await idle();assert.deepEqual(turns.slice(0,4).map(t=>t.body.text),['queue-order A','queue-order B','queue-order C','queue-order D']);
 assert.equal(await page.inputValue('#draft'),'这只是未提交的草稿');assert.equal(await page.locator('#message-queue').isVisible(),false);assert.equal(await page.getAttribute('#send','aria-label'),'发送消息');
 assert.equal(await page.locator('.turn:not(#live-turn)').count(),4);
 // Snapshot the actual node parent chain, through the real data adapter.
 const chain=await page.evaluate(async()=>{const original=Native.request;return await new Promise(resolve=>{Native.request=json=>{const v=JSON.parse(json);if(v.id==='queue-test-state'){const receive=kaipi.receive;kaipi.receive=message=>{if(message.id===v.id){kaipi.receive=receive;Native.request=original;resolve(message.result);}else receive(message);};}return original(json);};Native.request(JSON.stringify({id:'queue-test-state',op:'state'}));});});
 for(let i=1;i<chain.history.length;i++)assert.equal(chain.history[i].parent_id,chain.history[i-1].id);

 // A failed predecessor owns its queue. X returns text AND attachments; draft replacement is explicit.
 await page.fill('#draft','');
 await page.setInputFiles('#file-input',{name:'A.txt',mimeType:'text/plain',buffer:Buffer.from('ORIGINAL_A_ATTACHMENT')});await page.waitForSelector('.attachment-chip');
 await send('queue-fail A with attachment [file1]');await page.waitForSelector('#live-turn');
 await page.setInputFiles('#file-input',{name:'B.txt',mimeType:'text/plain',buffer:Buffer.from('FROZEN_BROWSER_ATTACHMENT')});await page.waitForSelector('.attachment-chip');
 await send('B 带附件 [file1]');await send('C 后续消息');await failed();await queueCount(2);
 const baseRetries=retries.length,baseTurns=turns.length;
 await page.reload();await failed();await queueCount(2);assert.equal(turns.length,baseTurns);
 assert.match(await page.textContent('.retry-footer'),/还可重试\s+2/);
 await page.fill('#draft','保留这段草稿');await page.locator('[data-take-queued]').first().click();await page.waitForSelector('#confirm');
 await page.click('#cancel');await queueCount(2);assert.equal(await page.inputValue('#draft'),'保留这段草稿');
 await page.locator('[data-take-queued]').first().click();await page.click('#confirm');await queueCount(1);
 assert.equal(await page.inputValue('#draft'),'B 带附件 [file1]');assert.match(await page.textContent('#attachments'),/B.txt/);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'draft');
 await page.fill('#draft','B 已编辑 [file1]');await page.click('#send');await queueCount(2);
 assert.deepEqual(await page.locator('.queued-content>span').allTextContents(),['C 后续消息','B 已编辑 [file1]']);
 // Two manual retries, neither may allow B/C through on failure. Rebuild keeps the cap.
 for(let i=0;i<2;i++){await page.click('.retry-button');await page.waitForSelector('#live-turn');await failed();}
 assert.equal(retries.length,baseRetries+2);assert.equal(turns.length,baseTurns);await queueCount(2);
 assert.match(await page.textContent('#toast'),/已尝试 3 次/);assert.equal(await page.locator('[data-retry-turn]').count(),0);
 await page.screenshot({path:'app/build/reports/gui-queue/exhausted.png',animations:'disabled'});
 await page.reload();await page.waitForSelector('[data-rewrite-queued]');await queueCount(2);
 assert.equal(await page.locator('[data-retry-turn]').count(),0);
 await page.click('[data-rewrite-queued]');
 if(await page.locator('#confirm').isVisible())throw new Error('Unexpected draft replacement dialog: '+await page.inputValue('#draft'));
 await queueCount(0);
 assert.equal(await page.inputValue('#draft'),'queue-fail A with attachment [file1]');assert.match(await page.textContent('#attachments'),/A.txt/);
 assert.equal(await page.getAttribute('#send','aria-label'),'发送消息');
 await page.fill('#draft','queue-revised A [file1]');await page.click('#send');await idle();

 // Success on retry resumes B then C, preserving the draft the user is still editing.
 await send('retry-once queue-dependent A');await page.waitForSelector('#live-turn');await send('queue-dependent B');await send('queue-dependent C');await failed();
 await page.fill('#draft','下一条还没写完');const beforeSuccess=turns.length;
 await page.click('.retry-button');await idle();
 assert.deepEqual(turns.slice(beforeSuccess).map(x=>x.body.text),['queue-dependent B','queue-dependent C']);assert.equal(await page.inputValue('#draft'),'下一条还没写完');
 assert.equal(await page.getAttribute('#send','aria-label'),'发送消息');

 // Reopening while active reconciles the saved receipt, without resending A.
 await send('queue-reload A');await page.waitForSelector('#live-turn');await send('queue-reload B');
 const beforeReload=turns.length;await page.reload();await idle();
 assert.equal(turns.length,beforeReload+1);assert.equal(turns.at(-1).body.text,'queue-reload B');

 // Late/missing acknowledgments and a repeated settled event cannot submit twice.
 await page.evaluate(()=>{const original=kaipi.receive;kaipi.receive=message=>{const value=typeof message==='string'?JSON.parse(message):message;if(value.event==='settled')window.__queueLastSettled=value;original(message);};});
 await page.evaluate(()=>{window.__queueTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>__queueTimeout(fn,ms===30000?120:ms,...args);});
 const delayed=async route=>{const response=await route.fetch();if(route.request().postDataJSON().op==='turn')await new Promise(r=>setTimeout(r,850));await route.fulfill({response});};
 await page.route('**/rpc',delayed);await send('queue-ack A');await page.waitForSelector('#live-turn');await send('queue-ack B');const ackCount=turns.length;
 await page.waitForFunction(()=>document.querySelector('#live-turn .question-bubble')?.textContent==='queue-ack B');
 await page.evaluate(()=>kaipi.receive(window.__queueLastSettled));await idle();await page.waitForTimeout(900);
 assert.equal(turns.length,ackCount+1);assert.equal(turns.at(-1).body.text,'queue-ack B');
 await page.unroute('**/rpc',delayed);await page.evaluate(()=>{window.setTimeout=window.__queueTimeout;});

 // A user stop never drains the dependent messages.
 await send('queue-stop A');await page.waitForSelector('#live-turn');await send('queue-stop B');const stoppedCount=turns.length;
 await page.click('#stop-generation');await page.waitForFunction(()=>!document.getElementById('live-turn')&&document.getElementById('stop-generation').hidden);await queueCount(1);assert.equal(turns.length,stoppedCount);
 // X to an empty input immediately makes this a normal unsent draft once the queue is empty.
 await page.locator('[data-take-queued]').click();await queueCount(0);assert.equal(await page.inputValue('#draft'),'queue-stop B');assert.equal(await page.getAttribute('#send','aria-label'),'发送消息');

 // A storage failure racing core completion cannot be undone by a stale queued storage write.
 await page.fill('#draft','');await page.locator('.retry-button, .turn-actions [data-retry-turn]').last().click();await page.waitForSelector('#live-turn');
 await page.waitForTimeout(120);
 await page.evaluate(()=>{const original=KaipiOutbox.write;KaipiOutbox.write=async q=>{KaipiOutbox.write=original;await new Promise(resolve=>setTimeout(resolve,2100));throw new Error('fixture quota');};});
 await send('不能丢失的排队草稿');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('无法保存排队消息'));
 assert.equal(await page.inputValue('#draft'),'不能丢失的排队草稿');assert.equal(await page.locator('.queued-message').count(),0);
 await idle();
 const beforeStorageReload=turns.length;await page.reload();await idle();
 assert.equal(turns.length,beforeStorageReload);assert.equal(await page.inputValue('#draft'),'不能丢失的排队草稿');assert.equal(await page.locator('.queued-message').count(),0);

 // Context changes pause the saved chain. Retry may resolve A, but does not bypass that pause.
 await send('retry-once queue-context A');await page.waitForSelector('#live-turn');await send('queue-context B');await failed();
 const contextTurns=turns.length;await page.click('#tree-toggle');const originalLeaf=await page.locator('.tree-node.current').getAttribute('data-tree-node');
 await page.locator('.tree-node.live:not(.current)').first().click();await page.click('[data-node-action=go]');await page.waitForFunction(()=>!document.getElementById('app').classList.contains('tree-open'));await queueCount(1);
 assert.match(await page.textContent('#queue-hint'),/上下文已变化/);assert.equal(turns.length,contextTurns);
 await page.click('#tree-toggle');await page.locator(`[data-tree-node="${originalLeaf}"]`).click();await page.click('[data-node-action=go]');await page.waitForFunction(()=>!document.getElementById('app').classList.contains('tree-open'));await failed();
 await page.click('.retry-button');await page.waitForSelector('#live-turn');await page.waitForSelector('#queue-resume');
 assert.equal(turns.length,contextTurns);await queueCount(1);await page.click('#queue-resume');await idle();assert.equal(turns.at(-1).body.text,'queue-context B');

 // Theme/language, narrow keyboard layout, reduced motion and safe rendering of queue text.
 await send('queue-fail appearance');await page.waitForSelector('#live-turn');await send('<img src=x onerror="window.queueInjected=1">');await failed();
 assert.equal(await page.evaluate(()=>window.queueInjected),undefined);assert.equal(await page.locator('#queue-items img').count(),0);
 await page.click('#sidebar-toggle');await page.click('#language-settings');await page.click('[data-language-setting=en]');await page.click('#sidebar-close');
 assert.match(await page.textContent('#queue-label'),/Queue paused/);assert.equal(await page.getAttribute('#send','aria-label'),'Add to queue');
 await page.evaluate(()=>KaipiTheme.apply({mode:'dark',color:'indigo'}));await page.waitForTimeout(100);
 for(const [width,height] of [[320,520],[390,460]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#send').evaluate(node=>{const r=node.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight;}),true);
 }
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#message-queue').evaluate(n=>getComputedStyle(n).animationName),'none');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'app/build/reports/gui-queue/paused-dark-english.png',animations:'disabled'});
 assert.deepEqual(errors,[]);
 console.log('PASS: FIFO/parent nodes, maximum 3, draft preservation, X edit/cancel/attachments/order, retries and cap, reload, duplicate/late receipts, stop, storage rollback race, context pause, safe text, language/themes and keyboard layout.');
} catch(error) {
 if(page){console.error('Queue UI:',await page.evaluate(()=>({label:document.getElementById('queue-label').textContent,hint:document.getElementById('queue-hint').textContent,send:document.getElementById('send').getAttribute('aria-label'),busy:document.getElementById('composer').getAttribute('aria-busy'),live:!!document.getElementById('live-turn'),dialog:document.getElementById('dialog-title')?.textContent})));await page.screenshot({path:'app/build/reports/gui-queue/failure.png',animations:'disabled'});}
 throw error;
} finally {await browser?.close();server.kill('SIGTERM');}
