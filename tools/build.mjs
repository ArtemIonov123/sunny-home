// Собирает игру в ОДИН файл dist/sunny-home.html: код, стили и все картинки внутри.
// Запуск: npm run build
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.endsWith('.webp')) out.push(p);
  }
  return out;
}

const bundle = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: ['es2020'],
});
const js = bundle.outputFiles[0].text;
const css = await readFile(join(root, 'src/styles.css'), 'utf8');

const assets = {};
for (const file of await walk(join(root, 'assets'))) {
  const key = relative(join(root, 'assets'), file).replace(/\\/g, '/').replace(/\.webp$/, '');
  assets[key] = 'data:image/webp;base64,' + (await readFile(file)).toString('base64');
}

let html = await readFile(join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="src/styles.css">', () => `<style>${css}</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () =>
  `<script>window.EMBEDDED_ASSETS=${JSON.stringify(assets)};</script>\n<script>${js}</script>`);

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/sunny-home.html'), html);
console.log(`dist/sunny-home.html  ${(html.length / 1024 / 1024).toFixed(2)} MB, картинок: ${Object.keys(assets).length}`);
