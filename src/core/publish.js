// Публикация паков в магазин прямо из студии — через GitHub (файлы в папке store/ репозитория игры).
// Нужен «ключ доступа» GitHub (fine-grained token: только этот репозиторий, право Contents: Read and write).
// Ключ хранится только в браузере, где открыта студия. В игру этот модуль не попадает.
import { validatePack, listRecords, listOverrides, PACK_FORMAT } from './library.js';
import { listOwnRecipes } from './recipes.js';
import { lockedList } from './access.js';
import { ownZones } from './mapZones.js';
import { ownWorld } from './world.js';
import { ownHeroArt } from '../render/heroArt.js';
import { loadImage, img } from '../assets.js';
import { itemDef } from './catalog.js';

const KEY = 'sunny-studio-github';
const API = 'https://api.github.com';

export function getSettings() {
  try { return { repo: 'ArtemIonov123/sunny-home', branch: 'main', token: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch (e) { return { repo: 'ArtemIonov123/sunny-home', branch: 'main', token: '' }; }
}
export function saveSettings(s) { localStorage.setItem(KEY, JSON.stringify({ repo: s.repo.trim(), branch: (s.branch || 'main').trim(), token: s.token.trim() })); }
export const hasToken = () => !!getSettings().token;

// UTF-8 ⇄ base64 (большие строки — кусками)
function toB64(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64.replace(/\n/g, '')), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const s = getSettings();
  if (!s.token) throw new Error('Сначала вставь ключ GitHub (настройки публикации)');
  const r = await fetch(`${API}/repos/${s.repo}/${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + s.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404 && method === 'GET') return null;
  if (r.status === 401) throw new Error('GitHub не принял ключ — проверь, что он вставлен целиком и не просрочен');
  if (r.status === 403) throw new Error('У ключа нет права менять файлы (нужно Contents: Read and write для этого репозитория)');
  if (r.status === 409) throw new Error('Файл на GitHub успел измениться — нажми ещё раз');
  if (!r.ok) throw new Error('GitHub ответил: ' + r.status);
  return raw ? r.text() : r.json();
}

async function getFile(path) {
  const { branch } = getSettings();
  const meta = await gh(`contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (!meta) return null;
  const text = meta.content ? fromB64(meta.content) : await gh(`contents/${path}?ref=${encodeURIComponent(branch)}`, { raw: true }); // больше 1 МБ — отдельным запросом
  return { sha: meta.sha, text };
}
async function putFile(path, text, message, sha) {
  const { branch } = getSettings();
  return gh(`contents/${path}`, { method: 'PUT', body: { message, content: toB64(text), branch, ...(sha ? { sha } : {}) } });
}
// Картинка (data:URL) → файл на GitHub как есть (двоичный).
async function putImage(path, dataUrl, message) {
  const { branch } = getSettings();
  const prev = await gh(`contents/${path}?ref=${encodeURIComponent(branch)}`);
  return gh(`contents/${path}`, { method: 'PUT', body: { message, content: dataUrl.split(',')[1], branch, ...(prev?.sha ? { sha: prev.sha } : {}) } });
}
async function deleteFile(path, message, sha) {
  const { branch } = getSettings();
  return gh(`contents/${path}`, { method: 'DELETE', body: { message, sha, branch } });
}

// Проверка ключа: читаем репозиторий.
export async function testToken() {
  const s = getSettings();
  const r = await fetch(`${API}/repos/${s.repo}`, { headers: { Authorization: 'Bearer ' + s.token, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(r.status === 401 ? 'Ключ не подходит' : r.status === 404 ? 'Репозиторий не найден или ключ к нему не допущен' : 'GitHub ответил: ' + r.status);
  const j = await r.json();
  if (j.permissions && !j.permissions.push) throw new Error('Ключ только для чтения — нужно право записи (Contents: Read and write)');
  return j.full_name;
}

// ── Обложка и маленькие картинки для карточки магазина (как tools/store.py) ──
const COLORS = ['#ffd68c', '#bae2ff', '#ffc4d6', '#c8ecbe', '#e1cdff'];
async function fit(src, size) {
  const im = await loadImage(src), cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const s = Math.min(size / im.width, size / im.height);
  cv.getContext('2d').drawImage(im, (size - im.width * s) / 2, (size - im.height * s) / 2, im.width * s, im.height * s);
  return cv;
}
export const COVER_COLORS = ['#ffd68c', '#bae2ff', '#ffc4d6', '#c8ecbe', '#e1cdff', '#ffb38a', '#9fe3d6', '#fff1a8', '#f3e3cf', '#c9d3ff'];
// Картинка «во весь холст» (обрезка по центру, как background-size: cover).
async function drawCover(c, src, W, H) {
  const im = await loadImage(src), s = Math.max(W / im.width, H / im.height);
  c.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
}
// Обложка пака 480×300. style: { color, bg (своя картинка-фон под вещами), full (своя обложка целиком) }.
export async function makeCover(items, k = 0, style = {}) {
  const W = 480, H = 300, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.beginPath(); c.roundRect ? c.roundRect(0, 0, W, H, 36) : c.rect(0, 0, W, H); c.clip();
  if (style.full) { await drawCover(c, style.full, W, H); return cv.toDataURL('image/webp', 0.88); }
  c.fillStyle = style.color || COLORS[k % COLORS.length]; c.fillRect(0, 0, W, H);
  if (style.bg) await drawCover(c, style.bg, W, H);
  else {
    c.fillStyle = 'rgba(255,255,255,.35)';
    for (const [x, y, r] of [[60, 50, 70], [420, 260, 110], [400, 40, 40], [90, 270, 50]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  }
  const pics = items.slice(0, 4), n = pics.length, size = n <= 2 ? 170 : 140;
  for (let i = 0; i < n; i++) {
    const t = await fit(pics[i].image, size);
    c.drawImage(t, W * (i + 1) / (n + 1) - size / 2, H - size - 30 - (i % 2 ? 18 : 0));
  }
  return cv.toDataURL('image/webp', 0.85);
}

export async function readCatalog() {
  const f = await getFile('store/catalog.json');
  const cat = f ? JSON.parse(f.text) : { format: 'sunny-home-store', version: 1, packs: [] };
  return { cat, sha: f?.sha };
}

// Опубликовать (или обновить) пак: файл пака + запись в каталоге. Возвращает запись каталога.
export async function publishPack(raw, onStep = () => {}) {
  const pack = { ...validatePack(raw), price: Math.max(0, Number(raw.price) || 0) };
  if (raw.coverStyle) pack.coverStyle = raw.coverStyle; // фон обложки — хранится в паке, чтобы при обновлении остался
  if (raw.pageStyle) pack.pageStyle = raw.pageStyle;   // фон страницы пака в магазине
  if (raw.slides) pack.slides = raw.slides;             // слайды «что внутри»
  // Открытые паком встроенные предметы (щенок) — тоже на обложку и в список «что внутри».
  const pics = [...pack.items, ...(pack.unlock || []).map((id) => ({ image: img(itemDef(id)?.art)?.src || img(itemDef(id)?.art)?.toDataURL?.() })).filter((x) => x.image)];
  onStep('Читаю магазин…');
  const { cat, sha } = await readCatalog();
  const old = cat.packs.find((p) => p.id === pack.id), k = old ? cat.packs.indexOf(old) : cat.packs.length;
  onStep('Рисую обложку…');
  const entry = {
    id: pack.id, name: pack.name, version: (old?.version || 0) + 1,
    price: pack.price, currency: 'PLN', priceLabel: pack.price ? pack.price.toFixed(2).replace('.', ',') + ' zł' : '',
    product: 'pack_' + pack.id, file: 'packs/' + pack.id + '.json', items: pics.length,
    ...(pack.gift ? { gift: true } : {}), // подарок: игра ставит его всем сама
    cover: pics.length || pack.coverStyle?.full ? await makeCover(pics, k, pack.coverStyle || {}) : old?.cover || '',
    // Все вещи пака (до 24) — для прокрутки на странице пака в магазине.
    preview: await Promise.all(pics.slice(0, 24).map(async (it) => (await fit(it.image, 112)).toDataURL('image/webp', 0.78))),
    page: { color: pack.pageStyle?.color || '' },
  };
  if (pack.pageStyle?.image) { // фон страницы пака — отдельной картинкой, чтобы список магазина оставался лёгким
    onStep('Загружаю фон пака…');
    await putImage(`store/bg/${pack.id}.webp`, pack.pageStyle.image, `Магазин: фон пака «${pack.name}»`);
    entry.page.image = `bg/${pack.id}.webp?v=${entry.version}`;
  }
  // Слайды: отдельными картинками store/slides/<id>_<n>.webp (лишние старые — удаляем).
  entry.slides = [];
  for (let n = 0; n < (pack.slides || []).length; n++) {
    onStep(`Загружаю слайд ${n + 1} из ${pack.slides.length}…`);
    await putImage(`store/slides/${pack.id}_${n + 1}.webp`, pack.slides[n], `Магазин: слайд ${n + 1} пака «${pack.name}»`);
    entry.slides.push(`slides/${pack.id}_${n + 1}.webp?v=${entry.version}`);
  }
  await removeSlides(pack.id, entry.slides.length);
  onStep('Загружаю пак…');
  const prev = await gh(`contents/store/packs/${pack.id}.json?ref=${encodeURIComponent(getSettings().branch)}`);
  await putFile(`store/packs/${pack.id}.json`, JSON.stringify(pack), `Магазин: пак «${pack.name}» (из студии)`, prev?.sha);
  onStep('Обновляю список магазина…');
  if (old) cat.packs[k] = entry; else cat.packs.push(entry);
  await putFile('store/catalog.json', JSON.stringify(cat, null, 1), `Магазин: «${pack.name}» в каталоге, версия ${entry.version}`, sha);
  return entry;
}

// Удалить слайды пака с номером больше keep.
async function removeSlides(id, keep) {
  const list = await gh(`contents/store/slides?ref=${encodeURIComponent(getSettings().branch)}`);
  if (!Array.isArray(list)) return;
  for (const f of list) {
    const m = f.name.match(/^(.+)_(\d+)\.webp$/);
    if (m && m[1] === id && Number(m[2]) > keep) await deleteFile(f.path, `Магазин: убран слайд ${f.name}`, f.sha);
  }
}

export async function removePack(id) {
  const { cat, sha } = await readCatalog();
  const entry = cat.packs.find((p) => p.id === id);
  cat.packs = cat.packs.filter((p) => p.id !== id);
  await putFile('store/catalog.json', JSON.stringify(cat, null, 1), `Магазин: убран пак «${entry?.name || id}»`, sha);
  const f = await gh(`contents/store/packs/${id}.json?ref=${encodeURIComponent(getSettings().branch)}`);
  if (f?.sha) await deleteFile(`store/packs/${id}.json`, `Магазин: удалён файл пака ${id}`, f.sha);
  await removeSlides(id, 0);
  const bg = await gh(`contents/store/bg/${id}.webp?ref=${encodeURIComponent(getSettings().branch)}`);
  if (bg?.sha) await deleteFile(`store/bg/${id}.webp`, `Магазин: удалён фон пака ${id}`, bg.sha);
}

// Пак из магазина — в студию (чтобы поправить и опубликовать заново).
export async function fetchStorePack(id) {
  const f = await getFile(`store/packs/${id}.json`);
  if (!f) throw new Error('Файл пака не найден');
  return JSON.parse(f.text);
}

// «Отправить игрокам» (студия → Животные): какие встроенные не выдавать всем (catalog.locked)
// и пак-подарок со своими животными, у которых стоит «выдать игроку» (ставится всем игрокам сам).
export const GIFT_ID = 'gift_animals';
export async function publishForPlayers({ locked, gift }, onStep = () => {}) {
  if (gift) await publishPack(gift, onStep);
  else {
    const { cat } = await readCatalog();
    if (cat.packs.some((p) => p.id === GIFT_ID)) { onStep('Убираю подарок…'); await removePack(GIFT_ID); }
  }
  onStep('Сохраняю, кого выдавать…');
  const { cat, sha } = await readCatalog();
  cat.locked = [...new Set(locked)];
  await putFile('store/catalog.json', JSON.stringify(cat, null, 1), `Магазин: выдавать игрокам (закрыто: ${cat.locked.join(', ') || 'ничего'})`, sha);
}

// «📤 В игру»: всё, что поменяли в студии, — игрокам. Один пак-подарок (ставится сам у всех):
// правки встроенных предметов, свои рецепты, свои животные с «выдать игроку». Плюс список «не выдавать».
// Комнаты и расстановка — это сохранение дома, не каталог: игрокам не отправляются.
export async function sendGameUpdate(onStep = () => {}) {
  const items = listRecords().filter((r) => (r.animal || r.cloth) && r.give);
  const overrides = listOverrides(), recipes = listOwnRecipes(), mapZones = ownZones(), world = ownWorld(), heroArt = ownHeroArt();
  const hasWorld = world.districts.length || Object.keys(world.places).length || Object.keys(world.finishes).length;
  const hasHero = Object.keys(heroArt).length > 0;
  const gift = items.length || overrides.length || recipes.length || Object.keys(mapZones).length || hasWorld || hasHero
    ? { format: PACK_FORMAT, version: 1, id: GIFT_ID, name: 'Обновление игры', price: 0, gift: true, items, overrides, recipes, mapZones, ...(hasWorld ? { world } : {}), ...(hasHero ? { heroArt } : {}) } : null;
  await publishForPlayers({ locked: lockedList().filter((id) => itemDef(id)), gift }, onStep);
  return { items: items.length, overrides: overrides.length, recipes: recipes.length, zones: Object.keys(mapZones).length, districts: world.districts.length, places: Object.keys(world.places).length, finishes: Object.keys(world.finishes).length };
}
