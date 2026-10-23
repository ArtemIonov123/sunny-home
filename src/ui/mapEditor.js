// Студия → «Карта»: живые здания на картинках районов. Обведи здание пальцем — оно станет «зоной»:
// при нажатии в игре пружинит со звуком, а если выбрать место — через него заходят внутрь.
// Сохраняется в студии; игрокам — кнопкой «📤 В игру» (паком-подарком, поле mapZones).
import { img } from '../assets.js';
import { play } from '../audio.js';
import { zonesOf, saveOwnZones, hasOwnZones, ZONE_SOUNDS } from '../core/mapZones.js';
import { PLACE_IDS, isReady } from '../core/places.js';
import { escapeHtml as esc } from '../util.js';

const NAMES = { home: 'Дом', shop: 'Магазин', disco: 'Дискотека', cafe: 'Кафе', salon: 'Салон' };

export function createMapEditor({ toast }) {
  let host = null, district = 'home', list = [], sel = -1, dirty = false, drawing = null, moving = null;
  const load = () => { list = JSON.parse(JSON.stringify(zonesOf(district))); sel = -1; dirty = false; };
  load();
  const opt = (obj, cur) => Object.entries(obj).map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');

  function html() {
    const z = list[sel];
    return `<div class="ie-bar">${PLACE_IDS.map((id) => `<button class="${id === district ? 'primary' : ''}" data-mz-d="${id}">${esc(NAMES[id] || id)}</button>`).join('')}
        <span class="ie-title">${hasOwnZones(district) ? 'свои зоны' : 'встроенные зоны'}${dirty ? ' · есть изменения' : ''}</span></div>
      <p class="adm-help">Обведи здание на картинке (из угла в угол) — оно оживёт: в игре пружинит со звуком. Нажми на зону, чтобы выбрать; тяни — чтобы передвинуть. Для зоны можно выбрать место — через это здание будут заходить внутрь. Игрокам изменения уходят кнопкой «📤 В игру».</p>
      <canvas class="mz-canvas" width="1000" height="500" data-mz-canvas></canvas>
      ${z ? `<div class="lv-row">
        <label class="adm-field">Звук<select data-mz-snd>${opt(ZONE_SOUNDS, z.snd)}</select></label>
        <label class="adm-field">Заходить внутрь<select data-mz-place>${opt({ '': 'Нет — только пружинит', ...Object.fromEntries(PLACE_IDS.map((id) => [id, (NAMES[id] || id) + (isReady(id) ? '' : ' (ещё строится)')])) }, z.place || '')}</select></label>
        <button data-mz-test>▶ Звук</button><button class="danger" data-mz-del>Убрать зону</button></div>` : ''}
      <div class="ie-actions"><button class="primary" data-mz-save${dirty ? '' : ' disabled'}>Сохранить</button><button data-mz-reset>Как было</button></div>`;
  }

  // Картинка района целиком в холсте (с небом).
  function frame(cv) { const s = Math.min(cv.width / 1600, cv.height / 800); return { s, x: (cv.width - 1600 * s) / 2, y: (cv.height - 800 * s) / 2, w: 1600 * s, h: 800 * s }; }
  function draw() {
    const cv = host?.querySelector('[data-mz-canvas]'); if (!cv) return;
    const c = cv.getContext('2d'), F = frame(cv), im = img('map/district_' + district);
    c.fillStyle = '#9fd3f5'; c.fillRect(0, 0, cv.width, cv.height);
    if (im) c.drawImage(im, F.x, F.y, F.w, F.h);
    list.forEach((z, i) => {
      const [u0, v0, u1, v1] = z.box, on = i === sel;
      c.lineWidth = on ? 4 : 2.5; c.setLineDash(on ? [] : [6, 4]);
      c.strokeStyle = z.place ? '#e0864a' : '#3f9a5a'; c.fillStyle = on ? 'rgba(255,220,120,.35)' : z.place ? 'rgba(224,134,74,.22)' : 'rgba(63,154,90,.2)';
      c.fillRect(F.x + u0 * F.w, F.y + v0 * F.h, (u1 - u0) * F.w, (v1 - v0) * F.h);
      c.strokeRect(F.x + u0 * F.w, F.y + v0 * F.h, (u1 - u0) * F.w, (v1 - v0) * F.h);
      if (z.place) { c.font = '22px sans-serif'; c.fillText('🚪', F.x + u0 * F.w + 4, F.y + v0 * F.h + 24); }
    });
    c.setLineDash([]);
    if (drawing) { c.strokeStyle = '#4a7fe0'; c.lineWidth = 3; c.setLineDash([5, 4]); c.strokeRect(drawing.x0, drawing.y0, drawing.x1 - drawing.x0, drawing.y1 - drawing.y0); c.setLineDash([]); }
  }
  function render() { if (!host) return; host.innerHTML = html(); draw(); }

  const toFrac = (cv, e) => {
    const b = cv.getBoundingClientRect(), F = frame(cv);
    const x = (e.clientX - b.left) * cv.width / b.width, y = (e.clientY - b.top) * cv.height / b.height;
    return { x, y, u: (x - F.x) / F.w, v: (y - F.y) / F.h };
  };
  const r3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

  function down(e) {
    const cv = e.target.closest?.('[data-mz-canvas]'); if (!cv) return;
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
    const p = toFrac(cv, e);
    const hit = list.map((z, i) => ({ z, i })).filter(({ z }) => p.u > z.box[0] && p.u < z.box[2] && p.v > z.box[1] && p.v < z.box[3])
      .sort((a, b) => (a.z.box[2] - a.z.box[0]) * (a.z.box[3] - a.z.box[1]) - (b.z.box[2] - b.z.box[0]) * (b.z.box[3] - b.z.box[1]))[0];
    if (hit) { sel = hit.i; moving = { p, box: [...hit.z.box], moved: false }; render(); return; }
    drawing = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, p0: p };
  }
  function move(e) {
    const cv = host?.querySelector('[data-mz-canvas]'); if (!cv || (!drawing && !moving)) return;
    const p = toFrac(cv, e);
    if (drawing) { drawing.x1 = p.x; drawing.y1 = p.y; drawing.p1 = p; draw(); return; }
    const du = p.u - moving.p.u, dv = p.v - moving.p.v, b = moving.box;
    if (Math.abs(du) + Math.abs(dv) > 0.005) moving.moved = true;
    const w = b[2] - b[0], h = b[3] - b[1], u0 = Math.max(0, Math.min(1 - w, b[0] + du)), v0 = Math.max(0, Math.min(1 - h, b[1] + dv));
    list[sel].box = [r3(u0), r3(v0), r3(u0 + w), r3(v0 + h)]; draw();
  }
  function up() {
    if (moving) { if (moving.moved) { dirty = true; render(); } moving = null; return; }
    if (!drawing) return;
    const a = drawing.p0, b = drawing.p1 || a; drawing = null;
    if (Math.abs(b.u - a.u) > 0.02 && Math.abs(b.v - a.v) > 0.02) {
      list.push({ box: [r3(Math.min(a.u, b.u)), r3(Math.min(a.v, b.v)), r3(Math.max(a.u, b.u)), r3(Math.max(a.v, b.v))], snd: 'boing' });
      sel = list.length - 1; dirty = true; play('pop');
    }
    render();
  }

  function click(e) {
    const b = e.target.closest('button'); if (!b || !host?.contains(b)) return;
    const d = b.dataset;
    if (d.mzD) { if (dirty && !confirm('Есть несохранённые зоны. Перейти без сохранения?')) return; district = d.mzD; load(); }
    else if (d.mzDel !== undefined) { list.splice(sel, 1); sel = -1; dirty = true; }
    else if (d.mzTest !== undefined) { play(list[sel]?.snd || 'pop'); return; }
    else if (d.mzSave !== undefined) { saveOwnZones(district, list); dirty = false; toast('Зоны сохранены. Игрокам — «📤 В игру»'); }
    else if (d.mzReset !== undefined) { if (!confirm('Вернуть встроенные зоны этого района?')) return; saveOwnZones(district, null); load(); toast('Вернули как было'); }
    else return;
    render();
  }
  function change(e) {
    if (!host?.contains(e.target) || !list[sel]) return;
    if (e.target.matches('[data-mz-snd]')) { list[sel].snd = e.target.value; play(e.target.value); }
    else if (e.target.matches('[data-mz-place]')) { if (e.target.value) list[sel].place = e.target.value; else delete list[sel].place; }
    else return;
    dirty = true; render();
  }

  return {
    mount(el) { host = el; render(); },
    bind(root) {
      root.addEventListener('click', click); root.addEventListener('change', change);
      root.addEventListener('pointerdown', down); root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', up); root.addEventListener('pointercancel', () => { drawing = null; moving = null; });
    },
  };
}
