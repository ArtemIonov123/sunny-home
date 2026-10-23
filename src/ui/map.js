// Карта — маленькая круглая планета (как в Toca Boca World): тянешь пальцем — планета крутится,
// здания стоят по кругу и уходят за горизонт. Нажал на здание — заходишь внутрь.
// Готовые места — core/places.js (isReady); остальные подпрыгивают и показывают 🚧 (скоро).
// Своё окно поверх игры со своим холстом; кадры рисуются только пока что-то движется.
import { img } from '../assets.js';
import { MAX_DPR } from '../config.js';
import { play } from '../audio.js';
import { isReady } from '../core/places.js';

const H = 900;                 // высота экрана в единицах карты (как VIEW_H у дома)
// Планета — шар, на который смотрим чуть сверху (как в Toca Boca World): крутится вокруг своей оси,
// места стоят по кругу на «широте» LAT и уезжают за горизонт; ближние крупнее, дальние меньше.
const RS = 760;                // радиус шара
const TILT = 0.5;              // насколько смотрим сверху (радианы)
const LAT = 0.72;              // широта, на которой стоят места
const FRONT_Y = 700;           // где на экране стоит ближнее место

// Что стоит на планете: долгота, широта, картинка, ширина. place — место, куда можно зайти.
export const PLACES = [
  { id: 'home', art: 'map/iso_home' },
  { id: 'shop', art: 'map/iso_shop' },
  { id: 'disco', art: 'map/iso_disco' },
  { id: 'cafe', art: 'map/iso_cafe' },
  { id: 'salon', art: 'map/iso_salon' },
];
const THINGS = [];
PLACES.forEach((p, k) => {
  const a = (k / PLACES.length) * Math.PI * 2, step = (Math.PI * 2) / PLACES.length;
  THINGS.push({ a, lat: LAT, art: p.art, w: 400, sink: 0.12, place: p });
  if (k % 2 === 0) THINGS.push({ a: a + step * 0.5, lat: LAT + 0.3, art: 'map/tree', w: 170 });
  THINGS.push({ a: a + step * 0.38, lat: LAT - 0.22, art: 'map/bush', w: 120 });
  THINGS.push({ a: a + step * 0.66, lat: LAT - 0.05, art: k % 2 ? 'map/tree' : 'map/bush', w: k % 2 ? 150 : 115 });
});
// Травинки и цветочки на шаре (одни и те же каждый раз).
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SPECKS = Array.from({ length: 240 }, (_, n) => ({ a: hash(n) * Math.PI * 2, lat: -0.2 + hash(n + 999) * 1.65, kind: hash(n + 77) < 0.3 ? 1 : 0, c: ['#ffffff', '#ffc4d6', '#fff1a8', '#e1cdff'][Math.floor(hash(n + 5) * 4)] }));
const CLOUDS = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ a: k * 0.9 + 0.3, r: RS + 260 + (k % 3) * 90, w: 190 + (k % 3) * 40, drift: 0.012 + (k % 4) * 0.004 }));
const ROT_KEY = 'sunny-map-rot';

export function createMap({ root, viewport, isNight = () => false, getPlace = () => 'home', onEnter = () => {} }) {
  const el = document.createElement('div');
  el.className = 'map-screen'; el.hidden = true;
  el.innerHTML = '<canvas aria-label="Карта"></canvas>';
  root.appendChild(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d', { alpha: false });

  let rot = 0; try { rot = Number(localStorage.getItem(ROT_KEY)) || 0; } catch (e) { /* пусто */ }
  let vel = 0, k = 1, W = 1600, raf = 0, lastT = 0, open = false, boxes = [], focus = null;
  let zoom = { t0: 0, from: 1, to: 1, dur: 0, then: null }, bounce = new Map(), soon = null;
  const now = () => performance.now() / 1000;

  function resize() {
    // Размер без поворота: телефон стоит вертикально — игра повёрнута (#app.rotated), и рамка на экране «боком».
    const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    k = cv.height / H; W = cv.width / k;
  }

  const CY = FRONT_Y + RS * (Math.cos(LAT) * Math.sin(TILT) - Math.sin(LAT) * Math.cos(TILT)) * -1;
  const center = () => ({ cx: W / 2, cy: CY });
  // Точка на шаре (широта, долгота с учётом поворота) → экран; d — насколько повёрнута к нам (меньше 0 — за шаром).
  function proj(lat, lon) {
    const x = RS * Math.cos(lat) * Math.sin(lon), y = RS * Math.sin(lat), z = RS * Math.cos(lat) * Math.cos(lon);
    return { x: W / 2 + x, y: CY - (y * Math.cos(TILT) - z * Math.sin(TILT)), d: (z * Math.cos(TILT) + y * Math.sin(TILT)) / RS };
  }
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
    const fx = focus ? focus.x : cx, fy = focus ? focus.y : FRONT_Y - 200;
    ctx.setTransform(k * z, 0, 0, k * z, fx * k * (1 - z), fy * k * (1 - z)); // приближаем к зданию
    if (night) { ctx.fillStyle = '#fff8d8'; for (let s = 0; s < 40; s++) { const x = ((s * 137.3 + rot * 60) % W + W) % W, y = (s * 53.7) % 420; ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t * 1.3 + s)); ctx.fillRect(x, y, 3, 3); } ctx.globalAlpha = 1; }
    // Облака — по большому кругу позади шара, медленнее его и сами плывут.
    const cloud = img('map/cloud');
    if (cloud) for (const c of CLOUDS) {
      const a = norm(c.a + rot * 0.4 + t * c.drift);
      if (Math.abs(a) > 1.4) continue;
      const h = c.w * cloud.height / cloud.width;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.globalAlpha = night ? 0.55 : 0.95;
      ctx.drawImage(cloud, -c.w / 2, -c.r - h / 2, c.w, h); ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Шар: трава со светом сверху-слева и тенью к краю.
    const g = ctx.createRadialGradient(cx - RS * 0.3, cy - RS * 0.55, RS * 0.1, cx, cy, RS);
    g.addColorStop(0, '#b5e57f'); g.addColorStop(0.55, '#86c95e'); g.addColorStop(1, '#4f9a45');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, RS, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = '#3d7a37'; ctx.stroke();
    // Дорожка по кругу — по ней стоят места.
    for (let j = 0; j < 120; j++) {
      const l0 = rot + (j / 120) * Math.PI * 2, l1 = l0 + (Math.PI * 2) / 120;
      const a0 = proj(LAT - 0.07, l0), a1 = proj(LAT - 0.07, l1), b0 = proj(LAT + 0.02, l0), b1 = proj(LAT + 0.02, l1);
      if (a0.d < 0 && a1.d < 0) continue;
      ctx.fillStyle = '#ead6a4'; ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b0.x, b0.y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#c9ab72'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
    }
    // Травинки и цветочки.
    for (const sp of SPECKS) {
      const p = proj(sp.lat, sp.a + rot); if (p.d < 0.05) continue;
      const s2 = 0.5 + 0.6 * p.d;
      if (sp.kind) { ctx.fillStyle = sp.c; for (let q = 0; q < 5; q++) { ctx.beginPath(); ctx.ellipse(p.x + Math.cos(q * 1.26) * 5 * s2, p.y + Math.sin(q * 1.26) * 3 * s2, 4 * s2, 3 * s2, 0, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = '#f2b84b'; ctx.beginPath(); ctx.arc(p.x, p.y, 3 * s2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(45,110,40,.55)'; ctx.lineWidth = 2.5 * s2; ctx.beginPath(); ctx.moveTo(p.x - 7 * s2, p.y - 6 * s2); ctx.lineTo(p.x - 2 * s2, p.y + 2 * s2); ctx.lineTo(p.x + 2 * s2, p.y - 8 * s2); ctx.lineTo(p.x + 5 * s2, p.y + 2 * s2); ctx.lineTo(p.x + 10 * s2, p.y - 5 * s2); ctx.stroke(); }
    }
    // Тень у края шара — он «круглый».
    const sh = ctx.createRadialGradient(cx, cy, RS * 0.72, cx, cy, RS);
    sh.addColorStop(0, 'rgba(30,60,30,0)'); sh.addColorStop(1, 'rgba(30,60,30,.28)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(cx, cy, RS, 0, Math.PI * 2); ctx.fill();
    // Места и деревья: дальние первыми, ближние поверх.
    const vis = [];
    for (const th of THINGS) { const p = proj(th.lat, th.a + rot); if (p.d > 0.02) vis.push({ th, p }); }
    vis.sort((u, v) => u.p.d - v.p.d);
    boxes = [];
    for (const { th, p } of vis) {
      const im = img(th.art); if (!im) continue;
      const sc = 0.38 + 0.64 * p.d, w = th.w * sc, h = w * im.height / im.width;
      ctx.save(); ctx.globalAlpha = Math.min(1, (p.d - 0.02) / 0.15);
      ctx.translate(p.x, p.y + (th.sink || 0) * h);
      const b = th.place && bounce.get(th.place.id);
      if (b) { const q = (t - b) / 0.5; if (q < 1) { const s2 = Math.sin(q * Math.PI); ctx.translate(0, -40 * s2); ctx.scale(1 - 0.06 * s2, 1 + 0.08 * s2); } else bounce.delete(th.place.id); }
      ctx.drawImage(im, -w / 2, -h, w, h);
      if (soon && th.place?.id === soon.id) { // ещё строится
        const q = (t - soon.t0) / 1.4;
        if (q < 1) { ctx.globalAlpha = Math.min(1, (1 - q) * 4); ctx.font = '64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🚧', 0, -h - 20 - q * 30); } else soon = null;
      }
      ctx.restore();
      if (th.place) boxes.push({ th, x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + (th.sink || 0) * h - h, y1: p.y + (th.sink || 0) * h, d: p.d });
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
    const da = dx / (RS * Math.cos(LAT)); rot += da;
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
    for (const bx of [...boxes].sort((u, v) => v.d - u.d)) if (p.x > bx.x0 && p.x < bx.x1 && p.y > bx.y0 && p.y < bx.y1) return bx.th;
    return null;
  }
  function tap(p) {
    const th = hitPlace(p); if (!th) return;
    bounce.set(th.place.id, now());
    if (!isReady(th.place.id)) { soon = { id: th.place.id, t0: now() }; play('boing'); return; }
    play('pop');
    // Повернуть планету так, чтобы здание было посередине, и «войти» (приближение + светлая вспышка).
    const target = rot - norm(th.a + rot), from = rot;
    const t0 = now();
    const spin = () => { const q = Math.min(1, (now() - t0) / 0.35); rot = from + (target - from) * q * (2 - q); if (q < 1) requestAnimationFrame(spin); };
    vel = 0; spin();
    focus = { x: W / 2, y: FRONT_Y - 180 }; // здание повернётся вперёд — приближаем к нему
    zoom = { t0: now() + 0.0, from: 1, to: 2.3, dur: 0.6, fade: 1, then: () => { close(true); onEnter(th.place.id); } };
    setTimeout(() => play('whoosh'), 250);
    kick();
  }

  function openMap() {
    // Планета повёрнута к месту, где сейчас игрок.
    const here = THINGS.find((t) => t.place?.id === getPlace());
    if (here && Math.abs(norm(here.a + rot)) > 0.9) rot = -here.a;
    if (open) return;
    open = true; el.hidden = false; resize(); lastT = 0;
    focus = null; zoom = { t0: now(), from: 1.8, to: 1, dur: 0.5, fade: -1 };
    play('whoosh'); kick();
  }
  function close() {
    open = false; el.hidden = true; clearTimeout(idle); if (raf) cancelAnimationFrame(raf); raf = 0;
    try { localStorage.setItem(ROT_KEY, String(norm(rot))); } catch (err) { /* не важно */ }
  }
  window.addEventListener('resize', () => { if (open) requestAnimationFrame(() => { resize(); kick(); }); }); // после того, как игра повернулась

  return { open: openMap, close, get isOpen() { return open; }, _hit: hitPlace, get rot() { return rot; }, set rot(v) { rot = v; kick(); } };
}
