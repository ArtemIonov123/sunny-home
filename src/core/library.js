// Библиотека своих предметов: создаются в админке, хранятся отдельно от дома,
// переносятся паком (JSON с картинками внутри).
// Запись: { id:'custom_…', name, group, place, w, image:'data:image/webp;base64,…' }
import { GROUPS, PLACES, CUSTOM_PREFIX, toDef, putCustomDef, removeCustomDef, customDefs, applyOverride, clearOverride, isBuiltin } from './catalog.js';
import { loadImage, registerImage, forgetImage } from '../assets.js';
import { loadCatalogRecords, saveCatalogRecords, loadOldStudio, loadOverrides, saveOverrides } from '../save/storage.js';

export const LIBRARY_LIMIT = 60;
export const MIN_W = 40, MAX_W = 900;
const records = new Map();

export function newId() { return CUSTOM_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function validateRecord(raw) {
  if (!raw || typeof raw !== 'object' || !/^custom_[a-z0-9_]{3,64}$/.test(raw.id || '')) throw new Error('У предмета неверный ID');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 40) throw new Error('Название — от 1 до 40 символов');
  if (!Number.isFinite(raw.w) || raw.w < MIN_W || raw.w > MAX_W) throw new Error(`Размер — от ${MIN_W} до ${MAX_W}`);
  if (typeof raw.image !== 'string' || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(raw.image)) throw new Error('Нужна картинка PNG, WebP или JPG');
  if (raw.image.length > 2_000_000) throw new Error('Картинка слишком тяжёлая');
  return { id: raw.id, name, group: GROUPS[raw.group] ? raw.group : 'decor', place: PLACES[raw.place] ? raw.place : 'floor', w: Math.round(raw.w), image: raw.image };
}

async function install(rec, { builtin = false } = {}) {
  const im = await loadImage(rec.image);
  if (!im.width || !im.height || im.width > 2048 || im.height > 2048) throw new Error('Картинка должна быть не больше 2048 × 2048');
  const def = toDef(rec);
  registerImage(def.art, im);
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
  if (typeof raw.image === 'string' && raw.image) {
    if (!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(raw.image) || raw.image.length > 2_000_000) throw new Error('Картинка не подходит');
    o.image = raw.image;
  }
  return o;
}

async function applyOv(o) {
  let art = null;
  if (o.image) { const im = await loadImage(o.image); art = 'override/' + o.id; registerImage(art, im); }
  applyOverride({ id: o.id, name: o.name, group: o.group, size: o.size, art });
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

export function makePack(name, ids, withOverrides = true) {
  const clean = String(name || '').trim().slice(0, 40) || 'Новый пак';
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'pack';
  const items = ids.map((id) => records.get(id)).filter(Boolean);
  const ovs = withOverrides ? listOverrides() : [];
  if (!items.length && !ovs.length) throw new Error('Выбери хотя бы один предмет');
  return { format: PACK_FORMAT, version: 1, id: slug + '_' + Date.now().toString(36), name: clean, created: new Date().toISOString().slice(0, 10), items, overrides: ovs };
}

export function validatePack(raw) {
  if (!raw || raw.format !== PACK_FORMAT) throw new Error('Это не пак «Солнечного дома»');
  if (!/^[a-z0-9_]{1,80}$/.test(raw.id || '')) throw new Error('У пака неверный ID');
  const items = (Array.isArray(raw.items) ? raw.items : []).map(validateRecord);
  const ovs = [];
  for (const o of Array.isArray(raw.overrides) ? raw.overrides : []) { try { ovs.push(validateOverride(o)); } catch (e) { /* неизвестный предмет — пропуск */ } }
  if (!items.length && !ovs.length) throw new Error('В паке нет предметов');
  return { format: PACK_FORMAT, version: 1, id: raw.id, name: String(raw.name || raw.id).slice(0, 40), items, overrides: ovs };
}

// Встроенные паки — при запуске (до чтения сохранения). Возвращает число установленных предметов.
export async function loadBuiltinPacks() {
  let n = 0;
  for (const raw of window.EMBEDDED_PACKS || []) {
    try {
      const pack = validatePack(raw);
      for (const rec of pack.items) {
        if (records.has(rec.id)) continue; // свой предмет с тем же ID важнее
        await install(rec, { builtin: true }); n++;
      }
      for (const o of pack.overrides) if (!overrides.has(o.id)) await applyOv(o); // своя правка в студии важнее
      packs.set(pack.id, { id: pack.id, name: pack.name, count: pack.items.length, fixes: pack.overrides.length });
    } catch (e) { /* испорченный пак пропускаем — игра работает без него */ }
  }
  return n;
}
export const getRecord = (id) => records.get(id) || null;

// При запуске. Возвращает текст предупреждения или ''.
export async function loadLibrary() {
  await loadOwnOverrides();
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
  forgetImage('custom/' + id);
}

// Импорт пака: новый формат «sunny-home-items» v2 или пак старой Studio 0.3 (v1).
export async function importPack(pack) {
  if (pack?.format === PACK_FORMAT) {
    const full = validatePack(pack);
    for (const o of full.overrides) await saveOverride(o); // правки встроенных предметов из пака
    if (!full.items.length) return full.overrides.length;
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
