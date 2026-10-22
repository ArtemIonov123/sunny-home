// «Ум» животных: каждый раз — случайное дело на случайное время, поэтому животные не повторяются:
// побродить, пробежаться, сходить в гости в другую комнату, понюхать пол, повертеться, вздремнуть,
// гавкнуть, носиться туда-сюда, запрыгнуть на диван или кровать.
// По кнопке со своей мордочкой животное бежит в комнату, на которую сейчас смотрит игрок.
//
// Вещи для животных (def.pet): миска с кормом — бежит есть; мячик и мышку (брошенные игроком) — приносит
// к герою; косточку — грызёт (лучше на лежанке); вздремнуть — на лежанку, если есть.
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
  ['nap', 7], ['bark', 7], ['zoomies', 5], ['hop', 7], ['rest', 10], ['play', 6],
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

  // ── Вещи для животных ──
  const things = (kind) => store.state.items.filter((i) => !i.inv && !i.held && itemDef(i.def)?.pet === kind && store.layout.byId.get(i.room));
  const carrierOf = (toyId) => { for (const [id, s] of st) if (s.carry === toyId) return id; return null; };
  const nearest = (list, wx) => list.sort((a, b) => Math.abs(worldX(a) - wx) - Math.abs(worldX(b) - wx))[0] || null;
  // Встать так, чтобы морда была у вещи t (подойти с той стороны, где стоит).
  function toThing(i, t) {
    const side = Math.sign(worldX(i) - worldX(t)) || 1, w = itemBounds(i).w;
    return { tx: worldX(t) + side * w * 0.36, ty: Math.min(floorBottom(), t.y + 2) };
  }
  // Где сейчас морда животного (мир) и куда оно смотрит.
  function mouth(i) {
    const w = st.get(i.id)?.walk, b = itemBounds(i);
    const wx = w ? w.wx : worldX(i), y = w ? w.y : i.y, dir = w ? w.dir : i.flip ? -1 : 1;
    return { wx: wx + dir * b.w * 0.4, y, lift: b.h * 0.3, dir };
  }
  // Положить вещь из пасти на пол.
  function drop(i, toyId) {
    const m = mouth(i), r = roomAtX(store.layout, m.wx);
    store.change((s) => { const t = s.items.find((x) => x.id === toyId); if (!t) return; delete t.inv; delete t.on; delete t.held; t.room = r.room.id; t.x = clamp(m.wx - r.x0, 40, r.room.width - 40); t.y = clamp(m.y + 4, floorTop(r.room) + 10, floorBottom()); }, { undo: false });
    onAct?.(i.id, 'drop', toyId);
  }
  function goEat(i, bowl) { go(i, [toThing(i, bowl)], WALK * rnd(2, 2.6), { task: { kind: 'eat', id: bowl.id } }); }
  function goFetch(i, toy, kind) { go(i, [toThing(i, toy)], RUN * rnd(0.7, 0.85), { task: { kind, id: toy.id } }); }
  // На лежанку: запрыгнуть на неё (как на диван) и сделать там дело.
  function goBed(i, bed, task, carry) {
    const sf = surfacesOf(bed)[0], r = store.layout.byId.get(bed.room);
    if (!sf || !r) return false;
    const lx = (sf.x0 + sf.x1) / 2 + rnd(-10, 10);
    go(i, [{ tx: r.x0 + lx, ty: Math.min(floorBottom(), bed.y + 12) }], WALK * rnd(1.4, 2), { hop: { id: bed.id, s: sf.s, dx: lx - bed.x, y: sf.y }, task, carry });
    return true;
  }
  // Куда нести игрушку: к герою в комнате, на которую смотрит игрок (или просто в середину экрана).
  function bringSpot(i) {
    const cx = camera.x + camera.viewW / 2, r = roomAtX(store.layout, cx);
    const heroes = store.state.chars.filter((c) => c.room === r.room.id && !c.seat);
    const h = heroes.sort((a, b) => Math.abs(r.x0 + a.x - cx) - Math.abs(r.x0 + b.x - cx))[0];
    const side = Math.sign(mouth(i).wx - (h ? r.x0 + h.x : cx)) || 1;
    if (h) return { tx: clamp(r.x0 + h.x + side * 110, r.x0 + 90, r.x0 + r.room.width - 90), ty: Math.min(floorBottom(), h.y + 6) };
    return { tx: clamp(cx + rnd(-150, 150), r.x0 + 90, r.x0 + r.room.width - 90), ty: rnd(floorBottom() - 80, floorBottom() - 10) };
  }
  // Пришло туда, куда шло по делу.
  function task(i, s) {
    const tk = s.task; if (!tk) return false;
    const t = store.state.items.find((x) => x.id === tk.id && !x.inv);
    if (tk.kind === 'eat') {
      if (!t?.full) return false;
      faceTo(i.id, worldX(t));
      rest(i.id, 3, 4.5, { pose: 'eat', done: () => {
        store.change((s0) => { const b = s0.items.find((x) => x.id === t.id); if (b) delete b.full; }, { undo: false });
        onAct?.(i.id, 'happy');
      } });
      onAct?.(i.id, 'eat');
      return true;
    }
    if (tk.kind === 'fetch' || tk.kind === 'chew') { // добежало до игрушки — берёт в пасть
      if (!t || t.on || carrierOf(t.id)) return false;
      onAct?.(i.id, 'grab', t.id);
      const bed = tk.kind === 'chew' && nearest(things('bed').filter((b) => b.room === i.room), worldX(i));
      if (tk.kind === 'chew' && bed && goBed(i, bed, { kind: 'chewing' }, t.id)) return true;
      if (tk.kind === 'chew') { rest(i.id, 5, 9, { pose: 'chew', carry: t.id, done: () => drop(i, t.id) }); return true; }
      go(i, [bringSpot(i)], RUN * rnd(0.6, 0.75), { task: { kind: 'bring' }, carry: t.id });
      return true;
    }
    if (tk.kind === 'bring') { const c = s.carry; drop(i, c); onAct?.(i.id, 'happy'); rest(i.id, 2, 5); return true; }
    if (tk.kind === 'chewing') { const c = s.carry; rest(i.id, 6, 10, { pose: 'chew', carry: c, done: () => drop(i, c) }); return true; }
    if (tk.kind === 'nap') { rest(i.id, 12, 30, { pose: 'nap' }); return true; }
    return false;
  }
  function faceTo(id, wx) {
    store.change((s) => { const o = s.items.find((z) => z.id === id); const r = o && store.layout.byId.get(o.room); if (!r) return; if (wx < r.x0 + o.x) o.flip = true; else delete o.flip; }, { undo: false });
  }

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
      case 'nap': { // есть лежанка — идёт спать на неё
        const bed = Math.random() < 0.7 && nearest(things('bed'), x);
        if (bed && goBed(i, bed, { kind: 'nap' })) return;
        return rest(i.id, 8, 28, { pose: 'nap' });
      }
      case 'play': { // игрушка лежит на полу в этой комнате — приносит её
        const toy = nearest([...things('fetch'), ...things('chew')].filter((t) => t.room === i.room && !t.on && !carrierOf(t.id)), x);
        if (toy) return goFetch(i, toy, itemDef(toy.def).pet === 'chew' ? 'chew' : 'fetch');
        return go(i, [spotIn(r, x)], WALK);
      }
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
    const i = store.state.items.find((x) => x.id === id);
    if (!(i && task(i, s))) { rest(id, 2, 12); if (s.carry) drop(i, s.carry); }
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
          if (s.done) { const f = s.done; delete s.done; delete s.carry; f(); rest(i.id, 1, 4); continue; }
          // В миске корм — бежит есть.
          const bowl = Math.random() < 0.8 && nearest(things('bowl').filter((b) => b.full), worldX(i));
          if (bowl) { goEat(i, bowl); s = st.get(i.id); }
          else {
          // На мебели чаще остаётся полежать.
          if (i.on && Math.random() < 0.5) { rest(i.id, 5, 16, { pose: Math.random() < 0.5 ? 'nap' : undefined }); continue; }
          act(i);
          s = st.get(i.id);
          }
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
      const c = this.carried(id); if (c) return c;
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
    stop(id) { const s = st.get(id), i = store.state.items.find((x) => x.id === id); if (s?.carry && i) drop(i, s.carry); rest(id, 3, 9); },
    // Игрушку взяли пальцем прямо из пасти — животное её отпускает.
    release(toyId) { const id = carrierOf(toyId); if (id !== null) rest(id, 2, 5); },
    // Игрок бросил игрушку/косточку на пол — ближайшее животное бежит за ней. Насыпал корм — бегут есть.
    fetch(toyId) {
      if (isPaused()) return false;
      const toy = store.state.items.find((x) => x.id === toyId && !x.inv && !x.on);
      const kind = toy && itemDef(toy.def)?.pet; if (kind !== 'fetch' && kind !== 'chew') return false;
      const free = animals().filter((a) => !st.get(a.id)?.carry && !st.get(a.id)?.task);
      const a = nearest(free.filter((x) => x.room === toy.room).length ? free.filter((x) => x.room === toy.room) : free, worldX(toy));
      if (!a) return false;
      goFetch(a, toy, kind); return true;
    },
    callToBowl(bowlId) {
      if (isPaused()) return;
      const bowl = store.state.items.find((x) => x.id === bowlId && x.full); if (!bowl) return;
      for (const a of animals()) if (!st.get(a.id)?.carry && st.get(a.id)?.task?.kind !== 'eat') { goEat(a, bowl); break; }
    },
    // Игрушка в пасти: где её рисовать (поверх морды).
    carried(toyId) {
      const id = carrierOf(toyId); if (id === null) return null;
      const i = store.state.items.find((x) => x.id === id && !x.inv); if (!i) return null;
      const m = mouth(i), r = roomAtX(store.layout, m.wx), w = st.get(id)?.walk;
      const lift = m.lift + (w ? Math.abs(Math.sin(w.phase * Math.PI)) * 6 * w.amp : 0);
      const p = !w && i.on && store.state.items.find((x) => x.id === i.on.id); // на лежанке: рисовать перед ней
      const y = p ? p.y + 1 : m.y + 3;
      return { room: r.room.id, x: m.wx - r.x0, y, lift: lift + (y - m.y - 3), on: undefined };
    },
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
