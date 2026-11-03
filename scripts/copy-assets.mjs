import {mkdir, copyFile} from 'node:fs/promises';
const dest = new URL('../app/src/main/assets/terminal/vendor/', import.meta.url);
await mkdir(dest, {recursive: true});
for (const [source, name] of [
  ['@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
  ['@xterm/xterm/LICENSE', 'xterm-LICENSE'],
  ['@xterm/addon-fit/LICENSE', 'addon-fit-LICENSE'],
]) await copyFile(new URL('../node_modules/' + source, import.meta.url), new URL(name, dest));
