import {spawn} from 'node:child_process';
import {mkdir,copyFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const server=spawn(process.env.KAIPI_TEST_PYTHON||'python3',['scripts/preview.py','--first-run','--port','0'],{stdio:['ignore','pipe','inherit']});
let browser;
try {
 const url=await new Promise((resolve,reject)=>{server.stdout.on('data',c=>{const m=String(c).match(/http:\/\/127\.0\.0\.1:\d+/);if(m)resolve(m[0]);});server.on('exit',reject);});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||undefined,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 await mkdir('dist/screenshots',{recursive:true});await mkdir('docs/screenshots',{recursive:true});
 await page.goto(url);await page.waitForSelector('#welcome-languages');await page.waitForTimeout(600);
 await page.screenshot({path:'dist/screenshots/language.png'});
 await page.click('[data-language=zh]');await page.click('#language-continue');await page.waitForSelector('#provider-form');await page.waitForTimeout(300);
 await page.screenshot({path:'dist/screenshots/provider-setup.png'});
 await page.click('#provider-select');await page.waitForTimeout(250);
 await page.screenshot({path:'dist/screenshots/provider-picker.png'});
 for(const name of ['language','provider-setup','provider-picker'])await copyFile(`dist/screenshots/${name}.png`,`docs/screenshots/${name}.png`);
} finally {await browser?.close();server.kill('SIGTERM');}
