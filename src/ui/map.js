// Карта — маленькая круглая планета (как в Toca Boca World): тянешь пальцем — планета крутится,
// здания стоят по кругу и уходят за горизонт. Нажал на здание — заходишь внутрь.
// Пока готов только дом; остальные места подпрыгивают и показывают 🚧 (скоро).
// Своё окно поверх игры со своим холстом; кадры рисуются только пока что-то движется.
import { img } from '../assets.js';
import { MAX_DPR } from '../config.js';
import { play } from '../audio.js';

const H = 900;                 // высота экрана в единицах карты (как VIEW_H у дома)
const R = 820;                 // радиус планеты
const TOP = 585;               // где верх травы посередине экрана
const BAND = 175;              // толщина полосы земли (картинка map/ground)
const SOIL = '#6b4127';        // земля внутри планеты

// Что стоит на планете: угол (доли круга), картинка, ширина. place — место, куда можно зайти.
export const PLACES = [
  { id: 'home', art: 'map/house', ready: true },
  { id: 'shop', art: 'map/shop' },
  { id: 'disco', art: 'map/disco' },
  { id: 'cafe', art: 'map/cafe' },
  { id: 'salon', art: 'map/salon' },
];
const THINGS = [];
PLACES.forEach((p, k) => {
  const a = (k / PLACES.length) * Math.PI * 2, step = (Math.PI * 2) / PLACES.length;
  THINGS.push({ a, art: p.art, w: 330, place: p });
  THINGS.push({ a: a + step * 0.33, art: 'map/tree', w: 175 });
  THINGS.push({ a: a + step * 0.62, art: k % 2 ? 'map/tree' : 'map/bush', w: k % 2 ? 150 : 125 });
});
const CLOUDS = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ a: k * 0.9 + 0.3, r: R + 470 + (k % 3) * 85, w: 190 + (k % 3) * 40, drift: 0.012 + (k % 4) * 0.004 }));
const ROT_KEY = 'sunny-map-rot';

export function createMap({ root, viewport, isNight = () => false, onEnter = () => {} }) {
  const el = document.createElement('div');
  el.className = 'map-screen'; el.hidden = true;
  el.innerHTML = '<canvas aria-label="Карта"></canvas>';
  root.appendChild(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d', { alpha: false });

  let rot = 0; try { rot = Number(localStorage.getItem(ROT_KEY)) || 0; } catch (e) { /* пусто */ }
  let vel = 0, k = 1, W = 1600, ring = null, ringK = 0, raf = 0, lastT = 0, open = false;
  let zoom = { t0: 0, from: 1, to: 1, dur: 0, then: null }, bounce = new Map(), soon = null;
  const now = () => performance.now() / 1000;

  function resize() {
    // Размер без поворота: телефон стоит вертикально — игра повёрнута (#app.rotated), и рамка на экране «боком».
    const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    k = cv.height / H; W = cv.width / k;
    if (Math.abs(ringK - k) > 0.01) ring = null;
  }

  // Полоса земли, согнутая в круг, — рисуется один раз в отдельный холст (потом только поворачивается).
  function buildRing() {
    const strip = img('map/ground'); if (!strip) return null;
    const size = Math.ceil((R + 10) * 2 * k), c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), m = size / 2;
    g.translate(m, m); g.scale(k, k);
    g.fillStyle = SOIL; g.beginPath(); g.arc(0, 0, R - BAND * 0.75, 0, Math.PI * 2); g.fill();
    const circ = Math.PI * 2 * R, reps = Math.max(3, Math.round(circ / (strip.width * BAND / strip.height)));
    const per = 64, n = reps * per, da = (Math.PI * 2) / n, sw = strip.width / per;
    for (let j = 0; j < n; j++) {
      g.save(); g.rotate(j * da);
      const w = R * da * 1.06; // чуть внахлёст — без щелей
      g.drawImage(strip, (j % per) * sw, 0, sw, strip.height, -w / 2, -R - 6, w, BAND);
      g.restore();
    }
    ringK = k;
    return c;
  }

  const center = () => ({ cx: W / 2, cy: TOP + R });
  const norm = (a) => { a %= Math.PI * 2; return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a; };

  function draw() {
    const t = now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Небо
    const night = isNight();
    const sky = ctx.createLinearGradient(0, 0, 0, cv.height);
    sky.addColorStop(0, night ? '#24305e' : '#8fd0fb'); sky.addColorStop(1, night ? '#55639b' : '#e4f5ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, cv.width, cv.height);
    // Приближение при входе в здание / при открытии карты.
    let z = 1;
    if (zoom.dur) { const p = Math.min(1, (t - zoom.t0) / zoom.dur), e = p * p * (3 - 2 * p); z = zoom.from + (zoom.to - zoom.from) * e; }
    const { cx, cy } = center();
    ctx.setTransform(k * z, 0, 0, k * z, cx * k * (1 - z), (TOP - 150) * k * (1 - z)); // приближаем к зданию посередине
    if (night) { ctx.fillStyle = '#fff8d8'; for (let s = 0; s < 40; s++) { const x = ((s * 137.3 + rot * 60) % W + W) % W, y = (s * 53.7) % 420; ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t * 1.3 + s)); ctx.fillRect(x, y, 3, 3); } ctx.globalAlpha = 1; }
    // Облака — по большому кругу, медленнее планеты и сами плывут.
    const cloud = img('map/cloud');
    if (cloud) for (const c of CLOUDS) {
      const a = norm(c.a + rot * 0.55 + t * c.drift);
      if (Math.abs(a) > 1.3) continue;
      const h = c.w * cloud.height / cloud.width;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.globalAlpha = night ? 0.55 : 0.95;
      ctx.drawImage(cloud, -c.w / 2, -c.r - h / 2, c.w, h); ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Здания и деревья — стоят на траве, «наклоняются» по кругу.
    for (const th of THINGS) {
      const a = norm(th.a + rot);
      if (Math.abs(a) > 1.45) continue; // за горизонтом
      const im = img(th.art); if (!im) continue;
      const h = th.w * im.height / im.width;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.translate(0, -R + 14);
      const b = th.place && bounce.get(th.place.id);
      if (b) { const p = (t - b) / 0.5; if (p < 1) { const s = Math.sin(p * Math.PI); ctx.translate(0, -40 * s); ctx.scale(1 - 0.06 * s, 1 + 0.08 * s); } else bounce.delete(th.place.id); }
      ctx.drawImage(im, -th.w / 2, -h, th.w, h);
      if (soon && th.place?.id === soon.id) { // ещё строится
        const p = (t - soon.t0) / 1.4;
        if (p < 1) { ctx.globalAlpha = Math.min(1, (1 - p) * 4); ctx.font = '64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🚧', 0, -h - 20 - p * 30); ctx.globalAlpha = 1; } else soon = null;
      }
      ctx.restore();
    }
    // Сама планета (поверх низа зданий не рисуем — они стоят на траве).
    if (!ring) ring = buildRing();
    if (ring) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(1 / k, 1 / k);
      ctx.drawImage(ring, -ring.width / 2, -ring.height / 2); ctx.restore();
    }
    if (night) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(28,40,85,.25)'; ctx.fillRect(0, 0, cv.width, cv.height); }
    // Затемнение при входе
    if (zoom.fade) { const p = Math.min(1, (t - zoom.t0) / zoom.dur); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(255,248,232,${zoom.fade > 0 ? p : 1 - p})`; ctx.fillRect(0, 0, cv.width, cv.height); }
  }

  function frame(ts) {
    raf = 0; if (!open) return;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0; lastT = ts;
    if (!drag && Math.abs(vel) > 0.0005) { rot += vel * dt; vel *= Math.exp(-2.6 * dt); }
    draw();
    const t = now();
    if (zoom.dur && t - zoom.t0 >= zoom.dur) { const f = zoom.then; zoom = { dur: 0 }; f?.(); if (!open) return; }
    const busy = drag || Math.abs(vel) > 0.0005 || zoom.dur || bounce.size || soon;
    if (busy) kick(); else { lastT = 0; idle = setTimeout(kick, 120); } // облака плывут — редкие кадры
  }
  let idle = 0;
  const kick = () => { clearTimeout(idle); if (!raf && open) raf = requestAnimationFrame(frame); };

  // ── Пальцем: крутить и нажимать ──
  let drag = null;
  const toWorld = (e) => {
    const p = viewport ? viewport.toLocal(e.clientX, e.clientY) : (() => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; })();
    return { x: (p.x / el.clientHeight) * H, y: (p.y / el.clientHeight) * H };
  };
  cv.addEventListener('pointerdown', (e) => {
    if (zoom.then) return;
    const p = toWorld(e); drag = { x0: p.x, y0: p.y, x: p.x, t0: now(), tl: now(), moved: false }; vel = 0;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* нет */ }
    kick();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toWorld(e), dx = p.x - drag.x, t = now();
    if (Math.abs(p.x - drag.x0) > 10) drag.moved = true;
    const da = dx / R; rot += da;
    const dt = Math.max(0.008, t - drag.tl); vel = vel * 0.6 + (da / dt) * 0.4;
    drag.x = p.x; drag.tl = t;
    kick();
  });
  const up = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (now() - d.tl > 0.08) vel = 0; // остановил палец — без инерции
    vel = Math.max(-4, Math.min(4, vel));
    try { localStorage.setItem(ROT_KEY, String(norm(rot))); } catch (err) { /* не важно */ }
    if (!d.moved && e.type === 'pointerup') tap(toWorld(e));
    kick();
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

  function hitPlace(p) {
    const { cx, cy } = center(), dx = p.x - cx, dy = p.y - cy, r = Math.hypot(dx, dy), phi = Math.atan2(dx, -dy);
    for (const th of THINGS) {
      if (!th.place) continue;
      const a = norm(th.a + rot), im = img(th.art); if (!im || Math.abs(a) > 1.45) continue;
      const h = th.w * im.height / im.width, d = norm(phi - a);
      const lx = r * Math.sin(d), lh = r * Math.cos(d) - (R - 14);
      if (Math.abs(lx) < th.w / 2 && lh > -20 && lh < h) return th;
    }
    return null;
  }
  function tap(p) {
    const th = hitPlace(p); if (!th) return;
    bounce.set(th.place.id, now());
    if (!th.place.ready) { soon = { id: th.place.id, t0: now() }; play('boing'); return; }
    play('pop');
    // Повернуть планету так, чтобы здание было посередине, и «войти» (приближение + светлая вспышка).
    const target = rot - norm(th.a + rot), from = rot;
    const t0 = now();
    const spin = () => { const q = Math.min(1, (now() - t0) / 0.35); rot = from + (target - from) * q * (2 - q); if (q < 1) requestAnimationFrame(spin); };
    vel = 0; spin();
    zoom = { t0: now() + 0.0, from: 1, to: 2.3, dur: 0.6, fade: 1, then: () => { close(true); onEnter(th.place.id); } };
    setTimeout(() => play('whoosh'), 250);
    kick();
  }

  function openMap() {
    if (open) return;
    open = true; el.hidden = false; resize(); lastT = 0;
    zoom = { t0: now(), from: 1.8, to: 1, dur: 0.5, fade: -1 };
    play('whoosh'); kick();
  }
  function close() {
    open = false; el.hidden = true; clearTimeout(idle); if (raf) cancelAnimationFrame(raf); raf = 0;
    try { localStorage.setItem(ROT_KEY, String(norm(rot))); } catch (err) { /* не важно */ }
  }
  window.addEventListener('resize', () => { if (open) requestAnimationFrame(() => { resize(); kick(); }); }); // после того, как игра повернулась

  return { open: openMap, close, get isOpen() { return open; }, _hit: hitPlace, get rot() { return rot; }, set rot(v) { rot = v; kick(); } };
}
