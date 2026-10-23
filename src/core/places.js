// Места на карте (ui/map.js): дом и другие места. Каждое место — как отдельный дом: свои комнаты и вещи.
// В state — только текущее место (rooms, items); остальные лежат в state.places[id] = { rooms, items }.
// Переход — actions.goPlace(id): герои идут с игроком, вместе с вещами в руках и шкафчиком.
// Магазин при каждом приходе пополняется: на свои полки снова встаёт товар (stock).
import { newRoom } from './house.js';

export const BUILTIN_PLACES = ['home', 'shop', 'disco', 'cafe', 'salon'];
// Все места: встроенные + свои из студии (core/world.js добавляет и убирает их здесь же, массив живой).
export const PLACE_IDS = [...BUILTIN_PLACES];
const custom = new Map(); // id → { name, rooms, items } — обстановка своего места (из студии или пака)
export function setCustomPlaces(map) {
  custom.clear();
  for (const [id, p] of Object.entries(map || {})) custom.set(id, p);
  PLACE_IDS.length = 0; PLACE_IDS.push(...BUILTIN_PLACES, ...custom.keys());
}
export const customPlace = (id) => custom.get(id) || null;

// Первая обстановка места: мебель [def, x, y] и товар [номер мебели, полка, dx, def].
const PLACES = {
  shop: {
    rooms: [['shop', 'shop']],
    furniture: [
      ['shop_shelf', 280, 650], ['shop_shelf', 730, 650], ['shop_fridge', 1200, 650],
      ['shop_crate', 1660, 790], ['shop_crate', 1930, 790], ['shop_counter', 2420, 690],
      ['shop_cart', 1480, 870], ['shop_basket', 2170, 868],
    ],
    stock: [
      [0, 0, -90, 'bread'], [0, 0, 0, 'bread'], [0, 0, 90, 'toast'], [0, 1, -80, 'cheese'], [0, 1, 40, 'cake'], [0, 2, -60, 'sandwich'], [0, 2, 70, 'pizza'],
      [1, 0, -90, 'juice'], [1, 0, 0, 'juice'], [1, 0, 90, 'smoothie_banana'], [1, 1, -70, 'soup'], [1, 1, 60, 'egg'], [1, 2, -40, 'egg'], [1, 2, 60, 'egg'],
      [2, 0, -60, 'milk'], [2, 0, 60, 'milk'], [2, 1, -60, 'cheese'], [2, 1, 60, 'egg'], [2, 2, -50, 'tomato'], [2, 2, 60, 'tomato'],
      [3, 0, -50, 'apple'], [3, 0, 10, 'apple'], [3, 0, 60, 'banana'], [4, 0, -55, 'carrot'], [4, 0, 5, 'potato'], [4, 0, 60, 'carrot'],
    ],
  },
};
export const isReady = (id) => id === 'home' || !!PLACES[id] || custom.has(id);

// Новое место: комнаты и мебель с товаром. nextId() — следующий номер вещи (общий на всю игру).
export function newPlace(id, nextId) {
  const c = custom.get(id);
  if (c) { // своё место: копия обстановки из студии, вещам — новые номера (мебель и то, что на ней)
    const rooms = JSON.parse(JSON.stringify(c.rooms || []));
    const map = new Map(), items = [];
    for (const it of c.items || []) map.set(it.id, nextId());
    for (const it of c.items || []) { const o = JSON.parse(JSON.stringify(it)); o.id = map.get(it.id); if (o.on) { if (map.has(o.on.id)) o.on.id = map.get(o.on.id); else delete o.on; } delete o.held; items.push(o); }
    return { rooms, items };
  }
  const p = PLACES[id]; if (!p) return null;
  const rooms = p.rooms.map(([type, rid]) => newRoom(type, rid));
  const items = p.furniture.map(([def, x, y]) => ({ id: nextId(), def, room: rooms[0].id, x, y }));
  return { rooms, items };
}

// Пополнить товар на полках (то, что унесли, появляется снова).
export function restock(s, nextId) {
  const p = PLACES[s.place]; if (!p?.stock) return 0;
  const byDef = {};
  for (const [def] of p.furniture) byDef[def] ||= s.items.filter((i) => i.def === def && !i.inv && !i.held).sort((a, b) => a.id - b.id);
  const seen = {}, parents = p.furniture.map(([def]) => { seen[def] = (seen[def] || 0) + 1; return byDef[def][seen[def] - 1] || null; });
  let n = 0;
  for (const [k, sIdx, dx, def] of p.stock) {
    const par = parents[k]; if (!par) continue;
    if (s.items.some((i) => i.on?.id === par.id && i.on.s === sIdx && i.def === def && Math.abs(i.on.dx - dx) < 30)) continue;
    s.items.push({ id: nextId(), def, room: par.room, x: 0, y: 0, on: { id: par.id, s: sIdx, dx } }); n++;
  }
  return n;
}
