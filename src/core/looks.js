// Внешность героев: кожа, причёска, цвет волос, эмоция, одежда (каждая вещь — со своим цветом).
// Картинки частей — серые, цвет накладывает render/hero.js. Здесь только данные и правила.
import { isHex } from '../util.js';

export const SKINS = ['#ffe3cc', '#f8cfae', '#efb98f', '#d9a074', '#b98157', '#93613f', '#6b432b', '#4a2e1f'];
export const HAIR_COLORS = ['#2a201c', '#553420', '#8a5530', '#c27c3a', '#e8c46a', '#f3e3b5', '#d4503a', '#f290b2', '#79a7e3', '#a184dd', '#7ccf9a', '#e8e8e8'];
export const WEAR_COLORS = ['#ff8fa8', '#ff6b6b', '#ffb36b', '#ffe27a', '#a8e08a', '#6fcfc0', '#7fb1f0', '#3d6fc4', '#b49cf0', '#f6f2ea', '#8b8f9c', '#4a4e5a'];
export const HAIRS = ['braids', 'bob', 'ponytail', 'bun', 'curly', 'spiky', 'bangs', 'long', 'none'];
export const FACES = ['happy', 'laugh', 'yum', 'surprised', 'sad', 'sleep'];
// Типы одежды: место на теле (slot — в одном месте одна вещь; платье занимает и верх, и низ),
// порядок рисования (rank — снизу вверх) и как вещь двигается со скелетом (cut, см. render/rig.js):
//  all — режется по костям (рукава идут за руками, штанины — за ногами), sleeves — в руки только рукава,
//  free — целиком на туловище (юбка), legs — на голенях (обувь), head — на голове (поверх волос).
export const WEAR_TYPES = {
  top:     { slot: 'top', rank: 3, cut: 'all', icon: '👕', name: 'Верх', hint: 'Футболка, кофта, свитер, худи. Рукава двигаются вместе с руками.' },
  outer:   { slot: 'outer', rank: 4.5, cut: 'all', icon: '🧥', name: 'Куртка', hint: 'Куртка, жилетка, кардиган, плащ. Надевается ПОВЕРХ кофты или платья (их не снимает).' },
  dress:   { slot: 'dress', rank: 4, cut: 'sleeves', icon: '👗', name: 'Платье', hint: 'Платье, сарафан, комбинезон. Занимает и верх, и низ; рукава идут за руками, подол — на туловище.' },
  pants:   { slot: 'bottom', rank: 1, cut: 'all', icon: '👖', name: 'Штаны', hint: 'Штаны, шорты, леггинсы. Штанины двигаются вместе с ногами.' },
  skirt:   { slot: 'bottom', rank: 2, cut: 'free', icon: '🩳', name: 'Юбка', hint: 'Юбка, пачка. Висит на туловище, ноги под ней двигаются свободно.' },
  shoes:   { slot: 'shoes', rank: 0, cut: 'legs', icon: '👟', name: 'Обувь', hint: 'Кеды, сапоги, тапочки. Делятся на левую и правую ногу.' },
  glasses: { slot: 'glasses', rank: 10, cut: 'head', icon: '👓', name: 'Очки', hint: 'Очки, маска. На лице, поверх волос.' },
  hat:     { slot: 'hat', rank: 11, cut: 'head', icon: '🧢', name: 'Шапка', hint: 'Кепка, шапка, корона, бант. На голове, поверх волос.' },
};
// Вещь → тип. Встроенные — ниже; свои (из студии и паков) добавляет registerWear (render/garment.js).
export const WEAR = {
  tshirt: { type: 'top' }, dress: { type: 'dress' }, pants: { type: 'pants' }, skirt: { type: 'skirt' },
  sneakers: { type: 'shoes' }, cap: { type: 'hat' }, glasses: { type: 'glasses' },
};
for (const w of Object.values(WEAR)) w.slot = WEAR_TYPES[w.type].slot;
export const BUILTIN_WEAR = Object.keys(WEAR);
// opts: tint — перекрашивается ли; sleeve — 'none' | 'short' | 'long'; stiff — плечо почти не двигается (рукав не отрывается).
export function registerWear(id, type, color, opts = {}) { if (WEAR_TYPES[type]) WEAR[id] = { type, slot: WEAR_TYPES[type].slot, custom: true, color, ...opts }; }
// Длина рукава и «жёсткое плечо» вещи (у встроенных — по типу).
export const sleeveOf = (w) => WEAR[w]?.sleeve || (WEAR[w]?.type === 'dress' ? 'short' : 'long');
export const stiffOf = (w) => WEAR[w]?.stiff !== false && sleeveOf(w) !== 'none';
export function unregisterWear(id) { if (WEAR[id]?.custom) delete WEAR[id]; }
const rankOf = (k) => WEAR_TYPES[WEAR[k]?.type]?.rank ?? 5;
// Что надето — в порядке рисования: на теле (снизу вверх) и на голове (поверх волос).
export const bodyWear = (wear) => Object.keys(wear || {}).filter((k) => WEAR[k] && WEAR_TYPES[WEAR[k].type].cut !== 'head').sort((a, b) => rankOf(a) - rankOf(b));
export const headWear = (wear) => Object.keys(wear || {}).filter((k) => WEAR[k] && WEAR_TYPES[WEAR[k].type].cut === 'head').sort((a, b) => rankOf(a) - rankOf(b));
// Старые имена (порядок встроенных вещей).
export const WEAR_ORDER = ['sneakers', 'pants', 'skirt', 'tshirt', 'dress'];
export const WEAR_TOP = ['glasses', 'cap'];

export const DEFAULT_LOOKS = {
  girl: { skin: '#d9a074', hair: 'braids', hairColor: '#2a201c', face: 'happy', wear: { dress: '#ffe27a', sneakers: '#f6f2ea' } },
  boy: { skin: '#efb98f', hair: 'curly', hairColor: '#553420', face: 'happy', wear: { tshirt: '#6fcfc0', pants: '#7fb1f0', sneakers: '#ff6b6b' } },
};

export const canDress = (charId) => !!DEFAULT_LOOKS[charId];

// Проверка внешности из сохранения: всё неизвестное — по умолчанию, ничего не ломается.
export function cleanLook(raw, charId) {
  const base = DEFAULT_LOOKS[charId];
  if (!base) return undefined;
  if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(base));
  const wear = {};
  if (raw.wear && typeof raw.wear === 'object') for (const [k, c] of Object.entries(raw.wear)) if (WEAR[k] && isHex(c)) wear[k] = c;
  return {
    skin: isHex(raw.skin) ? raw.skin : base.skin,
    hair: HAIRS.includes(raw.hair) ? raw.hair : base.hair,
    hairColor: isHex(raw.hairColor) ? raw.hairColor : base.hairColor,
    face: FACES.includes(raw.face) ? raw.face : base.face,
    wear: fixSlots(wear),
  };
}

// Надеть / снять вещь. Та же вещь того же цвета — снять; иначе надеть (сняв то, что мешает).
export function toggleWear(look, item, color) {
  const wear = { ...look.wear };
  if (wear[item] && (!color || wear[item] === color)) { delete wear[item]; return { ...look, wear }; }
  const slot = WEAR[item].slot;
  for (const k of Object.keys(wear)) {
    const s = WEAR[k].slot;
    if (s === slot || (slot === 'dress' && (s === 'top' || s === 'bottom')) || ((slot === 'top' || slot === 'bottom') && s === 'dress')) delete wear[k];
  }
  wear[item] = color || look.wear[item] || WEAR[item].color || WEAR_COLORS[0];
  return { ...look, wear };
}

function fixSlots(wear) {
  let out = {};
  for (const [k, c] of Object.entries(wear)) out = toggleWear({ wear: out }, k, c).wear;
  return out;
}
