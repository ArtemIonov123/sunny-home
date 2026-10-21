// Действия над домом. Каждое — одна понятная операция через store.change(),
// поэтому у всех есть отмена и автосохранение.
import { itemDef, ROOM_TYPES } from './catalog.js';
import { newRoom, uniqueRoomId, MAX_ROOMS, roomAtX } from './house.js';
import { snapItem, snapChar } from './placement.js';
import { landing, syncChildren, releaseChildren } from './physics.js';
import { clamp } from '../util.js';

export const MAX_ITEMS = 250;

// Прижать все вещи и героев к допустимым местам (после загрузки, смены разметки и ширины).
export function normalize(s) {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const indoor = s.rooms.find((r) => !ROOM_TYPES[r.type].outdoor) || s.rooms[0];
  for (const i of s.items) {
    if (i.inv) continue; // вещь в шкафчике — у неё нет места в доме
    if (i.on) continue;  // стоит на мебели — место считается от мебели (ниже)
    let room = rooms.get(i.room) || indoor;
    let p = snapItem(i.def, room, i.x, i.y);
    if (!p) { room = indoor; p = snapItem(i.def, room, room.width / 2, i.y) || { x: room.width / 2, y: i.y }; }
    i.room = room.id; i.x = p.x; i.y = p.y;
  }
  for (const c of s.chars) {
    const room = rooms.get(c.room) || indoor;
    const p = snapChar(room, c.x, c.y);
    c.room = room.id; c.x = p.x; c.y = p.y;
  }
  syncChildren(s);
}

export function createActions(store, camera) {
  const roomInView = () => {
    const r = roomAtX(store.layout, camera.x + camera.viewW / 2);
    return r;
  };

  return {
    roomInView,

    // ── Экземпляры. Вещь всегда ровно в одном месте: в доме или в шкафчике. ──

    // Получить новую вещь из каталога — она появляется в шкафчике.
    obtain(defId) {
      if (!itemDef(defId)) return { ok: false, reason: 'Такого предмета нет' };
      if (store.state.items.length >= MAX_ITEMS) return { ok: false, reason: `Вещей уже ${MAX_ITEMS} — убери лишнее` };
      let id;
      store.change((s) => { id = s.next++; s.items.push({ id, def: defId, inv: true }); });
      return { ok: true, id };
    },

    // Достать вещь из шкафчика в комнату на экране, ближе к середине экрана.
    placeFromInventory(itemId) {
      const item = store.state.items.find((i) => i.id === itemId && i.inv);
      const r = roomInView();
      if (!item || !r) return { ok: false, reason: 'Вещь не найдена' };
      const def = itemDef(item.def);
      // Небольшой сдвиг, чтобы несколько вещей подряд не легли точно друг на друга.
      const cx = clamp(camera.x + camera.viewW / 2 - r.x0 + ((itemId * 97) % 240) - 120, 0, r.room.width);
      // Мелкая вещь «падает» сверху — и может приземлиться на стол или полку.
      const y = def.place === 'floor' ? 330 : def.place === 'doorway' ? 0 : 230;
      const p = landing(store.state, item.def, r.room, cx, y, itemId);
      if (!p) return { ok: false, reason: `«${def.name}» нельзя поставить в комнате «${r.room.name}»` };
      store.change((s) => { const i = s.items.find((i) => i.id === itemId); delete i.inv; i.room = r.room.id; i.x = p.x; i.y = p.y; if (p.on) i.on = { ...p.on }; syncChildren(s); });
      return { ok: true, fall: def.place === 'floor' ? Math.min(0, 160 - p.y) : 0 };
    },

    toInventory(itemId, { undo = true } = {}) {
      store.change((s) => { releaseChildren(s, itemId); const i = s.items.find((i) => i.id === itemId); if (i) { delete i.room; delete i.x; delete i.y; delete i.on; i.inv = true; } }, { undo });
    },

    // Выбросить вещь совсем (из шкафчика).
    discard(itemId) { store.change((s) => { s.items = s.items.filter((i) => i.id !== itemId); }); },

    // Вещи, чьё определение появилось (импортировали пак) — возвращаются из «потерянных» в шкафчик.
    restoreMissing() {
      const back = (store.state.missing || []).filter((i) => itemDef(i.def));
      if (!back.length) return 0;
      store.change((s) => {
        s.missing = s.missing.filter((i) => !itemDef(i.def));
        for (const i of back) s.items.push({ id: i.id, def: i.def, inv: true });
      }, { undo: false });
      return back.length;
    },

    // Убрать определение: его экземпляры откладываются в «потерянные», а не исчезают навсегда.
    shelveDef(defId) {
      store.change((s) => {
        const gone = s.items.filter((i) => i.def === defId);
        for (const g of gone) releaseChildren(s, g.id);
        s.items = s.items.filter((i) => i.def !== defId);
        s.missing = [...(s.missing || []), ...gone.map((i) => ({ id: i.id, def: i.def, inv: true }))];
      }, { undo: false });
    },

    // Счётчик для проверки «ничего не теряется и не копируется».
    counts() {
      const it = store.state.items;
      return { total: it.length, placed: it.filter((i) => !i.inv).length, inventory: it.filter((i) => i.inv).length, missing: (store.state.missing || []).length };
    },

    setWall(roomId, patch) { store.change((s) => { Object.assign(s.rooms.find((r) => r.id === roomId).wall, patch); }); },
    setFloor(roomId, patch) { store.change((s) => { Object.assign(s.rooms.find((r) => r.id === roomId).floor, patch); }); },

    renameRoom(roomId, name) {
      const v = String(name || '').trim().slice(0, 30);
      if (!v) return;
      store.change((s) => { s.rooms.find((r) => r.id === roomId).name = v; });
    },

    // Переставить комнату влево (-1) или вправо (+1). Лужайка всегда первая.
    moveRoom(roomId, dir) {
      const rooms = store.state.rooms, i = rooms.findIndex((r) => r.id === roomId), j = i + dir;
      if (i < 0 || j < 0 || j >= rooms.length) return false;
      if (rooms[i].type === 'lawn' || rooms[j].type === 'lawn') return false;
      store.change((s) => { const [r] = s.rooms.splice(i, 1); s.rooms.splice(j, 0, r); });
      return true;
    },

    addRoom(type) {
      if (store.state.rooms.length >= MAX_ROOMS) return { ok: false, reason: `В доме может быть до ${MAX_ROOMS} комнат` };
      if (type === 'lawn') return { ok: false, reason: 'Лужайка уже есть' };
      let id;
      store.change((s) => { id = uniqueRoomId(s.rooms, type); s.rooms.push(newRoom(type, id)); });
      return { ok: true, id };
    },

    removeRoom(roomId) {
      const s0 = store.state, room = s0.rooms.find((r) => r.id === roomId);
      if (!room || room.type === 'lawn') return { ok: false, reason: 'Лужайку убрать нельзя' };
      if (s0.rooms.filter((r) => r.type !== 'lawn').length <= 1) return { ok: false, reason: 'В доме должна остаться хотя бы одна комната' };
      const moved = s0.items.filter((i) => !i.inv && i.room === roomId).length;
      store.change((s) => {
        // Вещи комнаты не пропадают — уходят в шкафчик.
        for (const i of s.items) if (!i.inv && i.room === roomId) { delete i.room; delete i.x; delete i.y; delete i.on; i.inv = true; }
        const rest = s.rooms.filter((r) => r.id !== roomId);
        const home = rest.find((r) => r.type !== 'lawn');
        s.rooms = rest;
        for (const c of s.chars) if (c.room === roomId) { c.room = home.id; c.x = 400; }
        normalize(s);
      });
      return { ok: true, moved };
    },

    setWidth(roomId, width) { store.change((s) => { s.rooms.find((r) => r.id === roomId).width = width; normalize(s); }); },

    setMarkup(roomId, split, walkTop, { undo = true } = {}) {
      store.change((s) => {
        const r = s.rooms.find((r) => r.id === roomId);
        r.split = clamp(split, 0.42, 0.70);
        r.walkTop = clamp(Math.max(walkTop, r.split + 0.04), 0.46, 0.88);
        normalize(s);
      }, { undo });
    },

    toggleNight() { store.change((s) => { s.night = !s.night; }); },
  };
}
