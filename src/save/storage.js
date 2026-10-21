// Надёжное сохранение: сначала localStorage, если браузер не даёт — IndexedDB,
// если нельзя ничего — игра продолжается без записи (и честно об этом говорит).
// Опыт 0.4.1: скачанный HTML на Android иногда не даёт localStorage.

const KEY = 'sunny-home-v5';
const DB = 'sunny-home';
const STORE = 'saves';
const DB_VERSION = 2;            // 2: добавлен склад «catalog» для своих предметов
const STORES = ['saves', 'catalog'];
const TIMEOUT = 1500;

let dbPromise = null;
let lastStamp = 0;
let queue = Promise.resolve();

function withTimeout(promise) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), TIMEOUT))]);
}

function openDb(name = DB, stores = STORES, version = DB_VERSION) {
  return withTimeout(new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => { for (const st of stores) if (!req.result.objectStoreNames.contains(st)) req.result.createObjectStore(st); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  }));
}

function db() { return (dbPromise ||= openDb()); }

function idb(database, store, mode, key, value) {
  if (!database) return Promise.resolve(null);
  return withTimeout(new Promise((resolve) => {
    try {
      const tx = database.transaction(store, mode);
      const req = mode === 'readwrite' ? tx.objectStore(store).put(value, key) : tx.objectStore(store).get(key);
      let result = null;
      req.onsuccess = () => { result = mode === 'readwrite' ? true : req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch (e) { resolve(null); }
  }));
}

function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

// Возвращает самое свежее из двух хранилищ: { data, backend } или null.
export async function loadSave() {
  const local = readLocal(KEY);
  const remote = await idb(await db(), STORE, 'readonly', 'main');
  const ok = (e) => e && Number.isFinite(e.savedAt) && e.data;
  const winner = [ok(local) && local, ok(remote) && remote].filter(Boolean).sort((a, b) => b.savedAt - a.savedAt)[0];
  if (!winner) return null;
  lastStamp = winner.savedAt;
  return winner.data;
}

// Сохранение прошлой версии (0.4.1): одна комната в localStorage или IndexedDB.
export async function loadLegacyRoom() {
  const unwrap = (v) => (v && v.version === 1 ? v : v?.room?.version === 1 ? v.room : null);
  const local = unwrap(readLocal('sunny-home-room-v1'));
  if (local) return local;
  const old = await openDb('sunny-home-rooms', ['rooms'], 1);
  const remote = unwrap(await idb(old, 'rooms', 'readonly', 'main'));
  old?.close();
  return remote;
}

// Результат: { saved: true/false, backend: 'local' | 'indexeddb' | 'session' }
export function writeSave(data) {
  const record = { savedAt: Math.max(Date.now(), lastStamp + 1), data };
  lastStamp = record.savedAt;
  const text = JSON.stringify(record);
  const job = queue.then(async () => {
    try { localStorage.setItem(KEY, text); return { saved: true, backend: 'local' }; } catch (e) { /* идём дальше */ }
    if (await idb(await db(), STORE, 'readwrite', 'main', record)) return { saved: true, backend: 'indexeddb' };
    return { saved: false, backend: 'session' };
  });
  queue = job.catch(() => {});
  return job;
}

// ── Каталог своих предметов (картинки внутри, поэтому сначала IndexedDB) ──
const CATALOG_KEY = 'sunny-home-catalog-v1';

export async function loadCatalogRecords() {
  const remote = await idb(await db(), 'catalog', 'readonly', 'items');
  if (Array.isArray(remote)) return remote;
  const local = readLocal(CATALOG_KEY);
  return Array.isArray(local) ? local : null;
}

// Бросает понятную ошибку, если сохранить негде — тогда изменения не применяются.
export async function saveCatalogRecords(records) {
  if (await idb(await db(), 'catalog', 'readwrite', 'items', records)) return 'indexeddb';
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify(records)); return 'local'; } catch (e) { /* нет места */ }
  throw new Error('Браузер не смог сохранить предметы. Скачай пак в «Данные» и освободи место.');
}

// Предметы из Sunny Home Studio 0.3 (старая админка), если они остались в браузере.
export async function loadOldStudio() {
  const old = await openDb('sunny-home-studio-v1', ['data'], 1);
  const v = await idb(old, 'data', 'readonly', 'catalog');
  old?.close();
  if (Array.isArray(v) && v.length) return v;
  const local = readLocal('sunny-home-studio-v1');
  return Array.isArray(local) && local.length ? local : null;
}
