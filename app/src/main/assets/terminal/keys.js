(function (root) {
  function encodeKey(key, applicationCursor = false) {
    const arrows = {up: 'A', down: 'B', right: 'C', left: 'D'};
    if (arrows[key]) return '\x1b' + (applicationCursor ? 'O' : '[') + arrows[key];
    return {esc: '\x1b', tab: '\t', slash: '/', enter: '\r', interrupt: '\x03'}[key] ?? '';
  }
  function controlInput(data) {
    if (data.length !== 1) return data;
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
    if (data === ' ') return '\x00';
    if (data === '?') return '\x7f';
    return data;
  }
  root.KaipiKeys = {encodeKey, controlInput};
})(globalThis);
