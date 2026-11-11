/** Real Chromium touch input, GUI and core preview. No model API calls. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
const server=spawn(process.env.KAIPI_TEST_PYTHON||'python3',['scripts/preview.py','--seed','--port','0'],{stdio:['ignore','pipe','inherit']});
let browser;
try {
  const url=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const m=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('exit',reject);});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||undefined,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForSelector('.turn');
  await page.evaluate(()=>{window.exclusions=[];Native.menuGesture=enabled=>window.exclusions.push(enabled);});
  const input=await page.context().newCDPSession(page);
  const touch=(type,points=[])=>input.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y,id=0])=>({x,y,id}))});
  const start=(x=8,y=160)=>touch('touchStart',[[x,y]]);
  const move=async(x,y=160,delay=35)=>{await page.waitForTimeout(delay);await touch('touchMove',[[x,y]]);};
  const end=()=>touch('touchEnd');
  const opened=()=>page.locator('#app').evaluate(node=>node.classList.contains('rail-open'));
  const dragging=()=>page.locator('#app').evaluate(node=>node.classList.contains('rail-dragging'));
  const close=async()=>{await page.click('#sidebar-close');await page.waitForTimeout(400);};
  const swipe=async(x,y,toX,toY=y)=>{await start(x,y);await move((x+toX)/2,(y+toY)/2);await move(toX,toY);await end();};

  // A real touch drag must track the finger, even before opening the menu once.
  await start();await move(30);await move(52);
  assert.equal(await dragging(),true);
  await page.waitForFunction(()=>Math.abs(document.getElementById('sidebar').getBoundingClientRect().x-(44-document.getElementById('sidebar').getBoundingClientRect().width))<2);
  const drawer=await page.locator('#sidebar').boundingBox();
  assert.ok(Math.abs(drawer.x-(44-drawer.width))<2,JSON.stringify(drawer));
  await page.waitForTimeout(150);await end();await page.waitForTimeout(400);
  assert.equal(await opened(),false);assert.equal(await dragging(),false);
  assert.equal(await page.locator('#sidebar').evaluate(node=>node.style.transform),'');

  // Repeating a pull while the cancelled drawer is settling must not hit its buttons.
  await start();await move(45);await page.waitForTimeout(150);await end();
  await swipe(8,160,150);await page.waitForTimeout(400);
  assert.equal(await opened(),true);
  assert.equal(await page.getAttribute('#sidebar-toggle','aria-expanded'),'true');
  assert.ok(Math.abs((await page.locator('#sidebar').boundingBox()).x)<1);
  assert.equal((await page.evaluate(()=>exclusions)).at(-1),false);
  await close();assert.equal((await page.evaluate(()=>exclusions)).at(-1),true);

  // A small quick flick opens; a held, short pull above returned to closed.
  await start();await move(32,160,12);await move(65,160,12);await end();
  await page.waitForTimeout(400);assert.equal(await opened(),true);await close();
  await swipe(60,160,190);assert.equal(await opened(),false);
  await swipe(8,500,150);assert.equal(await opened(),false);
  await swipe(20,160,1);assert.equal(await opened(),false);

  // Vertical input at the edge still scrolls the underlying conversation.
  await page.evaluate(()=>{const filler=document.createElement('div');filler.id='gesture-scroll-fixture';filler.style.height='2000px';document.getElementById('messages').append(filler);document.getElementById('scroll').scrollTop=0;});
  await swipe(8,200,9,130);await page.waitForTimeout(150);
  assert.equal(await opened(),false);
  assert.ok(await page.locator('#scroll').evaluate(node=>node.scrollTop>0));
  await page.evaluate(()=>document.getElementById('gesture-scroll-fixture').remove());

  await start();await move(60);await touch('touchCancel');
  await page.waitForTimeout(400);assert.equal(await dragging(),false);assert.equal(await opened(),false);
  await start();await move(60);await touch('touchStart',[[60,160,0],[80,180,1]]);await end();
  await page.waitForTimeout(400);assert.equal(await dragging(),false);assert.equal(await opened(),false);
  await start();await move(60);await page.setViewportSize({width:390,height:620});await end();
  await page.waitForTimeout(400);assert.equal(await opened(),false);assert.equal(await dragging(),false);
  await page.setViewportSize({width:390,height:844});
  await start();await page.waitForTimeout(650);await move(140);await end();
  assert.equal(await opened(),false);

  await page.click('#tree-toggle');await swipe(8,160,150);assert.equal(await dragging(),false);
  assert.equal((await page.evaluate(()=>exclusions)).at(-1),false);await page.click('#tree-close');
  await page.tap('#sidebar-toggle');await page.waitForTimeout(400);
  assert.equal(await opened(),true);
  await page.click('#appearance-button');await swipe(8,160,150);assert.equal(await dragging(),false);
  assert.equal((await page.evaluate(()=>exclusions)).at(-1),false);await page.click('#dialog-close');await close();

  await page.emulateMedia({reducedMotion:'reduce'});await swipe(8,160,150);
  assert.equal(await opened(),true);
  assert.equal(await page.locator('#sidebar').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  await close();await page.setViewportSize({width:1024,height:844});
  await swipe(8,160,180);assert.equal(await opened(),false);assert.equal(await dragging(),false);
  assert.equal((await page.evaluate(()=>exclusions)).at(-1),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: upper-left edge drag, finger tracking, flick, spring back, vertical scroll, region limits, multi-touch/cancel/resize, dialog/tree isolation, tap, reduced motion and wide layout.');
} finally {await browser?.close();server.kill('SIGTERM');}
