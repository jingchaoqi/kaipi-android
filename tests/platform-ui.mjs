/** Native update transport is a fixture; real UI, layout, localization and themes. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const server=spawn(process.env.KAIPI_TEST_PYTHON||'python3',['scripts/preview.py','--seed','--port','0'],{stdio:['ignore','pipe','inherit']});
let browser;
try {
  const url=await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('exit',reject);});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||undefined,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForSelector('.turn');
  await page.evaluate(()=>{
    window.updateChecks=0;window.updateInstalls=[];
    Native.checkUpdates=()=>{window.updateChecks++;};
    Native.installUpdate=id=>window.updateInstalls.push(id);
  });
  await page.click('#sidebar-toggle');await page.waitForTimeout(400);
  const language=await page.locator('#language-settings .language-icon').boundingBox();
  for(const id of ['appearance-button','settings','update-settings']) {
    const icon=await page.locator(`#${id}>svg`).boundingBox();assert.equal(icon.x,language.x);assert.equal(icon.width,language.width);
  }
  await page.click('#update-settings');
  assert.equal(await page.evaluate(()=>updateChecks),1);
  const update=async data=>page.evaluate(data=>kaipi.receive({event:'update',data}),data);
  const release={installed:'0.2.0',version:'0.3.0',asset:'123',size:40*1048576};
  await update({...release,status:'available'});
  assert.ok((await page.textContent('#dialog')).includes('Downloads'));
  await page.click('#update-install');
  assert.deepEqual(await page.evaluate(()=>updateInstalls),['123']);
  await update({...release,status:'downloading',progress:47});
  assert.equal(await page.getAttribute('[role=progressbar]','aria-valuenow'),'47');
  assert.equal(await page.locator('#update-install').count(),0);
  await page.click('#dialog-close');
  await update({...release,status:'ready',progress:100});
  await page.click('#update-settings');
  await update({...release,status:'ready'});
  assert.ok((await page.textContent('#update-install')).includes('安装已下载'));
  await page.click('#update-install');
  assert.deepEqual(await page.evaluate(()=>updateInstalls),['123','123']);
  await update({...release,status:'permission',reason:'install_permission'});
  assert.ok((await page.textContent('#dialog')).includes('已下载'));
  await update({...release,status:'ready',reason:'install_permission'});
  assert.equal(await page.locator('#update-install').isEnabled(),true);
  await page.click('#dialog-close');
  await page.click('#appearance-button');await page.click('[data-mode=dark]');await page.click('[data-color=indigo]');await page.click('#dialog-close');
  await page.click('#language-settings');await page.click('[data-language-setting=en]');
  await page.click('#update-settings');await update({...release,status:'ready'});
  assert.ok((await page.textContent('#update-install')).includes('Install downloaded APK'));
  await mkdir('app/build/reports/gui-platform',{recursive:true});
  await page.waitForFunction(()=>document.getElementById('toast').hidden);await page.waitForTimeout(300);await page.screenshot({path:'app/build/reports/gui-platform/update-dark.png'});
  await update({...release,status:'error',reason:'missing_apk'});
  assert.equal(await page.locator('#update-install').count(),0);
  await page.click('#update-check');assert.equal(await page.locator('#update-check').isDisabled(),true);
  await update({...release,status:'current'});
  assert.ok((await page.textContent('#dialog')).includes('up to date'));
  await page.setViewportSize({width:320,height:520});
  await update({...release,status:'ready'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#dialog').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: menu alignment, update states, repeated install action, progress, permission recovery, language, themes and narrow layout.');
} finally {await browser?.close();server.kill('SIGTERM');}
