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
    bath:    { width: 2000, pattern: 'tile', wall: '#cfe0ef', floor: { material: 'tile', color: '#e9e4dc' } },
    bedroom: { width: 2000, wall: '#dfe8d0', floor: { material: 'wood', color: '#cf9a63' } },
  };
  const p = presets[type] || presets.living;
  return {
    id, type, name: ROOM_TYPES[type]?.name || 'Комната', width: p.width,
    split: 0.60,    // граница стены и пола (доля высоты)
    walkTop: 0.70,  // верхняя граница, где ходят герои
    wall: { color: p.wall, pattern: p.pattern || 'plain' },
    floor: { ...p.floor },
  };
}

// Кухня, стирка, еда и одежда — в шкафчике (поверхностей для блендера ещё нет).
export const NEW_IN_INVENTORY = ['blender', 'smoothie_banana', 'banana', 'banana', 'apple', 'milk', 'juice', 'cake', 'sandwich', 'tomato', 'tshirt', 'pants', 'dress'];
// В новом доме часть этого стоит на кухне (см. defaultState), остальное — в шкафчике.
const KITCHEN_START = ['blender', 'banana', 'banana', 'apple', 'milk', 'juice', 'tomato', 'toaster'];

// Ванная: ванна с душем, раковина с зеркалом, унитаз, стирка. Уточка — в ванне, мыло — на раковине (см. ниже).
export const BATH_START = [
  ['towel_rack', 190, 300], ['bathtub', 430, 660], ['bath_mirror', 900, 250], ['bath_sink', 900, 640], ['toilet', 1190, 640],
  ['wall_clock', 1190, 200], ['washing_machine', 1520, 650], ['picture', 1640, 250], ['laundry_basket', 1830, 700],
];

// Спальня: шкаф, кровать с картиной над ней, тумбочка с лампой, комод. В шкафу висят футболка и платье.
export const BEDROOM_START = [
  ['wardrobe', 250, 640], ['bed', 760, 660], ['picture', 760, 240], ['nightstand', 1130, 650], ['dresser', 1700, 650],
  ['wall_shelf_small', 1700, 330],
];
// Мелочь спальни: мишка на кровати, будильник на комоде, книжка на полочке. [вещь, мебель, поверхность, сдвиг]
export const BEDROOM_SMALL = [['teddy_bear', 'bed', 0, 120], ['alarm_clock', 'dresser', 0, -90], ['book', 'wall_shelf_small', 0, -40]];

export function defaultState() {
  const rooms = ['lawn', 'living', 'kitchen', 'kids', 'bath', 'bedroom'].map((t) => newRoom(t, t));
  let id = 1;
  const it = (def, room, x, y) => ({ id: id++, def, room, x, y });
  const items = [
    it('tree', 'lawn', 300, 700), it('bush', 'lawn', 1000, 600), it('flowerbed', 'lawn', 1250, 800), it('bush', 'lawn', 60, 860),
    it('door', 'living', 150, 540),
    it('window', 'living', 1450, 260), it('picture', 'living', 520, 230), it('tv_stand', 'living', 520, 640), it('plant_big', 'living', 900, 620),
    it('rug', 'living', 1450, 840), it('sofa', 'living', 1450, 640), it('table', 'living', 1450, 800), it('armchair', 'living', 1950, 700), it('floor_lamp', 'living', 2200, 630),
    it('bookshelf', 'kids', 1300, 600),
    it('window', 'kitchen', 900, 250), it('table', 'kitchen', 1700, 800),
    it('fridge', 'kitchen', 230, 640), it('stove', 'kitchen', 560, 640), it('sink_counter', 'kitchen', 900, 640),
    it('kitchen_counter', 'kitchen', 1290, 640), it('kitchen_shelf', 'kitchen', 1290, 300),
    it('window', 'kids', 800, 250), it('picture', 'kids', 330, 240),
    ...BATH_START.map(([def, x, y]) => it(def, 'bath', x, y)),
    it('window', 'bedroom', 1300, 260), ...BEDROOM_START.map(([def, x, y]) => it(def, 'bedroom', x, y)),
  ];
  // Кухня обставлена: на тумбе тостер и блендер, в холодильнике еда, на полке сок.
  const byDef = (def, room) => items.find((i) => i.def === def && i.room === room).id;
  const counter = byDef('kitchen_counter', 'kitchen'), fridge = byDef('fridge', 'kitchen'), shelf = byDef('kitchen_shelf', 'kitchen');
  const onIt = (def, parent, s, dx) => ({ id: id++, def, room: 'kitchen', x: 0, y: 0, on: { id: parent, s, dx } });
  items.push(
    onIt('toaster', counter, 0, -100), onIt('blender', counter, 0, 90),
    onIt('banana', fridge, 2, -10), onIt('banana', fridge, 3, -10), onIt('apple', fridge, 2, -60), onIt('milk', fridge, 4, -50), onIt('tomato', fridge, 4, 0),
    onIt('juice', shelf, 0, -120),
  );
  const tub = byDef('bathtub', 'bath'), sink = byDef('bath_sink', 'bath');
  items.push({ id: id++, def: 'rubber_duck', room: 'bath', x: 0, y: 0, on: { id: tub, s: 0, dx: -60 } },
    { id: id++, def: 'soap', room: 'bath', x: 0, y: 0, on: { id: sink, s: 0, dx: -70 } });
  const wardrobe = byDef('wardrobe', 'bedroom'), stand = byDef('nightstand', 'bedroom');
  items.push({ id: id++, def: 'bedside_lamp', room: 'bedroom', x: 0, y: 0, on: { id: stand, s: 0, dx: 0 } },
    { id: id++, def: 'tshirt', room: 'bedroom', x: 0, y: 0, on: { id: wardrobe, s: 2, dx: 0 } },
    { id: id++, def: 'dress', room: 'bedroom', x: 0, y: 0, on: { id: wardrobe, s: 1, dx: 0 } },
    ...BEDROOM_SMALL.map(([def, par, s, dx]) => ({ id: id++, def, room: 'bedroom', x: 0, y: 0, on: { id: byDef(par, 'bedroom'), s, dx } })));
  const rest = [...NEW_IN_INVENTORY];
  for (const d of [...KITCHEN_START, 'tshirt', 'dress']) { const k = rest.indexOf(d); if (k >= 0) rest.splice(k, 1); }
  return {
    schema: 12, // = SCHEMA в save/migrate.js
    rooms, items: [...items, ...['picture', 'picture', 'table', 'window', 'door', ...rest].map((def) => ({ id: id++, def, inv: true }))], next: id,
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
