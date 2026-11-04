import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/src/main/assets/terminal/touch.js', import.meta.url), 'utf8');
function setup() {
  let now = 0, nextFrame = 1, scrollTop = 0;
  const frames = new Map(), listeners = {}, callbacks = {};
  const buffer = {baseY:100, viewportY:50};
  // xterm snaps its scrollbar back to row boundaries after rendering.
  const viewport = {
    get scrollTop() {return scrollTop;},
    set scrollTop(value) {
      buffer.viewportY = Math.round(value / 20);
      scrollTop = buffer.viewportY * 20;
      callbacks.scroll?.(buffer.viewportY);
    }
  };
  const terminal = {
    rows:20, buffer:{active:buffer},
    element:{
      querySelector: name => name === '.xterm-viewport' ? viewport : {getBoundingClientRect:() => ({height:400})},
      addEventListener: (name, fn) => {listeners[name] = fn;}
    },
    onScroll: fn => {callbacks.scroll = fn;},
    onResize: fn => {callbacks.resize = fn;}
  };
  const context = vm.createContext({
    performance:{now:() => now},
    requestAnimationFrame:fn => {const id = nextFrame++; frames.set(id, fn); return id;},
    cancelAnimationFrame:id => frames.delete(id),
    document:{addEventListener:(name, fn) => {callbacks[name] = fn;}}
  });
  vm.runInContext(source, context);
  const controller = context.KaipiTouch.install(terminal);
  function event(name, y = 200, count = 1) {
    now += 16;
    const ev = {touches:Array.from({length:count}, (_, identifier) => ({identifier, clientY:y})),
      cancelable:true, preventDefault() {this.prevented = true;}, stopImmediatePropagation() {this.stopped = true;}};
    listeners[name](ev);
    return ev;
  }
  function advance(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 16;
      const batch = [...frames.values()]; frames.clear();
      for (const fn of batch) fn(now);
    }
  }
  return {buffer, event, advance, frames, callbacks, controller};
}

test('slow sub-row drags accumulate even when xterm snaps the scrollbar', () => {
  const t = setup();
  t.event('touchstart');
  for (let i = 1; i <= 20; i++) {
    const ev = t.event('touchmove', 200 + i * 2);
    assert.ok(ev.prevented && ev.stopped);
  }
  assert.equal(t.buffer.viewportY, 48);
});

test('a flick coasts continuously, stops at the boundary, and can reverse', () => {
  const t = setup();
  t.event('touchstart'); t.event('touchmove', 280); t.event('touchend', 280, 0);
  const released = t.buffer.viewportY;
  t.advance(5);
  assert.ok(t.buffer.viewportY < released);
  t.advance(200);
  assert.equal(t.frames.size, 0);
  assert.ok(t.buffer.viewportY >= 0);
  t.event('touchstart', 280); t.event('touchmove', -2000); t.event('touchend', -2000, 0);
  t.advance(200);
  assert.equal(t.buffer.viewportY, 100);
  assert.equal(t.frames.size, 0);
});

test('tap, cancellation, resize, new input and backgrounding stop inertia', () => {
  const t = setup();
  t.event('touchstart'); t.event('touchend', 200, 0);
  assert.equal(t.frames.size, 0);
  for (const stop of [() => t.event('touchstart'), () => t.event('touchcancel'),
    () => t.event('touchstart', 200, 2), t.callbacks.resize, t.controller.stop, t.callbacks.visibilitychange]) {
    t.event('touchstart'); t.event('touchmove', 240); t.event('touchend', 240, 0);
    stop();
    const row = t.buffer.viewportY;
    t.advance(20);
    assert.equal(t.buffer.viewportY, row);
    assert.equal(t.frames.size, 0);
  }
});
