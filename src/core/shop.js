// Магазин паков. Список паков (каталог) лежит на GitHub: store/catalog.json, сами паки — store/packs/*.json.
// Без сети — копия каталога из сборки (window.EMBEDDED_STORE), скачанные паки работают всегда.
// Покупки пока ТЕСТОВЫЕ (без денег). В APK здесь будет оплата Google Play: product — ID товара в Play Console.
import { installPack, validatePack } from './library.js';
import { loadShopState, saveShopState } from '../save/storage.js';

export const STORE_BASE = 'https://raw.githubusercontent.com/ArtemIonov123/sunny-home/main/store/';
export const TEST_PURCHASES = true;

let state = { owned: [], installed: {} }; // installed: id → { version, pack }
let catalog = null, offline = false;

const save = () => saveShopState(state);

// При запуске: поставить скачанные раньше паки (до чтения сохранения дома — чтобы их вещи узнались).
export async function initShop() {
  try { const s = await loadShopState(); if (s && typeof s === 'object') state = { owned: Array.isArray(s.owned) ? s.owned : [], installed: s.installed && typeof s.installed === 'object' ? s.installed : {} }; } catch (e) { /* пусто */ }
  for (const [id, it] of Object.entries(state.installed)) {
    try { await installPack(it.pack); } catch (e) { delete state.installed[id]; }
  }
}

async function fetchJson(url, ms = 7000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('Магазин недоступен: ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function loadCatalog() {
  try {
    const c = await fetchJson(STORE_BASE + 'catalog.json?t=' + Date.now());
    if (c?.format !== 'sunny-home-store' || !Array.isArray(c.packs)) throw new Error('Каталог повреждён');
    catalog = c; offline = false;
  } catch (e) {
    catalog = window.EMBEDDED_STORE || { packs: [] }; offline = true; // нет сети — то, что знали при сборке
  }
  return catalog;
}
export const isOffline = () => offline;
export const getCatalog = () => catalog;

// Состояние пака для кнопки: установлен / есть обновление / куплен, но не скачан / бесплатный / платный.
export function status(entry) {
  const inst = state.installed[entry.id];
  if (inst) return inst.version < entry.version ? 'update' : 'installed';
  if (!entry.price || state.owned.includes(entry.id)) return 'get';
  return 'buy';
}

// Тестовая покупка: просто отмечаем «куплено». (В APK — Google Play Billing, затем проверка покупки.)
export async function buy(entry) {
  if (!TEST_PURCHASES) throw new Error('Покупки доступны в приложении из Google Play');
  if (!state.owned.includes(entry.id)) state.owned.push(entry.id);
  await save();
}

// Скачать и поставить пак. Возвращает ID новых вещей (для звёздочек «новое»).
export async function download(entry) {
  if (entry.price && !state.owned.includes(entry.id)) throw new Error('Сначала купить');
  const raw = await fetchJson(STORE_BASE + entry.file + '?v=' + entry.version, 20000);
  const pack = validatePack(raw);
  const ids = await installPack(pack);
  state.installed[entry.id] = { version: entry.version, pack };
  await save();
  markNew(pack.items.map((i) => i.id));
  return ids;
}

// ── Звёздочки «новое» на карточках в «Вещах» (только для удобства, хранится в браузере) ──
const NEW_KEY = 'sunny-home-new-items';
let fresh = new Set();
try { fresh = new Set(JSON.parse(localStorage.getItem(NEW_KEY) || '[]')); } catch (e) { fresh = new Set(); }
const keepNew = () => { try { localStorage.setItem(NEW_KEY, JSON.stringify([...fresh])); } catch (e) { /* не важно */ } };
export function markNew(ids) { for (const id of ids) fresh.add(id); keepNew(); }
export const isNew = (id) => fresh.has(id);
export function seen(id) { if (fresh.delete(id)) keepNew(); }

// Для тестов: сбросить покупки (кнопка в студии).
export async function resetShop() { state = { owned: [], installed: {} }; await save(); } // вещи паков уйдут после перезапуска
