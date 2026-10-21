// «Физика» в духе Toca Boca: вещь, отпущенная в воздухе, падает вниз —
// на ближайшую поверхность мебели (столешница, сиденье, полка) или на пол.
// Вещь на поверхности хранит ссылку на мебель: on = { id, s, dx } и едет вместе с ней.
import { itemDef } from './catalog.js';
import { sizeOf } from '../assets.js';
import { itemBounds, floorTop, floorBottom, snapItem } from './placement.js';
import { clamp } from '../util.js';

const SMALL = 230;          // вещи не больше этого размера можно ставить на мебель
const CATCH_ABOVE = 70;     // поверхность «ловит» вещь, отпущенную чуть ниже её края
const BACK_OF_FLOOR = 28;   // куда падает вещь, отпущенная над стеной: самый дальний край пола

export function isSmall(def) {
  if (!def || def.place !== 'floor') return false;
  if (def.small !== undefined) return def.small;
  const { w, h } = sizeOf(def);
  return Math.max(w, h) <= SMALL;
}

// Поверхности мебели в координатах комнаты.
export function surfacesOf(parent) {
  const def = itemDef(parent.def);
  if (!def?.surfaces || parent.inv) return [];
  const b = itemBounds(parent);
  return def.surfaces.map(([x0, x1, y, inside], s) => ({
    s, x0: b.x + x0 * b.w, x1: b.x + x1 * b.w, y: b.y + y * b.h, bottom: b.y + b.h,
    inside: !!inside, open: !inside || !!parent.open, // внутренняя полка доступна, только если открыто
  }));
}

// Куда приземлится вещь defId, отпущенная в точке (lx, ly) комнаты room.
// Возвращает { x, y, on } или null (в этой комнате вещь стоять не может).
export function landing(state, defId, room, lx, ly, selfId = null) {
  const def = itemDef(defId);
  if (!def || !room) return null;
  if (def.place !== 'floor') return snapItem(defId, room, lx, ly);
  const floorY = ly >= floorTop(room) ? Math.min(ly, floorBottom()) : floorTop(room) + BACK_OF_FLOOR;
  let best = null;
  if (isSmall(def)) {
    const { w } = sizeOf(def);
    for (const p of state.items) {
      if (p.inv || p.on || p.id === selfId || p.room !== room.id) continue;
      for (const sf of surfacesOf(p)) {
        if (!sf.open) continue;
        if (lx < sf.x0 - 20 || lx > sf.x1 + 20) continue;      // мимо поверхности
        if (sf.y < ly - CATCH_ABOVE || ly > sf.bottom) continue; // поверхность выше точки или отпустили ниже мебели
        if (!best || sf.y < best.y) {
          const half = Math.min(w / 2, (sf.x1 - sf.x0) / 2);
          best = { x: clamp(lx, sf.x0 + half, sf.x1 - half), y: sf.y, on: { id: p.id, s: sf.s, dx: 0 }, parent: p };
        }
      }
    }
  }
  if (best && best.y < floorY + 1) {
    best.on.dx = best.x - best.parent.x;
    delete best.parent;
    return best;
  }
  return { x: clamp(lx, 30, room.width - 30), y: floorY };
}

// Подтянуть вещи, стоящие на мебели, к их мебели (после переноса мебели, загрузки и т. п.).
export function syncChildren(state) {
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const rooms = new Map(state.rooms.map((r) => [r.id, r]));
  for (const c of state.items) {
    if (!c.on) continue;
    const p = byId.get(c.on.id);
    const sf = p && !p.inv && !p.on ? surfacesOf(p)[c.on.s] : null;
    if (!sf) { dropToFloor(c, rooms.get(c.room)); continue; }
    const half = Math.min(sizeOf(itemDef(c.def)).w / 2, (sf.x1 - sf.x0) / 2);
    c.room = p.room;
    c.x = clamp(p.x + c.on.dx, sf.x0 + half, sf.x1 - half);
    c.y = sf.y;
  }
}

// Мебель убрали — вещи с неё падают на пол в том же месте.
export function dropToFloor(c, room) {
  delete c.on;
  if (c.inv || !room) return;
  c.y = Math.max(c.y + 60, floorTop(room) + BACK_OF_FLOOR);
  c.y = Math.min(c.y, floorBottom());
}

export function releaseChildren(state, parentId) {
  const rooms = new Map(state.rooms.map((r) => [r.id, r]));
  for (const c of state.items) if (c.on?.id === parentId) dropToFloor(c, rooms.get(c.room));
}

// Вещь лежит внутри закрытой мебели (холодильник закрыт) — её не видно и не взять.
export function isHidden(item, parentOf) {
  if (!item.on) return false;
  const p = parentOf(item.on.id);
  const def = p && itemDef(p.def);
  return !!(def?.surfaces?.[item.on.s]?.[3] && !p.open);
}

// Глубина вещи на мебели: сразу перед своей мебелью.
export function childDepth(parent, child) {
  return parent.y + 0.5 + child.on.s * 0.01;
}

