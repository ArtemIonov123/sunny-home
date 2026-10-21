// Отрисовка дома. Рисуются только комнаты, которые попадают на экран.
// Поиск вещи под пальцем использует ТОТ ЖЕ список и порядок, что и отрисовка,
// поэтому палец всегда хватает то, что видно сверху.
import { VIEW_H, MAX_DPR } from '../config.js';
import { itemDef, CHARS } from '../core/catalog.js';
import { img, maskOf } from '../assets.js';
import { itemBounds, charBounds, depthOf, wallBottom, floorTop, floorBottom } from '../core/placement.js';
import { backgroundFor, clearBackgrounds } from './background.js';

export function createRenderer(canvas, store, camera) {
  const ctx = canvas.getContext('2d');
  let k = 1;

  function resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
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
  function entries(drag) {
    const lay = store.layout, s = store.state;
    const left = camera.x - 400, right = camera.x + camera.viewW + 400;
    const list = [];
    const add = (kind, obj, b, art, x0) => {
      const wb = { x: b.x + x0, y: b.y, w: b.w, h: b.h };
      if (wb.x + wb.w < left || wb.x > right) return;
      list.push({ kind, obj, b: wb, art, depth: depthOf(kind, obj) });
    };
    for (const i of s.items) {
      if (drag && drag.kind === 'item' && drag.id === i.id) continue;
      if (i.inv) continue; // в шкафчике — не в доме
      const def = itemDef(i.def), r = lay.byId.get(i.room); if (!r || !def) continue;
      add('item', i, itemBounds(i), def.art, r.x0);
    }
    for (const c of s.chars) {
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

  function drawSprite(art, b, glow) {
    const im = img(art); if (!im) return;
    if (glow) { ctx.save(); ctx.shadowColor = 'rgba(255,248,200,.95)'; ctx.shadowBlur = 22; }
    ctx.drawImage(im, b.x, b.y, b.w, b.h);
    if (glow) ctx.restore();
  }

  function shadowUnder(b) {
    ctx.fillStyle = 'rgba(90,60,30,.16)';
    ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h - 3, b.w * 0.34, 9, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawZones(drag) {
    if (!drag || drag.kind !== 'item' || !drag.target) return;
    const { r } = drag.target, place = itemDef(drag.obj.def).place;
    ctx.save();
    ctx.fillStyle = drag.valid ? 'rgba(120,200,150,.16)' : 'rgba(220,100,80,.14)';
    if (place === 'floor') ctx.fillRect(r.x0, floorTop(r.room), r.room.width, floorBottom() - floorTop(r.room));
    else if (place === 'wall') ctx.fillRect(r.x0, 0, r.room.width, wallBottom(r.room));
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
    drawZones(drag);
    for (const e of entries(drag)) {
      if (e.kind === 'char' || (itemDef(e.obj.def)?.place === 'floor' && !itemDef(e.obj.def)?.layer)) shadowUnder(e.b);
      drawSprite(e.art, e.b, false);
    }
    drawPartitions();
    if (guidesRoomId) drawGuides(guidesRoomId);
    if (drag && drag.kind !== 'pan') {
      ctx.globalAlpha = drag.valid ? 1 : 0.6;
      drawSprite(drag.art, drag.b, true);
      ctx.globalAlpha = 1;
    }
    if (nightLevel > 0.01) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(28,40,85,${nightLevel * 0.38})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  return { resize, draw, hit, get scale() { return k; } };
}
