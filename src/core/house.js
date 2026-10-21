// Дом — это СПИСОК комнат. Порядок в списке = порядок слева направо.
// Положение комнаты в мире не хранится, а вычисляется (layout), поэтому
// комнаты можно переставлять: вещи хранят координаты ВНУТРИ своей комнаты и едут вместе с ней.
import { VIEW_H } from '../config.js';
import { ROOM_TYPES } from './catalog.js';

export const MAX_ROOMS = 10;
export const ROOM_WIDTHS = { 1600: 'Узкая', 2000: 'Средняя', 2400: 'Широкая' };

export function newRoom(type, id) {
  const presets = {
    lawn:    { width: 1600, wall: '#bfe3f7', floor: { material: 'grass', color: '#8fcf6a' } },
    living:  { width: 2400, wall: '#f6e3c4', floor: { material: 'wood', color: '#e2b27c' } },
    kitchen: { width: 2000, wall: '#dfe8d0', floor: { material: 'wood', color: '#ecc99b' } },
    kids:    { width: 1600, wall: '#f6cfc8', floor: { material: 'wood', color: '#e2b27c' } },
    bath:    { width: 1600, wall: '#cfe0ef', floor: { material: 'tile', color: '#e9e4dc' } },
    bedroom: { width: 2000, wall: '#dfe8d0', floor: { material: 'wood', color: '#cf9a63' } },
  };
  const p = presets[type] || presets.living;
  return {
    id, type, name: ROOM_TYPES[type]?.name || 'Комната', width: p.width,
    split: 0.60,    // граница стены и пола (доля высоты)
    walkTop: 0.70,  // верхняя граница, где ходят герои
    wall: { color: p.wall, pattern: 'plain' },
    floor: { ...p.floor },
  };
}

export function defaultState() {
  const rooms = ['lawn', 'living', 'kitchen', 'kids', 'bath', 'bedroom'].map((t) => newRoom(t, t));
  let id = 1;
  const it = (def, room, x, y) => ({ id: id++, def, room, x, y });
  const items = [
    it('door', 'living', 150, 540),
    it('window', 'living', 1250, 260), it('picture', 'living', 700, 250), it('table', 'living', 1300, 760),
    it('window', 'kitchen', 1000, 260), it('table', 'kitchen', 1000, 780),
    it('window', 'kids', 800, 250), it('picture', 'kids', 330, 240),
    it('picture', 'bath', 800, 240),
    it('window', 'bedroom', 1300, 260), it('picture', 'bedroom', 560, 240),
  ];
  return {
    schema: 1,
    rooms, items, next: id,
    chars: [
      { id: 'girl', room: 'living', x: 900, y: 770 },
      { id: 'boy', room: 'living', x: 1700, y: 800 },
      { id: 'cat', room: 'living', x: 1250, y: 830 },
    ],
    night: false,
  };
}

// Вычисляет, где в мире начинается каждая комната.
export function layout(rooms) {
  let x = 0;
  const list = rooms.map((room, index) => { const r = { room, index, x0: x, x1: x + room.width }; x += room.width; return r; });
  const byId = new Map(list.map((r) => [r.room.id, r]));
  return { list, byId, width: x, height: VIEW_H };
}

export function roomAtX(lay, wx) {
  if (!lay.list.length) return null;
  if (wx < 0) return lay.list[0];
  return lay.list.find((r) => wx < r.x1) || lay.list[lay.list.length - 1];
}

export function uniqueRoomId(rooms, type) {
  let n = 1, id = type;
  while (rooms.some((r) => r.id === id)) id = type + '_' + (++n);
  return id;
}
