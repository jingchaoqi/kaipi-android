'use strict';
const terminal = new Terminal({cursorBlink:true, fontSize:14, fontFamily:'monospace', scrollback:5000,
  theme:{background:'#101411', foreground:'#E3E9DF', cursor:'#A3E635', selectionBackground:'#425338'},
  allowProposedApi:false, convertEol:false});
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open(document.getElementById('terminal'));
let ctrl = false;
terminal.onData(data => {
  if (ctrl) { data = KaipiKeys.controlInput(data); ctrl = false; Native.ctrlReleased(); }
  Native.send(data);
});
terminal.onResize(({cols, rows}) => Native.resize(cols, rows));
function fitTerminal() {
  const el = document.getElementById('terminal');
  if (el.clientWidth > 20 && el.clientHeight > 20) fit.fit();
}
let pendingFit;
new ResizeObserver(() => {clearTimeout(pendingFit); pendingFit = setTimeout(() => fitTerminal(), 60);}).observe(document.getElementById('terminal'));
window.kaipi = {
  output(base64, generation) {terminal.write(Uint8Array.from(atob(base64), c => c.charCodeAt(0)), () => Native.consumed(generation));},
  key(key) {terminal.input(KaipiKeys.encodeKey(key, terminal.modes.applicationCursorKeysMode), true); terminal.focus();},
  ctrl(active) {ctrl = active; terminal.focus();},
  focus() {terminal.focus();},
  reset() {terminal.reset(); fitTerminal(); Native.resize(terminal.cols, terminal.rows);},
  ready() {fitTerminal(); Native.resize(terminal.cols, terminal.rows);}
};
fitTerminal();
Native.ready();
