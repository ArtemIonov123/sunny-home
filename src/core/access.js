// Что игроку доступно бесплатно. Встроенный предмет (например, щенок) можно «не выдавать» —
// тогда он есть только в паках: пак с полем unlock: ['dog'] открывает его.
// Список закрытых — в каталоге магазина (store/catalog.json → locked), его меняет студия
// («Животные» → «Отправить игрокам»). Без сети — копия каталога из сборки (EMBEDDED_STORE).
const locked = new Set(Array.isArray(globalThis.window?.EMBEDDED_STORE?.locked) ? window.EMBEDDED_STORE.locked : []);
const unlocked = new Set();
const STUDIO_KEY = 'sunny-studio-locked'; // в студии — свой список (пока не отправлен игрокам)

export function setLocked(ids) { locked.clear(); for (const id of ids || []) if (typeof id === 'string') locked.add(id); }
export const lockedList = () => [...locked];
export function unlock(ids) { for (const id of ids || []) unlocked.add(id); }
export const isLocked = (id) => locked.has(id) && !unlocked.has(id);
// Выдан ли игроку (для галочки в студии): не закрыт.
export const isGiven = (id) => !locked.has(id);

// Студия: галочка «выдать игроку» сразу действует в студии и запоминается в этом браузере.
export function studioSetGiven(id, given) {
  if (given) locked.delete(id); else locked.add(id);
  try { localStorage.setItem(STUDIO_KEY, JSON.stringify([...locked])); } catch (e) { /* не важно */ }
}
export function studioLoad() {
  try { const v = JSON.parse(localStorage.getItem(STUDIO_KEY) || 'null'); if (Array.isArray(v)) setLocked(v); } catch (e) { /* пусто */ }
}
