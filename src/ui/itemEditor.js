// Админка → «Предметы»: свои предметы из картинок GPT.
// Картинка → название → группа → куда ставится → размер (сравнение с Милой) → сохранить.
import { GROUPS, PLACES, allItemDefs, itemDef, originalDef, sizeKey } from '../core/catalog.js';
import { listRecords, getRecord, saveRecord, deleteRecord, importPack, exportPack, newId, MIN_W, MAX_W, LIBRARY_LIMIT, getOverride, saveOverride, resetOverride } from '../core/library.js';
import { normalize } from '../core/actions.js';
import { streams, drawStreams } from '../render/water.js';
import { img, loadImage } from '../assets.js';
import { escapeHtml as esc } from '../util.js';

const MAX_SIDE = 768;

// Загруженный файл → WebP: убираем розовый фон #FF00FF, обрезаем пустые края, уменьшаем.
export async function prepareImage(file) {
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('Выбери PNG, WebP или JPG');
  if (file.size > 12 * 1024 * 1024) throw new Error('Файл больше 12 МБ');
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось открыть файл')); r.readAsDataURL(file); });
  const im = await loadImage(url);
  const s0 = Math.min(1, 2048 / Math.max(im.width, im.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(im.width * s0); cv.height = Math.round(im.height * s0);
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(im, 0, 0, cv.width, cv.height);
  const data = c.getImageData(0, 0, cv.width, cv.height), px = data.data;
  let minX = cv.width, minY = cv.height, maxX = -1, maxY = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const k = (y * cv.width + x) * 4;
    if (px[k] > 200 && px[k + 2] > 200 && px[k + 1] < 90) px[k + 3] = 0; // розовый фон → прозрачно
    if (px[k + 3] > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) throw new Error('Картинка пустая или целиком прозрачная');
  c.putImageData(data, 0, 0);
  const w = maxX - minX + 1, h = maxY - minY + 1, s1 = Math.min(1, MAX_SIDE / Math.max(w, h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * s1)); out.height = Math.max(1, Math.round(h * s1));
  out.getContext('2d').drawImage(cv, minX, minY, w, h, 0, 0, out.width, out.height);
  const src = out.toDataURL('image/webp', 0.88);
  if (src.length > 2_000_000) throw new Error('Картинка слишком тяжёлая — попробуй файл поменьше');
  // crop — где вещь была на исходной картинке (для совмещения «закрыто» и «открыто» от GPT)
  return { src, crop: [minX / s0, minY / s0, w / s0, h / s0, im.width, im.height].map(Math.round) };
}

// Где «открытая» картинка относительно закрытой: по положению на исходных картинках GPT
// (одинакового размера); если размеры разные — по низу и центру.
function openBoxOf(c, o) {
  if (c && o && Math.abs(c[4] - o[4]) < 3 && Math.abs(c[5] - o[5]) < 3) return [(o[0] - c[0]) / c[2], (o[1] - c[1]) / c[3], o[2] / c[2], o[3] / c[3]].map((v) => Math.round(v * 1000) / 1000);
  const ow = c && o ? (o[2] / o[3]) / (c[2] / c[3]) : 1;
  return [(1 - ow) / 2, 0, ow, 1];
}

export function createItemEditor({ store, actions, toast, onChange }) {
  let host = null, draft = null, dirty = false, busy = false, previewIm = null;

  const fresh = () => ({ id: newId(), name: '', group: 'decor', place: 'floor', w: 160, image: '' });

  function mount(el) { host = el; render(); }

  function list() {
    const mine = listRecords();
    const builtins = allItemDefs().filter((d) => d.builtin);
    return `<div class="ie-bar">
        <button data-ie-new class="primary"${mine.length >= LIBRARY_LIMIT ? ' disabled' : ''}>＋ Новый предмет</button>
        <button data-ie-export${mine.length ? '' : ' disabled'}>↓ Скачать пак</button>
        <button data-ie-import>↑ Загрузить пак</button>
        <input type="file" accept="application/json,.json" data-ie-pack hidden>
      </div>
      <p class="adm-help">Свои предметы: ${mine.length} из ${LIBRARY_LIMIT}. Пак — это файл со всеми своими предметами и картинками: так их можно перенести на другое устройство. Подходят и паки старой админки 0.3.</p>
      <div class="ie-grid">${mine.map((r) => `<button class="ie-card" data-ie-edit="${esc(r.id)}"><img src="${img('custom/' + r.id)?.src || r.image}" alt=""><b>${esc(r.name)}</b><small>${GROUPS[r.group]} · ${PLACES[r.place].split(' ')[0]} ${PLACES[r.place].split(' ')[1] || ''}</small></button>`).join('') || '<p class="adm-help">Пока нет своих предметов. Нажми «Новый предмет» и загрузи картинку от GPT.</p>'}</div>
      <h4>Встроенные предметы (${builtins.length})</h4>
      <p class="adm-help">Можно поменять название, группу, размер и картинку. «Вернуть как было» — исходный вид. Правки попадают в пак (вкладка «Паки»).</p>
      <div class="ie-grid">${builtins.map((d) => `<button class="ie-card${getOverride(d.id) ? ' changed' : ''}" data-ie-builtin="${esc(d.id)}"><img src="${img(d.art)?.src || ''}" alt=""><b>${esc(d.name)}</b><small>${GROUPS[d.group] || ''}${getOverride(d.id) ? ' · изменён' : ''}</small></button>`).join('')}</div>`;
  }

  // Встроенный предмет: черновик правки. size — в той мере, которой задан предмет (высота или ширина).
  function builtinDraft(id) {
    const def = itemDef(id), base = originalDef(id), o = getOverride(id), key = sizeKey(id);
    const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return { builtin: true, id, name: def.name, group: def.group, place: def.place, sizeKey: key, size: def[key], baseSize: base[key], image: o?.image || '', origArt: base.art,
      surfaces: copy(def.surfaces) || [], power: copy(def.power), tap: def.tap, openArt: def.openArt, baseLiving: JSON.stringify([base.surfaces || [], base.power || null, base.tap || null]) };
  }
  const imgSrc = (d) => d.image || (d.builtin ? img(d.origArt)?.src : '') || '';

  function builtinForm() {
    const d = draft, changed = !!getOverride(d.id);
    const opt = (obj, cur) => Object.entries(obj).map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${n}</option>`).join('');
    const lim = d.sizeKey === 'h' ? [30, 900] : [MIN_W, MAX_W];
    return `<div class="ie-bar"><button data-ie-back>← Все предметы</button><b class="ie-title">Встроенный: ${esc(originalDef(d.id).name)}${dirty ? ' · есть изменения' : ''}</b></div>
      <div class="ie-form">
        <div class="ie-fields">
          <label class="ie-upload"><img src="${imgSrc(d)}" alt=""><em>Заменить картинку</em><input type="file" accept="image/png,image/webp,image/jpeg" data-ie-file></label>
          ${d.image ? '<div class="ie-actions"><button data-ie-origimg>Вернуть исходную картинку</button></div>' : ''}
          <p class="adm-help">Картинка от GPT: прозрачный фон или розовый #FF00FF. ${itemDef(d.id).openArt ? 'У этой вещи есть «открытая» картинка — она останется прежней.' : ''}</p>
          <label class="adm-field">Название<input data-ie-name maxlength="40" value="${esc(d.name)}"></label>
          <label class="adm-field">Группа в каталоге<select data-ie-group>${opt(GROUPS, d.group)}</select></label>
          <p class="adm-help">Куда ставится: ${esc(PLACES[d.place] || d.place)} (у встроенных не меняется — от этого зависят полки и открывание).</p>
          <label class="adm-field">${d.sizeKey === 'h' ? 'Высота' : 'Ширина'} в доме · <b data-ie-wv>${d.size}</b> <small>(было ${d.baseSize})</small><input type="range" data-ie-size min="${lim[0]}" max="${lim[1]}" value="${d.size}"></label>
        </div>
        <div class="ie-preview"><canvas width="520" height="420" data-ie-canvas aria-label="Сравнение размера с Милой"></canvas><small>Размер рядом с Милой</small></div>
      </div>
      ${livingHtml()}
      <div class="ie-actions">
        <button data-ie-save class="primary">Сохранить</button>
        <button data-ie-save-put>Сохранить и поставить в дом</button>
        ${changed ? '<button data-ie-reset class="danger">Вернуть как было</button>' : ''}
      </div>`;
  }

  function form() {
    if (draft.builtin) return builtinForm();
    const d = draft, exists = !!getRecord(d.id);
    const opt = (obj, cur) => Object.entries(obj).map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${n}</option>`).join('');
    return `<div class="ie-bar"><button data-ie-back>← Все предметы</button><b class="ie-title">${exists ? 'Редактировать' : 'Новый предмет'}${dirty ? ' · есть изменения' : ''}</b></div>
      <div class="ie-form">
        <div class="ie-fields">
          <label class="ie-upload">${d.image ? `<img src="${d.image}" alt="">` : '<span>＋</span>'}<em>${d.image ? 'Заменить картинку' : 'Загрузить картинку'}</em><input type="file" accept="image/png,image/webp,image/jpeg" data-ie-file></label>
          <p class="adm-help">PNG / WebP / JPG. Прозрачный фон или розовый #FF00FF — он уберётся сам, пустые края обрежутся.</p>
          <label class="adm-field">Название<input data-ie-name maxlength="40" value="${esc(d.name)}" placeholder="Например, кресло"></label>
          <label class="adm-field">Группа в каталоге<select data-ie-group>${opt(GROUPS, d.group)}</select></label>
          <label class="adm-field">Куда ставится<select data-ie-place>${opt(PLACES, d.place)}</select></label>
          <label class="adm-field">Размер в доме · <b data-ie-wv>${d.w}</b><input type="range" data-ie-w min="${MIN_W}" max="${MAX_W}" value="${d.w}"></label>
        </div>
        <div class="ie-preview"><canvas width="520" height="420" data-ie-canvas aria-label="Сравнение размера с Милой"></canvas><small>Размер рядом с Милой</small></div>
      </div>
      ${d.image ? livingHtml() : ''}
      <div class="ie-actions">
        <button data-ie-save class="primary">Сохранить</button>
        <button data-ie-save-put>Сохранить и поставить в дом</button>
        ${exists ? '<button data-ie-copy>Копия</button><button data-ie-del class="danger">Удалить</button>' : ''}
      </div>`;
  }

  // ── «Оживить» предмет: полки, открывание, включение, отклик, еда/одежда ──
  let tool = 'surface', view = 'closed', drawing = null;
  const KINDS = { thing: 'Обычная вещь', food: 'Еда (можно съесть)', drink: 'Напиток (можно выпить)', wear_tshirt: 'Одежда: футболка', wear_pants: 'Одежда: штанишки', wear_dress: 'Одежда: платье' };
  const kindOf = (d) => (d.wear ? 'wear_' + d.wear : d.drink ? 'drink' : d.group === 'food' ? 'food' : 'thing');
  const powerKind = (d) => (d.power?.glow ? 'glow' : d.power?.screen ? 'screen' : d.power?.water ? 'water' : '');
  function livingHtml() {
    const d = draft, pk = powerKind(d);
    const opt = (obj, cur) => Object.entries(obj).map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${n}</option>`).join('');
    const surf = (d.surfaces || []).map((s, k) => `<span class="lv-chip">${s[3] ? '🔒 внутри' : '▭ полка'} ${k + 1}<button data-lv-delsurf="${k}" aria-label="Убрать">×</button></span>`).join('');
    const B = !!d.builtin, w = d.power?.water;
    const waterBox = pk === 'water' ? `<div class="lv-row lv-water">
        <label class="adm-field">Ширина струи · <b>${Math.round(w[3] * 100)}%</b><input type="range" data-lv-ww min="1" max="40" value="${Math.round(w[3] * 100)}"></label>
        <label class="adm-field">Направление · <b>${w[4] || 0}°</b><input type="range" data-lv-wdir min="-85" max="85" value="${w[4] || 0}"></label>
        <label class="adm-field">Напор · <b>${Math.round((w[5] || 0) * 100)}%</b><input type="range" data-lv-wpush min="0" max="100" value="${Math.round((w[5] || 0) * 100)}"></label>
      </div>` : '';
    return `<div class="lv"><h4>Оживить предмет</h4>
      <div class="lv-row">
        ${B ? '' : `<label class="adm-field">Что это<select data-lv-kind>${opt(KINDS, kindOf(d))}</select></label>`}
        <label class="adm-field">Нажатие<select data-lv-tap>${opt({ '': 'Покачивается', ring: 'Звенит и трясётся', squeak: 'Пищит' }, d.tap || '')}</select></label>
        <label class="adm-field">Включается<select data-lv-power>${opt({ '': 'Нет', glow: 'Свет (лампа)', screen: 'Экран с мультиком', water: 'Вода (душ, кран)' }, pk)}</select></label>
      </div>
      ${B ? '' : `<div class="lv-row">
        <label class="ie-upload small"><em>${d.open ? 'Заменить картинку «открыто»' : '＋ Картинка «открыто» (шкаф, холодильник)'}</em><input type="file" accept="image/png,image/webp,image/jpeg" data-ie-openfile></label>
        ${d.open ? '<button data-lv-noopen>Убрать «открыто»</button>' : ''}
      </div>`}
      ${waterBox}
      <div class="lv-tools">
        <button data-lv-tool="surface" class="${tool === 'surface' ? 'on' : ''}">✏️ Полка</button>
        ${pk ? `<button data-lv-tool="power" class="${tool === 'power' ? 'on' : ''}">${pk === 'glow' ? '💡 Где свет' : pk === 'screen' ? '📺 Где экран' : '🚿 Откуда и куда вода'}</button>` : ''}
        ${pk === 'water' ? `<button data-lv-tool="wend" class="${tool === 'wend' ? 'on' : ''}">📏 Докуда падает</button>` : ''}
        ${hasOpen(d) ? `<span class="lv-sep"></span><button data-lv-view="closed" class="lv-view ${view === 'closed' ? 'on' : ''}">Закрыто</button><button data-lv-view="open" class="lv-view ${view === 'open' ? 'on' : ''}">Открыто</button>` : ''}
      </div>
      <p class="adm-help">${tool === 'surface' ? 'Проведи пальцем по картинке слева направо там, где вещи должны стоять (столешница, полка, сиденье).' + (d.open ? ' На картинке «Открыто» полка будет внутренней — видна только открытой.' : '')
        : tool === 'wend' ? 'Нажми на высоту, где вода разбивается брызгами (дно раковины, ванна) — ниже она не полетит.'
        : pk === 'glow' ? 'Нажми туда, откуда идёт свет (абажур).' : pk === 'screen' ? 'Обведи экран: проведи из угла в угол.' : 'Поставь палец на кран/лейку и проведи в сторону, куда бьёт вода: направление — куда ведёшь, напор — насколько далеко. Голубая дуга — как польётся.'}</p>
      <canvas class="lv-canvas" width="560" height="380" data-lv-canvas></canvas>
      <div class="lv-chips">${surf}</div></div>`;
  }

  // Высота предмета в доме (единицы мира) — чтобы дуга воды в студии была как в игре.
  function itemHeightWorld() {
    const ar = lvIm ? lvIm.height / lvIm.width : 1;
    if (draft.builtin) return draft.sizeKey === 'h' ? draft.size : draft.size * ar;
    return (draft.w || 160) * ar;
  }
  const hasOpen = (d) => !!(d.open || (d.builtin && d.openArt));
  const closedSrc = (d) => imgSrc(d);
  const openSrc = (d) => d.open?.image || (d.builtin && d.openArt ? img(d.openArt)?.src : '');
  // Рамка закрытой картинки на холсте редактора и рамка «открытой» внутри неё.
  let lvIm = null, lvOpenIm = null;
  function lvFrames(cv) {
    const im = lvIm; if (!im) return null;
    const box = draft.open?.box || [0, 0, 1, 1];
    const minX = Math.min(0, box[0]), minY = Math.min(0, box[1]), maxX = Math.max(1, box[0] + box[2]), maxY = Math.max(1, box[1] + box[3]);
    const ar = im.height / im.width, spanW = maxX - minX, spanH = (maxY - minY) * ar;
    const s = Math.min((cv.width - 40) / spanW, (cv.height - 40) / spanH);
    const R = { x: (cv.width - spanW * s) / 2 - minX * s, y: (cv.height - spanH * s) / 2 - minY * s * ar, w: s, h: s * ar };
    const O = { x: R.x + box[0] * R.w, y: R.y + box[1] * R.h, w: box[2] * R.w, h: box[3] * R.h };
    return { R, O };
  }
  async function drawLiving() {
    const cv = host?.querySelector('[data-lv-canvas]'); const cs = draft && closedSrc(draft); if (!cv || !cs) return;
    if (!lvIm || lvIm.src !== cs) lvIm = await loadImage(cs);
    const os = hasOpen(draft) && openSrc(draft);
    if (os && (!lvOpenIm || lvOpenIm.src !== os)) lvOpenIm = await loadImage(os);
    const c = cv.getContext('2d'), F = lvFrames(cv); if (!F) return;
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#f7efe0'; c.fillRect(0, 0, cv.width, cv.height);
    const open = view === 'open' && hasOpen(draft);
    const r = open ? F.O : F.R;
    c.drawImage(open ? lvOpenIm : lvIm, r.x, r.y, r.w, r.h);
    c.setLineDash([6, 5]); c.strokeStyle = '#c9a47788'; c.strokeRect(F.R.x, F.R.y, F.R.w, F.R.h); c.setLineDash([]);
    c.lineWidth = 5; c.lineCap = 'round';
    for (const s of draft.surfaces || []) {
      if (!!s[3] !== !!open && s[3]) continue; // внутренние полки — только на «открыто»
      c.strokeStyle = s[3] ? '#e0864a' : '#3f9a5a';
      c.beginPath(); c.moveTo(F.R.x + s[0] * F.R.w, F.R.y + s[2] * F.R.h); c.lineTo(F.R.x + s[1] * F.R.w, F.R.y + s[2] * F.R.h); c.stroke();
    }
    const p = draft.power, at = (fx, fy) => [F.R.x + fx * F.R.w, F.R.y + fy * F.R.h];
    c.lineWidth = 3;
    if (p?.glow) { const [x, y] = at(p.glow[0], p.glow[1]); c.fillStyle = '#ffd34d99'; c.beginPath(); c.arc(x, y, 26, 0, Math.PI * 2); c.fill(); c.fillStyle = '#e8a400'; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); }
    if (p?.screen) { const [x0, y0] = at(p.screen[0], p.screen[1]), [x1, y1] = at(p.screen[2], p.screen[3]); c.fillStyle = '#7fd3ff88'; c.fillRect(x0, y0, x1 - x0, y1 - y0); }
    if (p?.water) {
      // Как польётся: та же «физика», что в игре (масштаб: высота картинки = её высота в доме).
      const wv = p.water, k = F.R.h / Math.max(1, itemHeightWorld());
      const [x, y] = at(wv[0], wv[1]), [, yEnd] = at(wv[0], wv[2]);
      c.save(); c.translate(x, y); c.scale(k, k);
      drawStreams(c, streams({ x: 0, y: 0, yEnd: (yEnd - y) / k, width: (wv[3] * F.R.w) / k, dir: wv[4] || 0, push: wv[5] || 0 }), 0.85);
      c.restore();
      c.setLineDash([8, 6]); c.strokeStyle = '#4aa8f0'; c.lineWidth = 2; c.beginPath(); c.moveTo(F.R.x, yEnd); c.lineTo(F.R.x + F.R.w, yEnd); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#4aa8f0'; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
    }
    if (drawing && tool === 'power' && draft.power?.water) { c.strokeStyle = '#4aa8f0'; c.lineWidth = 3; c.beginPath(); c.moveTo(drawing.x0, drawing.y0); c.lineTo(drawing.x1, drawing.y1); c.stroke(); }
    else if (drawing) { c.strokeStyle = '#3f9a5a'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(drawing.x0, drawing.y0); c.lineTo(drawing.x1, tool === 'surface' ? drawing.y0 : drawing.y1); c.stroke(); c.setLineDash([]); }
  }
  // Точка на холсте → доли закрытой картинки.
  function toFrac(cv, e) {
    const b = cv.getBoundingClientRect(), F = lvFrames(cv);
    const x = (e.clientX - b.left) * cv.width / b.width, y = (e.clientY - b.top) * cv.height / b.height;
    return { x, y, fx: (x - F.R.x) / F.R.w, fy: (y - F.R.y) / F.R.h };
  }
  function lvDown(e) {
    const cv = e.target.closest('[data-lv-canvas]'); if (!cv || !lvIm) return;
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
    const p = toFrac(cv, e);
    drawing = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, f0: p };
    if (tool === 'power' && draft.power?.glow) { draft.power = { glow: [round(p.fx), round(p.fy), 1.2] }; dirty = true; drawing = null; drawLiving(); }
    else if (tool === 'wend' && draft.power?.water) { const w = draft.power.water; w[2] = round(Math.max(w[1] + 0.03, p.fy)); dirty = true; drawing = null; render(); }
  }
  function lvMove(e) {
    if (!drawing) return;
    const cv = host.querySelector('[data-lv-canvas]'), p = toFrac(cv, e);
    drawing.x1 = p.x; drawing.y1 = p.y; drawing.f1 = p; drawLiving();
  }
  const round = (v) => Math.round(Math.max(-0.5, Math.min(1.5, v)) * 1000) / 1000;
  function lvUp() {
    if (!drawing) return;
    const a = drawing.f0, b = drawing.f1 || a; drawing = null;
    if (tool === 'surface') {
      const x0 = Math.min(a.fx, b.fx), x1 = Math.max(a.fx, b.fx);
      if (x1 - x0 > 0.05) { (draft.surfaces ||= []).push(view === 'open' && hasOpen(draft) ? [round(x0), round(x1), round(a.fy), 1] : [round(x0), round(x1), round(a.fy)]); dirty = true; }
    } else if (draft.power?.screen) {
      if (Math.abs(b.fx - a.fx) > 0.05 && Math.abs(b.fy - a.fy) > 0.05) { draft.power = { screen: [round(Math.min(a.fx, b.fx)), round(Math.min(a.fy, b.fy)), round(Math.max(a.fx, b.fx)), round(Math.max(a.fy, b.fy))] }; dirty = true; }
    } else if (draft.power?.water) {
      // Откуда (точка нажатия), направление (куда повёл) и напор (насколько далеко повёл). «Докуда» не трогаем.
      const w = draft.power.water, dx = b.fx - a.fx, dy = b.fy - a.fy, len = Math.hypot(dx, dy);
      w[0] = round(a.fx); w[1] = round(a.fy);
      if (len > 0.03) { w[4] = Math.max(-85, Math.min(85, Math.round(Math.atan2(dx, Math.max(0.0001, dy)) * 180 / Math.PI))); w[5] = Math.round(Math.min(1, Math.max(0, (len - 0.05) / 0.6)) * 100) / 100; }
      if (w[2] <= w[1] + 0.03) w[2] = round(Math.min(1.2, w[1] + 0.25));
      dirty = true;
    }
    render();
  }

  function render() {
    if (!host) return;
    host.innerHTML = draft ? form() : list();
    if (draft) { drawPreview(); drawLiving(); }
  }

  async function drawPreview() {
    const cv = host?.querySelector('[data-ie-canvas]'); if (!cv) return;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, k = H / 900;
    const floorY = H * 0.6;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#f6e3c4'; c.fillRect(0, 0, W, floorY);
    c.fillStyle = '#e2b27c'; c.fillRect(0, floorY, W, H - floorY);
    c.fillStyle = '#c99158'; c.fillRect(0, floorY - 6, W, 8);
    const mila = img('hero/girl'); // собранная Мила — для сравнения размера
    const standY = H * 0.86;
    if (mila) { const h = 330 * k, w = h * mila.width / mila.height; c.drawImage(mila, 70 - w / 2 + 40, standY - h, w, h); }
    const src = imgSrc(draft);
    if (!src) { c.fillStyle = '#b9a07c'; c.font = '16px system-ui'; c.textAlign = 'center'; c.fillText('Загрузи картинку', W * 0.66, H * 0.4); return; }
    if (!previewIm || previewIm.src !== src) { try { previewIm = await loadImage(src); } catch (e) { return; } }
    const ratio = previewIm.height / previewIm.width;
    const w = (draft.builtin ? (draft.sizeKey === 'h' ? draft.size / ratio : draft.size) : draft.w) * k, h = w * ratio, x = W * 0.66 - w / 2;
    const y = draft.place === 'wall' ? Math.max(6, floorY * 0.45 - h / 2) : draft.place === 'doorway' ? floorY - h : standY - h;
    c.drawImage(previewIm, x, y, w, h);
    if (draft.place === 'wall' && y + h > floorY - 8) { c.fillStyle = '#b0563d'; c.font = '600 14px system-ui'; c.textAlign = 'center'; c.fillText('Слишком большой для стены', W * 0.66, H - 14); }
  }

  function read() {
    const v = (s) => host.querySelector(s)?.value;
    draft.name = v('[data-ie-name]') ?? draft.name;
    draft.group = v('[data-ie-group]') ?? draft.group;
    draft.place = v('[data-ie-place]') ?? draft.place;
    if (draft.builtin) draft.size = Number(v('[data-ie-size]') ?? draft.size);
    else draft.w = Number(v('[data-ie-w]') ?? draft.w);
  }

  async function canLeave() { return !dirty || confirm('Есть несохранённые изменения. Выйти без сохранения?'); }

  async function save(putToInventory) {
    if (busy) return;
    read();
    if (draft.builtin) return saveBuiltin(putToInventory);
    if (!draft.image) { toast('Сначала загрузи картинку', true); return; }
    busy = true;
    try {
      const rec = await saveRecord(draft);
      dirty = false;
      store.change((s) => normalize(s), { undo: false }); // размер или место могли измениться
      actions.restoreMissing();
      if (putToInventory) { const id = actions.take(rec.id); if (id) actions.placeFromInventory(id); toast(`«${rec.name}» сохранён и стоит в доме`); }
      else toast(`«${rec.name}» сохранён — он в списке вещей`);
      draft = { ...rec };
    } catch (e) { toast(e.message, true); }
    busy = false;
    render(); onChange();
  }

  async function saveBuiltin(put) {
    busy = true;
    try {
      const d = draft, base = originalDef(d.id);
      const livingChanged = JSON.stringify([d.surfaces || [], d.power || null, d.tap || null]) !== d.baseLiving;
      await saveOverride({ id: d.id, name: d.name !== base.name ? d.name : undefined, group: d.group !== base.group ? d.group : undefined, size: d.size !== d.baseSize ? d.size : undefined, image: d.image || undefined,
        ...(livingChanged ? { surfaces: d.surfaces || [], power: d.power, tap: d.tap } : {}) });
      dirty = false;
      store.change((s) => normalize(s), { undo: false }); // новый размер — вещи в доме перестраиваются
      if (put) { const id = actions.take(d.id); if (id) actions.placeFromInventory(id); }
      toast(`«${d.name}» сохранён` + (put ? ' и стоит в доме' : ''));
      draft = builtinDraft(d.id);
    } catch (e) { toast(e.message, true); }
    busy = false;
    render(); onChange();
  }

  host = null;
  const onClick = async (e) => {
    const b = e.target.closest('button, .ie-card'); if (!b || !host?.contains(b)) return;
    if (b.dataset.ieNew !== undefined) { draft = fresh(); dirty = false; view = 'closed'; tool = 'surface'; }
    else if (b.dataset.ieEdit) { draft = JSON.parse(JSON.stringify(getRecord(b.dataset.ieEdit))); dirty = false; view = 'closed'; tool = 'surface'; }
    else if (b.dataset.ieBuiltin) { draft = builtinDraft(b.dataset.ieBuiltin); dirty = false; }
    else if (b.dataset.lvTool) { tool = b.dataset.lvTool; }
    else if (b.dataset.lvView) { view = b.dataset.lvView; }
    else if (b.dataset.lvDelsurf !== undefined) { read(); draft.surfaces.splice(Number(b.dataset.lvDelsurf), 1); dirty = true; }
    else if (b.dataset.lvNoopen !== undefined) { read(); delete draft.open; draft.surfaces = (draft.surfaces || []).filter((s) => !s[3]); view = 'closed'; dirty = true; }
    else if (b.dataset.ieOrigimg !== undefined) { read(); draft.image = ''; dirty = true; }
    else if (b.dataset.ieReset !== undefined) {
      if (!confirm(`Вернуть «${originalDef(draft.id).name}» как было?`)) return;
      try { await resetOverride(draft.id); store.change((s) => normalize(s), { undo: false }); toast('Вернули как было'); draft = builtinDraft(draft.id); dirty = false; }
      catch (err) { toast(err.message, true); }
    }
    else if (b.dataset.ieBack !== undefined) { if (!(await canLeave())) return; draft = null; dirty = false; }
    else if (b.dataset.ieSave !== undefined) return save(false);
    else if (b.dataset.ieSavePut !== undefined) return save(true);
    else if (b.dataset.ieCopy !== undefined) { read(); draft = { ...draft, id: newId(), name: (draft.name + ' — копия').slice(0, 40) }; dirty = true; }
    else if (b.dataset.ieDel !== undefined) {
      const n = store.state.items.filter((i) => i.def === draft.id).length;
      if (!confirm(`Удалить «${draft.name}» из библиотеки?` + (n ? ` Его экземпляров в доме и шкафчике: ${n} — они спрячутся и вернутся, если загрузить пак с этим предметом.` : ''))) return;
      try { await deleteRecord(draft.id); actions.shelveDef(draft.id); toast('Предмет удалён'); draft = null; dirty = false; }
      catch (err) { toast(err.message, true); }
    } else if (b.dataset.ieExport !== undefined) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(exportPack())], { type: 'application/json' }));
      a.download = 'Sunny_Home_Items.json'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast('Пак скачан');
    } else if (b.dataset.ieImport !== undefined) { host.querySelector('[data-ie-pack]').click(); return; }
    else return;
    render(); onChange();
  };

  const onChangeEv = async (e) => {
    if (!host?.contains(e.target)) return;
    if (e.target.matches('[data-ie-file],[data-ie-openfile]')) {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      read();
      try {
        toast('Готовлю картинку…');
        const res = await prepareImage(file);
        if (e.target.matches('[data-ie-openfile]')) { draft.open = { image: res.src, box: openBoxOf(draft.crop, res.crop) }; view = 'open'; }
        else { draft.image = res.src; draft.crop = res.crop; if (draft.open) draft.open.box = openBoxOf(res.crop, null); }
        if (!draft.name) draft.name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40);
        dirty = true; render();
        toast('Картинка готова. Проверь размер рядом с Милой.');
      } catch (err) { toast(err.message, true); }
    } else if (e.target.matches('[data-ie-pack]')) {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      try {
        if (file.size > 40 * 1024 * 1024) throw new Error('Пак больше 40 МБ');
        const n = await importPack(JSON.parse(await file.text()));
        const back = actions.restoreMissing();
        toast(`Загружено предметов: ${n}` + (back ? `. Вернулось в шкафчик: ${back}` : ''));
        render(); onChange();
      } catch (err) { toast('Не удалось загрузить пак: ' + (err instanceof SyntaxError ? 'файл повреждён' : err.message), true); }
    } else if (e.target.matches('[data-ie-group],[data-ie-place]')) { read(); dirty = true; render(); }
    else if (e.target.matches('[data-lv-kind]')) {
      read(); const k = e.target.value;
      delete draft.drink; delete draft.wear;
      if (k === 'food' || k === 'drink') { draft.group = 'food'; if (k === 'drink') draft.drink = true; }
      else if (k.startsWith('wear_')) { draft.wear = k.slice(5); draft.group = 'clothes'; }
      dirty = true; render();
    } else if (e.target.matches('[data-lv-tap]')) { read(); if (e.target.value) draft.tap = e.target.value; else delete draft.tap; dirty = true; }
    else if (e.target.matches('[data-lv-power]')) {
      read(); const v = e.target.value;
      draft.power = v === 'glow' ? { glow: [0.5, 0.25, 1.2] } : v === 'screen' ? { screen: [0.15, 0.1, 0.85, 0.6] } : v === 'water' ? { water: [0.5, 0.15, 0.6, 0.04, 0, 0.1] } : undefined;
      if (!draft.power) delete draft.power; else tool = 'power';
      dirty = true; render();
    }
  };

  const onInput = (e) => {
    if (!host?.contains(e.target) || !draft) return;
    if (e.target.matches('[data-ie-w]')) { read(); dirty = true; host.querySelector('[data-ie-wv]').textContent = draft.w; drawPreview(); }
    if (e.target.matches('[data-lv-ww],[data-lv-wdir],[data-lv-wpush]') && draft.power?.water) {
      const w = draft.power.water, v = Number(e.target.value);
      if (e.target.matches('[data-lv-ww]')) w[3] = v / 100; else if (e.target.matches('[data-lv-wdir]')) w[4] = v; else w[5] = v / 100;
      e.target.previousElementSibling.textContent = e.target.matches('[data-lv-wdir]') ? v + '°' : v + '%';
      dirty = true; drawLiving();
    }
    if (e.target.matches('[data-ie-size]')) { read(); dirty = true; host.querySelector('[data-ie-wv]').textContent = draft.size; drawPreview(); }
    if (e.target.matches('[data-ie-name]')) { dirty = true; }
  };

  return {
    mount,
    bind(root) {
      root.addEventListener('click', onClick); root.addEventListener('change', onChangeEv); root.addEventListener('input', onInput);
      root.addEventListener('pointerdown', lvDown); root.addEventListener('pointermove', lvMove);
      root.addEventListener('pointerup', lvUp); root.addEventListener('pointercancel', () => { drawing = null; });
    },
    get dirty() { return dirty; },
    has: (id) => !!itemDef(id),
  };
}
