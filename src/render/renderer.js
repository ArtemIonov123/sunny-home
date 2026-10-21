// Отрисовка дома. Рисуются только комнаты, которые попадают на экран.
// Поиск вещи под пальцем использует ТОТ ЖЕ список и порядок, что и отрисовка,
// поэтому палец всегда хватает то, что видно сверху.
import { VIEW_H, MAX_DPR } from '../config.js';
import { itemDef, CHARS } from '../core/catalog.js';
import { img, maskOf } from '../assets.js';
import { itemBounds, charBounds, depthOf } from '../core/placement.js';
import { backgroundFor, clearBackgrounds, prewarm } from './background.js';
import { anims } from './anims.js';
import { mode } from '../ui/mode.js';
import { surfacesOf, isHidden, isSmall } from '../core/physics.js';

export function createRenderer(canvas, store, camera) {
  // alpha:false — непрозрачный холст дешевле передавать на экран.
  const ctx = canvas.getContext('2d', { alpha: false });
  let k = 1;

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
    for (const i of s.items) {
      if (drag && drag.kind === 'item' && drag.id === i.id) continue;
      if (drag && drag.kind === 'item' && i.on?.id === drag.id) { // едет вместе с мебелью в руке
        if (isHidden(i, parentOf)) continue;
        const r = lay.byId.get(i.room), def = itemDef(i.def);
        if (carried && r && def) { const b = itemBounds(i); carried.push({ kind: 'item', obj: i, art: def.art, b: { x: b.x + r.x0, y: b.y, w: b.w, h: b.h } }); }
        continue;
      }
      if (i.inv) continue; // в шкафчике — не в доме
      if (isHidden(i, parentOf)) continue; // внутри закрытого холодильника — за дверью не видно
      const def = itemDef(i.def), r = lay.byId.get(i.room); if (!r || !def) continue;
      add('item', i, itemBounds(i), i.open && def.openArt ? def.openArt : def.art, r.x0);
    }
    for (const c of s.chars) {
      if (mode.design) break; // в редакторе героев не видно — не мешают расставлять мебель
      if (drag && drag.kind === 'char' && drag.id === c.id) continue;
      const r = lay.byId.get(c.room); if (!r) continue;
      add('char', c, charBounds(c), CHARS[c.id].art, r.x0);
    }
    list.sort((a, b) => a.depth - b.depth);
    return list;
  }

  function hitTest(e, wx, wy) {
    const pad = e.kind === 'char' ? 6 : 10;
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
  function drawSprite(art, b, { glow = false, pose = null, tilt = 0 } = {}) {
    const im = img(art); if (!im) return;
    const rot = (pose?.rot || 0) + tilt, sx = pose?.sx || 1, sy = pose?.sy || 1;
    ctx.save();
    ctx.translate(b.x + b.w / 2 + (pose?.dx || 0), b.y + b.h + (pose?.dy || 0));
    if (rot) ctx.rotate(rot);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    // «Поднятая» вещь: чуть крупнее, без размытой тени (shadowBlur на телефоне очень дорогой).
    if (glow) ctx.scale(1.06, 1.06);
    ctx.drawImage(im, -b.w / 2, -b.h, b.w, b.h);
    ctx.restore();
  }
  const sway = { angle: 0 }; // задаёт main.js (качание от прокрутки)
  const keyOf = (e) => (e.kind === 'char' ? 'char:' : 'item:') + e.obj.id;

  function shadowUnder(b) {
    ctx.fillStyle = 'rgba(90,60,30,.16)';
    ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h - 3, b.w * 0.34, 9, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Подсказка без слов: светящаяся полоска там, куда приземлится вещь (полка, столешница, сиденье).
  function drawLanding(drag) {
    const on = drag?.target?.pos?.on;
    if (!on) return;
    const parent = store.state.items.find((i) => i.id === on.id);
    const sf = parent && surfacesOf(parent)[on.s];
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

  function draw(drag, nightLevel, guidesRoomId) {
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
    for (const e of entries(drag, carried)) {
      let pose = anims.pose(keyOf(e));
      // Качание мелочи при резкой прокрутке (у каждой вещи — свой размах, чтобы не качались строем).
      if (sway.angle && e.kind === 'item' && isSmall(itemDef(e.obj.def))) {
        const r = sway.angle * (0.75 + (e.obj.id % 5) * 0.12);
        pose = pose ? { ...pose, rot: pose.rot + r } : { dx: 0, dy: 0, rot: r, sx: 1, sy: 1 };
      }
      if (!pose || pose.dy > -20) {
        if (e.kind === 'char' || (itemDef(e.obj.def)?.place === 'floor' && !itemDef(e.obj.def)?.layer && !e.obj.on)) shadowUnder(e.b);
      }
      drawSprite(e.art, e.b, { pose });
    }
    drawPartitions();
    if (guidesRoomId) drawGuides(guidesRoomId);
    if (drag && drag.kind !== 'pan') {
      drawLanding(drag);
      ctx.globalAlpha = drag.valid ? 1 : 0.6;
      ctx.fillStyle = 'rgba(70,45,20,.18)'; // тень под вещью в руке
      ctx.beginPath(); ctx.ellipse(drag.b.x + drag.b.w / 2, drag.b.y + drag.b.h + 18, drag.b.w * 0.32, 10, 0, 0, Math.PI * 2); ctx.fill();
      drawSprite(drag.art, drag.b, { glow: true, tilt: drag.tilt || 0 });
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

  return { sway, resize, draw, hit, warmup, lowerQuality, get quality() { return quality; }, get scale() { return k; } };
}
