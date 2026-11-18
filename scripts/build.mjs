import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
const assets = {};
for (const [path, file, type] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/name-import.js', 'name-import.js', 'text/javascript; charset=utf-8'],
  ['/navigation.js', 'navigation.js', 'text/javascript; charset=utf-8'],
  ['/gradebook.js', 'gradebook.js', 'text/javascript; charset=utf-8'],
  ['/fonts/zain.css', 'fonts/zain.css', 'text/css; charset=utf-8'],
  ['/layout.css', 'layout.css', 'text/css; charset=utf-8'],
  ['/grid.js', 'grid.js', 'text/javascript; charset=utf-8'],
  ['/sync.js', 'sync.js', 'text/javascript; charset=utf-8']
]) {
  assets[path] = [type, await readFile(new URL('../public/' + file, import.meta.url), 'utf8')];
}
const fontDirectory = new URL('../public/fonts/', import.meta.url);
for (const name of await readdir(fontDirectory)) {
  if (name.endsWith('.woff2')) {
    assets['/fonts/' + name] = ['font/woff2', (await readFile(new URL(name, fontDirectory))).toString('base64'), true];
  }
}
const moduleRoot = new URL('../node_modules/', import.meta.url);
for (const [path,file] of [
 ['jszip.min.js','jszip/dist/jszip.min.js'],
 ['pdf.min.mjs','pdfjs-dist/legacy/build/pdf.min.mjs'],
 ['pdf.worker.min.mjs','pdfjs-dist/legacy/build/pdf.worker.min.mjs'],
 ['tesseract.min.js','tesseract.js/dist/tesseract.min.js'],
 ['tesseract-worker.min.js','tesseract.js/dist/worker.min.js'],
 ['tesseract-core-lstm.wasm.js','tesseract.js-core/tesseract-core-lstm.wasm.js']
]) assets['/vendor/'+path]=['text/javascript; charset=utf-8',await readFile(new URL(file,moduleRoot),'utf8')];
const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\n' + source);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
