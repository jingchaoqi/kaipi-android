import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../app/src/main/assets/terminal/keys.js';
const {encodeKey,controlInput}=globalThis.KaipiKeys;
test('normal and application cursor modes match terminal escape sequences',()=>{
  for(const [key,code] of Object.entries({up:'A',down:'B',right:'C',left:'D'})) {
    assert.equal(encodeKey(key), '\x1b['+code);
    assert.equal(encodeKey(key,true), '\x1bO'+code);
  }
});
test('toolbar sends actual control bytes and literal slash',()=>{
  for(const [key,value] of Object.entries({slash:'/',tab:'\t',esc:'\x1b',enter:'\r',interrupt:'\x03'}))assert.equal(encodeKey(key),value);
  assert.equal(encodeKey('unknown'),'');
});
test('Ctrl combinations, Unicode and paste',()=>{
  assert.equal(controlInput('c'),'\x03'); assert.equal(controlInput('D'),'\x04');
  assert.equal(controlInput('['),'\x1b'); assert.equal(controlInput(' '),'\x00');
  assert.equal(controlInput('?'),'\x7f'); assert.equal(controlInput('你好'),'你好');
  assert.equal(controlInput('paste\ntext'),'paste\ntext');
});
