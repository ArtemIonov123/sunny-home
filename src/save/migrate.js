// Проверка и обновление формата сохранения.
// Правило: новое поле или изменение формата → schema+1 и функция в MIGRATIONS.
// Старые сохранения никогда не выбрасываются молча.
import { ITEMS, itemDef, CHARS, ROOM_TYPES, WALL_PATTERNS, FLOOR_MATERIALS } from '../core/catalog.js';
import { defaultState, newRoom, MAX_ROOMS, NEW_IN_INVENTORY, BATH_START, BEDROOM_START, BEDROOM_SMALL } from '../core/house.js';
import { clamp, isHex } from '../util.js';
import { cleanLook } from '../core/looks.js';

export const SCHEMA = 12;

const MIGRATIONS = {
  // 1 → 2: появился шкафчик. Все вещи из версии 1 стоят в доме, формат вещи в доме не меняется.
  1: (s) => ({ ...s, schema: 2 }),
  // 2 → 3: у лужайки появились свои картинки — сажаем сад, если на лужайке пусто.
  2: (s) => {
    const lawn = (s.rooms || []).find((r) => r?.type === 'lawn');
    const items = Array.isArray(s.items) ? [...s.items] : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    if (lawn && !items.some((i) => i?.room === lawn.id)) {
      for (const [def, x, y] of [['tree', 300, 700], ['bush', 1000, 600], ['flowerbed', 1250, 800]]) items.push({ id: next++, def, room: lawn.id, x, y });
    }
    return { ...s, items, next, schema: 3 };
  },
  // 3 → 4: мебель гостиной — по одной штуке в шкафчик (расстановку игрока не трогаем).
  3: (s) => {
    const items = Array.isArray(s.items) ? [...s.items] : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    for (const def of ['sofa', 'armchair', 'rug', 'floor_lamp', 'tv_stand', 'plant_big', 'bookshelf']) items.push({ id: next++, def, inv: true });
    return { ...s, items, next, schema: 4 };
  },
  // 4 → 5: техника, корзина, еда и одежда — в шкафчик.
  4: (s) => {
    const items = Array.isArray(s.items) ? [...s.items] : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    for (const def of ['washing_machine', 'laundry_basket', ...NEW_IN_INVENTORY]) items.push({ id: next++, def, inv: true });
    return { ...s, items, next, schema: 5 };
  },
  // 5 → 6: вещи могут стоять на мебели (поле on). Старые данные подходят без изменений.
  5: (s) => ({ ...s, schema: 6 }),
  // 6 → 7: кухня (холодильник, плита, мойка, тумба, полка, тостер) — в шкафчик.
  6: (s) => {
    const items = Array.isArray(s.items) ? [...s.items] : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    for (const def of ['fridge', 'stove', 'sink_counter', 'kitchen_counter', 'kitchen_shelf', 'toaster']) items.push({ id: next++, def, inv: true });
    return { ...s, items, next, schema: 7 };
  },
  // 7 → 8: ванная обставлена (ванна, раковина, унитаз, зеркало, полотенце, часы, уточка, мыло), стены — кафель.
  // Стиралку, корзину и картину из старой расстановки сдвигаем, только если игрок их не трогал.
  7: (s) => {
    const items = Array.isArray(s.items) ? s.items.map((i) => ({ ...i })) : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    const rooms = Array.isArray(s.rooms) ? s.rooms.map((r) => (r && typeof r === 'object' ? { ...r } : r)) : [];
    const bath = rooms.find((r) => r?.type === 'bath');
    if (bath && !items.some((i) => i?.def === 'bathtub')) {
      if (!(bath.width >= 2000)) bath.width = 2000;
      if (!bath.wall?.pattern || bath.wall.pattern === 'plain') bath.wall = { ...bath.wall, pattern: 'tile' };
      const spot = Object.fromEntries(BATH_START.map(([d, x, y]) => [d, [x, y]]));
      for (const [def, ox, oy] of [['washing_machine', 1150, 650], ['laundry_basket', 1400, 700], ['picture', 800, 240]]) {
        const it = items.find((i) => i?.def === def && i.room === bath.id && i.x === ox && i.y === oy);
        if (it) [it.x, it.y] = spot[def];
      }
      const ids = {};
      for (const [def, x, y] of BATH_START) {
        if (['washing_machine', 'laundry_basket', 'picture'].includes(def)) continue;
        ids[def] = next; items.push({ id: next++, def, room: bath.id, x, y });
      }
      items.push({ id: next++, def: 'rubber_duck', room: bath.id, x: 0, y: 0, on: { id: ids.bathtub, s: 0, dx: -60 } });
      items.push({ id: next++, def: 'soap', room: bath.id, x: 0, y: 0, on: { id: ids.bath_sink, s: 0, dx: -70 } });
    }
    return { ...s, rooms, items, next, schema: 8 };
  },
  // 8 → 9: спальня обставлена (шкаф, кровать, тумбочка с лампой, комод). Картину сдвигаем, только если её не трогали.
  // Одежду не трогаем — она у игрока уже где-то есть.
  8: (s) => {
    const items = Array.isArray(s.items) ? s.items.map((i) => ({ ...i })) : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    const bed = (Array.isArray(s.rooms) ? s.rooms : []).find((r) => r?.type === 'bedroom');
    if (bed && !items.some((i) => i?.def === 'bed')) {
      const pic = items.find((i) => i?.def === 'picture' && i.room === bed.id && i.x === 560 && i.y === 240);
      if (pic) pic.x = 760;
      const ids = {};
      for (const [def, x, y] of BEDROOM_START) {
        if (def === 'picture') continue;
        ids[def] = next; items.push({ id: next++, def, room: bed.id, x, y });
      }
      items.push({ id: next++, def: 'bedside_lamp', room: bed.id, x: 0, y: 0, on: { id: ids.nightstand, s: 0, dx: 0 } });
    }
    return { ...s, items, next, schema: 9 };
  },
  // 9 → 10: в спальне — настенная полочка, мишка, будильник, книжка (ставим на мебель спальни, если она есть).
  9: (s) => {
    const items = Array.isArray(s.items) ? s.items.map((i) => ({ ...i })) : [];
    let next = Math.max(Number(s.next) || 1, ...items.map((i) => (Number.isInteger(i?.id) ? i.id + 1 : 1)));
    const bed = (Array.isArray(s.rooms) ? s.rooms : []).find((r) => r?.type === 'bedroom');
    if (bed && !items.some((i) => i?.def === 'teddy_bear')) {
      if (!items.some((i) => i?.def === 'wall_shelf_small' && i.room === bed.id)) items.push({ id: next++, def: 'wall_shelf_small', room: bed.id, x: 1700, y: 330 });
      for (const [def, par, sf, dx] of BEDROOM_SMALL) {
        const p = items.find((i) => i?.def === par && i.room === bed.id && !i.inv);
        items.push(p ? { id: next++, def, room: bed.id, x: 0, y: 0, on: { id: p.id, s: sf, dx } } : { id: next++, def, inv: true });
      }
    }
    return { ...s, items, next, schema: 10 };
  },
  // 10 → 11: у героев появилась внешность (look). Нет — значит по умолчанию (подставит validate).
  10: (s) => ({ ...s, schema: 11 }),
  // 11 → 12: вещь может быть в руке героя (held) и надкушена (bites). Старые данные подходят.
  11: (s) => ({ ...s, schema: 12 }),
};

const num = (v, a, b, d) => (Number.isFinite(v) ? clamp(v, a, b) : d);

function cleanRoom(raw, used) {
  if (!raw || !ROOM_TYPES[raw.type] || typeof raw.id !== 'string' || used.has(raw.id)) return null;
  used.add(raw.id);
  const base = newRoom(raw.type, raw.id);
  const floorMaterials = raw.type === 'lawn' ? ['grass'] : Object.keys(FLOOR_MATERIALS);
  const r = {
    ...base,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 30) : base.name,
    width: num(raw.width, 1200, 4000, base.width),
    split: num(raw.split, 0.42, 0.70, base.split),
    walkTop: num(raw.walkTop, 0.46, 0.88, base.walkTop),
    wall: {
      color: isHex(raw.wall?.color) ? raw.wall.color : base.wall.color,
      pattern: WALL_PATTERNS[raw.wall?.pattern] ? raw.wall.pattern : 'plain',
    },
    floor: {
      material: floorMaterials.includes(raw.floor?.material) ? raw.floor.material : base.floor.material,
      color: isHex(raw.floor?.color) ? raw.floor.color : base.floor.color,
    },
  };
  r.walkTop = Math.max(r.walkTop, r.split + 0.04);
  return r;
}

// Принимает что угодно, возвращает корректное состояние (или бросает понятную ошибку).
export function validate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Сохранение повреждено.');
  let s = raw;
  while (Number.isInteger(s.schema) && s.schema < SCHEMA) {
    const step = MIGRATIONS[s.schema];
    if (!step) throw new Error('Неизвестная версия сохранения: ' + s.schema);
    s = step(s);
  }
  if (s.schema !== SCHEMA) throw new Error('Сохранение из более новой версии игры.');

  const used = new Set();
  let rooms = (Array.isArray(s.rooms) ? s.rooms : []).map((r) => cleanRoom(r, used)).filter(Boolean).slice(0, MAX_ROOMS);
  if (!rooms.length) rooms = defaultState().rooms;
  // Лужайка всегда первая — через неё вход в дом.
  const lawnAt = rooms.findIndex((r) => r.type === 'lawn');
  if (lawnAt > 0) rooms.unshift(rooms.splice(lawnAt, 1)[0]);
  const roomIds = new Set(rooms.map((r) => r.id));
  const fallbackRoom = (rooms.find((r) => r.type !== 'lawn') || rooms[0]).id;

  const ids = new Set();
  const items = [], missing = [];
  for (const i of [...(Array.isArray(s.items) ? s.items : []), ...(Array.isArray(s.missing) ? s.missing : [])]) {
    if (!i || !Number.isInteger(i.id) || ids.has(i.id)) continue;
    const inInventory = i.inv === true || !Number.isFinite(i.x) || !Number.isFinite(i.y);
    ids.add(i.id);
    const item = inInventory
      ? { id: i.id, def: String(i.def), inv: true }
      : { id: i.id, def: String(i.def), room: roomIds.has(i.room) ? i.room : fallbackRoom, x: i.x, y: i.y };
    if (!inInventory && i.on && Number.isInteger(i.on.id) && i.on.id !== i.id && Number.isInteger(i.on.s) && Number.isFinite(i.on.dx)) {
      item.on = { id: i.on.id, s: i.on.s, dx: i.on.dx }; // проверка, что мебель существует, — в syncChildren
    }
    if (!inInventory && i.open === true) item.open = true;
    if (!inInventory && i.lit === true) item.lit = true;
    if (!inInventory && i.held && CHARS[i.held.by]) item.held = { by: i.held.by }; // место — от героя (syncChildren)
    if (Number.isInteger(i.bites) && i.bites > 0 && i.bites < 3) item.bites = i.bites;
    (itemDef(item.def) ? items : missing).push(item); // неизвестный предмет откладываем, а не удаляем
  }

  const chars = Object.keys(CHARS).map((id, k) => {
    const c = (Array.isArray(s.chars) ? s.chars : []).find((c) => c?.id === id);
    const ok = c && roomIds.has(c.room) && Number.isFinite(c.x) && Number.isFinite(c.y);
    const look = cleanLook(c?.look, id); // у кошки внешности нет
    const out = ok ? { id, room: c.room, x: c.x, y: c.y } : { id, room: fallbackRoom, x: 700 + k * 300, y: 800 };
    if (look) out.look = look;
    return out;
  });

  const maxId = Math.max(0, ...[...ids]);
  return { schema: SCHEMA, rooms, items, missing, chars, next: Math.max(Number(s.next) || 1, maxId + 1), night: !!s.night };
}

// Комната из версии 0.4.1 (координаты в долях 0..1) → гостиная нового дома.
export function fromLegacyRoom(old) {
  const s = defaultState();
  const living = s.rooms.find((r) => r.id === 'living');
  living.name = typeof old.name === 'string' && old.name.trim() ? old.name.trim().slice(0, 30) : living.name;
  if (Number.isFinite(old.split)) living.split = clamp(old.split, 0.42, 0.70);
  if (Number.isFinite(old.walkTop)) living.walkTop = clamp(Math.max(old.walkTop, living.split + 0.04), 0.46, 0.88);
  if (isHex(old.wallColor)) living.wall.color = old.wallColor;
  if (WALL_PATTERNS[old.wallPattern]) living.wall.pattern = old.wallPattern;
  if (isHex(old.floorColor)) living.floor.color = old.floorColor;
  living.floor.material = old.floorMaterial === 'tile' ? 'tile' : 'wood';
  // Старая комната была 1600 шириной; ставим её содержимое в середину широкой гостиной.
  const dx = (living.width - 1600) / 2;
  const moved = (Array.isArray(old.objects) ? old.objects : [])
    .filter((o) => o && ITEMS[o.type] && Number.isFinite(o.x) && Number.isFinite(o.y))
    .map((o) => ({ id: s.next++, def: o.type, room: 'living', x: dx + o.x * 1600, y: o.y * 900 }));
  if (moved.length) s.items = s.items.filter((i) => i.room !== 'living' || i.def === 'door' || i.def === 'window').concat(moved);
  if (Array.isArray(old.chars)) for (const c of s.chars) {
    const oc = old.chars.find((o) => o?.id === c.id);
    if (oc && Number.isFinite(oc.x) && Number.isFinite(oc.y)) { c.x = dx + oc.x * 1600; c.y = oc.y * 900; }
  }
  s.night = !!old.night;
  return validate(s);
}
