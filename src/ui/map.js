// Карта мира (как в Toca Boca World): огромная круглая земля, мы видим её кусочек — район с главным зданием
// и живыми домиками; за ними на горизонте горы и город. Тянешь пальцем — земля крутится, край по бокам
// заворачивается вниз (видно, что она круглая), следующий квартал выезжает из-за горизонта.
// Нажал на здание — заходишь внутрь. Готовые места — core/places.js (isReady); остальные — 🚧 (скоро).
// Своё окно поверх игры со своим холстом; кадры рисуются только пока что-то движется.
import { img } from '../assets.js';
import { MAX_DPR } from '../config.js';
import { play } from '../audio.js';
import { isReady } from '../core/places.js';
import { zonesOf } from '../core/mapZones.js';
import { districtList } from '../core/world.js';

const H = 900;                 // высота экрана в единицах карты (как VIEW_H у дома)
// Земля — огромный цилиндр, повёрнутый к нам боком: районы лежат по кругу, края по бокам уходят вниз (DROP).
const RC = 1500;               // радиус для горизонта (он дальше районов)
const HZ = 300;                // линия горизонта посередине экрана
const DROP = 0.55;             // насколько края земли уходят вниз
// Районы — картинки 1600×800 (встроенные от GPT и свои из студии, core/world.js): земля начинается с VH
// (доля высоты), главное здание района стоит на площадке посередине (низ — LOT_V); соседние районы — внахлёст OVER.
const DW = 1600, DH = 800, VH = 0.244, LOT_V = 0.6, OVER = 0.08;
const CLOUDS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ x: k * 520 + (k % 3) * 90, y: 60 + (k % 4) * 55, w: 170 + (k % 3) * 45, drift: 6 + (k % 4) * 3 }));
// Горизонт: длинные полосы от GPT (горы, холмы, город) по кругу, стык — плавный.
const HORIZON = ['mountains', 'hills', 'city', 'mountains', 'hills', 'city'];
const ROT_KEY = 'sunny-map-rot';

export function createMap({ root, viewport, isNight = () => false, getPlace = () => 'home', onEnter = () => {} }) {
  const el = document.createElement('div');
  el.className = 'map-screen'; el.hidden = true;
  el.innerHTML = '<canvas aria-label="Карта"></canvas>';
  root.appendChild(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d', { alpha: false });

  let rot = 0; try { rot = Number(localStorage.getItem(ROT_KEY)) || 0; } catch (e) { /* пусто */ }
  let vel = 0, k = 1, W = 1600, raf = 0, lastT = 0, open = false, boxes = [], focus = null;
  let zoom = { t0: 0, from: 1, to: 1, dur: 0, then: null }, bounce = new Map(), soon = null, wiggles = new Map();
  // Районы (встроенные + свои): перечитываются при открытии карты. STEP — угол одного района, RD — радиус земли.
  let D = districtList(), STEP = (Math.PI * 2) / D.length, RD = DW / STEP;
  function refresh() { D = districtList(); STEP = (Math.PI * 2) / D.length; RD = DW / STEP; }
  let snap = null; // долёт до квартала: { from, to, t0, dur }
  function snapTo(to) { vel = 0; snap = { from: rot, to, t0: now(), dur: Math.min(0.7, 0.3 + Math.abs(to - rot) * 0.6) }; }
  const now = () => performance.now() / 1000;

  function resize() {
    // Размер без поворота: телефон стоит вертикально — игра повёрнута (#app.rotated), и рамка на экране «боком».
    const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    k = cv.height / H; W = cv.width / k;
  }

  const center = () => ({ cx: W / 2, cy: HZ });
  // Точка дальней земли (горизонт): угол th → экран.
  function at(g, th) {
    const R = RC * (0.78 + 0.44 * g), c = Math.cos(th);
    return { x: W / 2 + R * Math.sin(th), y: HZ + g * 640 + R * (1 - c) * DROP };
  }
  // Точка района: a — угол района (середина), u, v — доли его картинки.
  function distPos(a, u, v) {
    const th = norm(a + (u - 0.5) * STEP + rot), c = Math.cos(th);
    return { x: W / 2 + RD * Math.sin(th), y: HZ + (v - VH) * DH + RD * (1 - c) * DROP, s: 0.75 + 0.25 * c, v: c - 0.2, th };
  }
  // Здание на картинке района (зона) → рамка на экране (по изгибу: низ — по середине рамки).
  function zoneRect(k, q) {
    const [u0, v0, u1, v1] = q.box, a = k * STEP;
    const L = distPos(a, u0, v1), R = distPos(a, u1, v1), T = distPos(a, (u0 + u1) / 2, v0), B = distPos(a, (u0 + u1) / 2, v1);
    return { x0: L.x, x1: R.x, y0: T.y, y1: B.y, cx: (L.x + R.x) / 2, vis: Math.min(L.v, R.v) };
  }
  // Нажатое здание района пружинит на месте (вырезаем его кусок картинки и сплющиваем), вокруг — звёздочки.
  function drawWiggles(t) {
    for (const [key, t0] of wiggles) {
      const q2 = (t - t0) / 0.6; if (q2 >= 1) { wiggles.delete(key); continue; }
      const [k, i] = key.split(':').map(Number), zn = D[k] && zonesOf(D[k].id)[i], im = D[k] && img(D[k].image);
      if (!zn || !im) continue;
      const r = zoneRect(k, zn); if (r.vis < 0) continue;
      const [u0, v0, u1, v1] = zn.box, s2 = Math.sin(q2 * Math.PI * 3) * 0.07 * (1 - q2);
      ctx.save(); ctx.translate(r.cx, r.y1); ctx.scale(1 - s2, 1 + s2); ctx.translate(-r.cx, -r.y1);
      ctx.drawImage(im, u0 * im.width, v0 * im.height, (u1 - u0) * im.width, (v1 - v0) * im.height, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
      ctx.save(); ctx.fillStyle = '#ffd84a'; ctx.globalAlpha = 1 - q2;
      for (let n = 0; n < 6; n++) {
        const an = n * 1.05 + q2 * 2, rr = (r.x1 - r.x0) * (0.45 + 0.35 * q2), x = r.cx + Math.cos(an) * rr, y = (r.y0 + r.y1) / 2 + Math.sin(an) * rr * 0.6, st = 9 * (1 - q2 * 0.5);
        ctx.beginPath(); for (let j = 0; j < 8; j++) { const rad = j % 2 ? st * 0.35 : st; ctx.lineTo(x + Math.cos(j * Math.PI / 4) * rad, y + Math.sin(j * Math.PI / 4) * rad); } ctx.fill();
      }
      ctx.restore();
    }
  }
  function hitZone(p) {
    let best = null;
    D.forEach((dd, k) => zonesOf(dd.id).forEach((zn, i) => {
      const r = zoneRect(k, zn); if (r.vis < 0.1) return;
      if (p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1) { const area = (r.x1 - r.x0) * (r.y1 - r.y0); if (!best || area < best.area) best = { k, i, zn, area }; }
    }));
    return best;
  }
  // Зайти в место: повернуть землю к району k, приблизиться к точке (fx, fy) после поворота и войти.
  function enter(placeId, k, fx, fy) {
    play('pop');
    const target = rot - norm(k * STEP + rot), from = rot, t0 = now();
    const spin = () => { const q = Math.min(1, (now() - t0) / 0.35); rot = from + (target - from) * q * (2 - q); if (q < 1) requestAnimationFrame(spin); };
    vel = 0; snap = null; spin();
    focus = { x: fx, y: fy };
    zoom = { t0: now(), from: 1, to: 2.3, dur: 0.6, fade: 1, then: () => { close(true); onEnter(placeId); } };
    setTimeout(() => play('whoosh'), 250);
    kick();
  }
  // Районы — картинки, порезанные на столбики и уложенные по изгибу (в пикселях экрана встык, без щелей).
  // Каждый район чуть шире своего места (OVER) и на стыке плавно проявляется поверх соседа.
  function drawDistricts(night) {
    const M = ctx.getTransform(), seg = STEP, cols = 140;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const one = (k, from, to) => {
      const im = img(D[k].image); if (!im) return;
      const span = seg * (1 + OVER), a0 = k * seg - span / 2, da = span / cols, sw = im.width / cols, fadeCols = Math.round(cols * OVER / (1 + OVER));
      for (let c = from; c < to; c++) {
        const th = norm(a0 + c * da + rot), c0 = Math.cos(th); if (c0 < 0.05) continue;
        const th1 = th + da, x0 = Math.round((W / 2 + RD * Math.sin(th)) * M.a + M.e), x1 = Math.round((W / 2 + RD * Math.sin(th1)) * M.a + M.e);
        if (x1 <= x0) continue;
        const y = (HZ - VH * DH + RD * (1 - c0) * DROP) * M.d + M.f;
        ctx.globalAlpha = c < fadeCols ? c / fadeCols : 1;
        ctx.drawImage(im, c * sw, 0, sw, im.height, x0, y, x1 - x0, DH * M.d);
      }
    };
    for (let k = 0; k < D.length; k++) one(k, 0, cols);
    one(0, 0, Math.round(cols * OVER / (1 + OVER))); // начало первого — поверх конца последнего
    ctx.restore();
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
    const { cx } = center();
    const fx = focus ? focus.x : cx, fy = focus ? focus.y : 520;
    ctx.setTransform(k * z, 0, 0, k * z, fx * k * (1 - z), fy * k * (1 - z)); // приближаем к зданию
    if (night) { ctx.fillStyle = '#fff8d8'; for (let s2 = 0; s2 < 40; s2++) { const x = ((s2 * 137.3 + rot * 60) % W + W) % W, y = (s2 * 53.7) % 300; ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t * 1.3 + s2)); ctx.fillRect(x, y, 3, 3); } ctx.globalAlpha = 1; }
    // Облака плывут сами и чуть-чуть сдвигаются вместе с землёй.
    const cloud = img('map/cloud');
    if (cloud) { const span = W + 900; for (const c of CLOUDS) {
      const x = (((c.x + rot * RC * 0.12 + t * c.drift) % span) + span) % span - 450, h = c.w * cloud.height / cloud.width;
      ctx.globalAlpha = night ? 0.55 : 0.95; ctx.drawImage(cloud, x, c.y, c.w, h);
    } ctx.globalAlpha = 1; }
    // Горизонт — дальше, чем земля, поэтому едет медленнее. Каждая полоса режется на столбики и
    // ложится по изгибу; на стыках полосы плавно растворяются друг в друге.
    {
      // Столбики рисуются в пикселях экрана встык (целые края) — без щелей и без наложений.
      const seg = (Math.PI * 2) / HORIZON.length, M = ctx.getTransform();
      const toPx = (p) => ({ x: Math.round(p.x * M.a + M.e), y: p.y * M.d + M.f });
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = night ? 0.7 : 1;
      const cols = 160, da = seg / cols, F = 40; // F столбиков — плавный переход от прошлой полосы
      const strip = (n, from, to) => {
        const name = HORIZON[n], im = img('map/horizon_' + name); if (!im) return;
        const hh = 215 * (name === 'mountains' ? 1.25 : 1) * M.d, sw = im.width / cols;
        for (let c = from; c < to; c++) {
          const a = n * seg + c * da, th = norm(a + rot * 0.6); if (Math.cos(th) < 0.12) continue;
          const pa = toPx(at(0, th)), pb = toPx(at(0, th + da)); if (pb.x <= pa.x) continue;
          ctx.globalAlpha = (night ? 0.7 : 1) * (c < 0 ? (c + F) / F : 1);
          ctx.drawImage(im, (((c % cols) + cols) % cols) * sw, 0, sw, im.height, pa.x, pa.y + 26 * M.d - hh, pb.x - pa.x, hh);
        }
      };
      HORIZON.forEach((_, n) => strip(n, -F, cols));
      strip(0, -F, 0); // начало первой полосы — поверх конца последней
      ctx.restore();
    }
    drawDistricts(night); drawWiggles(t);
    // Главные здания районов — на площадке посередине; дальние первыми.
    const vis = [];
    D.forEach((dd, k) => { if (!dd.art) return; const p = distPos(k * STEP, 0.5, LOT_V); if (p.v > 0) vis.push({ dd, k, p }); });
    vis.sort((u, v) => u.p.y - v.p.y);
    boxes = [];
    for (const { dd, k, p } of vis) {
      const im = img(dd.art); if (!im) continue;
      const w = 360 * p.s, h = w * im.height / im.width, sink = 0.12;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.v / 0.12);
      ctx.translate(p.x, p.y + sink * h); ctx.rotate(Math.sin(p.th) * 0.25); // по краям — наклон вместе с землёй
      const b = bounce.get(dd.id);
      if (b) { const q = (t - b) / 0.5; if (q < 1) { const s2 = Math.sin(q * Math.PI); ctx.translate(0, -40 * s2); ctx.scale(1 - 0.06 * s2, 1 + 0.08 * s2); } else bounce.delete(dd.id); }
      ctx.drawImage(im, -w / 2, -h, w, h);
      if (soon && dd.id === soon.id) { // ещё строится
        const q = (t - soon.t0) / 1.4;
        if (q < 1) { ctx.globalAlpha = Math.min(1, (1 - q) * 4); ctx.font = '64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🚧', 0, -h - 20 - q * 30); } else soon = null;
      }
      ctx.restore();
      boxes.push({ dd, k, x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y + sink * h - h, y1: p.y + sink * h });
    }
    if (night) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(28,40,85,.25)'; ctx.fillRect(0, 0, cv.width, cv.height); }
    // Затемнение при входе
    if (zoom.fade) { const p = Math.min(1, (t - zoom.t0) / zoom.dur); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(255,248,232,${zoom.fade > 0 ? p : 1 - p})`; ctx.fillRect(0, 0, cv.width, cv.height); }
  }

  function frame(ts) {
    raf = 0; if (!open) return;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0; lastT = ts;
    if (snap) { const q = Math.min(1, (now() - snap.t0) / snap.dur), e = 1 - (1 - q) ** 3; rot = snap.from + (snap.to - snap.from) * e; if (q >= 1) { snap = null; try { localStorage.setItem(ROT_KEY, String(rot)); } catch (err) { /* не важно */ } } }
    draw();
    const t = now();
    if (zoom.dur && t - zoom.t0 >= zoom.dur) { const f = zoom.then; zoom = { dur: 0 }; f?.(); if (!open) return; }
    const busy = drag || snap || zoom.dur || bounce.size || soon || wiggles.size;
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
    const p = toWorld(e); drag = { x0: p.x, y0: p.y, x: p.x, t0: now(), tl: now(), moved: false, rot0: snap ? snap.to : rot }; vel = 0; snap = null;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* нет */ }
    kick();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toWorld(e), dx = p.x - drag.x, t = now();
    if (Math.abs(p.x - drag.x0) > 10) drag.moved = true;
    const da = dx / RD; rot += da;
    const dt = Math.max(0.008, t - drag.tl); vel = vel * 0.6 + (da / dt) * 0.4;
    drag.x = p.x; drag.tl = t;
    kick();
  });
  const up = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (now() - d.tl > 0.08) vel = 0; // остановил палец — без инерции
    if (!d.moved && e.type === 'pointerup') { snapTo(Math.round(rot / STEP) * STEP); tap(toWorld(e)); kick(); return; }
    // Листание страницами: лёгкий свайп — земля сама долетает до следующего квартала.
    const start = d.rot0, page0 = Math.round(start / STEP);
    let page = Math.round((rot + vel * 0.18) / STEP);
    if (page === page0 && Math.abs(rot - start) > 0.012) page += rot > start ? 1 : -1;
    page = Math.max(page0 - 1, Math.min(page0 + 1, page)); // не больше одного квартала за раз
    snapTo(page * STEP);
    play('whoosh');
    kick();
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

  function hitPlace(p) {
    for (const bx of [...boxes].reverse()) if (p.x > bx.x0 && p.x < bx.x1 && p.y > bx.y0 && p.y < bx.y1) return bx;
    return null;
  }
  function tap(p) {
    const bx = hitPlace(p);
    if (!bx) { // здание на картинке района
      const hz = hitZone(p); if (!hz) return;
      wiggles.set(hz.k + ':' + hz.i, now()); play(hz.zn.snd);
      if (hz.zn.place) {
        if (!isReady(hz.zn.place)) { play('boing'); kick(); return; }
        const [u0, v0, u1, v1] = hz.zn.box, th2 = ((u0 + u1) / 2 - 0.5) * STEP;
        setTimeout(() => enter(hz.zn.place, hz.k, W / 2 + RD * Math.sin(th2), HZ + ((v0 + v1) / 2 - VH) * DH + RD * (1 - Math.cos(th2)) * DROP), 250);
      }
      kick(); return;
    }
    bounce.set(bx.dd.id, now());
    if (!bx.dd.place || !isReady(bx.dd.place)) { soon = { id: bx.dd.id, t0: now() }; play('boing'); kick(); return; }
    enter(bx.dd.place, bx.k, W / 2, HZ + (LOT_V - VH) * DH - 160); // здание повернётся вперёд — приближаем к нему
  }

  function openMap() {
    refresh();
    // Земля повёрнута к району, где сейчас игрок (место — главное в районе или вход через домик района).
    const pl = getPlace();
    let k = D.findIndex((d) => d.place === pl);
    if (k < 0) k = D.findIndex((d) => zonesOf(d.id).some((z) => z.place === pl));
    if (k >= 0) { const a = k * STEP; rot = -a + Math.round((rot + a) / (Math.PI * 2)) * Math.PI * 2; } // ровно на своём районе
    else rot = Math.round(rot / STEP) * STEP;
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
