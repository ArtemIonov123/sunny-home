// Касания и мышь.
//   коснулся вещи или героя → тащишь её (сразу, без задержки);
//   коснулся пустого места и повёл → листаешь дом (после сдвига PAN_THRESHOLD);
//   коснулся и отпустил → нажатие.
// Пока вещь у края экрана, камера едет. Позиция вещи пересчитывается КАЖДЫЙ кадр
// из пальца и камеры — поэтому вещь не отстаёт и не прыгает.
// Отпущенная вещь падает на ближайшую поверхность (physics.js); вещи с мебели едут вместе с ней.
import { EDGE_ZONE, EDGE_SPEED, PAN_THRESHOLD } from '../config.js';
import { itemDef, CHARS } from '../core/catalog.js';
import { roomAtX } from '../core/house.js';
import { snapChar, itemBounds, charBounds, charHitBox, hipDrop } from '../core/placement.js';
import { landing, seatLanding, syncChildren, releaseChildren, isSmall } from '../core/physics.js';
import { mode } from '../ui/mode.js';
import { anims } from '../render/anims.js';
import { play } from '../audio.js';
import { sizeOf } from '../assets.js';
import { emitter, clamp } from '../util.js';

export function createInteraction({ canvas, viewport, camera, renderer, store, isOverStash }) {
  const events = emitter();
  let g = null; // текущий жест
  let visit = null; // в гостях (net/visit.js)

  const world = (p) => ({ x: camera.x + p.x, y: p.y });

  function down(e) {
    if (g || e.button > 0) return;
    e.preventDefault();
    const p = viewport.toScreen(e.clientX, e.clientY), w = world(p);
    const hit = renderer.hit(w.x, w.y);
    // В игре мебель не двигается: касание мебели — это нажатие или листание дома.
    // Чужого героя-гостя не утащить (его ведёт свой игрок); своего — можно.
    const movable = hit && (mode.design ? hit.kind === 'item' : (hit.kind === 'char' && (!hit.obj.visitor || hit.obj.own)) || (hit.kind === 'item' && isSmall(itemDef(hit.obj.def))));
    if (hit && movable) {
      const r = store.layout.byId.get(hit.obj.room);
      store.checkpoint();
      g = {
        kind: hit.kind, id: hit.obj.id, obj: hit.obj, art: hit.art, pointer: e.pointerId,
        start: p, last: p, moved: false,
        dx: r.x0 + hit.obj.x - w.x, dy: hit.obj.y + (hit.kind === 'char' ? hipDrop(hit.obj) : 0) - w.y, // героя держим за то же место, сидит он или стоит
        clientX: e.clientX, clientY: e.clientY,
        from: { ...hit.b }, vx: 0, tilt: 0,
      };
      update();
      play('pick');
      events.emit('dragstart', g);
    } else {
      g = { kind: 'pending', pointer: e.pointerId, start: p, last: p, camStart: camera.x, samples: [{ x: p.x, t: performance.now() }], tapOn: hit };
    }
    canvas.setPointerCapture?.(e.pointerId);
    events.emit('frame');
  }

  function move(e) {
    if (!g || g.pointer !== e.pointerId) return;
    e.preventDefault();
    const p = viewport.toScreen(e.clientX, e.clientY);
    g.last = p; g.clientX = e.clientX; g.clientY = e.clientY;
    const dist = Math.hypot(p.x - g.start.x, p.y - g.start.y);
    if (g.kind === 'pending' && dist > PAN_THRESHOLD) g.kind = 'pan';
    if (g.kind === 'pan') {
      camera.holdAt(g.camStart - (p.x - g.start.x));
      g.samples.push({ x: p.x, t: performance.now() });
      if (g.samples.length > 6) g.samples.shift();
    } else if (g.kind !== 'pending') {
      if (dist > 6) g.moved = true;
      update();
      if (g.kind === 'item') events.emit('stash', isOverStash(e.clientX, e.clientY));
    }
    events.emit('frame');
  }

  // Идёт ли сам (герой, животное): у пола и медленно — да; быстро или поднял — болтается в руке.
  function walkStep(ground, step) {
    const sp = Math.abs(g.speed);
    if (g.walk) { if (!ground || sp > 1100) g.walk = null; }
    else if (ground && sp < 650) g.walk = { phase: 0, dir: g.obj?.flip ? -1 : 1 };
    if (!g.walk) return false;
    const ph0 = g.walk.phase;
    g.walk.phase += Math.abs(step) * 0.05;  // шаги — по пройденному пути: медленнее ведёшь — медленнее шагает
    if (Math.floor(g.walk.phase / Math.PI) !== Math.floor(ph0 / Math.PI) && g.walk.amp > 0.3) play('step'); // топ-топ
    if (sp > 20) g.walk.dir = Math.sign(g.speed);
    g.walk.amp = g.walk.amp === undefined ? 0 : g.walk.amp * 0.85 + Math.min(1, sp / 70) * 0.15; // плавно начинает и заканчивает
    g.tilt = 0;
    return true;
  }

  // Где окажется вещь, если отпустить её сейчас.
  function update() {
    const w = world(g.last), ax = w.x + g.dx, ay = w.y + g.dy;
    const r = roomAtX(store.layout, ax);
    const lx = ax - r.x0;
    // Наклон при переноске — вещь «болтается» в сторону движения.
    const now = performance.now(), dt = Math.min(0.1, Math.max(0.004, (now - (g.prevT || now - 16)) / 1000));
    const step = g.prevAx !== undefined ? ax - g.prevAx : 0;
    g.speed = (g.speed || 0) * 0.92 + (step / dt) * 0.08; // скорость пальца по горизонтали, единиц мира в секунду
    g.prevT = now;
    if (g.prevAx !== undefined) g.vx = g.vx * 0.75 + step * 0.25;
    g.prevAx = ax;
    g.tilt = clamp((g.vx || 0) * 0.012, -0.32, 0.32);
    g.ax = ax; g.ay = ay;
    if (g.kind === 'item') {
      const pos = landing(store.state, g.obj.def, r.room, lx, ay, g.id);
      g.target = { r, pos };
      g.valid = !!pos;
      // Животное: медленно ведёшь у пола — идёт само (как герой).
      if (itemDef(g.obj.def)?.animal && pos && walkStep(!pos.on && Math.abs(ay - pos.y) < 90, step)) {
        g.hero = null;
        g.b = itemBounds({ def: g.obj.def, x: ax, y: pos.y });
        return;
      }
      // Мелочь поднесли к герою — он её возьмёт (одежду — наденет).
      g.hero = isSmall(itemDef(g.obj.def)) ? heroAt(ax, ay - sizeOf(itemDef(g.obj.def)).h / 2) : null;
      if (g.hero) g.valid = true;
      // Вещь идёт за пальцем; на стене/проёме сразу показываем, куда она встанет.
      const show = pos && itemDef(g.obj.def).place !== 'floor' ? { x: r.x0 + pos.x, y: pos.y } : { x: ax, y: ay };
      g.b = itemBounds({ def: g.obj.def, x: show.x, y: show.y });
    } else {
      // Над диваном, креслом, кроватью — сядет или ляжет; иначе встанет на пол.
      const pos = seatLanding(store.state, g.obj.id, r.room, lx, ay) || snapChar(r.room, lx, ay);
      g.target = { r, pos }; g.valid = true;
      // Медленно ведёшь у пола — герой идёт сам (ноги шагают по полу); быстро или поднял выше — болтается в руке.
      if (walkStep(!pos.seat && Math.abs(ay - pos.y) < 110 && !!g.obj.look, step)) {
        g.b = charBounds({ id: g.obj.id, x: ax, y: pos.y });
        return;
      }
      g.b = charBounds({ id: g.obj.id, x: ax, y: Math.min(ay, pos.y + (pos.seat ? hipDrop({ id: g.obj.id, seat: pos.seat }) : 0) + 40) });
    }
  }

  function finish(e, cancel = false) {
    if (!g || g.pointer !== e.pointerId) return;
    const d = g; g = null;
    events.emit('stash', false);
    if (d.fromInventory) finishFromInventory(d, cancel);
    else if (d.kind === 'pending') { if (d.tapOn) events.emit('tap', { kind: d.tapOn.kind, id: d.tapOn.obj.id }); else events.emit('tapEmpty', d.last); }
    else if (d.kind === 'pan') {
      const a = d.samples[0], b = d.samples[d.samples.length - 1], dt = (b.t - a.t) / 1000;
      camera.release(dt > 0.01 ? -(b.x - a.x) / dt : 0);
    } else if (cancel) {
      store.undo(); // вернуть как было до начала перетаскивания
    } else if (!d.moved) {
      store.dropCheckpoint();
      events.emit('tap', { kind: d.kind, id: d.id });
    } else if (d.kind === 'item' && isOverStash(d.clientX, d.clientY)) {
      const kids = store.state.items.filter((c) => c.on?.id === d.id).map((c) => ({ id: c.id, y: c.y }));
      store.change((s) => {
        releaseChildren(s, d.id); // вещи с мебели падают на пол, а не исчезают с ней
        const i = s.items.find((i) => i.id === d.id);
        if (i) { delete i.room; delete i.x; delete i.y; delete i.on; delete i.held; delete i.bites; i.inv = true; }
      }, { undo: false });
      animateFallen(kids);
      play('stash');
      events.emit('stashed', itemDef(d.obj.def).name);
    } else if (d.kind === 'item' && d.hero) {
      events.emit('give', { itemId: d.id, charId: d.hero });
    } else if (!d.valid) {
      store.dropCheckpoint();
      anims.back('item:' + d.id, d.b.x - d.from.x, d.b.y - d.from.y); // некуда — возвращается на место
      play('nope');
      events.emit('invalid', itemDef(d.obj.def).name);
    } else {
      place(d);
    }
    events.emit('dragend');
    events.emit('frame');
  }

  // Вещь вытащили пальцем из шкафчика (панель справа) — дальше её ведёт сцена.
  function startFromInventory(e, itemId) {
    if (g) return false;
    const item = store.state.items.find((i) => i.id === itemId && i.inv);
    if (!item) return false;
    const def = itemDef(item.def), { h } = sizeOf(def);
    const p = viewport.toScreen(e.clientX, e.clientY);
    store.checkpoint();
    g = {
      kind: 'item', id: item.id, obj: item, art: def.art, pointer: e.pointerId, fromInventory: true,
      start: p, last: p, moved: true, clientX: e.clientX, clientY: e.clientY,
      dx: 0, dy: def.anchor === 'center' ? 0 : h / 2, // палец держит середину вещи
      vx: 0, tilt: 0,
    };
    g.from = null;
    play('pick');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* указатель уже отпущен */ }
    update();
    events.emit('dragstart', g);
    events.emit('frame');
    return true;
  }

  // Герой под точкой (только те, у кого есть внешность — их можно одевать и давать им вещи).
  function heroAt(wx, wy) {
    if (mode.design) return null;
    for (const c of store.state.chars) {
      if (!c.look) continue;
      const r = store.layout.byId.get(c.room); if (!r) continue;
      const b = charHitBox(c), x = b.x + r.x0;
      if (wx >= x + b.w * 0.12 && wx <= x + b.w * 0.88 && wy >= b.y + b.h * 0.08 && wy <= b.y + b.h) return c.id;
    }
    return null;
  }

  function finishFromInventory(d, cancel) {
    const name = itemDef(d.obj.def).name;
    if (cancel || isOverStash(d.clientX, d.clientY)) { store.dropCheckpoint(); return; }
    if (d.hero) { events.emit('give', { itemId: d.id, charId: d.hero }); return; }
    if (!d.valid) { store.dropCheckpoint(); play('nope'); events.emit('invalid', name); return; }
    place(d);
  }

  // Положить вещь или героя туда, куда указывает d.target, и показать падение.
  function place(d) {
    const { r, pos } = d.target;
    const isItem = d.kind === 'item';
    if (d.obj?.visitor) { // свой герой в гостях: место знает «в гости», а не дом
      store.dropCheckpoint();
      visit?.moveSelf(r.room.id, pos.x, pos.y);
      const fy0 = Math.min(0, d.b.y + d.b.h - pos.y);
      anims.fall('char:' + d.id, fy0, 0); play(fy0 < -12 ? 'land' : 'drop');
      return;
    }
    store.change((s) => {
      const o = (isItem ? s.items : s.chars).find((o) => o.id === d.id);
      if (!o) return;
      delete o.inv; o.room = r.room.id; o.x = pos.x; o.y = pos.y;
      if (isItem) { delete o.held; delete o.bites; if (pos.on) o.on = { ...pos.on }; else delete o.on; }
      if (isItem && d.walk) { if (d.walk.dir < 0) o.flip = true; else delete o.flip; } // животное смотрит туда, куда шло
      else if (pos.seat) o.seat = { ...pos.seat }; else delete o.seat;
      syncChildren(s); // и вещи в руках героя переезжают вместе с ним
    }, { undo: false });
    // Анимация: от того места, где отпустили, до места приземления.
    const fx = (d.ax ?? r.x0 + pos.x) - (r.x0 + pos.x);
    const landY = isItem ? pos.y : pos.y + (pos.seat ? hipDrop({ id: d.id, seat: pos.seat }) : 0); // низ героя после приземления
    const fy = isItem && itemDef(d.obj.def).place !== 'floor' ? 0 : Math.min(0, (d.kind === 'char' ? d.b.y + d.b.h : d.ay) - landY);
    anims.fall((isItem ? 'item:' : 'char:') + d.id, fy, isItem ? fx : 0);
    if (fy < -12) setTimeout(() => play('land'), 120); else play('drop');
    if (isItem) events.emit('placed', { id: d.id }); // для животных: бросили мячик, поставили корм к миске
  }

  function animateFallen(kids) {
    for (const k of kids) {
      const c = store.state.items.find((i) => i.id === k.id);
      if (c && !c.inv) anims.fall('item:' + c.id, Math.min(0, k.y - c.y));
    }
  }

  // Вызывается каждый кадр. Возвращает true, если нужен следующий кадр.
  function frame(dt) {
    if (!g || g.kind === 'pending' || g.kind === 'pan') return !!g;
    const x = g.last.x, view = camera.viewW;
    let speed = 0;
    if (x < EDGE_ZONE) speed = -EDGE_SPEED * (1 - x / EDGE_ZONE);
    else if (x > view - EDGE_ZONE) speed = EDGE_SPEED * (1 - (view - x) / EDGE_ZONE);
    if (speed) { camera.nudge(speed * dt); g.moved = true; }
    update();
    return true;
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', (e) => finish(e));
  canvas.addEventListener('pointercancel', (e) => finish(e, true));
  canvas.addEventListener('lostpointercapture', (e) => { if (g && g.pointer === e.pointerId) finish(e); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    on: events.on, frame, startFromInventory,
    setVisit(v) { visit = v; },
    get drag() { return g && g.kind !== 'pending' && g.kind !== 'pan' ? g : null; },
    get active() { return !!g; },
    name: (kind, id) => (kind === 'char' ? CHARS[id].name : itemDef(store.state.items.find((i) => i.id === id)?.def)?.name),
  };
}
