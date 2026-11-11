/** Real GUI and Markdown renderer; native disk/preview transport is covered by Robolectric. */
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
    window.fileCalls={list:[],open:[],save:[],share:[]};
    const folders={
      '':[{name:'project',path:'project',directory:true},{name:'设计稿.html',path:'设计稿.html',size:3500},{name:'README.md',path:'README.md',size:500},{name:'report.pdf',path:'report.pdf',size:1048576},{name:'picture.png',path:'picture.png',size:104857},{name:'预算 100% #1.txt',path:'预算 100% #1.txt',size:123},{name:'<img src=x onerror=window.fileInjected=1>.txt',path:'odd.txt',size:20}],
      project:[{name:'assets',path:'project/assets',directory:true},{name:'index.html',path:'project/index.html',size:12}],
      'project/assets':[],
    };
    Native.listWorkspaceFiles=(request,path)=>{fileCalls.list.push({request,path});kaipi.receive({event:'workspaceFiles',data:{status:'listed',request,data:{path,entries:folders[path]||[]}}});};
    Native.openWorkspaceFile=(path,appearance)=>fileCalls.open.push({path,appearance:JSON.parse(appearance)});
    Native.saveWorkspaceFile=path=>fileCalls.save.push(path);
    Native.shareWorkspaceFile=path=>fileCalls.share.push(path);
    document.getElementById('messages').insertAdjacentHTML('beforeend','<div class="markdown file-link-fixture">'+KaipiRender.markdown('[打开 HTML](./%E8%AE%BE%E8%AE%A1%E7%A8%BF.html) [普通文件](report.pdf) [绝对路径](file:///data/user/0/dev.kaipi.android/files/workspaces/test/demo.html) [unsafe](javascript:alert(1))')+'</div>');
  });
  await page.locator('.file-link-fixture a').nth(0).click();
  await page.locator('.file-link-fixture a').nth(1).click();
  await page.locator('.file-link-fixture a').nth(2).click();
  assert.deepEqual(await page.evaluate(()=>fileCalls.open.map(x=>x.path)),['./设计稿.html','report.pdf','file:///data/user/0/dev.kaipi.android/files/workspaces/test/demo.html']);
  assert.equal(await page.locator('.file-link-fixture a').count(),3);
  await page.fill('#draft','保留我正在写的草稿');
  await page.click('#sidebar-toggle');await page.waitForTimeout(350);await page.click('#workspace-files');
  await page.waitForSelector('.workspace-file-row');
  assert.equal(await page.locator('.workspace-file-row').count(),7);
  assert.equal(await page.locator('.workspace-files-dialog img').count(),0);
  assert.equal(await page.evaluate(()=>window.fileInjected),undefined);
  const pdf=page.locator('.workspace-file-row').filter({hasText:'report.pdf'});
  await pdf.locator('.workspace-file-main').click();
  await pdf.locator('[data-save-file]').click();await pdf.locator('[data-share-file]').click();
  assert.deepEqual(await page.evaluate(()=>fileCalls.save),['report.pdf']);assert.deepEqual(await page.evaluate(()=>fileCalls.share),['report.pdf']);
  await page.locator('.workspace-file-row').filter({hasText:'picture.png'}).locator('.workspace-file-main').click();
  assert.equal(await page.evaluate(()=>fileCalls.open.at(-1).path),'picture.png');
  await page.locator('.workspace-file-row').filter({hasText:'预算 100% #1.txt'}).locator('.workspace-file-main').click();
  assert.equal(await page.evaluate(()=>fileCalls.open.at(-1).path),'预算 100% #1.txt');
  await page.locator('.workspace-file-main').filter({hasText:'project'}).click();
  assert.equal(await page.locator('.workspace-file-row').count(),2);
  await page.locator('.workspace-file-main').filter({hasText:'assets'}).click();
  await page.waitForSelector('.file-empty');await page.click('#save-workspace-directory');
  assert.equal(await page.evaluate(()=>fileCalls.save.at(-1)),'project/assets');
  await page.locator('.file-breadcrumbs [data-directory="project"]').click();
  await page.locator('.file-breadcrumbs [data-directory=""]').click();
  assert.equal(await page.locator('.workspace-file-row').count(),7);
  // Ignore a stale folder response; closing a sheet also prevents late replies from reopening it.
  await page.evaluate(()=>kaipi.receive({event:'workspaceFiles',data:{status:'listed',request:'0',data:{path:'old',entries:[]}}}));
  assert.equal(await page.locator('.workspace-file-row').count(),7);
  await page.evaluate(()=>{KaipiTheme.apply({mode:'dark',color:'indigo'});KaipiLocale.apply({language:'en'});});
  await page.click('#refresh-workspace-files');
  assert.equal(await page.textContent('#dialog-title'),'Workspace files');
  await page.locator('.workspace-file-row').filter({hasText:'README.md'}).locator('.workspace-file-main').click();
  const appearance=await page.evaluate(()=>fileCalls.open.at(-1).appearance);assert.equal(appearance.language,'en');assert.equal(appearance.dark,true);assert.equal(appearance.background,'#181c26');
  await page.evaluate(()=>kaipi.receive({event:'workspaceFiles',data:{status:'saved',data:'已保存到 Downloads。'}}));
  assert.match(await page.textContent('#workspace-file-status'),/Downloads/);
  assert.ok(await page.evaluate(()=>document.getElementById('dialog').scrollWidth<=document.getElementById('dialog').clientWidth+1));
  await mkdir('app/build/reports/gui-files',{recursive:true});await page.screenshot({path:'app/build/reports/gui-files/workspace-files-mobile.png'});
  await page.click('#dialog-close');assert.equal(await page.inputValue('#draft'),'保留我正在写的草稿');
  await page.evaluate(()=>kaipi.receive({event:'workspaceFiles',data:{status:'listed',request:String(fileCalls.list.at(-1).request),data:{path:'old',entries:[]}}}));
  assert.equal(await page.locator('#overlay').isHidden(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: existing file links, file browsing, folders/breadcrumbs, all-format open/save/share, ZIP actions, escaped names, stale replies, drafts, language, dark theme and narrow layout.');
} finally {if(browser)await browser.close();server.kill();}
