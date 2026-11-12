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
    window.fileCalls={list:[],open:[],save:[],share:[],delete:[]};
    const folders={
      '':[{name:'project',path:'project',directory:true},{name:'设计稿.html',path:'设计稿.html',size:3500},{name:'README.md',path:'README.md',size:500},{name:'report.pdf',path:'report.pdf',size:1048576},{name:'picture.png',path:'picture.png',size:104857},{name:'预算 100% #1.txt',path:'预算 100% #1.txt',size:123},{name:'<img src=x onerror=window.fileInjected=1>.txt',path:'odd.txt',size:20}],
      project:[{name:'assets',path:'project/assets',directory:true},{name:'index.html',path:'project/index.html',size:12}],
      'project/assets':[],
    };
    window.fileFolders=folders;
    Native.listWorkspaceFiles=(request,path)=>{fileCalls.list.push({request,path});kaipi.receive({event:'workspaceFiles',data:{status:'listed',request,data:{workspace:'fixture-workspace',path,entries:(folders[path]||[]).map(file=>({...file,revision:file.directory?'':file.path+':v1'}))}}});};
    Native.openWorkspaceFile=(path,appearance)=>fileCalls.open.push({path,appearance:JSON.parse(appearance)});
    Native.saveWorkspaceFile=path=>fileCalls.save.push(path);
    Native.shareWorkspaceFile=path=>fileCalls.share.push(path);
    Native.deleteWorkspaceFile=(workspace,request,path,revision)=>{
      const operation={workspace,request,path,revision};fileCalls.delete.push(operation);
      window.finishFileDelete=()=>{
        for(const key of Object.keys(folders))folders[key]=folders[key].filter(file=>file.path!==path);
        kaipi.receive({event:'workspaceFiles',data:{status:'deleted',request,data:path}});
      };
      if(window.failFileDelete){window.failFileDelete=false;kaipi.receive({event:'workspaceFiles',data:{status:'delete_error',request,data:'文件已变化，请刷新列表后重新确认。'}});}
      else if(!window.holdFileDelete)window.finishFileDelete();
    };

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
  // Opening or dismissing confirmation never calls the destructive bridge.
  const remove=name=>page.locator('.workspace-file-row').filter({hasText:name}).locator('[data-delete-file]');
  assert.equal(await page.locator('[data-delete-file]').count(),6);
  assert.equal(await page.locator('.workspace-file-row').filter({hasText:'project'}).locator('[data-delete-file]').count(),0);
  await remove('README.md').click();
  assert.equal(await page.textContent('#file-delete-title'),'Delete this file?');
  assert.match(await page.textContent('.delete-file-warning'),/cannot be undone/);
  assert.match(await page.textContent('.delete-file-target'),/README\.md/);
  assert.equal(await page.evaluate(()=>fileCalls.delete.length),0);
  await page.focus('#file-delete-close');await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'file-delete-confirm');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'file-delete-close');
  await page.click('#file-delete-cancel');
  assert.equal(await page.locator('#file-delete-overlay').isHidden(),true);assert.equal(await page.locator('#overlay').isVisible(),true);
  await remove('README.md').click();await page.keyboard.press('Escape');
  await remove('README.md').click();await page.click('#file-delete-close');
  await remove('README.md').click();assert.equal(await page.evaluate(()=>kaipi.back()),true);
  assert.equal(await page.evaluate(()=>fileCalls.delete.length),0);
  // A changed-file error keeps the confirmation open and does not silently retry.
  await page.evaluate(()=>window.failFileDelete=true);await remove('README.md').click();await page.click('#file-delete-confirm');
  assert.match(await page.textContent('#file-delete-error'),/file has changed/);
  assert.equal(await page.locator('#file-delete-confirm').isDisabled(),true);
  await page.click('#file-delete-cancel');assert.equal(await page.locator('.workspace-file-row').count(),7);
  // Exactly one confirmed operation; Back and repeat clicks cannot cancel/repeat a pending delete.
  await page.evaluate(()=>window.holdFileDelete=true);await remove('report.pdf').click();await page.click('#file-delete-confirm');
  assert.equal(await page.locator('#file-delete-cancel').isDisabled(),true);
  await page.evaluate(()=>document.getElementById('file-delete-confirm').click());
  assert.equal(await page.evaluate(()=>kaipi.back()),true);assert.equal(await page.locator('#file-delete-overlay').isVisible(),true);
  assert.equal(await page.evaluate(()=>fileCalls.delete.length),2);
  await page.evaluate(()=>kaipi.receive({event:'workspaceFiles',data:{status:'deleted',request:'stale',data:'other.txt'}}));
  assert.equal(await page.locator('#file-delete-overlay').isVisible(),true);
  await page.evaluate(()=>window.finishFileDelete());await page.waitForFunction(()=>document.getElementById('file-delete-overlay').hidden);
  assert.equal(await page.locator('.workspace-file-row').count(),6);
  assert.equal(await page.locator('.workspace-file-row').filter({hasText:'report.pdf'}).count(),0);
  assert.equal(await page.evaluate(()=>fileCalls.delete.at(-1).workspace),'fixture-workspace');
  assert.equal(await page.evaluate(()=>fileCalls.delete.at(-1).revision),'report.pdf:v1');
  assert.match(await page.textContent('#toast'),/Deleted/);
  // An uncertain result offers returning to the list, with no automatic destructive retry.
  await page.evaluate(()=>{window.restoreFileTimeout=window.setTimeout;window.setTimeout=function(fn,ms,...args){return restoreFileTimeout.call(window,fn,ms===15000?50:ms,...args);};});
  await remove('picture.png').click();await page.click('#file-delete-confirm');await page.waitForFunction(()=>document.getElementById('file-delete-error').textContent.length>0);
  assert.match(await page.textContent('#file-delete-error'),/not confirmed/);assert.equal(await page.evaluate(()=>fileCalls.delete.length),3);
  const late=await page.evaluate(()=>fileCalls.delete.at(-1).request);await page.click('#file-delete-cancel');
  await page.evaluate(()=>{window.setTimeout=window.restoreFileTimeout;window.holdFileDelete=false;});
  await page.evaluate(request=>kaipi.receive({event:'workspaceFiles',data:{status:'deleted',request,data:'picture.png'}}),late);
  assert.equal(await page.locator('#file-delete-overlay').isHidden(),true);assert.equal(await page.locator('.workspace-file-row').count(),6);
  // User-controlled names remain text in the destructive confirmation as well.
  await remove('<img src=x').click();assert.equal(await page.locator('#file-delete-dialog img').count(),0);
  assert.equal(await page.evaluate(()=>window.fileInjected),undefined);await page.click('#file-delete-cancel');
  await mkdir('app/build/reports/gui-files',{recursive:true});await page.screenshot({path:'app/build/reports/gui-files/workspace-files-mobile.png'});
  await page.evaluate(()=>KaipiLocale.apply({language:'zh'}));await page.click('#refresh-workspace-files');await remove('设计稿.html').click();
  await page.waitForFunction(()=>Number(getComputedStyle(document.getElementById('file-delete-overlay')).opacity)>.99);
  await page.screenshot({path:'app/build/reports/gui-files/file-delete-confirm.png',animations:'disabled'});
  await page.setViewportSize({width:320,height:640});
  assert.ok(await page.evaluate(()=>document.getElementById('file-delete-dialog').scrollWidth<=document.getElementById('file-delete-dialog').clientWidth+1));
  await page.click('#file-delete-cancel');
  await page.click('#dialog-close');assert.equal(await page.inputValue('#draft'),'保留我正在写的草稿');
  await page.evaluate(()=>kaipi.receive({event:'workspaceFiles',data:{status:'listed',request:String(fileCalls.list.at(-1).request),data:{path:'old',entries:[]}}}));
  assert.equal(await page.locator('#overlay').isHidden(),true);
  // Re-entering the same directory while its initial listing is pending keeps a valid loading surface.
  await page.evaluate(()=>{window.normalFileList=Native.listWorkspaceFiles;Native.listWorkspaceFiles=(request,path)=>fileCalls.list.push({request,path});kaipi.receive({event:'workspaceFiles',data:{status:'directory',data:''}});kaipi.receive({event:'workspaceFiles',data:{status:'directory',data:''}});});
  await page.waitForSelector('.workspace-file-loading');
  await page.evaluate(()=>{Native.listWorkspaceFiles=window.normalFileList;const pending=fileCalls.list.at(-1);Native.listWorkspaceFiles(pending.request,pending.path);});
  assert.equal(await page.locator('.workspace-file-row').count(),6);await page.click('#dialog-close');
  assert.deepEqual(errors,[]);
  console.log('PASS: existing file links, file browsing, folders/breadcrumbs, all-format open/save/share, ZIP actions, escaped names, stale replies, drafts, language, dark theme, confirmation/cancel/back/focus, deletion success/error/timeout, duplicate/stale guards and narrow layout.');
} finally {if(browser)await browser.close();server.kill();}
