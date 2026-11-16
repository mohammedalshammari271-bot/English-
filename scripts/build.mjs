import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const assets = {};
for (const [path, file, type] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/gradebook.js', 'gradebook.js', 'text/javascript; charset=utf-8'],
  ['/layout.css', 'layout.css', 'text/css; charset=utf-8'],
  ['/grid.js', 'grid.js', 'text/javascript; charset=utf-8'],
  ['/sync.js', 'sync.js', 'text/javascript; charset=utf-8']
]) {
  assets[path] = [type, await readFile(new URL('../public/' + file, import.meta.url), 'utf8')];
}
const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\n' + source);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
