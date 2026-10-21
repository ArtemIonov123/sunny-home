// Правила размещения. Вместо «вернуть назад, если нельзя» вещь прижимается
// к ближайшему допустимому месту. null — в этой комнате вещь стоять не может совсем.
import { VIEW_H, FLOOR_BOTTOM } from '../config.js';
import { itemDef, CHARS, ROOM_TYPES } from './catalog.js';
import { sizeOf } from '../assets.js';
import { clamp } from '../util.js';

const WALL_TOP = 16;       // отступ от потолка
const BASEBOARD = 16;      // картины не залезают на плинтус

export const wallBottom = (room) => room.split * VIEW_H - BASEBOARD;
export const floorTop = (room) => room.split * VIEW_H + 12;
export const floorBottom = () => FLOOR_BOTTOM * VIEW_H;
export const walkTop = (room) => room.walkTop * VIEW_H;

export function itemBounds(item) {
  const def = itemDef(item.def);
  const { w, h } = sizeOf(def);
  return def.anchor === 'center'
    ? { x: item.x - w / 2, y: item.y - h / 2, w, h }
    : { x: item.x - w / 2, y: item.y - h, w, h };
}

export function charBounds(c) {
  const def = CHARS[c.id];
  const { w, h } = sizeOf(def);
  return { x: c.x - w / 2, y: c.y - h, w, h };
}

export function snapItem(defId, room, x, y) {
  const def = itemDef(defId);
  if (!def || !room) return null;
  const outdoor = ROOM_TYPES[room.type]?.outdoor;
  if (def.indoorOnly && outdoor) return null;
  const { w, h } = sizeOf(def);
  if (def.place === 'floor') {
    return { x: clamp(x, 30, room.width - 30), y: clamp(y, floorTop(room), floorBottom()) };
  }
  if (def.place === 'doorway') {
    return { x: clamp(x, w / 2, room.width - w / 2), y: room.split * VIEW_H };
  }
  // wall: вся картинка на стене
  const top = WALL_TOP + h / 2, bottom = wallBottom(room) - h / 2;
  if (bottom < top || outdoor) return null;
  return { x: clamp(x, w / 2 + 8, room.width - w / 2 - 8), y: clamp(y, top, bottom) };
}

export function snapChar(room, x, y) {
  return { x: clamp(x, 40, room.width - 40), y: clamp(y, walkTop(room), floorBottom()) };
}

// Слой отрисовки: стены и дверные проёмы позади, на полу — по нижней точке.
export function depthOf(kind, obj, parentOf) {
  if (kind === 'item') {
    const parent = obj.on && parentOf?.(obj.on.id);
    if (parent) return parent.y + 0.5 + obj.on.s * 0.01; // вещь на мебели — сразу перед мебелью
    const place = itemDef(obj.def)?.place;
    if (place === 'wall') return -2000 + obj.y;
    if (place === 'doorway') return -1000;
    if (itemDef(obj.def)?.layer === 'under') return -500 + obj.y / 10; // ковёр под мебелью и героями
  }
  return obj.y;
}
