/** Capture the actual GUI against the isolated development fixture. */
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const server = spawn(process.env.KAIPI_TEST_PYTHON || 'python3', ['scripts/preview.py','--seed','--port','0'], {stdio:['ignore','pipe','inherit']});
let browser;
try {
 const url = await new Promise((resolve,reject) => { server.stdout.on('data',c=>{const m=String(c).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('exit',reject); });
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN || undefined,headless:true,args:['--no-sandbox']});
 await mkdir('dist/screenshots',{recursive:true});
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 await mobile.goto(url);await mobile.waitForSelector('.turn');await mobile.waitForTimeout(250);
 await mobile.screenshot({path:'dist/screenshots/mobile-chat.png'});
 await mobile.click('#tree-toggle');await mobile.waitForTimeout(400);await mobile.locator('.tree-node').filter({hasText:'N3'}).click();await mobile.waitForTimeout(250);
 await mobile.screenshot({path:'dist/screenshots/mobile-tree.png'});
 await mobile.click('#tree-close');await mobile.click('#sidebar-toggle');await mobile.click('#appearance-button');
 await mobile.click('[data-mode="dark"]');await mobile.click('[data-color="indigo"]');await mobile.waitForTimeout(300);
 await mobile.screenshot({path:'dist/screenshots/theme-dark.png'});
 await mobile.click('#dialog-close');await mobile.click('#sidebar-close');await mobile.waitForTimeout(450);
 await mobile.screenshot({path:'dist/screenshots/mobile-dark.png'});
 await mobile.click('#tree-toggle');await mobile.waitForTimeout(400);
 await mobile.screenshot({path:'dist/screenshots/tree-dark.png'});
 await mobile.click('#tree-close');await mobile.click('#sidebar-toggle');await mobile.click('#appearance-button');
 await mobile.click('[data-mode="light"]');await mobile.click('[data-color="clay"]');await mobile.waitForTimeout(300);
 await mobile.screenshot({path:'dist/screenshots/theme-clay.png'});
 await mobile.click('#dialog-close');await mobile.click('#new-chat');await mobile.waitForTimeout(300);
 await mobile.screenshot({path:'dist/screenshots/mobile-welcome.png'});
 console.log('Captured light, dark, color picker, conversation and context tree.');
} finally {await browser?.close();server.kill('SIGTERM');}
