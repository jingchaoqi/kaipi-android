import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../app/src/main/assets/ui/'+name,import.meta.url),'utf8');
test('bundled Markdown renders answers, tables, code and safe links without Array.at',()=>{
 const context=vm.createContext({window:{}});
 vm.runInContext('Array.prototype.at=undefined',context);
 vm.runInContext(source('vendor/marked.js'),context);vm.runInContext(source('render.js'),context);
 const render=context.window.KaipiRender.markdown;
 assert.match(render('A'),/^<p>A<\/p>/);
 assert.match(render('- First\n- Second'),/<ul>/);
 assert.match(render('| A | B |\n|---|---|\n| 1 | 2 |'),/<table>/);
 assert.match(render('```js\nconst a=1;\n```'),/<code class="language-js">/);
 assert.match(render('[file](./index.html)'),/data-workspace-file=".\/index.html"/);
 assert.doesNotMatch(render('[unsafe](javascript:alert(1))'),/href=/);
 assert.doesNotMatch(render('<button onclick="bad()">x</button>'),/<button/);
});
test('unexpected Markdown errors fall back to escaped text instead of breaking execution UI',()=>{
 const context=vm.createContext({window:{},marked:{use(){},parse(){throw new Error('render failure');}}});
 vm.runInContext(source('render.js'),context);
 const result=context.window.KaipiRender.markdown('<script>bad()</script>\n[unchanged]');
 assert.equal(result,'<p>&lt;script&gt;bad()&lt;/script&gt;<br>[unchanged]</p>');
});
