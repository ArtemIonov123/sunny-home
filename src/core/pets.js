// «Ум» животных: сами гуляют по дому — постоят, понюхают, пойдут в другое место или в соседнюю комнату.
// По кнопке со своей мордочкой животное бежит в комнату, на которую сейчас смотрит игрок.
//
// Пока животное идёт, его место живёт только здесь (override): в сохранение не пишем каждый кадр.
// Пришло — место записывается в дом одним store.change (без отмены).
import { itemDef } from './catalog.js';
import { roomAtX } from './house.js';
import { floorTop, floorBottom } from './placement.js';
import { clamp } from '../util.js';

const WALK = 130, RUN = 620;     // скорость шагом и бегом (единиц мира в секунду)
const now = () => performance.now() / 1000;
const rnd = (a, b) => a + Math.random() * (b - a);

export function createPets({ store, camera, isPaused, onArrive }) {
  const st = new Map(); // id вещи → { until, walk: { wx, y, tx, ty, speed, phase, dir, room } }

  const animals = () => store.state.items.filter((i) => !i.inv && !i.held && itemDef(i.def)?.animal && store.layout.byId.get(i.room));
  const worldX = (i) => store.layout.byId.get(i.room).x0 + i.x;

  // Куда пойти: чаще — по своей комнате, иногда — в соседнюю.
  function pickTarget(i) {
    const lay = store.layout, list = lay.list, k = list.findIndex((r) => r.room.id === i.room);
    let r = list[k];
    if (Math.random() < 0.25) { const n = list[k + (Math.random() < 0.5 ? -1 : 1)]; if (n) r = n; }
    const from = worldX(i);
    const tx = r === list[k] ? clamp(from + rnd(-650, 650), r.x0 + 90, r.x0 + r.room.width - 90) : rnd(r.x0 + 150, r.x0 + r.room.width - 150);
    return { tx, ty: rnd(floorTop(r.room) + 50, floorBottom() - 8) };
  }

  function start(i, t, speed) {
    const wx = worldX(i);
    // На мебели — спрыгивает на пол прямо под собой.
    const y = i.on ? floorBottom() - 20 : i.y;
    st.set(i.id, { until: 0, walk: { wx, y, tx: t.tx, ty: t.ty, speed, phase: 0, dir: Math.sign(t.tx - wx) || 1, amp: 0, run: speed > WALK * 2 } });
  }

  // Пришло: записать место в дом.
  function arrive(id, w) {
    const r = roomAtX(store.layout, w.wx);
    store.change((s) => {
      const i = s.items.find((x) => x.id === id); if (!i || i.inv) return;
      i.room = r.room.id; i.x = clamp(w.wx - r.x0, 40, r.room.width - 40); i.y = w.y;
      delete i.on; delete i.held;
      if (w.dir < 0) i.flip = true; else delete i.flip;
    }, { undo: false });
    st.set(id, { until: now() + rnd(4, 11) });
    onArrive?.(id, w.run);
  }

  return {
    // Шаг «ума». Возвращает true, пока кто-то идёт (нужны кадры).
    tick(dt) {
      if (isPaused()) return false;
      let moving = false;
      const t = now(), alive = new Set();
      for (const i of animals()) {
        alive.add(i.id);
        let s = st.get(i.id);
        if (!s) { s = { until: t + rnd(1.5, 6) }; st.set(i.id, s); }
        if (!s.walk) {
          if (t < s.until || i.on) { if (i.on && t >= s.until) s.until = t + rnd(6, 14); continue; } // на диване любит полежать подольше
          start(i, pickTarget(i), WALK * rnd(0.85, 1.2));
          s = st.get(i.id);
        }
        const w = s.walk, dx = w.tx - w.wx, dist = Math.hypot(dx, w.ty - w.y);
        const step = Math.min(dist, w.speed * dt);
        if (dist < 2) { arrive(i.id, w); continue; }
        w.wx += (dx / dist) * step; w.y += ((w.ty - w.y) / dist) * step;
        w.phase += step * (w.run ? 0.03 : 0.05);
        w.amp = Math.min(1, w.amp + dt * 4);
        if (Math.abs(dx) > 1) w.dir = Math.sign(dx);
        moving = true;
      }
      for (const id of st.keys()) if (!alive.has(id)) st.delete(id); // убрали в шкафчик и т. п.
      return moving;
    },
    // Пора кому-то пойти (для редких проверок, когда кадров нет).
    wantsFrame() {
      if (isPaused()) return false;
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
    walkOf(id) { const w = st.get(id)?.walk; return w ? { phase: w.phase, amp: w.amp, dir: w.dir } : null; },
    // Взяли пальцем — «ум» отдыхает (место запишет само перетаскивание).
    stop(id) { st.set(id, { until: now() + rnd(5, 10) }); },
    // Позвали кнопкой: бежит в комнату, на которую смотрит игрок. Далеко — прибегает из-за края экрана.
    call(id) {
      const i = store.state.items.find((x) => x.id === id);
      if (!i || i.inv || !itemDef(i.def)?.animal) return false;
      if (i.held) store.change((s) => { const x = s.items.find((o) => o.id === id); if (x) delete x.held; }, { undo: false });
      const r = roomAtX(store.layout, camera.x + camera.viewW / 2);
      const view0 = camera.x, view1 = camera.x + camera.viewW;
      const tx = clamp(rnd(view0 + camera.viewW * 0.3, view1 - camera.viewW * 0.3), r.x0 + 90, r.x0 + r.room.width - 90);
      const ty = rnd(floorBottom() - 90, floorBottom() - 15); // поближе к игроку
      const cur = st.get(id)?.walk;
      const fresh = store.state.items.find((x) => x.id === id);
      start(fresh, { tx, ty }, RUN);
      const w = st.get(id).walk;
      if (cur) { w.wx = cur.wx; w.y = cur.y; }
      // Далеко и не видно — появляется у края экрана с той стороны, где было.
      if (w.wx < view0 - 200 || w.wx > view1 + 200) { w.wx = w.wx < view0 ? view0 - 120 : view1 + 120; w.y = ty; }
      w.dir = Math.sign(tx - w.wx) || 1;
      return true;
    },
    get list() { return animals(); },
  };
}
