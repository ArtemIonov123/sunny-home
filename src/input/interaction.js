// Касания и мышь.
//   коснулся вещи или героя → тащишь её (сразу, без задержки);
//   коснулся пустого места и повёл → листаешь дом (после сдвига PAN_THRESHOLD);
//   коснулся и отпустил → нажатие.
// Пока вещь у края экрана, камера едет. Позиция вещи пересчитывается КАЖДЫЙ кадр
// из пальца и камеры — поэтому вещь не отстаёт и не прыгает.
import { EDGE_ZONE, EDGE_SPEED, PAN_THRESHOLD } from '../config.js';
import { ITEMS, CHARS } from '../core/catalog.js';
import { roomAtX } from '../core/house.js';
import { snapItem, snapChar, itemBounds, charBounds } from '../core/placement.js';
import { emitter } from '../util.js';

export function createInteraction({ canvas, viewport, camera, renderer, store, isOverTrash }) {
  const events = emitter();
  let g = null; // текущий жест

  const world = (p) => ({ x: camera.x + p.x, y: p.y });

  function down(e) {
    if (g || e.button > 0) return;
    e.preventDefault();
    const p = viewport.toScreen(e.clientX, e.clientY), w = world(p);
    const hit = renderer.hit(w.x, w.y);
    if (hit) {
      const r = store.layout.byId.get(hit.obj.room);
      store.checkpoint();
      g = {
        kind: hit.kind, id: hit.obj.id, obj: hit.obj, art: hit.art, pointer: e.pointerId,
        start: p, last: p, moved: false,
        dx: r.x0 + hit.obj.x - w.x, dy: hit.obj.y - w.y,
        clientX: e.clientX, clientY: e.clientY,
      };
      update();
      events.emit('dragstart', g);
    } else {
      g = { kind: 'pending', pointer: e.pointerId, start: p, last: p, camStart: camera.x, samples: [{ x: p.x, t: performance.now() }] };
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
      if (g.kind === 'item') events.emit('trash', isOverTrash(e.clientX, e.clientY));
    }
    events.emit('frame');
  }

  // Где окажется вещь, если отпустить её сейчас.
  function update() {
    const w = world(g.last), ax = w.x + g.dx, ay = w.y + g.dy;
    const r = roomAtX(store.layout, ax);
    const lx = ax - r.x0;
    if (g.kind === 'item') {
      const pos = snapItem(g.obj.def, r.room, lx, ay);
      g.target = { r, pos };
      g.valid = !!pos;
      // Вещь идёт за пальцем; на стене/проёме сразу показываем, куда она встанет.
      const show = pos && ITEMS[g.obj.def].place !== 'floor' ? { x: r.x0 + pos.x, y: pos.y } : { x: ax, y: ay };
      g.b = itemBounds({ def: g.obj.def, x: show.x, y: show.y });
    } else {
      const pos = snapChar(r.room, lx, ay);
      g.target = { r, pos }; g.valid = true;
      g.b = charBounds({ id: g.obj.id, x: ax, y: Math.min(ay, pos.y + 40) });
    }
  }

  function finish(e, cancel = false) {
    if (!g || g.pointer !== e.pointerId) return;
    const d = g; g = null;
    events.emit('trash', false);
    if (d.kind === 'pending') { events.emit('tapEmpty', d.last); }
    else if (d.kind === 'pan') {
      const a = d.samples[0], b = d.samples[d.samples.length - 1], dt = (b.t - a.t) / 1000;
      camera.release(dt > 0.01 ? -(b.x - a.x) / dt : 0);
    } else if (cancel) {
      store.undo(); // вернуть как было до начала перетаскивания
    } else if (!d.moved) {
      store.dropCheckpoint();
      events.emit('tap', { kind: d.kind, id: d.id });
    } else if (d.kind === 'item' && isOverTrash(d.clientX, d.clientY)) {
      store.change((s) => { s.items = s.items.filter((i) => i.id !== d.id); }, { undo: false });
      events.emit('removed', ITEMS[d.obj.def].name);
    } else if (!d.valid) {
      store.dropCheckpoint();
      events.emit('invalid', ITEMS[d.obj.def].name);
    } else {
      const { r, pos } = d.target;
      store.change((s) => {
        const list = d.kind === 'item' ? s.items : s.chars;
        const o = list.find((o) => o.id === d.id);
        if (o) { o.room = r.room.id; o.x = pos.x; o.y = pos.y; }
      }, { undo: false });
    }
    events.emit('dragend');
    events.emit('frame');
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
    on: events.on, frame,
    get drag() { return g && g.kind !== 'pending' && g.kind !== 'pan' ? g : null; },
    get active() { return !!g; },
    name: (kind, id) => (kind === 'char' ? CHARS[id].name : ITEMS[store.state.items.find((i) => i.id === id)?.def]?.name),
  };
}
