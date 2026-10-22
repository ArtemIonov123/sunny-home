// Внешность героев: кожа, причёска, цвет волос, эмоция, одежда (каждая вещь — со своим цветом).
// Картинки частей — серые, цвет накладывает render/hero.js. Здесь только данные и правила.
import { isHex } from '../util.js';

export const SKINS = ['#ffe3cc', '#f8cfae', '#efb98f', '#d9a074', '#b98157', '#93613f', '#6b432b', '#4a2e1f'];
export const HAIR_COLORS = ['#2a201c', '#553420', '#8a5530', '#c27c3a', '#e8c46a', '#f3e3b5', '#d4503a', '#f290b2', '#79a7e3', '#a184dd', '#7ccf9a', '#e8e8e8'];
export const WEAR_COLORS = ['#ff8fa8', '#ff6b6b', '#ffb36b', '#ffe27a', '#a8e08a', '#6fcfc0', '#7fb1f0', '#3d6fc4', '#b49cf0', '#f6f2ea', '#8b8f9c', '#4a4e5a'];
export const HAIRS = ['braids', 'bob', 'ponytail', 'bun', 'curly', 'spiky', 'bangs', 'long', 'none'];
export const FACES = ['happy', 'laugh', 'yum', 'surprised', 'sad', 'sleep'];
// Вещь → «место» на теле. В одном месте одна вещь; платье занимает и верх, и низ.
export const WEAR = {
  tshirt: { slot: 'top' }, dress: { slot: 'dress' }, pants: { slot: 'bottom' }, skirt: { slot: 'bottom' },
  sneakers: { slot: 'shoes' }, cap: { slot: 'hat' }, glasses: { slot: 'glasses' },
};
// Порядок рисования одежды (снизу вверх).
export const WEAR_ORDER = ['sneakers', 'pants', 'skirt', 'tshirt', 'dress'];
export const WEAR_TOP = ['glasses', 'cap']; // поверх головы и волос

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
  wear[item] = color || look.wear[item] || WEAR_COLORS[0];
  return { ...look, wear };
}

function fixSlots(wear) {
  let out = {};
  for (const [k, c] of Object.entries(wear)) out = toggleWear({ wear: out }, k, c).wear;
  return out;
}
