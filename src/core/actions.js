// Действия над домом. Каждое — одна понятная операция через store.change(),
// поэтому у всех есть отмена и автосохранение.
import { ITEMS, ROOM_TYPES } from './catalog.js';
import { newRoom, uniqueRoomId, MAX_ROOMS, roomAtX } from './house.js';
import { snapItem, snapChar } from './placement.js';
import { clamp } from '../util.js';

// Прижать все вещи и героев к допустимым местам (после загрузки, смены разметки и ширины).
export function normalize(s) {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const indoor = s.rooms.find((r) => !ROOM_TYPES[r.type].outdoor) || s.rooms[0];
  for (const i of s.items) {
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
}

export function createActions(store, camera) {
  const roomInView = () => {
    const r = roomAtX(store.layout, camera.x + camera.viewW / 2);
    return r;
  };

  return {
    roomInView,

    // Добавить предмет в комнату, которая сейчас на экране, ближе к середине экрана.
    addItem(defId) {
      const r = roomInView();
      if (!r) return { ok: false, reason: 'Нет комнаты' };
      const def = ITEMS[defId];
      const cx = clamp(camera.x + camera.viewW / 2 - r.x0, 0, r.room.width);
      const y = def.place === 'floor' ? 800 : def.place === 'doorway' ? 0 : 230;
      const p = snapItem(defId, r.room, cx, y);
      if (!p) return { ok: false, reason: `«${def.name}» нельзя поставить в комнате «${r.room.name}»` };
      let id;
      store.change((s) => { id = s.next++; s.items.push({ id, def: defId, room: r.room.id, x: p.x, y: p.y }); });
      return { ok: true, id };
    },

    removeItem(id) { store.change((s) => { s.items = s.items.filter((i) => i.id !== id); }); },

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
      if (s0.items.some((i) => i.room === roomId)) return { ok: false, reason: 'Сначала убери вещи из этой комнаты' };
      store.change((s) => {
        const rest = s.rooms.filter((r) => r.id !== roomId);
        const home = rest.find((r) => r.type !== 'lawn');
        s.rooms = rest;
        for (const c of s.chars) if (c.room === roomId) { c.room = home.id; c.x = 400; }
        normalize(s);
      });
      return { ok: true };
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
