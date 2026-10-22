// «Ум» животных: каждый раз — случайное дело на случайное время, поэтому животные не повторяются:
// побродить, пробежаться, сходить в гости в другую комнату, понюхать пол, повертеться, вздремнуть,
// гавкнуть, носиться туда-сюда, запрыгнуть на диван или кровать.
// По кнопке со своей мордочкой животное бежит в комнату, на которую сейчас смотрит игрок.
//
// Пока животное идёт, его место живёт только здесь (override): в сохранение не пишем каждый кадр.
// Пришло — место записывается в дом одним store.change (без отмены).
import { itemDef } from './catalog.js';
import { roomAtX } from './house.js';
import { floorTop, floorBottom, itemBounds } from './placement.js';
import { surfacesOf } from './physics.js';
import { clamp } from '../util.js';

const WALK = 130, RUN = 620;     // скорость шагом и бегом (единиц мира в секунду)
const now = () => performance.now() / 1000;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Дела и их «вес» (чем больше — тем чаще). Время каждого — случайное.
const ACTS = [
  ['wander', 26], ['trot', 9], ['visit', 11], ['far', 3], ['sniff', 12], ['turn', 9],
  ['nap', 7], ['bark', 7], ['zoomies', 5], ['hop', 7], ['rest', 10],
];
const TOTAL = ACTS.reduce((s, [, w]) => s + w, 0);
function chooseAct() { let r = Math.random() * TOTAL; for (const [a, w] of ACTS) { r -= w; if (r <= 0) return a; } return 'rest'; }

export function createPets({ store, camera, isPaused, onArrive, onAct, onWalk }) {
  // id вещи → { until, walk?, legs?: [следующие точки], pose?: 'sniff'|'nap', hop? }
  const st = new Map();

  const animals = () => store.state.items.filter((i) => !i.inv && !i.held && itemDef(i.def)?.animal && store.layout.byId.get(i.room));
  const worldX = (i) => store.layout.byId.get(i.room).x0 + i.x;
  const roomOf = (i) => store.layout.list.find((r) => r.room.id === i.room);
  const floorY = (room) => rnd(floorTop(room) + 50, floorBottom() - 8);

  // Точка в комнате r (мир): рядом с x или где угодно.
  const spotIn = (r, near = null, span = 650) => ({
    tx: near === null ? rnd(r.x0 + 150, r.x0 + r.room.width - 150) : clamp(near + rnd(-span, span), r.x0 + 90, r.x0 + r.room.width - 90),
    ty: floorY(r.room),
  });

  // Начать путь: точки по очереди (legs), скорость, бег?
  function go(i, legs, speed, extra = {}) {
    const ov = st.get(i.id)?.walk;
    let wx = ov ? ov.wx : worldX(i), y = ov ? ov.y : i.y;
    if (!ov && i.on) { const p = store.state.items.find((x) => x.id === i.on.id); y = p ? Math.min(floorBottom(), p.y + rnd(8, 30)) : floorBottom() - 20; } // спрыгивает с мебели
    const [first, ...rest] = legs;
    st.set(i.id, { until: 0, legs: rest, ...extra, walk: { wx, y, tx: first.tx, ty: first.ty, speed, phase: 0, dir: Math.sign(first.tx - wx) || 1, amp: 0, run: speed > WALK * 1.8 } });
    // Гостям: куда и как идёт (у них животное пройдёт тот же путь само, плавно).
    onWalk?.(i.id, { wx, y, legs: legs.map((l) => [Math.round(l.tx), Math.round(l.ty)]), speed: Math.round(speed) });
  }
  const rest = (id, a, b, extra = {}) => st.set(id, { until: now() + rnd(a, b), ...extra });

  // Новое дело.
  function act(i) {
    const r = roomOf(i), x = worldX(i), list = store.layout.list, k = list.indexOf(r);
    switch (chooseAct()) {
      case 'wander': return go(i, [spotIn(r, x)], WALK * rnd(0.7, 1.3));
      case 'trot': return go(i, [spotIn(r, x, 900)], WALK * rnd(2, 2.8));
      case 'visit': { const n = list[k + (Math.random() < 0.5 ? -1 : 1)] || r; return go(i, [spotIn(n)], WALK * rnd(0.9, 1.6)); }
      case 'far': return go(i, [spotIn(pick(list))], WALK * rnd(2.2, 3.2)); // в любую комнату, бегом
      case 'zoomies': { // носится туда-сюда
        const legs = []; let cx = x;
        for (let n = 0, m = 2 + Math.floor(Math.random() * 3); n < m; n++) { const p = spotIn(r, cx, 500); legs.push(p); cx = p.tx; }
        return go(i, legs, RUN * rnd(0.6, 0.85));
      }
      case 'hop': { // запрыгнуть на диван, кровать, кресло в этой комнате
        const spots = [];
        for (const p of store.state.items) {
          if (p.inv || p.on || p.room !== i.room || p.id === i.id) continue;
          for (const sf of surfacesOf(p)) {
            if (!sf.open || sf.inside || sf.x1 - sf.x0 < 90 || sf.bottom - sf.y > 300) continue; // не выше 300 — допрыгнет
            spots.push({ p, sf });
          }
        }
        if (!spots.length) return go(i, [spotIn(r, x)], WALK);
        const { p, sf } = pick(spots), half = itemBounds(i).w / 2, lx = rnd(sf.x0 + Math.min(half, (sf.x1 - sf.x0) / 2), sf.x1 - Math.min(half, (sf.x1 - sf.x0) / 2));
        return go(i, [{ tx: r.x0 + lx, ty: Math.min(floorBottom(), p.y + 12) }], WALK * rnd(1, 1.6), { hop: { id: p.id, s: sf.s, dx: lx - p.x, y: sf.y } });
      }
      case 'sniff': return rest(i.id, 2, 6, { pose: 'sniff' });
      case 'nap': return rest(i.id, 8, 28, { pose: 'nap' });
      case 'turn': store.change((s) => { const o = s.items.find((z) => z.id === i.id); if (o) { if (o.flip) delete o.flip; else o.flip = true; } }, { undo: false }); return rest(i.id, 1, 4);
      case 'bark': onAct?.(i.id, 'bark'); return rest(i.id, 1.5, 4);
      default: return rest(i.id, 3, 10);
    }
  }

  // Дошло до точки: следующая точка или записать место в дом.
  function arrive(id, s) {
    const w = s.walk;
    if (s.legs?.length) { const [n, ...more] = s.legs; s.legs = more; w.tx = n.tx; w.ty = n.ty; return; }
    const r = roomAtX(store.layout, w.wx);
    const hop = s.hop;
    store.change((st0) => {
      const i = st0.items.find((x) => x.id === id); if (!i || i.inv) return;
      i.room = r.room.id; i.x = clamp(w.wx - r.x0, 40, r.room.width - 40); i.y = w.y;
      delete i.on; delete i.held;
      const p = hop && st0.items.find((x) => x.id === hop.id && !x.inv && x.room === i.room);
      if (p) { i.on = { id: p.id, s: hop.s, dx: hop.dx }; i.y = hop.y; } // прыг — на диван
      if (w.dir < 0) i.flip = true; else delete i.flip;
    }, { undo: false });
    if (hop) onAct?.(id, 'hop');
    onWalk?.(id, null);
    rest(id, 2, 12);
    onArrive?.(id, w.called);
  }

  return {
    // Шаг «ума». Возвращает true, пока кто-то идёт (нужны кадры).
    tick(dt) {
      const paused = isPaused();
      let moving = false;
      const t = now(), alive = new Set();
      for (const i of animals()) {
        alive.add(i.id);
        let s = st.get(i.id);
        if (paused) { if (!s?.walk?.remote) continue; } // в гостях: животные идут только так, как у хозяина
        else if (s?.walk?.remote) { st.delete(i.id); s = null; }
        if (!s) { rest(i.id, 1, 6); continue; }
        if (!s.walk) {
          if (t < s.until) continue;
          // На мебели чаще остаётся полежать.
          if (i.on && Math.random() < 0.5) { rest(i.id, 5, 16, { pose: Math.random() < 0.5 ? 'nap' : undefined }); continue; }
          act(i);
          s = st.get(i.id);
          if (!s.walk) continue;
        }
        const w = s.walk, dx = w.tx - w.wx, dist = Math.hypot(dx, w.ty - w.y);
        const step = Math.min(dist, w.speed * dt);
        if (dist < 2) {
          if (!w.remote) { arrive(i.id, s); continue; }
          if (s.legs?.length) { const [n, ...more] = s.legs; s.legs = more; w.tx = n.tx; w.ty = n.ty; } else { st.delete(i.id); continue; } // дошло — дальше место пришлёт хозяин
        }
        w.wx += (dx / dist) * step; w.y += ((w.ty - w.y) / dist) * step;
        w.phase += step * (w.run ? 0.03 : 0.05);
        w.amp = Math.min(1, w.amp + dt * 4);
        if (Math.abs(dx) > 1) w.dir = Math.sign(dx);
        moving = true;
      }
      for (const id of st.keys()) if (!alive.has(id)) st.delete(id); // убрали в шкафчик и т. п.
      return moving;
    },
    // Пора кому-то за дело (для редких проверок, когда кадров нет).
    wantsFrame() {
      if (isPaused()) return [...st.values()].some((x) => x.walk?.remote);
      const t = now();
      for (const s of st.values()) if (s.walk || t >= s.until) return true;
      return st.size === 0 && animals().length > 0;
    },
    // Где животное сейчас (пока идёт) — для отрисовки и касаний.
    override(id) {
      const w = st.get(id)?.walk; if (!w) return null;
      const r = roomAtX(store.layout, w.wx);
      return { room: r.room.id, x: w.wx - r.x0, y: w.y, on: undefined, flip: w.dir < 0 };
    },
    // Животное у хозяина пошло (я в гостях): пройти тот же путь у себя. null — пришло.
    remoteWalk(id, w) {
      if (!w || !Array.isArray(w.legs) || !w.legs.length) { if (st.get(id)?.walk?.remote) st.delete(id); return; }
      const legs = w.legs.map(([tx, ty]) => ({ tx, ty })), [first, ...more] = legs;
      st.set(id, { until: 0, legs: more, walk: { wx: w.wx, y: w.y, tx: first.tx, ty: first.ty, speed: w.speed || WALK, phase: 0, dir: Math.sign(first.tx - w.wx) || 1, amp: 0, run: (w.speed || WALK) > WALK * 1.8, remote: true } });
    },
    walkOf(id) { const w = st.get(id)?.walk; return w ? { phase: w.phase, amp: w.amp, dir: w.dir } : null; },
    // Чем занято, стоя на месте: 'sniff' — нюхает, 'nap' — дремлет.
    poseOf(id) { const s = st.get(id); return !s || s.walk || now() >= s.until ? null : s.pose || null; },
    // Нажали, взяли пальцем — проснулось и отдыхает (место запишет само перетаскивание).
    stop(id) { rest(id, 3, 9); },
    // Позвали кнопкой: бежит в комнату, на которую смотрит игрок. Далеко — прибегает из-за края экрана.
    call(id) {
      const i = store.state.items.find((x) => x.id === id);
      if (!i || i.inv || !itemDef(i.def)?.animal) return false;
      if (i.held) store.change((s) => { const x = s.items.find((o) => o.id === id); if (x) delete x.held; }, { undo: false });
      const r = roomAtX(store.layout, camera.x + camera.viewW / 2);
      const view0 = camera.x, view1 = camera.x + camera.viewW;
      const tx = clamp(rnd(view0 + camera.viewW * 0.3, view1 - camera.viewW * 0.3), r.x0 + 90, r.x0 + r.room.width - 90);
      const ty = rnd(floorBottom() - 90, floorBottom() - 15); // поближе к игроку
      go(store.state.items.find((x) => x.id === id), [{ tx, ty }], RUN * rnd(0.9, 1.1));
      const w = st.get(id).walk;
      w.called = true;
      // Далеко и не видно — появляется у края экрана с той стороны, где было.
      if (w.wx < view0 - 200 || w.wx > view1 + 200) { w.wx = w.wx < view0 ? view0 - 120 : view1 + 120; w.y = ty; }
      w.dir = Math.sign(tx - w.wx) || 1;
      return true;
    },
    get list() { return animals(); },
  };
}
