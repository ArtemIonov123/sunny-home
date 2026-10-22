// Отрисовка дома. Рисуются только комнаты, которые попадают на экран.
// Поиск вещи под пальцем использует ТОТ ЖЕ список и порядок, что и отрисовка,
// поэтому палец всегда хватает то, что видно сверху.
import { VIEW_H, MAX_DPR } from '../config.js';
import { itemDef, CHARS } from '../core/catalog.js';
import { img, maskOf } from '../assets.js';
import { itemBounds, charBounds, charHitBox, depthOf } from '../core/placement.js';
import { backgroundFor, clearBackgrounds, prewarm } from './background.js';
import { anims } from './anims.js';
import { drawWater, waterParams, cutStreams } from './water.js';
import { soak, wetness, wantsShake, drawDrips, drawPuddle, drawShakeSpray } from './wet.js';
import { getRig, drawRig, heroPose } from './rig.js';
import { getAnimal, drawAnimal, animalPose, animalAnims } from './animal.js';
import { sizeOf } from '../assets.js';
import { mode } from '../ui/mode.js';
import { surfacesOf, seatsOf, isHidden, isSmall } from '../core/physics.js';

export function createRenderer(canvas, store, camera) {
  // alpha:false — непрозрачный холст дешевле передавать на экран.
  const ctx = canvas.getContext('2d', { alpha: false });
  let k = 1;
  let pets = null; // «ум» животных (core/pets.js): где животное, пока идёт само
  let visit = null; // гости (net/visit.js)
  let cooking = null; // приборы, которые сейчас работают (main.js): id → { t0, dur, mc, kids }
  const sparkles = new Map(); // id вещи → когда появилась (звёздочки «готово!»)

  let quality = 1, lastCss = [0, 0]; // quality < 1 — игра сама снизила чёткость на медленном телефоне
  function resize(cssW, cssH) {
    lastCss = [cssW, cssH];
    const dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, MAX_DPR) * quality);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const nk = canvas.height / VIEW_H;
    if (nk !== k) clearBackgrounds();
    k = nk;
    camera.viewW = canvas.width / k;
  }

  // Все видимые объекты в мировых координатах, отсортированные по глубине.
  function entries(drag, carried = null) {
    const lay = store.layout, s = store.state;
    const left = camera.x - 400, right = camera.x + camera.viewW + 400;
    const byId = new Map(s.items.map((i) => [i.id, i]));
    const parentOf = (id) => byId.get(id);
    const list = [];
    const add = (kind, obj, b, art, x0) => {
      const wb = { x: b.x + x0, y: b.y, w: b.w, h: b.h };
      if (wb.x + wb.w < left || wb.x > right) return;
      list.push({ kind, obj, b: wb, art, depth: depthOf(kind, obj, parentOf) });
    };
    for (const i0 of s.items) {
      if (drag && drag.kind === 'item' && drag.id === i0.id) continue;
      const o = visit?.dragOverride('item', i0.id) || pets?.override(i0.id), i = o ? { ...i0, ...o } : i0; // друг тянет её / животное идёт само // животное идёт само — его место сейчас у «ума»
      if (drag && drag.kind === 'item' && i.on?.id === drag.id) { // едет вместе с мебелью в руке
        if (isHidden(i, parentOf)) continue;
        const r = lay.byId.get(i.room), def = itemDef(i.def);
        if (carried && r && def) { const b = itemBounds(i); carried.push({ kind: 'item', obj: i, art: def.art, b: { x: b.x + r.x0, y: b.y, w: b.w, h: b.h } }); }
        continue;
      }
      if (i.inv) continue; // в шкафчике — не в доме
      if (i.on && cooking?.get(i.on.id)?.mc.hide) continue; // ушли внутрь работающего прибора
      if (isHidden(i, parentOf)) continue; // внутри закрытого холодильника — за дверью не видно
      const def = itemDef(i.def), r = lay.byId.get(i.room); if (!r || !def) continue;
      let b = itemBounds(i);
      if (i.lift) b = { ...b, y: b.y - i.lift }; // игрушка в пасти у животного
      if (i.open && def.openBox) { const [ox, oy, ow, oh] = def.openBox; b = { x: b.x + ox * b.w, y: b.y + oy * b.h, w: ow * b.w, h: oh * b.h }; } // своя «открытая» картинка другого размера
      add('item', i, b, i.open && def.openArt ? def.openArt : i.full && def.fullArt ? def.fullArt : def.art, r.x0); // миска с кормом — своя картинка
    }
    for (const c0 of s.chars) {
      if (mode.design) break; // в редакторе героев не видно — не мешают расставлять мебель
      const o = visit?.dragOverride('char', c0.id), c = o ? { ...c0, ...o } : c0; // друг несёт героя
      if (drag && drag.kind === 'char' && drag.id === c.id) continue;
      const r = lay.byId.get(c.room); if (!r) continue;
      add('char', c, charBounds(c), CHARS[c.id].art, r.x0);
      if (c.seat && list.at(-1)?.obj === c) { const h = charHitBox(c); list.at(-1).hb = { x: h.x + r.x0, y: h.y, w: h.w, h: h.h }; }
    }
    // Гости (друзья в моём доме или я сам у друга) — такие же герои.
    if (!mode.design) for (const v0 of visit?.visitors() || []) {
      if (drag && drag.kind === 'char' && drag.id === v0.id) continue;
      const o = visit.dragOverride('char', v0.id), v = o ? { ...v0, ...o } : v0; // гость несёт своего героя
      const r = lay.byId.get(v.room); if (!r || !CHARS[v.id]) continue;
      add('char', v, charBounds(v), CHARS[v.id].art, r.x0);
    }
    list.sort((a, b) => a.depth - b.depth);
    return list;
  }

  function hitTest(e, wx, wy) {
    const pad = e.kind === 'char' ? 6 : 10;
    if (e.hb) return wx >= e.hb.x && wx <= e.hb.x + e.hb.w && wy >= e.hb.y && wy <= e.hb.y + e.hb.h; // сидит/лежит — по рамке
    const b = e.b;
    if (wx < b.x - pad || wx > b.x + b.w + pad || wy < b.y - pad || wy > b.y + b.h + pad) return false;
    const m = maskOf(e.art);
    if (!m) return true;
    // Проверяем прозрачность в небольшом круге: тонкие ножки стола тоже легко взять.
    for (const [dx, dy] of [[0, 0], [-14, 0], [14, 0], [0, -14], [0, 14]]) {
      const u = Math.floor(((wx + dx - b.x) / b.w) * m.w), v = Math.floor(((wy + dy - b.y) / b.h) * m.h);
      if (u >= 0 && v >= 0 && u < m.w && v < m.h && m.a[v * m.w + u] > 40) return true;
    }
    return false;
  }

  function hit(wx, wy) {
    const list = entries(null);
    for (let i = list.length - 1; i >= 0; i--) if (hitTest(list[i], wx, wy)) return list[i];
    return null;
  }

  // Спрайт с анимацией: смещение, поворот и «сплющивание» вокруг нижней точки.
  function drawSprite(art, b, { glow = false, pose = null, tilt = 0, after = null } = {}) {
    const im = img(art); if (!im) return;
    const rot = (pose?.rot || 0) + tilt, sx = pose?.sx || 1, sy = pose?.sy || 1;
    ctx.save();
    ctx.translate(b.x + b.w / 2 + (pose?.dx || 0), b.y + b.h + (pose?.dy || 0));
    if (rot) ctx.rotate(rot);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    // «Поднятая» вещь: чуть крупнее, без размытой тени (shadowBlur на телефоне очень дорогой).
    if (glow) ctx.scale(1.06, 1.06);
    ctx.drawImage(im, -b.w / 2, -b.h, b.w, b.h);
    if (after) after(-b.w / 2, -b.h, b.w, b.h); // рисунок поверх (экран телевизора) — качается вместе с вещью
    ctx.restore();
  }

  // Животное на скелете: общая поза (прыжок, сплющивание) + движения частей (дыхание, хвост, шаги).
  function drawAnimalItem(obj, b, pose, opts = {}) {
    const rig = getAnimal(obj.def); if (!rig) return false;
    const rot = (pose?.rot || 0) + (opts.tilt || 0);
    ctx.save();
    ctx.translate(b.x + b.w / 2 + (pose?.dx || 0), b.y + b.h + (pose?.dy || 0));
    if (rot) ctx.rotate(rot);
    if (pose && (pose.sx !== 1 || pose.sy !== 1)) ctx.scale(pose.sx || 1, pose.sy || 1);
    if (opts.lift) ctx.scale(1.06, 1.06);
    drawAnimal(ctx, rig, { x: -b.w / 2, y: -b.h, w: b.w, h: b.h }, animalPose(obj.id, { ...opts, rig }), opts.flip ?? !!obj.flip);
    ctx.restore();
    return true;
  }

  // Мокрое животное: лужица, а вышло из-под воды — отряхивается (брызги в стороны). Всегда true.
  function wetAnimal(e) {
    const key = 'item:' + e.obj.id, wl = wetness(key);
    if (!wl) return true;
    if (!e.obj.on) drawPuddle(ctx, e.b.x + e.b.w / 2, e.b.y + e.b.h, e.b.w * 0.6, wl);
    if (wantsShake(key)) animalAnims.shake(e.obj.id);
    afterAnimal.push(e);
    animating = true;
    return true;
  }
  let afterAnimal = [];
  function drawAnimalWet(e) {
    const key = 'item:' + e.obj.id, wl = wetness(key), p = animalAnims.progress(e.obj.id, 'shake');
    if (p !== null) drawShakeSpray(ctx, e.b, p, e.obj.id);
    if (wl) drawDrips(ctx, e.b, wl * 0.8, e.obj.id * 5, [0.35, 0.6]);
  }

  // Герой по частям: общая поза (прыжок, сплющивание) + движения костей (дыхание, взмах, болтание ногами).
  function drawHeroRig(id, b, pose, opts = {}) {
    ctx.save();
    ctx.translate(b.x + b.w / 2 + (pose?.dx || 0), b.y + b.h + (pose?.dy || 0));
    if (pose?.rot) ctx.rotate(pose.rot);
    if (pose && (pose.sx !== 1 || pose.sy !== 1)) ctx.scale(pose.sx || 1, pose.sy || 1);
    const held = store.state.items.filter((i) => i.held?.by === id && !(curDrag?.kind === 'item' && curDrag.id === i.id)).map((i) => {
      const def = itemDef(i.def), sz = sizeOf(def);
      return { im: img(def.art), w: sz.w, h: sz.h, bites: i.bites || 0, drink: !!def.drink };
    });
    drawRig(ctx, getRig(id), { x: -b.w / 2, y: -b.h, w: b.w, h: b.h }, heroPose(id, { ...opts, holding: held.length > 0 }), held);
    ctx.restore();
  }

  // ── Включённые вещи ──
  // Экран телевизора: короткая «вспышка» включения, потом мультик — небо, облака, солнце и мячик.
  const litSince = new Map(); // id → когда включили (для вспышки)
  const tnow = () => performance.now() / 1000;
  function drawScreen(x, y, w, h, since) {
    const t = tnow(), age = t - since;
    ctx.save();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.04) : ctx.rect(x, y, w, h); ctx.clip();
    if (age < 0.35) { // старый телевизор: белая полоска раскрывается в картинку
      ctx.fillStyle = '#1d2230'; ctx.fillRect(x, y, w, h);
      const q = age / 0.35, lh = Math.max(2, h * q * q);
      ctx.fillStyle = '#f4fbff'; ctx.fillRect(x + w * 0.5 * (1 - Math.min(1, q * 3)), y + (h - lh) / 2, w * Math.min(1, q * 3), lh);
      ctx.restore(); return;
    }
    const sky = ctx.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#7fd3ff'); sky.addColorStop(1, '#d9f4ff');
    ctx.fillStyle = sky; ctx.fillRect(x, y, w, h);
    // солнце покачивается
    const sx = x + w * 0.8, sy = y + h * (0.26 + 0.04 * Math.sin(t * 1.6)), sr = h * 0.13;
    ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = h * 0.025; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = t * 0.8 + (i * Math.PI) / 4;
      ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * sr * 1.3, sy + Math.sin(a) * sr * 1.3); ctx.lineTo(sx + Math.cos(a) * sr * 1.65, sy + Math.sin(a) * sr * 1.65); ctx.stroke();
    }
    // облака плывут
    ctx.fillStyle = '#ffffff';
    for (const [k, cy, sp] of [[0, 0.22, 0.05], [0.55, 0.38, 0.035]]) {
      const cx = x + (((k + t * sp) % 1.3) - 0.15) * w, r = h * 0.07;
      ctx.beginPath(); ctx.arc(cx, y + h * cy, r, 0, Math.PI * 2); ctx.arc(cx + r * 1.1, y + h * cy - r * 0.4, r * 1.2, 0, Math.PI * 2); ctx.arc(cx + r * 2.3, y + h * cy, r, 0, Math.PI * 2); ctx.fill();
    }
    // холмы
    ctx.fillStyle = '#7ccf6a';
    ctx.beginPath(); ctx.ellipse(x + w * 0.25, y + h * 1.05, w * 0.45, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#63bb57';
    ctx.beginPath(); ctx.ellipse(x + w * 0.85, y + h * 1.1, w * 0.5, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // мячик прыгает и сплющивается у земли
    const ph = (t * 1.4) % 1, up = 4 * ph * (1 - ph), ground = y + h * 0.8, br = h * 0.11;
    const squash = up < 0.12 ? 1 - (0.12 - up) * 2 : 1;
    const bx = x + w * (0.3 + 0.12 * Math.sin(t * 0.7)), by = ground - br * squash - up * h * 0.45;
    ctx.fillStyle = 'rgba(40,80,40,.25)'; ctx.beginPath(); ctx.ellipse(bx, ground + 2, br * (1.2 - up * 0.5), br * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff5d6c'; ctx.beginPath(); ctx.ellipse(bx, by, br * (2 - squash), br * squash, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(bx - br * 0.3, by - br * 0.35 * squash, br * 0.25, br * 0.18, -0.5, 0, Math.PI * 2); ctx.fill();
    // блик на стекле
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.45, y); ctx.lineTo(x + w * 0.2, y + h); ctx.lineTo(x, y + h); ctx.fill();
    ctx.restore();
  }
  // Работающий прибор: внутри крутятся продукты (барабан, чаша блендера), идёт пар или светится.
  function drawMachineFx(ck, x, y, w, h) {
    const t = tnow() - ck.t0, p = Math.min(1, t / ck.dur), [ax, ay, ar] = ck.mc.at;
    const cx = x + ax * w, cy = y + ay * h, fade = Math.min(1, t * 4, (1 - p) * 6);
    if (ck.mc.fx === 'spin') {
      const r = ar * w;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = fade;
      // вода: волна, наклоняется в сторону вращения
      ctx.fillStyle = 'rgba(120,190,245,.55)';
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r);
      for (let k = 0; k <= 12; k++) { const qx = -r + (2 * r * k) / 12; ctx.lineTo(cx + qx, cy - r * 0.05 + Math.sin(k * 0.9 + t * 9) * r * 0.08 + qx * 0.25); }
      ctx.lineTo(cx + r, cy + r); ctx.fill();
      // продукты кружатся
      const n = Math.max(1, ck.kids.length), sz = r * (n > 1 ? 0.75 : 0.95);
      ck.kids.forEach((d, k) => {
        const im = img(itemDef(d)?.art); if (!im) return;
        const a = t * 7 + (k * Math.PI * 2) / n, rr = r * (n > 1 ? 0.42 : 0.28);
        const iw = im.width >= im.height ? sz : sz * im.width / im.height, ih = im.width >= im.height ? sz * im.height / im.width : sz;
        ctx.save(); ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); ctx.rotate(a * 1.3); ctx.drawImage(im, -iw / 2, -ih / 2, iw, ih); ctx.restore();
      });
      // пузырьки и пена
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let k = 0; k < 9; k++) { const a = t * 5 + k * 0.7, rr = r * (0.3 + 0.6 * ((k * 0.37) % 1)); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, r * (0.04 + 0.03 * ((k * 0.61) % 1)), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      // блик стекла
      ctx.save(); ctx.globalAlpha = 0.5 * fade; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * 0.07); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke(); ctx.restore();
    } else if (ck.mc.fx === 'steam') {
      ctx.save();
      for (let k = 0; k < 8; k++) {
        const q = (t * 0.7 + k / 8) % 1, s = w / 300;
        ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - q) * fade})`;
        ctx.beginPath(); ctx.arc(cx + Math.sin(k * 2.3 + t * 2) * w * ar * 0.5 * q + (k % 3 - 1) * w * ar * 0.4, cy - q * h * 0.55, (10 + q * 30) * s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (ck.mc.fx === 'glow') {
      drawGlow(cx, cy, w * ar * 2.2, (0.7 + 0.25 * Math.sin(t * 7)) * fade);
    }
  }
  // Звёздочки вокруг только что приготовленного.
  function drawSparkles(list) {
    if (!sparkles.size) return;
    const t = tnow();
    for (const [id, t0] of sparkles) {
      const q = (t - t0) / 1.1; if (q >= 1) { sparkles.delete(id); continue; }
      const e = list.find((x) => x.kind === 'item' && x.obj.id === id); if (!e || q < 0) { animating = true; continue; }
      const cx = e.b.x + e.b.w / 2, cy = e.b.y + e.b.h / 2, R = Math.max(e.b.w, e.b.h) * 0.6;
      ctx.save(); ctx.fillStyle = '#ffd84a'; ctx.globalAlpha = 1 - q;
      for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + q * 1.5, rr = R * (0.6 + 0.5 * q), s = 9 * (1 - q * 0.6) * (k % 2 ? 0.7 : 1);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.8;
        ctx.beginPath(); for (let j = 0; j < 8; j++) { const rad = j % 2 ? s * 0.35 : s; ctx.lineTo(x + Math.cos(j * Math.PI / 4) * rad, y + Math.sin(j * Math.PI / 4) * rad); } ctx.fill();
      }
      ctx.restore(); animating = true;
    }
  }
  // Тёплый свет торшера (рисуется «добавлением» цвета — ночью особенно заметно).
  function drawGlow(cx, cy, r, strength) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
    g.addColorStop(0, `rgba(255,214,130,${0.55 * strength})`);
    g.addColorStop(0.35, `rgba(255,190,100,${0.22 * strength})`);
    g.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2); ctx.restore();
  }
  // То же преобразование, что у drawSprite, но для «детей»: поворот и сплющивание вокруг низа родителя.
  function applyPose(b, pose) {
    const px = b.x + b.w / 2, py = b.y + b.h;
    ctx.translate(px + (pose.dx || 0), py + (pose.dy || 0));
    if (pose.rot) ctx.rotate(pose.rot);
    if (pose.sx !== 1 || pose.sy !== 1) ctx.scale(pose.sx || 1, pose.sy || 1);
    ctx.translate(-px, -py);
  }
  let animating = false, idleHeroes = false; // idleHeroes — на экране герои (дышат: нужны редкие кадры) // в этом кадре на экране идёт мультик — нужен следующий кадр
  const sway = { angle: 0 }; // задаёт main.js (качание от прокрутки)
  const keyOf = (e) => (e.kind === 'char' ? 'char:' : 'item:') + e.obj.id;

  function shadowUnder(b) {
    ctx.fillStyle = 'rgba(90,60,30,.16)';
    ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h - 3, b.w * 0.34, 9, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Подсказка без слов: светящаяся полоска там, куда приземлится вещь (полка, столешница, сиденье).
  // Лежащего героя укрываем: часть картинки кровати (одеяло) — ещё раз поверх него.
  function drawCover(pe) {
    const def = pe && itemDef(pe.obj.def), im = def?.cover && img(pe.art);
    if (!im) return;
    const [a, b2, c, d] = def.cover, b = pe.b;
    ctx.save(); // качание кровати уже применено (герой рисуется в её «цепочке»)
    ctx.beginPath();
    if (def.coverPoly) def.coverPoly.forEach(([fx, fy], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, b.x + fx * b.w, b.y + fy * b.h)); // по краю одеяла — подушка не режет героя
    else ctx.rect(b.x + a * b.w, b.y + b2 * b.h, (c - a) * b.w, (d - b2) * b.h);
    ctx.clip();
    ctx.drawImage(im, b.x, b.y, b.w, b.h);
    ctx.restore();
  }
  // Спит: над головой всплывают «z» (картинка, читать не нужно).
  // Смайлики над героями (👋 ❤️ 😂 …): выпрыгивают, висят и тают.
  function drawEmotes(list) {
    for (const m of visit?.emotesNow() || []) {
      const e = list.find((x) => x.kind === 'char' && x.obj.id === m.who); if (!e) continue;
      const pop = Math.min(1, m.age / 0.25), fade = m.age > 2.1 ? Math.max(0, 1 - (m.age - 2.1) / 0.5) : 1;
      const s = pop < 1 ? 0.5 + pop * 0.7 : 1.2 - Math.min(0.2, (m.age - 0.25) * 0.8);
      const cx = e.b.x + e.b.w * 0.75, cy = e.b.y - 62 - m.age * 10; // выше имени
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(cx, cy); ctx.scale(s, s);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#c9a477'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-14, 30); ctx.lineTo(-30, 52); ctx.lineTo(4, 36); ctx.closePath(); ctx.fill();
      ctx.font = '44px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.e, 0, 3);
      ctx.restore();
      animating = true;
    }
  }

  // Имя гостя над головой (белая плашка).
  function drawNameTag(e) {
    const name = e.obj.nick || ''; if (!name) return;
    const cx = e.b.x + e.b.w / 2, y = e.b.y + 4;
    ctx.save();
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(name).width + 22;
    ctx.fillStyle = e.obj.own ? '#fff3c8' : '#ffffffe8'; ctx.strokeStyle = '#c9a477'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - w / 2, y - 16, w, 32, 16) : ctx.rect(cx - w / 2, y - 16, w, 32); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5a3b1f'; ctx.fillText(name, cx, y + 1);
    ctx.restore();
  }
  function drawZzz(e) {
    const t = tnow(), k = e.b.h / 873, hx = e.b.x + e.b.w / 2 - 60 * k, hy = e.b.y + e.b.h - 293 * k - 230 * k;
    ctx.save();
    ctx.fillStyle = '#7f8fd9'; ctx.textAlign = 'center';
    for (let j = 0; j < 3; j++) {
      const q = (t * 0.45 + j / 3) % 1;
      ctx.globalAlpha = Math.sin(q * Math.PI);
      ctx.font = `bold ${Math.round(18 + q * 16)}px sans-serif`;
      ctx.fillText('z', hx + q * 40 + Math.sin(q * 6 + j) * 6, hy - q * 70);
    }
    ctx.restore(); // кадры — редкие, как у дышащих героев (idleHeroes)
  }

  function drawLanding(drag) {
    const on = drag?.target?.pos?.on || drag?.target?.pos?.seat;
    if (!on) return;
    const parent = store.state.items.find((i) => i.id === on.id);
    const sf = parent && (drag.target.pos.seat ? seatsOf : surfacesOf)(parent)[on.s];
    if (!sf) return;
    const x0 = drag.target.r.x0;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,240,170,.95)'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,214,110,.45)'; ctx.lineWidth = 18;
    ctx.beginPath(); ctx.moveTo(x0 + sf.x0 + 6, sf.y); ctx.lineTo(x0 + sf.x1 - 6, sf.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,190,.95)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(x0 + sf.x0 + 6, sf.y); ctx.lineTo(x0 + sf.x1 - 6, sf.y); ctx.stroke();
    ctx.restore();
  }

  function drawPartitions() {
    const lay = store.layout;
    const left = camera.x - 60, right = camera.x + camera.viewW + 60;
    // Балка под потолком по всему дому (кроме лужайки).
    const first = lay.list.find((r) => r.room.type !== 'lawn');
    if (first) {
      const x = Math.max(first.x0, left), w = Math.min(lay.width, right) - x;
      if (w > 0) { ctx.fillStyle = '#c99158'; ctx.fillRect(x, 0, w, 16); ctx.fillStyle = 'rgba(80,50,25,.25)'; ctx.fillRect(x, 16, w, 4); }
    }
    for (const r of lay.list) {
      if (r.index === 0) continue;
      if (r.x0 < left || r.x0 > right) continue;
      const facade = lay.list[r.index - 1].room.type === 'lawn';
      const w = facade ? 44 : 26;
      ctx.fillStyle = facade ? '#b9804c' : '#c99158';
      ctx.strokeStyle = '#8a5a33'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(r.x0 - w / 2, -4, w, VIEW_H + 8, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,210,.35)'; ctx.fillRect(r.x0 - w / 2 + 5, 0, 5, VIEW_H);
    }
  }

  function drawGuides(roomId) {
    const r = store.layout.byId.get(roomId); if (!r) return;
    ctx.save(); ctx.lineWidth = 4; ctx.setLineDash([16, 10]); ctx.font = '600 24px system-ui, sans-serif';
    for (const [y, color, label] of [[r.room.split * VIEW_H, '#b4703c', 'Граница стены и пола'], [r.room.walkTop * VIEW_H, '#3f8a62', 'Здесь начинают ходить герои']]) {
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(r.x0, y); ctx.lineTo(r.x1, y); ctx.stroke();
      const x = Math.max(r.x0, camera.x) + 30;
      ctx.fillStyle = 'rgba(255,250,240,.92)'; ctx.fillRect(x - 10, y - 38, ctx.measureText(label).width + 20, 32);
      ctx.fillStyle = color; ctx.fillText(label, x, y - 13);
    }
    ctx.fillStyle = 'rgba(80,160,110,.12)'; ctx.fillRect(r.x0, r.room.walkTop * VIEW_H, r.room.width, VIEW_H * 0.95 - r.room.walkTop * VIEW_H);
    ctx.restore();
  }

  let curDrag = null; // что сейчас в руке у игрока (для рисования героев)
  function draw(drag, nightLevel, guidesRoomId) {
    curDrag = drag;
    const lay = store.layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f3dfbd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const r of lay.list) {
      if (r.x1 < camera.x || r.x0 > camera.x + camera.viewW) continue;
      ctx.drawImage(backgroundFor(r.room, k), Math.round((r.x0 - camera.x) * k), 0);
    }
    ctx.setTransform(k, 0, 0, k, -camera.x * k, 0);
    const carried = [];
    const list = entries(drag, carried);
    const lights = []; animating = false; idleHeroes = false; afterAnimal = [];
    // Сначала позы всех вещей: вещь на мебели повторяет движение мебели (качнули шкаф — молоко качается с ним).
    const byId = new Map();
    for (const e of list) {
      let pose = anims.pose(keyOf(e));
      // Качание мелочи при резкой прокрутке (у каждой вещи — свой размах, чтобы не качались строем).
      if (sway.angle && e.kind === 'item' && isSmall(itemDef(e.obj.def))) {
        const r = sway.angle * (0.75 + (e.obj.id % 5) * 0.12);
        pose = pose ? { ...pose, rot: pose.rot + r } : { dx: 0, dy: 0, rot: r, sx: 1, sy: 1 };
      }
      e.pose = pose;
      if (e.kind === 'item') byId.set(e.obj.id, e);
    }
    // Кого может намочить вода (герои и животные): рамка тела в мире.
    const wetBoxes = [];
    for (const e of list) {
      if (e.kind === 'char' && getRig(e.obj.id) && !e.obj.seat?.lie) { const h = e.hb || e.b; wetBoxes.push({ key: 'char:' + e.obj.id, x0: h.x + h.w * 0.22, y0: h.y + h.h * 0.04, x1: h.x + h.w * 0.78, y1: h.y + h.h }); }
      else if (e.kind === 'item' && itemDef(e.obj.def)?.animal) wetBoxes.push({ key: 'item:' + e.obj.id, x0: e.b.x + e.b.w * 0.12, y0: e.b.y + e.b.h * 0.1, x1: e.b.x + e.b.w * 0.88, y1: e.b.y + e.b.h });
    }
    const lateWater = []; // вода, которая бьёт по герою, — поверх него
    for (const e of list) {
      const pose = e.pose;
      if (!pose || pose.dy > -20) {
        if ((e.kind === 'char' && !e.obj.seat) || (itemDef(e.obj.def)?.place === 'floor' && !itemDef(e.obj.def)?.layer && !e.obj.on)) shadowUnder(e.b);
      }
      const chain = [];
      for (let p = byId.get(e.kind === 'item' ? e.obj.on?.id : e.obj.seat?.id), n = 0; p && n < 6; p = byId.get(p.obj.on?.id), n++) if (p.pose) chain.unshift(p);
      if (chain.length) { ctx.save(); for (const p of chain) applyPose(p.b, p.pose); }
      const power = e.kind === 'item' && e.obj.lit ? itemDef(e.obj.def)?.power : null;
      let after = null;
      if (power) {
        if (!litSince.has(e.obj.id)) litSince.set(e.obj.id, tnow());
        after = (x, y, w, h) => {
          const m = ctx.getTransform(); // запоминаем положение — ночью свет рисуется ещё раз поверх темноты
          lights.push({ m, power, x, y, w, h, since: litSince.get(e.obj.id) });
          if (power.water) {
            // Струя падает на героя/животное — разбивается о него, а он мокнет. Такую воду рисуем поверх всех.
            const ox = e.b.x + e.b.w / 2 + (e.pose?.dx || 0), oy = e.b.y + e.b.h + (e.pose?.dy || 0);
            const cut = cutStreams(waterParams(power.water, x, y, w, h), wetBoxes.map((o) => ({ key: o.key, x0: o.x0 - ox, y0: o.y0 - oy, x1: o.x1 - ox, y1: o.y1 - oy })));
            for (const k2 of cut.hits) soak(k2);
            if (cut.hits.length) lateWater.push({ m: ctx.getTransform(), params: cut.params }); else drawWater(ctx, tnow(), cut.params);
            animating = true;
          }
          if (power.screen) { const [a, b2, c, d] = power.screen; drawScreen(x + a * w, y + b2 * h, (c - a) * w, (d - b2) * h, litSince.get(e.obj.id)); animating = true; }
        };
      }
      const ck = e.kind === 'item' && cooking?.get(e.obj.id);
      if (ck) { const prev = after; after = (x, y, w, h) => { prev?.(x, y, w, h); drawMachineFx(ck, x, y, w, h); }; animating = true; }
      if (e.kind === 'item' && e.obj.held) continue; // в руке — рисуется вместе с героем
      if (e.kind === 'item' && itemDef(e.obj.def)?.animal && wetAnimal(e) && drawAnimalItem(e.obj, e.b, pose, { sleep: (nightLevel > 0.5 && (!e.obj.on || itemDef(byId.get(e.obj.on.id)?.obj.def)?.pet === 'bed')) || pets?.poseOf(e.obj.id) === 'nap', sniff: ['sniff', 'eat', 'chew'].includes(pets?.poseOf(e.obj.id)), walk: pets?.walkOf(e.obj.id) })) { if (afterAnimal.at(-1) === e) drawAnimalWet(e); idleHeroes = true; if (chain.length) ctx.restore(); continue; }
      if (e.kind === 'char' && getRig(e.obj.id)) {
        const seat = e.obj.seat ? (e.obj.seat.lie ? 'lie' : 'sit') : null;
        const wl = wetness('char:' + e.obj.id);
        if (wl && !seat) drawPuddle(ctx, e.b.x + e.b.w / 2, e.b.y + e.b.h, e.b.w * 0.5, wl);
        drawHeroRig(e.obj.id, e.b, pose, { reach: drag?.hero === e.obj.id, seat, covered: !!seat && !!itemDef(byId.get(e.obj.seat.id)?.obj.def)?.cover });
        if (seat === 'sit' && itemDef(byId.get(e.obj.seat.id)?.obj.def)?.cover) drawCover(byId.get(e.obj.seat.id)); // сидит в ванне — бортик перед ним
        if (wl && !(seat && itemDef(byId.get(e.obj.seat.id)?.obj.def)?.cover)) { const g = e.hb ? e.hb.y + e.hb.h : e.b.y + e.b.h; drawDrips(ctx, e.b, wl, e.obj.id.length * 17, [0.1, 0.62], g); animating = true; } // с мокрого капает (в ванне — нет: капли внутри)
        if (seat === 'lie') {
          const bed = byId.get(e.obj.seat.id);
          drawCover(bed); // одеяло поверх туловища
          if (itemDef(bed?.obj.def)?.cover) drawHeroRig(e.obj.id, e.b, pose, { seat, covered: true, arms: true }); // а руки — поверх одеяла
          drawZzz(e);
        }
        if (e.obj.visitor) drawNameTag(e); // гость — с именем над головой
        idleHeroes = true;
      }
      else drawSprite(e.art, e.b, { pose, after });
      if (chain.length) ctx.restore();
    }
    drawEmotes(list);
    drawSparkles(list);
    for (const L of lateWater) { ctx.save(); ctx.setTransform(L.m); drawWater(ctx, tnow(), L.params); ctx.restore(); }
    drawPartitions();
    if (guidesRoomId) drawGuides(guidesRoomId);
    if (drag && drag.kind !== 'pan') {
      if (!drag.hero) drawLanding(drag); // над героем — не показываем, куда упадёт: герой возьмёт
      ctx.globalAlpha = drag.valid ? 1 : 0.6;
      ctx.fillStyle = 'rgba(70,45,20,.18)'; // тень под вещью в руке
      if (drag.walk) shadowUnder(drag.b); // идёт — тень прямо под ногами
      else { ctx.beginPath(); ctx.ellipse(drag.b.x + drag.b.w / 2, drag.b.y + drag.b.h + 18, drag.b.w * 0.32, 10, 0, 0, Math.PI * 2); ctx.fill(); }
      if (drag.kind === 'item' && itemDef(drag.obj.def)?.animal && getAnimal(drag.obj.def)) {
        if (drag.walk) drawAnimalItem(drag.obj, drag.b, null, { walk: drag.walk, flip: drag.walk.dir < 0 }); // идёт само по полу
        else drawAnimalItem(drag.obj, drag.b, null, { carried: true, tilt: drag.tilt || 0, lift: true });
      } else if (drag.kind === 'char' && getRig(drag.id) && drag.walk) drawHeroRig(drag.id, drag.b, null, { walk: drag.walk }); // идёт сам по полу
      else if (drag.kind === 'char' && getRig(drag.id)) drawHeroRig(drag.id, drag.b, { dx: 0, dy: 0, rot: drag.tilt || 0, sx: 1.06, sy: 1.06 }, { carried: true, tilt: drag.tilt || 0 });
      else drawSprite(drag.art, drag.b, { glow: true, tilt: drag.tilt || 0 });
      const dwl = wetness((drag.kind === 'char' ? 'char:' : 'item:') + drag.id);
      if (dwl) { drawDrips(ctx, drag.b, dwl, 99, [0.1, 0.7], drag.b.y + drag.b.h + 18); animating = true; } // несёшь мокрого — капает
      // Вещи с полок и столешницы едут вместе с мебелью.
      if (carried.length && drag.from) {
        const ddx = drag.b.x - drag.from.x, ddy = drag.b.y - drag.from.y;
        const px = drag.b.x + drag.b.w / 2, py = drag.b.y + drag.b.h; // наклоняются вместе с мебелью
        ctx.save(); ctx.translate(px, py); ctx.rotate(drag.tilt || 0); ctx.translate(-px, -py);
        for (const c of carried) drawSprite(c.art, { ...c.b, x: c.b.x + ddx, y: c.b.y + ddy });
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    if (nightLevel > 0.01) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(28,40,85,${nightLevel * 0.38})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Свет поверх всего (и поверх ночной темноты): экран светится, торшер греет комнату.
    for (const L of lights) {
      ctx.setTransform(L.m);
      if (L.power.screen && nightLevel > 0.01) {
        const [a, b2, c, d] = L.power.screen;
        ctx.globalAlpha = Math.min(1, nightLevel * 0.9);
        drawScreen(L.x + a * L.w, L.y + b2 * L.h, (c - a) * L.w, (d - b2) * L.h, L.since);
        ctx.globalAlpha = 1;
        drawGlow(L.x + (a + c) / 2 * L.w, L.y + (b2 + d) / 2 * L.h, L.w * 0.7, 0.25 + nightLevel * 0.35);
      }
      if (L.power.glow) { const [gx, gy, gr] = L.power.glow; drawGlow(L.x + gx * L.w, L.y + gy * L.h, L.w * gr * (2.2 + 1.3 * nightLevel), 0.5 + nightLevel * 0.7); }
    }
    for (const id of litSince.keys()) if (!store.state.items.find((i) => i.id === id && i.lit)) litSince.delete(id);
  }

  // Подготовить фоны всех комнат, начиная с ближайших к камере.
  function warmup() {
    const mid = camera.x + camera.viewW / 2;
    const order = [...store.layout.list].sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - mid) - Math.abs((b.x0 + b.x1) / 2 - mid)).map((r) => r.room);
    prewarm(store.state.rooms, k, order);
  }

  // Медленный телефон: снизить чёткость на ступень (до 3 раз). Возвращает true, если снизили.
  function lowerQuality() {
    if (quality <= 0.62) return false;
    quality = Math.round((quality - 0.13) * 100) / 100;
    resize(lastCss[0], lastCss[1]);
    warmup();
    return true;
  }

  return { setCooking(c) { cooking = c; }, sparkle(ids) { const t = tnow() + 0.45; for (const id of ids) sparkles.set(id, t); }, setPets(p) { pets = p; }, setVisit(v) { visit = v; }, sway, get animating() { return animating; }, get idleHeroes() { return idleHeroes; }, resize, draw, hit, warmup, lowerQuality, get quality() { return quality; }, get scale() { return k; } };
}
