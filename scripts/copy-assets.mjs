import {mkdir, copyFile} from 'node:fs/promises';
const dest = new URL('../app/src/main/assets/ui/vendor/', import.meta.url);
await mkdir(dest, {recursive: true});
for (const [source, name] of [
  ['marked/lib/marked.umd.js', 'marked.js'],
  ['marked/LICENSE.md', 'marked-LICENSE'],
]) await copyFile(new URL('../node_modules/' + source, import.meta.url), new URL(name, dest));
