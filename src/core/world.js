// Свои районы карты и свои места (студия → «Карта»).
// Район — картинка от GPT (как встроенные: 1600×800, площадка посередине) и, если нужно, главное место
// на площадке. Место — название, картинка здания (для площадки района) и обстановка: комнаты и вещи,
// собранные в студии обычным редактором («Зайти и обставить» → «Сохранить обстановку»).
// Студия хранит своё в IndexedDB; игрокам всё уходит в паке-подарке (поле world, «📤 В игру»).
import { loadImage, registerImage } from '../assets.js';
import { BUILTIN_PLACES, setCustomPlaces } from './places.js';
import { loadWorldStore, saveWorldStore } from '../save/storage.js';
import { cleanRoom } from '../save/migrate.js';

const IMG_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const DID = /^d_[a-z0-9]{3,30}$/, PID = /^p_[a-z0-9]{3,30}$/;
const empty = () => ({ districts: [], places: {} });
let own = empty(), fromPacks = empty();

export const newDistrictId = () => 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
export const newPlaceId = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const name = (v, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 30) : d);

// Обстановка места: комнаты (как в сохранении) и вещи в них.
function cleanLayout(rooms, items) {
  const used = new Set();
  const rs = (Array.isArray(rooms) ? rooms : []).map((r) => cleanRoom(r, used)).filter(Boolean).slice(0, 6);
  const ids = new Set(rs.map((r) => r.id)), seen = new Set();
  const it = (Array.isArray(items) ? items : []).filter((i) => i && Number.isInteger(i.id) && !seen.has(i.id) && typeof i.def === 'string' && ids.has(i.room) && Number.isFinite(i.x) && Number.isFinite(i.y))
    .slice(0, 400).map((i) => { seen.add(i.id); const o = { id: i.id, def: i.def, room: i.room, x: i.x, y: i.y };
      if (i.on && Number.isInteger(i.on.id) && Number.isInteger(i.on.s) && Number.isFinite(i.on.dx)) o.on = { id: i.on.id, s: i.on.s, dx: i.on.dx };
      if (i.open === true) o.open = true; if (i.lit === true) o.lit = true; if (i.flip === true) o.flip = true; return o; });
  return { rooms: rs, items: it };
}
export function cleanWorld(raw) {
  const out = empty();
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, p] of Object.entries(raw.places || {}).slice(0, 40)) {
    if (!PID.test(id) || !p || typeof p !== 'object') continue;
    const lay = cleanLayout(p.rooms, p.items);
    if (!lay.rooms.length) continue;
    out.places[id] = { name: name(p.name, 'Место'), ...lay, ...(typeof p.art === 'string' && IMG_RE.test(p.art) && p.art.length < 2_000_000 ? { art: p.art } : {}) };
  }
  for (const d of (Array.isArray(raw.districts) ? raw.districts : []).slice(0, 20)) {
    if (!d || !DID.test(d.id) || typeof d.image !== 'string' || !IMG_RE.test(d.image) || d.image.length > 4_000_000) continue;
    out.districts.push({ id: d.id, name: name(d.name, 'Район'), image: d.image, ...(typeof d.place === 'string' && /^[a-z0-9_]{2,40}$/.test(d.place) ? { place: d.place } : {}) });
  }
  return out;
}

// Всё вместе: паки, поверх — своё из студии (по id).
function merged() {
  const places = { ...fromPacks.places, ...own.places };
  const ds = new Map(); for (const d of [...fromPacks.districts, ...own.districts]) ds.set(d.id, d);
  return { districts: [...ds.values()], places };
}
// Картинки районов и зданий — в общий список картинок игры; места — в core/places.js.
async function apply() {
  const w = merged();
  for (const d of w.districts) { try { registerImage('world/' + d.id, await loadImage(d.image)); } catch (e) { /* битая картинка — район без неё */ } }
  for (const [id, p] of Object.entries(w.places)) if (p.art) { try { registerImage('world/' + id, await loadImage(p.art)); } catch (e) { /* без здания */ } }
  setCustomPlaces(w.places);
}

// Список районов карты по порядку: встроенные, потом свои. image/art — ключи картинок.
export function districtList() {
  const w = merged();
  const out = BUILTIN_PLACES.map((id) => ({ id, name: null, image: 'map/district_' + id, place: id, art: 'map/iso_' + id }));
  for (const d of w.districts) {
    const p = d.place, art = !p ? null : BUILTIN_PLACES.includes(p) ? 'map/iso_' + p : w.places[p]?.art ? 'world/' + p : null;
    out.push({ id: d.id, name: d.name, image: 'world/' + d.id, place: p || null, art });
  }
  return out;
}
export const placeName = (id) => merged().places[id]?.name || null;
export const ownWorld = () => JSON.parse(JSON.stringify(own));
export const allWorld = () => merged();

// Студия: загрузить своё при запуске, сохранить изменения.
export async function loadOwnWorld() { try { own = cleanWorld(await loadWorldStore()); } catch (e) { own = empty(); } await apply(); }
export async function saveOwnWorld(next) { own = cleanWorld(next); await saveWorldStore(own); await apply(); }
// Пак (подарок «📤 В игру» или из магазина) принёс районы и места.
export async function setPackWorld(raw) {
  const w = cleanWorld(raw);
  Object.assign(fromPacks.places, w.places);
  const ids = new Set(w.districts.map((d) => d.id));
  fromPacks.districts = [...fromPacks.districts.filter((d) => !ids.has(d.id)), ...w.districts];
  await apply();
}
