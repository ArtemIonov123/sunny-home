// «Физика» в духе Toca Boca: вещь, отпущенная в воздухе, падает вниз —
// на ближайшую поверхность мебели (столешница, сиденье, полка) или на пол.
// Вещь на поверхности хранит ссылку на мебель: on = { id, s, dx } и едет вместе с ней.
import { itemDef, CHARS } from './catalog.js';
import { sizeOf } from '../assets.js';
import { itemBounds, floorTop, floorBottom, snapItem, heldSpot, hipDrop, HIP_Y, HERO_CANVAS_H } from './placement.js';
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

// Сиденья и кровати: seats у определения — [x0, x1, y, 1?] в долях картинки (y — где таз сидящего).
export function seatsOf(parent) {
  const def = itemDef(parent.def);
  if (!def?.seats || parent.inv) return [];
  const b = itemBounds(parent);
  return def.seats.map(([x0, x1, y, kind], s) => ({ s, x0: b.x + x0 * b.w, x1: b.x + x1 * b.w, y: b.y + y * b.h, bottom: b.y + b.h, lie: !!kind }));
}
function seatX(charId, sf, x) {
  if (sf.lie) return sf.x0; // кровать: x0 — где шея (край подушки), голова — левее, на подушке
  const pad = Math.min(CHARS[charId].h * 0.12, (sf.x1 - sf.x0) / 2);
  return clamp(x, sf.x0 + pad, sf.x1 - pad);
}
// Героя отпустили над диваном, креслом, кроватью — садится или ложится. Иначе null (встанет на пол).
export function seatLanding(state, charId, room, lx, ly) {
  if (!state.chars.find((c) => c.id === charId)?.look) return null; // кошка просто стоит
  const drop = (CHARS[charId].h * (HERO_CANVAS_H - HIP_Y)) / HERO_CANVAS_H;
  let best = null;
  for (const p of state.items) {
    if (p.inv || p.room !== room.id || p.on) continue;
    for (const sf of seatsOf(p)) {
      if (lx < sf.x0 - 10 || lx > sf.x1 + 10) continue;
      const hip = ly - drop; // где окажется таз, если отпустить здесь
      if (hip < sf.y - 150 || hip > sf.bottom + 30) continue;
      if (!best || Math.abs(sf.y - hip) < Math.abs(best.y - hip)) {
        const x = seatX(charId, sf, lx);
        best = { x, y: sf.y, seat: { id: p.id, s: sf.s, dx: x - p.x, ...(sf.lie ? { lie: true } : {}) } };
      }
    }
  }
  return best;
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
    const byId = new Map(state.items.map((i) => [i.id, i]));
    for (const p of state.items) {
      if (p.inv || p.id === selfId || p.room !== room.id) continue;
      // Можно класть и на вещь, которая сама стоит на мебели (блендер на тумбе), — но не глубже и не на свою же «дочку».
      if (p.on && (p.on.id === selfId || byId.get(p.on.id)?.on)) continue;
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
  // Герои на диване, в кресле, на кровати — едут вместе с мебелью; мебель убрали — встают на пол.
  for (const c of state.chars || []) {
    if (!c.seat) continue;
    const p = byId.get(c.seat.id), sf = p && !p.inv && !p.on ? seatsOf(p)[c.seat.s] : null;
    if (!sf || !c.look) { c.y = Math.min(floorBottom(), c.y + hipDrop(c) + 20); delete c.seat; continue; }
    c.room = p.room; c.x = seatX(c.id, sf, p.x + c.seat.dx); c.y = sf.y;
    if (sf.lie) c.seat.lie = true; else delete c.seat.lie;
  }
  // Вещи в руках героев — там, где ладошка; герой пропал — вещь падает на пол.
  for (const i of state.items) {
    if (!i.held) continue;
    const c = state.chars?.find((c) => c.id === i.held.by);
    if (!c || i.inv) { delete i.held; continue; }
    const p = heldSpot(c, i.def);
    i.room = c.room; i.x = p.x; i.y = p.y; delete i.on;
  }
  // Два прохода: сначала то, что стоит на мебели, потом то, что стоит на них (продукты в блендере на тумбе).
  for (const pass of [0, 1]) for (const c of state.items) {
    if (!c.on) continue;
    const p = byId.get(c.on.id);
    if (!!p?.on !== !!pass) continue;
    const grand = p?.on ? byId.get(p.on.id) : null;
    const sf = p && !p.inv && (!p.on || (grand && !grand.on)) ? surfacesOf(p)[c.on.s] : null;
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


// ── Свободное место: вещь не кладётся поверх других ──

function overlaps(a0, a1, list, gap) {
  return list.some(([b0, b1]) => a0 < b1 + gap && a1 > b0 - gap);
}

// Ближайшее к want место шириной w на отрезке [lo, hi], не задевающее занятые отрезки.
function slotNear(want, w, lo, hi, taken, gap = 16) {
  const half = w / 2;
  if (hi - lo < w) return null;
  const clampX = (x) => clamp(x, lo + half, hi - half);
  for (let d = 0; d <= hi - lo; d += 12) {
    for (const x of d ? [want + d, want - d] : [want]) {
      const cx = clampX(x);
      if (!overlaps(cx - half, cx + half, taken, gap)) return cx;
    }
  }
  return null;
}

// Куда поставить вещь, чтобы она не легла в кучу: мелкая — на свободное место
// на мебели или на полу спереди, мебель — вдоль стены, картина — на свободную стену.
export function freeSpot(state, defId, room, wantX, selfId = null) {
  const def = itemDef(defId);
  if (!def || !room) return null;
  const { w, h } = sizeOf(def);
  const here = state.items.filter((i) => !i.inv && i.room === room.id && i.id !== selfId);
  const span = (i) => { const b = itemBounds(i); return [b.x, b.x + b.w]; };

  if (def.place === 'wall' || def.place === 'doorway') {
    const p = snapItem(defId, room, wantX, def.place === 'wall' ? 250 : 0);
    if (!p) return null;
    const y0 = p.y - h / 2, y1 = p.y + h / 2;
    const taken = here.filter((i) => itemDef(i.def)?.place === def.place).filter((i) => {
      const b = itemBounds(i); return def.place === 'doorway' || (b.y < y1 && b.y + b.h > y0);
    }).map(span);
    const x = slotNear(p.x, w, 0, room.width, taken, 24);
    return x === null ? p : { x, y: p.y };
  }

  if (isSmall(def)) {
    // 1) свободное место на поверхностях мебели, ближайших к wantX
    const surfaces = [];
    for (const p of here) {
      if (p.on) continue;
      for (const sf of surfacesOf(p)) if (sf.open && !sf.inside) surfaces.push({ p, sf });
    }
    surfaces.sort((a, b) => Math.abs((a.sf.x0 + a.sf.x1) / 2 - wantX) - Math.abs((b.sf.x0 + b.sf.x1) / 2 - wantX));
    for (const { p, sf } of surfaces.slice(0, 6)) {
      const taken = here.filter((c) => c.on?.id === p.id && c.on.s === sf.s).map(span);
      const x = slotNear(clamp(wantX, sf.x0, sf.x1), w, sf.x0, sf.x1, taken, 8);
      if (x !== null) return { x, y: sf.y, on: { id: p.id, s: sf.s, dx: x - p.x } };
    }
    // 2) пол у переднего края
    const y = floorBottom() - 30;
    const taken = here.filter((i) => !i.on && isSmall(itemDef(i.def)) && Math.abs(i.y - y) < 80).map(span);
    const x = slotNear(wantX, w, 30, room.width - 30, taken, 10);
    return { x: x ?? clamp(wantX, 30, room.width - 30), y };
  }

  // Мебель: сначала ряд у стены, потом ряд ближе.
  const big = here.filter((i) => !i.on && itemDef(i.def)?.place === 'floor' && !isSmall(itemDef(i.def)) && !itemDef(i.def)?.layer);
  if (def.layer) { // ковёр — под мебелью, где-нибудь по центру свободного места
    return { x: clamp(wantX, w / 2, room.width - w / 2), y: Math.min(floorBottom(), floorTop(room) + 260) };
  }
  for (const y of [floorTop(room) + 85, floorTop(room) + 220]) {
    const taken = big.filter((i) => Math.abs(i.y - y) < 150).map(span);
    const x = slotNear(wantX, w, 20, room.width - 20, taken, 24);
    if (x !== null) return { x, y };
  }
  return { x: clamp(wantX, w / 2, room.width - w / 2), y: floorTop(room) + 85 };
}
