// Живые здания на картинках районов карты (ui/map.js): рамка на картинке района (доли: u0, v0, u1, v1),
// звук и, если нужно, место, куда через это здание заходят (place).
// Встроенные зоны — ниже. Студия («Карта») сохраняет свои (localStorage), игрокам они уходят в паке-подарке
// (поле mapZones, «📤 В игру»).
import { PLACE_IDS } from './places.js';

export const ZONE_SOUNDS = { boing: 'Пружинит', pop: 'Хлоп', ding: 'Динь', ring: 'Звонок', squeak: 'Пищит', yum: 'Ням', chomp: 'Хрум', gulp: 'Глоток', chirp: 'Птички', bubble: 'Бульк', buzz: 'Жужжит', whoosh: 'Вжух' };

const z = (u0, v0, u1, v1, snd = 'boing') => ({ box: [u0, v0, u1, v1], snd });
export const DEFAULT_ZONES = {
  home: [z(0.23, 0.2, 0.33, 0.38), z(0.39, 0.18, 0.48, 0.36), z(0.52, 0.17, 0.62, 0.35), z(0.69, 0.2, 0.82, 0.39, 'squeak'), z(0.16, 0.4, 0.28, 0.61), z(0.73, 0.41, 0.85, 0.62), z(0.26, 0.74, 0.36, 0.93), z(0.62, 0.73, 0.73, 0.93)],
  shop: [z(0.17, 0.27, 0.3, 0.5, 'yum'), z(0.3, 0.19, 0.4, 0.37, 'yum'), z(0.45, 0.18, 0.55, 0.36, 'chirp'), z(0.61, 0.19, 0.71, 0.37, 'gulp'), z(0.7, 0.27, 0.83, 0.49, 'pop'), z(0.15, 0.48, 0.21, 0.57, 'ring'), z(0.8, 0.49, 0.86, 0.57, 'ring'), z(0.27, 0.71, 0.38, 0.93, 'yum'), z(0.45, 0.78, 0.54, 0.92, 'ding'), z(0.62, 0.72, 0.75, 0.93, 'pop'), z(0.75, 0.83, 0.82, 0.92, 'ring')],
  disco: [z(0.24, 0.2, 0.32, 0.38, 'ding'), z(0.39, 0.17, 0.49, 0.37, 'pop'), z(0.52, 0.17, 0.62, 0.36, 'buzz'), z(0.7, 0.17, 0.82, 0.39, 'ding'), z(0.17, 0.39, 0.28, 0.6, 'yum'), z(0.71, 0.4, 0.84, 0.6, 'pop'), z(0.27, 0.74, 0.39, 0.93, 'chomp'), z(0.6, 0.74, 0.72, 0.95, 'ding'), z(0.73, 0.77, 0.81, 0.93, 'whoosh')],
  cafe: [z(0.23, 0.19, 0.33, 0.37), z(0.38, 0.17, 0.49, 0.36, 'yum'), z(0.52, 0.17, 0.62, 0.37, 'gulp'), z(0.71, 0.2, 0.8, 0.39, 'chirp'), z(0.27, 0.39, 0.33, 0.47, 'bubble'), z(0.16, 0.4, 0.28, 0.61), z(0.73, 0.41, 0.85, 0.62)],
  salon: [z(0.22, 0.21, 0.33, 0.38, 'pop'), z(0.37, 0.17, 0.48, 0.36, 'pop'), z(0.52, 0.19, 0.63, 0.37, 'squeak'), z(0.68, 0.2, 0.8, 0.4, 'pop'), z(0.16, 0.42, 0.29, 0.61, 'pop'), z(0.72, 0.45, 0.84, 0.62, 'squeak'), z(0.2, 0.74, 0.31, 0.95, 'pop'), z(0.35, 0.78, 0.46, 0.94, 'pop'), z(0.54, 0.77, 0.66, 0.94, 'squeak'), z(0.69, 0.75, 0.8, 0.95, 'pop')],
};

const frac = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
// Проверить зоны одного района (из студии или из пака).
export function cleanZones(list) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((q) => {
    const b = q?.box;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(frac) || b[2] - b[0] < 0.01 || b[3] - b[1] < 0.01) return null;
    return { box: b.map((v) => Math.round(v * 1000) / 1000), snd: ZONE_SOUNDS[q.snd] ? q.snd : 'boing', ...(PLACE_IDS.includes(q.place) ? { place: q.place } : {}) };
  }).filter(Boolean);
}
export function cleanAllZones(raw) {
  const out = {};
  if (raw && typeof raw === 'object') for (const id of PLACE_IDS) if (Array.isArray(raw[id])) out[id] = cleanZones(raw[id]);
  return out;
}

let fromPacks = {}, own = {};
const KEY = 'sunny-studio-zones';
try { own = cleanAllZones(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { own = {}; }

export const zonesOf = (district) => own[district] || fromPacks[district] || DEFAULT_ZONES[district] || [];
export function setPackZones(raw) { Object.assign(fromPacks, cleanAllZones(raw)); }
// Студия: свои зоны района (null — вернуть встроенные).
export function saveOwnZones(district, list) {
  if (list) own[district] = cleanZones(list); else delete own[district];
  try { localStorage.setItem(KEY, JSON.stringify(own)); } catch (e) { /* не важно */ }
}
export const ownZones = () => ({ ...own });
export const hasOwnZones = (district) => !!own[district];
