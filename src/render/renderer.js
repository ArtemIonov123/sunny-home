// Отрисовка дома. Рисуются только комнаты, которые попадают на экран.
// Поиск вещи под пальцем использует ТОТ ЖЕ список и порядок, что и отрисовка,
// поэтому палец всегда хватает то, что видно сверху.
import { VIEW_H, MAX_DPR } from '../config.js';
import { itemDef, CHARS } from '../core/catalog.js';
import { img, maskOf } from '../assets.js';
import { itemBounds, charBounds, charHitBox, depthOf } from '../core/placement.js';
import { backgroundFor, clearBackgrounds, prewarm } from './background.js';
import { anims } from './anims.js';
import { drawWater, waterParams } from './water.js';
import { getRig, drawRig, heroPose } from './rig.js';
import { getAnimal, drawAnimal, animalPose } from './animal.js';
import { sizeOf } from '../assets.js';
import { mode } from '../ui/mode.js';
import { surfacesOf, seatsOf, isHidden, isSmall } from '../core/physics.js';

export function createRenderer(canvas, store, camera) {
  // alpha:false — непрозрачный холст дешевле передавать на экран.
  const ctx = canvas.getContext('2d', { alpha: false });
  let k = 1;
  let pets = null; // «ум» животных (core/pets.js): где животное, пока идёт само

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
      const o = pets?.override(i0.id), i = o ? { ...i0, ...o } : i0; // животное идёт само — его место сейчас у «ума»
      if (drag && drag.kind === 'item' && i.on?.id === drag.id) { // едет вместе с мебелью в руке
        if (isHidden(i, parentOf)) continue;
        const r = lay.byId.get(i.room), def = itemDef(i.def);
        if (carried && r && def) { const b = itemBounds(i); carried.push({ kind: 'item', obj: i, art: def.art, b: { x: b.x + r.x0, y: b.y, w: b.w, h: b.h } }); }
        continue;
      }
      if (i.inv) continue; // в шкафчике — не в доме
      if (isHidden(i, parentOf)) continue; // внутри закрытого холодильника — за дверью не видно
      const def = itemDef(i.def), r = lay.byId.get(i.room); if (!r || !def) continue;
      let b = itemBounds(i);
      if (i.open && def.openBox) { const [ox, oy, ow, oh] = def.openBox; b = { x: b.x + ox * b.w, y: b.y + oy * b.h, w: ow * b.w, h: oh * b.h }; } // своя «открытая» картинка другого размера
      add('item', i, b, i.open && def.openArt ? def.openArt : def.art, r.x0);
    }
    for (const c of s.chars) {
      if (mode.design) break; // в редакторе героев не видно — не мешают расставлять мебель
      if (drag && drag.kind === 'char' && drag.id === c.id) continue;
      const r = lay.byId.get(c.room); if (!r) continue;
      add('char', c, charBounds(c), CHARS[c.id].art, r.x0);
      if (c.seat && list.at(-1)?.obj === c) { const h = charHitBox(c); list.at(-1).hb = { x: h.x + r.x0, y: h.y, w: h.w, h: h.h }; }
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
    const lights = []; animating = false; idleHeroes = false;
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
          if (power.water) { drawWater(ctx, tnow(), waterParams(power.water, x, y, w, h)); animating = true; }
          if (power.screen) { const [a, b2, c, d] = power.screen; drawScreen(x + a * w, y + b2 * h, (c - a) * w, (d - b2) * h, litSince.get(e.obj.id)); animating = true; }
        };
      }
      if (e.kind === 'item' && e.obj.held) continue; // в руке — рисуется вместе с героем
      if (e.kind === 'item' && itemDef(e.obj.def)?.animal && drawAnimalItem(e.obj, e.b, pose, { sleep: nightLevel > 0.5 && !e.obj.on, walk: pets?.walkOf(e.obj.id) })) { idleHeroes = true; if (chain.length) ctx.restore(); continue; }
      if (e.kind === 'char' && getRig(e.obj.id)) {
        const seat = e.obj.seat ? (e.obj.seat.lie ? 'lie' : 'sit') : null;
        drawHeroRig(e.obj.id, e.b, pose, { reach: drag?.hero === e.obj.id, seat, covered: seat === 'lie' && !!itemDef(byId.get(e.obj.seat.id)?.obj.def)?.cover });
        if (seat === 'lie') {
          const bed = byId.get(e.obj.seat.id);
          drawCover(bed); // одеяло поверх туловища
          if (itemDef(bed?.obj.def)?.cover) drawHeroRig(e.obj.id, e.b, pose, { seat, covered: true, arms: true }); // а руки — поверх одеяла
          drawZzz(e);
        }
        idleHeroes = true;
      }
      else drawSprite(e.art, e.b, { pose, after });
      if (chain.length) ctx.restore();
    }
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

  return { setPets(p) { pets = p; }, sway, get animating() { return animating; }, get idleHeroes() { return idleHeroes; }, resize, draw, hit, warmup, lowerQuality, get quality() { return quality; }, get scale() { return k; } };
}
