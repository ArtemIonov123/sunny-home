// Библиотека своих предметов: создаются в админке, хранятся отдельно от дома,
// переносятся паком (JSON с картинками внутри).
// Запись: { id:'custom_…', name, group, place, w, image:'data:image/webp;base64,…' }
import { GROUPS, PLACES, CUSTOM_PREFIX, toDef, putCustomDef, removeCustomDef, customDefs, applyOverride, clearOverride, isBuiltin, MACHINE_FX, MACHINE_MOVES } from './catalog.js';
import { loadImage, registerImage, forgetImage } from '../assets.js';
import { loadCatalogRecords, saveCatalogRecords, loadOldStudio, loadOverrides, saveOverrides, loadRecipes, saveRecipes } from '../save/storage.js';
import { validateRecipe, setOwnRecipes, listOwnRecipes, addPackRecipes } from './recipes.js';
import { ANIMAL_PARTS, JOINT_PARTS, VOICES, setupAnimal, forgetAnimal } from '../render/animal.js';
import { unlock } from './access.js';
import { itemDef } from './catalog.js';
import { cleanAllZones, setPackZones } from './mapZones.js';

export const LIBRARY_LIMIT = 60;
export const MIN_W = 40, MAX_W = 900;
const records = new Map();

export function newId() { return CUSTOM_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// «Живые» свойства своего предмета. Всё в долях картинки (0..1), неверное просто отбрасывается.
const frac = (v) => Number.isFinite(v) && v >= -0.5 && v <= 1.5;
const fracs = (a, n) => Array.isArray(a) && a.length >= n && a.slice(0, n).every(frac);
const IMG_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
export const TAPS = { ring: 'Звенит и трясётся', squeak: 'Пищит' };
export const WEARS = { tshirt: 'Футболка', pants: 'Штанишки', dress: 'Платье' };
// Вода: [x, y, докуда, ширина] в долях картинки + направление (−85…85°) и напор (0…1).
function cleanWater(a) {
  const w = a.slice(0, 4).map((v) => Math.round(v * 1000) / 1000);
  const dir = Number.isFinite(a[4]) ? Math.max(-85, Math.min(85, Math.round(a[4]))) : 0;
  const push = Number.isFinite(a[5]) ? Math.max(0, Math.min(1, Math.round(a[5] * 100) / 100)) : 0;
  return [...w, dir, push];
}
export function cleanLiving(raw) {
  const out = {};
  if (Array.isArray(raw.crop) && raw.crop.length === 6 && raw.crop.every(Number.isFinite)) out.crop = raw.crop.map(Math.round);
  if (Array.isArray(raw.surfaces)) {
    const s = raw.surfaces.filter((a) => fracs(a, 3) && a[1] > a[0]).slice(0, 8).map((a) => (a[3] ? [a[0], a[1], a[2], 1] : [a[0], a[1], a[2]]).map((v) => Math.round(v * 1000) / 1000));
    if (s.length) out.surfaces = s;
  }
  // Сиденья и кровати: [x0, x1, y] или [x0, x1, y, 1] — кровать (герой ложится головой к x0); cover — одеяло.
  if (Array.isArray(raw.seats)) {
    const s = raw.seats.filter((a) => fracs(a, 3) && a[1] > a[0]).slice(0, 6).map((a) => [a[0], a[1], a[2]].map((v) => Math.round(v * 1000) / 1000).concat(a[3] ? [1] : []));
    if (s.length) out.seats = s;
  }
  if (out.seats?.some((a) => a[3]) && fracs(raw.cover, 4) && raw.cover[2] > raw.cover[0] && raw.cover[3] > raw.cover[1]) out.cover = raw.cover.slice(0, 4).map((v) => Math.round(v * 1000) / 1000);
  if (raw.open && typeof raw.open.image === 'string' && IMG_RE.test(raw.open.image) && raw.open.image.length < 2_000_000) {
    out.open = { image: raw.open.image, box: fracs(raw.open.box, 4) && raw.open.box[2] > 0 && raw.open.box[3] > 0 ? raw.open.box.slice(0, 4) : [0, 0, 1, 1] };
  }
  const p = raw.power;
  if (p && fracs(p.glow, 3)) out.power = { glow: p.glow.slice(0, 3) };
  else if (p && fracs(p.screen, 4)) out.power = { screen: p.screen.slice(0, 4) };
  else if (p && fracs(p.water, 4)) out.power = { water: cleanWater(p.water) };
  if (TAPS[raw.tap]) out.tap = raw.tap;
  const mc = raw.machine;
  if (mc && typeof mc === 'object' && MACHINE_FX[mc.fx] !== undefined) {
    out.machine = { move: MACHINE_MOVES[mc.move] ? mc.move : 'shake', fx: mc.fx, at: fracs(mc.at, 3) ? mc.at.slice(0, 3).map((v) => Math.round(v * 1000) / 1000) : [0.5, 0.4, 0.25], hide: mc.hide === true, out: mc.out === 'pop' ? 'pop' : 'shelf' };
  }
  // Животное: картинки частей (data:URL), суставы (доли), голос.
  const an = raw.animal;
  if (an && typeof an === 'object' && an.parts && typeof an.parts === 'object') {
    const parts = {};
    for (const k of Object.keys(ANIMAL_PARTS)) { const v = an.parts[k]; if (typeof v === 'string' && IMG_RE.test(v) && v.length < 1_500_000) parts[k] = v; }
    if (Object.entries(ANIMAL_PARTS).every(([k, p]) => !p.need || parts[k])) {
      const joints = {};
      for (const k of JOINT_PARTS) if (parts[k] && fracs(an.joints?.[k], 2)) joints[k] = an.joints[k].slice(0, 2).map((v) => Math.round(v * 10000) / 10000);
      out.animal = { parts, joints, voice: VOICES[an.voice] !== undefined ? an.voice : '' };
    }
  }
  if (raw.drink === true) out.drink = true;
  if (WEARS[raw.wear]) out.wear = raw.wear;
  return out;
}

export function validateRecord(raw) {
  if (!raw || typeof raw !== 'object' || !/^custom_[a-z0-9_]{3,64}$/.test(raw.id || '')) throw new Error('У предмета неверный ID');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 40) throw new Error('Название — от 1 до 40 символов');
  if (!Number.isFinite(raw.w) || raw.w < MIN_W || raw.w > MAX_W) throw new Error(`Размер — от ${MIN_W} до ${MAX_W}`);
  if (typeof raw.image !== 'string' || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(raw.image)) throw new Error('Нужна картинка PNG, WebP или JPG');
  if (raw.image.length > 2_000_000) throw new Error('Картинка слишком тяжёлая');
  const rec = { id: raw.id, name, group: GROUPS[raw.group] ? raw.group : 'decor', place: PLACES[raw.place] ? raw.place : 'floor', w: Math.round(raw.w), image: raw.image };
  return Object.assign(rec, cleanLiving(raw), raw.give === true ? { give: true } : {}); // give — выдать игрокам (подарком)
}

async function install(rec, { builtin = false } = {}) {
  const im = await loadImage(rec.image);
  if (!im.width || !im.height || im.width > 2048 || im.height > 2048) throw new Error('Картинка должна быть не больше 2048 × 2048');
  const def = toDef(rec);
  registerImage(def.art, im);
  if (rec.open) registerImage(def.openArt, await loadImage(rec.open.image));
  if (rec.animal) { // части животного — на скелет; картинка целиком собирается из них
    for (const [k, src] of Object.entries(rec.animal.parts)) registerImage(def.animal.parts[k], await loadImage(src));
    setupAnimal(def);
  }
  putCustomDef(def);
  if (!builtin) records.set(rec.id, rec);
}

export const listRecords = () => [...records.values()];

// ── Правки встроенных предметов ──
// { id: встроенный предмет, name?, group?, size?, image? (data:URL) }
const overrides = new Map();
export const listOverrides = () => [...overrides.values()];
export const getOverride = (id) => overrides.get(id) || null;

export function validateOverride(raw) {
  if (!raw || !isBuiltin(raw.id)) throw new Error('Нет такого встроенного предмета');
  const o = { id: raw.id };
  if (typeof raw.name === 'string' && raw.name.trim()) o.name = raw.name.trim().slice(0, 40);
  if (GROUPS[raw.group]) o.group = raw.group;
  if (Number.isFinite(raw.size)) o.size = Math.round(Math.max(30, Math.min(1200, raw.size)));
  // «Живые» правки встроенных: полки, включение (свет/экран/вода), отклик на нажатие.
  const lv = cleanLiving(raw);
  if (raw.surfaces !== undefined) o.surfaces = lv.surfaces || [];
  if (raw.seats !== undefined) { o.seats = lv.seats || []; if (lv.cover) o.cover = lv.cover; }
  if (lv.power) o.power = lv.power;
  if (lv.tap) o.tap = lv.tap;
  if (lv.machine) o.machine = lv.machine;
  // Встроенное животное: суставы и голос (картинки — встроенные).
  if (raw.animal && typeof raw.animal === 'object' && itemDef(raw.id)?.animal) {
    const a = {};
    if (raw.animal.joints && typeof raw.animal.joints === 'object') { a.joints = {}; for (const k of JOINT_PARTS) if (fracs(raw.animal.joints[k], 2)) a.joints[k] = raw.animal.joints[k].slice(0, 2).map((v) => Math.round(v * 10000) / 10000); }
    if (VOICES[raw.animal.voice] !== undefined) a.voice = raw.animal.voice;
    o.animal = a;
  }
  if (typeof raw.image === 'string' && raw.image) {
    if (!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(raw.image) || raw.image.length > 2_000_000) throw new Error('Картинка не подходит');
    o.image = raw.image;
  }
  return o;
}

async function applyOv(o) {
  let art = null;
  if (o.image) { const im = await loadImage(o.image); art = 'override/' + o.id; registerImage(art, im); }
  applyOverride({ id: o.id, name: o.name, group: o.group, size: o.size, art, surfaces: o.surfaces, seats: o.seats, cover: o.cover, power: o.power, tap: o.tap, machine: o.machine, animal: o.animal });
  const d = itemDef(o.id);
  if (d?.animal) setupAnimal({ id: o.id, ...d }); // новые суставы — скелет заново
}

// Сохранить правку встроенного предмета (null-поля — вернуть исходное).
export async function saveOverride(raw) {
  const o = validateOverride(raw);
  const next = new Map(overrides); next.set(o.id, o);
  await saveOverrides([...next.values()]);
  overrides.set(o.id, o);
  clearOverride(o.id); forgetImage('override/' + o.id);
  await applyOv(o);
  return o;
}
export async function resetOverride(id) {
  const next = new Map(overrides); next.delete(id);
  await saveOverrides([...next.values()]);
  overrides.delete(id);
  clearOverride(id); forgetImage('override/' + id);
  const d = itemDef(id); if (d?.animal) setupAnimal({ id, ...d });
}
async function loadOwnOverrides() {
  let list = [];
  try { list = await loadOverrides(); } catch (e) { list = []; }
  for (const raw of list) { try { const o = validateOverride(raw); overrides.set(o.id, o); await applyOv(o); } catch (e) { /* пропускаем испорченную */ } }
}

// ── Паки ──
// Пак — один файл: { format:'sunny-home-pack', version:1, id, name, items:[записи предметов] }.
// Встроенные паки игры лежат в папке packs/ и попадают в сборку (window.EMBEDDED_PACKS).
// Предметы встроенных паков не сохраняются в библиотеку — они «зашиты» в игру.
export const PACK_FORMAT = 'sunny-home-pack';
const packs = new Map(); // id → { id, name, count }
export const listPacks = () => [...packs.values()];

// Латиницей для ID пака («Пляж» → plyazh): ID виден в Google Play.
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const translit = (s) => [...s].map((ch) => TR[ch] ?? ch).join('');

export function makePack(name, ids, withOverrides = true, price = 0, keepId = '', coverStyle = null, pageStyle = null, slides = [], unlockIds = []) {
  const clean = String(name || '').trim().slice(0, 40) || 'Новый пак';
  const slug = translit(clean.toLowerCase()).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'pack';
  const items = ids.map((id) => records.get(id)).filter(Boolean);
  const unl = [...new Set([...(unlockIds || []), ...ids])].filter(isBuiltin); // отмеченные встроенные (щенок) — пак их «открывает»
  const ovs = withOverrides ? listOverrides() : [];
  const recipes = withOverrides ? listOwnRecipes() : [];
  if (!items.length && !ovs.length && !recipes.length && !unl.length) throw new Error('Выбери хотя бы один предмет');
  return { format: PACK_FORMAT, version: 1, id: /^[a-z0-9_]{1,80}$/.test(keepId) ? keepId : slug + '_' + Date.now().toString(36), name: clean, created: new Date().toISOString().slice(0, 10), price: Math.max(0, Math.round(Number(price) * 100) / 100) || 0, items, overrides: ovs, ...(unl.length ? { unlock: unl } : {}), ...(recipes.length ? { recipes } : {}), ...(coverStyle && Object.keys(coverStyle).length ? { coverStyle } : {}), ...(pageStyle && Object.keys(pageStyle).length ? { pageStyle } : {}), ...(slides?.length ? { slides } : {}) };
}

export function validatePack(raw) {
  if (!raw || raw.format !== PACK_FORMAT) throw new Error('Это не пак «Солнечного дома»');
  if (!/^[a-z0-9_]{1,80}$/.test(raw.id || '')) throw new Error('У пака неверный ID');
  const items = (Array.isArray(raw.items) ? raw.items : []).map(validateRecord);
  const ovs = [];
  for (const o of Array.isArray(raw.overrides) ? raw.overrides : []) { try { ovs.push(validateOverride(o)); } catch (e) { /* неизвестный предмет — пропуск */ } }
  const recipes = [];
  for (const r of Array.isArray(raw.recipes) ? raw.recipes : []) { try { recipes.push(validateRecipe(r)); } catch (e) { /* пропуск */ } }
  // unlock — встроенные предметы, которые пак «открывает» (щенок, если его не выдают всем).
  const unl = (Array.isArray(raw.unlock) ? raw.unlock : []).filter((id) => typeof id === 'string' && isBuiltin(id)).slice(0, 50);
  const zones = cleanAllZones(raw.mapZones); // живые здания на карте (студия → «Карта»)
  if (!items.length && !ovs.length && !recipes.length && !unl.length && !Object.keys(zones).length) throw new Error('В паке нет предметов');
  const out = { format: PACK_FORMAT, version: 1, id: raw.id, name: String(raw.name || raw.id).slice(0, 40), items, overrides: ovs, ...(recipes.length ? { recipes } : {}) };
  if (unl.length) out.unlock = unl;
  if (Object.keys(zones).length) out.mapZones = zones;
  if (raw.gift === true) out.gift = true;
  // Оформление обложки (для студии и магазина): цвет, своя картинка-фон или обложка целиком.
  const cs = raw.coverStyle;
  if (cs && typeof cs === 'object') {
    const st = {};
    if (/^#[0-9a-f]{6}$/i.test(cs.color || '')) st.color = cs.color;
    for (const k of ['bg', 'full']) if (typeof cs[k] === 'string' && IMG_RE.test(cs[k]) && cs[k].length < 2_000_000) st[k] = cs[k];
    if (Object.keys(st).length) out.coverStyle = st;
  }
  // Фон страницы пака в магазине: цвет и/или картинка.
  const ps = raw.pageStyle;
  if (ps && typeof ps === 'object') {
    const st = {};
    if (/^#[0-9a-f]{6}$/i.test(ps.color || '')) st.color = ps.color;
    if (typeof ps.image === 'string' && IMG_RE.test(ps.image) && ps.image.length < 3_000_000) st.image = ps.image;
    if (Object.keys(st).length) out.pageStyle = st;
  }
  // Слайды-обложки: что внутри пака (листаются вправо-влево на странице пака). До 10 картинок.
  if (Array.isArray(raw.slides)) {
    const sl = raw.slides.filter((x) => typeof x === 'string' && IMG_RE.test(x) && x.length < 3_000_000).slice(0, 10);
    if (sl.length) out.slides = sl;
  }
  return out;
}

// Встроенные паки — при запуске (до чтения сохранения). Возвращает число установленных предметов.
export async function loadBuiltinPacks() {
  let n = 0;
  for (const raw of window.EMBEDDED_PACKS || []) {
    try { n += (await installPack(raw)).length; } catch (e) { /* испорченный пак пропускаем — игра работает без него */ }
  }
  return n;
}

// Поставить пак в игру (встроенный или из магазина): его предметы появляются в «Вещах».
// В библиотеку своих предметов не пишется. Возвращает ID новых предметов.
export async function installPack(raw) {
  const pack = validatePack(raw), ids = [];
  for (const rec of pack.items) {
    if (records.has(rec.id)) continue; // свой предмет с тем же ID важнее
    await install(rec, { builtin: true }); ids.push(rec.id);
  }
  for (const o of pack.overrides) if (!overrides.has(o.id)) await applyOv(o); // своя правка в студии важнее
  addPackRecipes(pack.recipes);
  if (pack.mapZones) setPackZones(pack.mapZones);
  if (pack.unlock) { unlock(pack.unlock); ids.push(...pack.unlock); }
  packs.set(pack.id, { id: pack.id, name: pack.name, count: pack.items.length, fixes: pack.overrides.length });
  return ids;
}
export const getRecord = (id) => records.get(id) || null;

// При запуске. Возвращает текст предупреждения или ''.
// ── Свои рецепты ──
export async function saveOwnRecipe(raw) {
  const r = validateRecipe(raw);
  const next = listOwnRecipes().filter((x) => x.id !== r.id).concat(r);
  await saveRecipes(next); setOwnRecipes(next);
  return r;
}
export async function deleteOwnRecipe(id) {
  const next = listOwnRecipes().filter((x) => x.id !== id);
  await saveRecipes(next); setOwnRecipes(next);
}
async function loadOwnRecipes() {
  const out = [];
  try { for (const raw of await loadRecipes()) { try { out.push(validateRecipe(raw)); } catch (e) { /* пропуск */ } } } catch (e) { /* нет */ }
  setOwnRecipes(out);
}

export async function loadLibrary() {
  await loadOwnOverrides();
  await loadOwnRecipes();
  let list = null, note = '';
  try { list = await loadCatalogRecords(); } catch (e) { list = null; }
  if (!list) {
    // Первый запуск новой версии: забираем предметы из старой Studio 0.3, если они есть.
    const old = await loadOldStudio().catch(() => null);
    if (old) {
      const { records: moved, skipped } = fromStudioPack(old);
      list = moved;
      if (moved.length) note = `Перенесено своих предметов из старой админки: ${moved.length}` + (skipped ? ` (без своей картинки пропущено: ${skipped})` : '');
      try { await saveCatalogRecords(list); } catch (e) { /* попробуем при следующем сохранении */ }
    }
  }
  let bad = 0;
  for (const raw of list || []) {
    try { await install(validateRecord(raw)); } catch (e) { bad++; }
  }
  if (bad) note = `Не удалось прочитать своих предметов: ${bad}. Импортируй резервный пак.`;
  return note;
}

async function persist(next) {
  await saveCatalogRecords(next);
}

// Сохранить новый или изменённый предмет. Сначала запись, потом применение — без «полусохранённых» состояний.
export async function saveRecord(raw) {
  const rec = validateRecord(raw);
  if (!records.has(rec.id) && records.size >= LIBRARY_LIMIT) throw new Error(`Можно создать до ${LIBRARY_LIMIT} своих предметов`);
  await loadImage(rec.image);
  const next = [...records.values()].filter((r) => r.id !== rec.id).concat(rec);
  await persist(next);
  await install(rec);
  return rec;
}

export async function deleteRecord(id) {
  const next = [...records.values()].filter((r) => r.id !== id);
  await persist(next);
  records.delete(id);
  removeCustomDef(id);
  forgetImage('custom/' + id); forgetImage('custom/' + id + '_open');
  for (const k of Object.keys(ANIMAL_PARTS)) forgetImage('custom/' + id + '_a_' + k);
  forgetAnimal(id);
}

// Импорт пака: новый формат «sunny-home-items» v2 или пак старой Studio 0.3 (v1).
export async function importPack(pack) {
  if (pack?.format === PACK_FORMAT) {
    const full = validatePack(pack);
    for (const o of full.overrides) await saveOverride(o); // правки встроенных предметов из пака
    for (const r of full.recipes || []) await saveOwnRecipe(r); // рецепты пака — в студию
    if (!full.items.length) return full.overrides.length + (full.recipes?.length || 0);
    pack = { format: 'sunny-home-items', version: 2, items: full.items };
  }
  if (!pack || pack.format !== 'sunny-home-items') throw new Error('Это не пак предметов «Солнечного дома»');
  const incoming = pack.version === 2 ? pack.items.map(validateRecord) : fromStudioPack(pack.items).records;
  if (!incoming.length) throw new Error('В паке нет предметов с картинками');
  const merged = new Map(records);
  for (const r of incoming) merged.set(r.id, r);
  if (merged.size > LIBRARY_LIMIT) throw new Error(`После импорта будет больше ${LIBRARY_LIMIT} предметов`);
  for (const r of incoming) await loadImage(r.image);
  await persist([...merged.values()]);
  for (const r of incoming) await install(r);
  return incoming.length;
}

export function exportPack() {
  return { format: 'sunny-home-items', version: 2, items: listRecords() };
}

// Записи старой Studio 0.3: { id, name, template, width, image }.
// Встроенные картинки старого прототипа (image:'builtin:…') пропускаем — их нет в новой версии.
export function fromStudioPack(items) {
  const groupOf = { food: 'food', drink: 'food', toy: 'toys', decor: 'decor', container: 'furniture', seat: 'furniture' };
  const out = []; let skipped = 0;
  for (const d of Array.isArray(items) ? items : []) {
    if (!d || typeof d.image !== 'string' || !d.image.startsWith('data:')) { skipped++; continue; }
    try {
      out.push(validateRecord({ id: d.id, name: d.name, group: groupOf[d.template] || 'decor', place: 'floor', w: Math.max(MIN_W, Math.min(MAX_W, Number(d.width) || 90)), image: d.image }));
    } catch (e) { skipped++; }
  }
  return { records: out, skipped };
}

export { customDefs };
