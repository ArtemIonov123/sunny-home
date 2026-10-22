// Действия над домом. Каждое — одна понятная операция через store.change(),
// поэтому у всех есть отмена и автосохранение.
import { itemDef, ROOM_TYPES } from './catalog.js';
import { newRoom, uniqueRoomId, MAX_ROOMS, roomAtX } from './house.js';
import { snapItem, snapChar } from './placement.js';
import { landing, syncChildren, releaseChildren, freeSpot, isSmall } from './physics.js';
import { toggleWear, WEAR } from './looks.js';
import { defaultState } from './house.js';
import { clamp } from '../util.js';

export const MAX_ITEMS = 250;

// Прижать все вещи и героев к допустимым местам (после загрузки, смены разметки и ширины).
// Одежда из каталога → вещь на герое (и её цвет по картинке).
// Одежда из каталога → вещь на герое: поле wear у определения (футболка, штанишки, платье, свои предметы).
export const wearOf = (defId) => itemDef(defId)?.wear || null;
const WEAR_DEFAULT_COLOR = { tshirt: '#ff8fa8', pants: '#7fb1f0', dress: '#b49cf0' };

export function normalize(s) {
  const rooms = new Map(s.rooms.map((r) => [r.id, r]));
  const indoor = s.rooms.find((r) => !ROOM_TYPES[r.type].outdoor) || s.rooms[0];
  for (const i of s.items) {
    if (i.inv) continue; // вещь в шкафчике — у неё нет места в доме
    if (i.on) continue;  // стоит на мебели — место считается от мебели (ниже)
    if (i.held) continue; // в руке героя — место считается от героя (syncChildren)
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

    // Взять вещь из каталога: сначала убранная раньше такая же (без копий), иначе новая.
    // Возвращает id вещи (она пока «в шкафчике»), или null, если вещей слишком много.
    take(defId) {
      if (!itemDef(defId)) return null;
      const old = store.state.items.find((i) => i.inv && i.def === defId);
      if (old) return old.id;
      if (store.state.items.length >= MAX_ITEMS) return null;
      let id;
      store.change((s) => { id = s.next++; s.items.push({ id, def: defId, inv: true }); }, { undo: false, save: false });
      return id;
    },

    // Достать вещь из шкафчика в комнату на экране, ближе к середине экрана.
    placeFromInventory(itemId) {
      const item = store.state.items.find((i) => i.id === itemId && i.inv);
      const r = roomInView();
      if (!item || !r) return { ok: false, reason: 'Вещь не найдена' };
      const def = itemDef(item.def);
      // Свободное место рядом с серединой экрана: на мебели, на полу или на стене — не в кучу.
      const cx = clamp(camera.x + camera.viewW / 2 - r.x0, 0, r.room.width);
      const p = freeSpot(store.state, item.def, r.room, cx, itemId);
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

    // Открыть / закрыть (холодильник, позже шкафы и духовка).
    toggleOpen(itemId) {
      const item = store.state.items.find((i) => i.id === itemId);
      if (!item || !itemDef(item.def)?.openArt) return null;
      store.change((s) => { const i = s.items.find((i) => i.id === itemId); i.open = !i.open; });
      return store.state.items.find((i) => i.id === itemId).open;
    },

    // Включить / выключить (телевизор, торшер; позже — плита, стиралка, блендер).
    togglePower(itemId) {
      const item = store.state.items.find((i) => i.id === itemId);
      if (!item || !itemDef(item.def)?.power) return null;
      store.change((s) => { const i = s.items.find((i) => i.id === itemId); if (i.lit) delete i.lit; else i.lit = true; });
      return !!store.state.items.find((i) => i.id === itemId).lit;
    },

    // «По местам»: расставить комнату аккуратно. Вещи из стандартной расстановки встают
    // на свои места, остальное — на свободные места вдоль стены, мелочь — на мебель или пол.
    arrangeRoom(roomId) {
      const s0 = store.state, room = s0.rooms.find((r) => r.id === roomId);
      if (!room) return 0;
      const ref = defaultState(), refRoom = ref.rooms.find((r) => r.type === room.type);
      const spots = new Map(); // def → [{x,y}]
      if (refRoom) for (const i of ref.items) if (i.room === refRoom.id && !i.on && !i.inv) {
        if (!spots.has(i.def)) spots.set(i.def, []);
        spots.get(i.def).push({ x: (i.x * room.width) / refRoom.width, y: i.y });
      }
      let moved = 0;
      store.change((s) => {
        const mine = s.items.filter((i) => !i.inv && i.room === roomId && !i.on);
        // по очереди: стена → мебель → ковры → мелочь (мелочи нужна уже расставленная мебель)
        const order = (i) => { const d = itemDef(i.def); return d.place !== 'floor' ? 0 : d.layer ? 2 : isSmall(d) ? 3 : 1; };
        mine.sort((a, b) => order(a) - order(b) || a.x - b.x);
        for (const i of mine) { i.inv = true; } // временно «снять» всё, чтобы расставлять заново
        for (const i of mine) {
          delete i.inv;
          const free = spots.get(i.def)?.shift();
          const p = free && order(i) !== 3 ? { ...snapItem(i.def, room, free.x, free.y) } : freeSpot(s, i.def, room, i.x, i.id);
          if (!p) continue;
          i.x = p.x; i.y = p.y; if (p.on) i.on = { ...p.on }; else delete i.on;
          moved++; // syncChildren — в конце: пока мебель «снята», вещи на ней не должны падать
        }
        syncChildren(s);
      });
      return moved;
    },

    // Дать вещь герою. Одежда — надевается (вещь уходит «в шкаф»), остальное — в правую руку
    // (то, что было в руке, падает рядом). Возвращает 'wear' | 'hold' | null.
    give(itemId, charId, color = null) {
      const item = store.state.items.find((i) => i.id === itemId), c = store.state.chars.find((c) => c.id === charId);
      if (!item || !c?.look) return null;
      const wear = wearOf(item.def);
      if (wear) {
        store.change((s) => {
          const ch = s.chars.find((x) => x.id === charId), i = s.items.find((x) => x.id === itemId);
          const look = { ...ch.look, wear: { ...ch.look.wear } };
          delete look.wear[wear]; // надеть заново (с цветом этой вещи), а не снять
          ch.look = toggleWear(look, wear, color || WEAR_DEFAULT_COLOR[wear]);
          releaseChildren(s, itemId); delete i.room; delete i.x; delete i.y; delete i.on; delete i.held; delete i.bites; i.inv = true;
        }, { undo: false });
        return 'wear';
      }
      store.change((s) => {
        const ch = s.chars.find((x) => x.id === charId), i = s.items.find((x) => x.id === itemId);
        for (const o of s.items) if (o.held?.by === charId && o.id !== itemId) { // прежняя вещь — на пол рядом
          delete o.held;
          const room = s.rooms.find((r) => r.id === ch.room);
          const pos = room && landing(s, o.def, room, ch.x + 90, ch.y, o.id);
          if (pos) { o.x = pos.x; o.y = pos.y; if (pos.on) o.on = { ...pos.on }; } else { o.x = ch.x + 90; o.y = ch.y; }
        }
        releaseChildren(s, itemId);
        delete i.inv; delete i.on; i.held = { by: charId }; i.room = ch.room;
        syncChildren(s);
      }, { undo: false });
      return 'hold';
    },
    // Откусить (выпить глоток). После третьего раза вещь съедена — уходит «в шкаф», её можно взять снова.
    bite(itemId) {
      let eaten = false;
      store.change((s) => {
        const i = s.items.find((x) => x.id === itemId); if (!i) return;
        i.bites = (i.bites || 0) + 1;
        if (i.bites >= 3) { eaten = true; delete i.bites; delete i.held; delete i.room; delete i.x; delete i.y; i.inv = true; }
      });
      return eaten;
    },

    // Внешность героя (кожа, волосы, лицо, одежда) — с отменой и сохранением.
    setLook(charId, look) {
      store.change((s) => { const c = s.chars.find((c) => c.id === charId); if (c) c.look = look; });
    },
    toggleNight() { store.change((s) => { s.night = !s.night; }); },
  };
}
