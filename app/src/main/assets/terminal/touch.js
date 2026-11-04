'use strict';
// Keep fractional drag distance between events: xterm's viewport rounds to rows
// and can otherwise discard slow gestures. Drive the same scrollbar as xterm.
globalThis.KaipiTouch = {
  install(terminal) {
    let finger = null, lastY = 0, lastTime = 0, position = 0, velocity = 0, frame = 0;
    const element = terminal.element;
    const viewport = element.querySelector('.xterm-viewport');
    const rowHeight = () => element.querySelector('.xterm-screen').getBoundingClientRect().height / terminal.rows;
    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      finger = null;
      velocity = 0;
    }
    function scroll(delta) {
      const height = rowHeight();
      if (!(height > 0)) return false;
      const next = Math.max(0, Math.min(terminal.buffer.active.baseY * height, position + delta));
      const moved = next !== position;
      position = next;
      viewport.scrollTop = position;
      return moved;
    }
    function coast(now) {
      const elapsed = Math.min(64, now - lastTime);
      lastTime = now;
      const decay = Math.exp(-elapsed / 240);
      const moved = scroll(velocity * 240 * (1 - decay));
      velocity *= decay;
      if (moved && Math.abs(velocity) > 0.02) frame = requestAnimationFrame(coast);
      else stop();
    }
    element.addEventListener('touchstart', event => {
      stop();
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      finger = touch.identifier;
      lastY = touch.clientY;
      lastTime = performance.now();
      position = terminal.buffer.active.viewportY * rowHeight();
      event.stopImmediatePropagation();
    }, {capture:true, passive:true});
    element.addEventListener('touchmove', event => {
      if (finger === null) return;
      if (event.touches.length !== 1) {stop(); return;}
      const touch = Array.from(event.touches).find(t => t.identifier === finger);
      if (!touch) return;
      const now = performance.now();
      const delta = lastY - touch.clientY;
      const elapsed = Math.max(1, now - lastTime);
      velocity = Math.max(-3, Math.min(3, delta / elapsed));
      scroll(delta);
      lastY = touch.clientY;
      lastTime = now;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }, {capture:true, passive:false});
    element.addEventListener('touchend', event => {
      if (finger === null) return;
      finger = null;
      const now = performance.now();
      if (now - lastTime < 80 && Math.abs(velocity) > 0.02) {
        lastTime = now;
        frame = requestAnimationFrame(coast);
      }
      event.stopImmediatePropagation();
    }, {capture:true, passive:true});
    element.addEventListener('touchcancel', stop, {capture:true, passive:true});
    element.addEventListener('wheel', stop, {capture:true, passive:true});
    terminal.onScroll(line => {if (line !== Math.round(position / rowHeight())) stop();});
    terminal.onResize(stop);
    document.addEventListener('visibilitychange', stop);
    return {stop};
  }
};
