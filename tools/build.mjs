// Собирает игру в ОДИН файл dist/sunny-home.html (и студию dist/studio.html): код, стили, картинки и паки внутри.
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

const css = await readFile(join(root, 'src/styles.css'), 'utf8');

const assets = {};
for (const file of await walk(join(root, 'assets'))) {
  const key = relative(join(root, 'assets'), file).replace(/\\/g, '/').replace(/\.webp$/, '');
  assets[key] = 'data:image/webp;base64,' + (await readFile(file)).toString('base64');
}

// Встроенные паки: все *.json из папки packs/ (файлы, скачанные в студии во вкладке «Паки»).
const packs = [];
try {
  for (const f of (await readdir(join(root, 'packs'))).filter((f) => f.endsWith('.json')).sort()) {
    try { packs.push(JSON.parse(await readFile(join(root, 'packs', f), 'utf8'))); }
    catch (e) { console.warn('Пак не прочитался, пропущен:', f, e.message); }
  }
} catch (e) { /* папки packs нет — паков нет */ }

// Копия каталога магазина — на случай, если нет сети (сами паки скачиваются с GitHub).
let storeCat = null;
try { storeCat = JSON.parse(await readFile(join(root, 'store/catalog.json'), 'utf8')); } catch (e) { storeCat = null; }

const template = await readFile(join(root, 'index.html'), 'utf8');
await mkdir(join(root, 'dist'), { recursive: true });

// Две сборки: игра (без админки) и студия (с админкой — делать паки).
for (const [file, studio, title] of [['sunny-home.html', false, 'Солнечный дом'], ['studio.html', true, 'Солнечный дом — студия']]) {
  const bundle = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true, format: 'iife', minify: true, write: false, target: ['es2020'],
    define: { __STUDIO__: String(studio) },
  });
  const js = bundle.outputFiles[0].text;
  let html = template.replace('<title>Солнечный дом</title>', `<title>${title}</title>`);
  html = html.replace('<link rel="stylesheet" href="src/styles.css">', () => `<style>${css}</style>`);
  html = html.replace(/<script>window.__STUDIO__[^<]*<\/script>\n/, '');
  html = html.replace('<script type="module" src="src/main.js"></script>', () =>
    `<script>window.EMBEDDED_ASSETS=${JSON.stringify(assets)};window.EMBEDDED_PACKS=${JSON.stringify(packs)};window.EMBEDDED_STORE=${JSON.stringify(storeCat)};</script>\n<script>${js}</script>`);
  await writeFile(join(root, 'dist', file), html);
  console.log(`dist/${file}  ${(html.length / 1024 / 1024).toFixed(2)} MB, картинок: ${Object.keys(assets).length}, паков: ${packs.length}, код ${(js.length / 1024).toFixed(0)} КБ`);
}
