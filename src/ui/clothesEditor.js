// Студия → «Одежда»: своя вещь для героев из одной картинки от GPT.
// Шаги: тип (верх, платье, штаны, юбка, обувь, очки, шапка) → образец для GPT → картинка → подвинуть
// на герое → сохранить. Сразу видно, как вещь сидит и двигается (машет, сидит, идёт). Сохраняется как
// свой предмет с полем cloth (core/library.js): лежит в доме, её можно дать герою, она есть в гардеробе
// героя (⚙️ → герои), уходит в паки и игрокам («📤 Отправить игрокам», галочка «Выдать игроку»).
import { listRecords, getRecord, saveRecord, deleteRecord, newId, LIBRARY_LIMIT } from '../core/library.js';
import { CHARS } from '../core/catalog.js';
import { WEAR, WEAR_TYPES, WEAR_COLORS, BUILTIN_WEAR, canDress, toggleWear } from '../core/looks.js';
import { hasToken, sendGameUpdate } from '../core/publish.js';
import { normalize } from '../core/actions.js';
import { drawHero, drawPart, partThumb } from '../render/hero.js';
import { buildRig, drawRig, heroPose, rigAnims } from '../render/rig.js';
import { HERO_LAYERS } from '../render/heroLayout.js';
import { registerGarment, unregisterGarment, fitUpload, fitToSample, sampleBox, layerRect, templateCanvas, templateOf, colored, grayShare } from '../render/garment.js';
import { img, loadImage } from '../assets.js';
import { play } from '../audio.js';
import { escapeHtml as esc } from '../util.js';

const DRAFT = 'draftwear'; // вещь на примерке (временный слой, в сохранение не попадает)
const TYPE_LIST = ['top', 'dress', 'pants', 'skirt', 'shoes', 'glasses', 'hat'];
const BUILTIN_NAMES = { tshirt: 'Футболка', dress: 'Платье', pants: 'Штанишки', skirt: 'Юбка', sneakers: 'Кеды', cap: 'Кепка', glasses: 'Очки' };
const BUILTIN_COLORS = { tshirt: '#6fcfc0', dress: '#ffe27a', pants: '#7fb1f0', skirt: '#ff8fa8', sneakers: '#ff6b6b', cap: '#ffb36b', glasses: '#3d6fc4' };
const MODES = { stand: '🧍 Стоит', wave: '👋 Машет', sit: '🪑 Сидит', walk: '🚶 Идёт', cheer: '🎉 Радуется' };
const W = 512;

async function fileUrl(file) {
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('Выбери PNG, WebP или JPG');
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось открыть файл')); r.readAsDataURL(file); });
}
const download = (cv, name) => cv.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');

export function createClothesEditor({ store, actions, toast, onChange }) {
  let host = null, draft = null, dirty = false, busy = false, sending = '';
  let heroId = 'girl', mode = 'stand', raf = 0, srcIm = null, rig = null, rigSig = '', drag = null, lastWave = 0, walkPh = 0, lastT = 0;
  let uploadBox = null; // где вещь встала при загрузке (кнопка «Как на картинке»)

  const fresh = (type = 'top') => ({ id: newId(), name: '', group: 'clothes', place: 'floor', w: 130, image: '', give: false, cloth: { type, image: '', box: null, color: WEAR_COLORS[0], tint: true, own: false } });
  const mine = () => listRecords().filter((r) => r.cloth);
  const heroes = () => store.state.chars.filter((c) => canDress(c.id) && c.look);

  function mount(el) { host = el; render(); }

  // ── Список ──
  const builtinThumb = (w) => partThumb(layerRect('wear_' + w) || [0, 0, 512, 900], (c) => drawPart(c, 'wear_' + w, BUILTIN_COLORS[w]), 120).toDataURL();
  function listHtml() {
    const list = mine();
    return `<div class="ie-bar"><button class="primary" data-ce-new${listRecords().length >= LIBRARY_LIMIT ? ' disabled' : ''}>＋ Новая вещь</button>
        <button data-ce-send${hasToken() && !sending ? '' : ' disabled'}>📤 Отправить игрокам</button>
        <span class="ie-title">${sending ? '⏳ ' + esc(sending) : `Своей одежды: ${list.length}`}</span></div>
      <ol class="ce-steps">
        <li><b>Тип</b> — что это: верх, платье, штаны, юбка, обувь, очки или шапка. От типа зависит, как вещь двигается.</li>
        <li><b>📥 Образец для GPT</b> — картинка с героем: голубым показано, где сидит такая вещь. Отправь её GPT вместе с промптом из арт-гида (раздел «Своя одежда»).</li>
        <li><b>📂 Картинка</b> — что нарисовал GPT. Серое станет цветом, который выберет игрок.</li>
        <li><b>Подвинь</b> вещь на герое пальцем или стрелками и проверь, как она двигается.</li>
        <li><b>Сохранить</b> — вещь появится в шкафчике и в гардеробе героя. В паке или с галочкой «Выдать игроку» она дойдёт до игроков.</li>
      </ol>
      <h4>Свои</h4>
      ${list.length ? `<div class="ie-grid">${list.map((r) => `<button class="ie-card" data-ce-edit="${esc(r.id)}"><img src="${r.image}" alt=""><b>${esc(r.name)}</b><small>${WEAR_TYPES[r.cloth.type].icon} ${WEAR_TYPES[r.cloth.type].name}${r.give ? ' · ✓ игрокам' : ''}</small></button>`).join('')}</div>` : '<p class="adm-help">Пока нет. Нажми «＋ Новая вещь» или «Сделать похожую» на встроенной.</p>'}
      <h4>Встроенные — сделать похожую</h4>
      <p class="adm-help">Нажми на встроенную вещь — откроется новая вещь того же типа с её картинкой. Поменяй картинку, цвет или размер и сохрани под своим именем.</p>
      <div class="ie-grid">${BUILTIN_WEAR.map((w) => `<button class="ie-card" data-ce-like="${w}"><img src="${builtinThumb(w)}" alt=""><b>${BUILTIN_NAMES[w]}</b><small>${WEAR_TYPES[WEAR[w].type].icon} ${WEAR_TYPES[WEAR[w].type].name}</small></button>`).join('')}</div>`;
  }

  // ── Форма ──
  function formHtml() {
    const d = draft, cl = d.cloth, T = WEAR_TYPES[cl.type];
    const hs = heroes();
    return `<div class="ie-bar"><button data-ce-back>← К списку</button><span class="ie-title">${getRecord(d.id) ? 'Своя одежда' : 'Новая вещь'}</span></div>
      <div class="ie-form">
        <div class="ie-fields">
          <label class="adm-field">Название<input data-ce-name maxlength="40" value="${esc(d.name)}" placeholder="Худи с ушками"></label>
          <div class="adm-field">Тип вещи<div class="ce-types">${TYPE_LIST.map((t) => `<button data-ce-type="${t}" class="${t === cl.type ? 'on' : ''}"><span>${WEAR_TYPES[t].icon}</span>${WEAR_TYPES[t].name}</button>`).join('')}</div>
            <small class="ce-hint">${T.hint}</small></div>
          <div class="adm-field">Картинка вещи «на герое»
            <div class="ce-row">
              <div class="ce-thumb">${cl.image ? `<img src="${cl.image}" alt="">` : '<span>👕</span>'}</div>
              <div class="ce-col">
                <button data-ce-template>📥 Образец для GPT</button>
                <label class="file-btn">📂 ${cl.image ? 'Другая картинка' : 'Загрузить картинку'}<input type="file" accept="image/png,image/webp,image/jpeg" data-ce-file hidden></label>
              </div>
            </div>
            <small class="ce-hint">Образец — ${templateOf(cl.type) === 'head' ? 'голова 1355×1161' : 'тело 1024×1536'}. Нарисованное на образце встанет точно на место, другая картинка встанет туда, где сидит встроенная вещь этого типа.</small></div>
          <label class="an-give"><input type="checkbox" data-ce-tint${cl.tint ? ' checked' : ''}> <b>Игрок перекрашивает</b><small>${cl.tint ? 'серое в картинке красится в цвет, который выберет игрок' : 'вещь всегда такая, как нарисована'}</small></label>
          ${cl.tint ? `<div class="adm-field">Цвет сначала<div class="swatches">${WEAR_COLORS.map((c) => `<button class="swatch${c === cl.color ? ' on' : ''}" style="--c:${c}" data-ce-color="${c}" aria-label="${c}"></button>`).join('')}</div></div>` : ''}
          <div class="adm-field">Как вещь лежит в доме
            <div class="ce-row">
              <div class="ce-thumb">${d.image ? `<img src="${d.image}" alt="">` : '<span>？</span>'}</div>
              <div class="ce-col">
                <label class="file-btn">📂 Своя картинка<input type="file" accept="image/png,image/webp,image/jpeg" data-ce-art hidden></label>
                ${d.cloth.own ? '<button data-ce-autoart>↺ Как на герое</button>' : ''}
              </div>
            </div>
            <small class="ce-hint">${d.cloth.own ? 'Своя картинка (например, сложенная вещь).' : 'Сама: та же вещь, цветом «сначала».'}</small></div>
          <label class="adm-field">Размер в доме · <b data-ce-wv>${d.w}</b><input type="range" data-ce-w min="60" max="300" value="${d.w}"></label>
          <label class="an-give"><input type="checkbox" data-ce-give${d.give ? ' checked' : ''}> <b>Выдать игроку</b><small>${d.give ? 'придёт всем игрокам подарком после «📤 Отправить игрокам»' : 'только в паках'}</small></label>
        </div>
        <div class="ie-preview ce-preview">
          <div class="lv-tools">${hs.map((c) => `<button data-ce-hero="${c.id}" class="${c.id === heroId ? 'on' : ''}">${esc(CHARS[c.id]?.name || c.id)}</button>`).join('')}</div>
          <div class="lv-tools">${Object.entries(MODES).map(([k, n]) => `<button data-ce-mode="${k}" class="${mode === k ? 'on' : ''}">${n}</button>`).join('')}</div>
          <canvas class="ce-canvas" width="440" height="560" data-ce-canvas></canvas>
          ${cl.image ? `<div class="lv-tools ce-nudge">
            <button data-ce-nudge="0,-1" aria-label="Выше">⬆</button><button data-ce-nudge="0,1" aria-label="Ниже">⬇</button>
            <button data-ce-nudge="-1,0" aria-label="Левее">⬅</button><button data-ce-nudge="1,0" aria-label="Правее">➡</button>
            <button data-ce-scale="1.04" aria-label="Больше">➕</button><button data-ce-scale="0.96" aria-label="Меньше">➖</button>
            <button data-ce-stretch="1.04,1" aria-label="Шире">↔ шире</button><button data-ce-stretch="0.96,1" aria-label="Уже">↔ уже</button>
            <button data-ce-stretch="1,1.04" aria-label="Длиннее">↕ длиннее</button><button data-ce-stretch="1,0.96" aria-label="Короче">↕ короче</button>
          </div>
          <div class="lv-tools"><button data-ce-fit>📐 По месту встроенной</button>${uploadBox ? '<button data-ce-asdrawn>🖼 Как на картинке</button>' : ''}<button data-ce-outline class="${showOutline ? 'on' : ''}">⬚ Рамка</button></div>
          <p class="adm-help">В режиме «Стоит» вещь можно тянуть пальцем. Голубая рамка — где сидит встроенная вещь этого типа.</p>` : '<p class="adm-help">Загрузи картинку — вещь появится на герое.</p>'}
        </div>
      </div>
      <div class="ie-actions">
        <button class="primary" data-ce-save>Сохранить</button>
        <button data-ce-wearit>Сохранить и надеть</button>
        <button data-ce-put>Сохранить и положить в дом</button>
        ${getRecord(draft.id) ? '<button data-ce-del>Удалить</button>' : ''}
      </div>`;
  }
  let showOutline = true;

  function render() {
    if (!host) return;
    host.innerHTML = draft ? formHtml() : listHtml();
    if (draft) { applyDraft(); loop(); } else { stop(); unregisterGarment(DRAFT); }
  }

  // Примерка: вещь черновика — временным слоем, герой — с ней (сняв то, что мешает, и прежнюю версию этой вещи).
  async function applyDraft() {
    const cl = draft?.cloth;
    if (!cl?.image || !cl.box) { unregisterGarment(DRAFT); rig = null; rigSig = ''; return; }
    if (!srcIm || srcIm.src !== cl.image) srcIm = await loadImage(cl.image);
    registerGarment(DRAFT, cl, srcIm);
    rigSig = '';
  }
  function tryLook() {
    const look = heroes().find((c) => c.id === heroId)?.look || heroes()[0]?.look;
    if (!look) return null;
    const wear = { ...look.wear }; delete wear[draft.id];
    return WEAR[DRAFT] ? toggleWear({ ...look, wear }, DRAFT, draft.cloth.tint ? draft.cloth.color : '#ffffff') : { ...look, wear };
  }

  // Где герой на холсте показа.
  const FEET = () => HERO_LAYERS['hero/body_stand_f'][1] + (img('hero/body_stand_f')?.height || 640);
  function frame(cv) {
    const feet = rig?.h || FEET(), top = 0;
    const s = Math.min((cv.height - 40) / (feet - top), (cv.width - 20) / W);
    return { s, x: (cv.width - W * s) / 2, y: cv.height - 24 - feet * s, feet };
  }

  function draw() {
    const cv = host?.querySelector('[data-ce-canvas]'); if (!cv || !draft) return false;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#e6d6bb'; c.fillRect(0, cv.height - 24, cv.width, 24);
    const look = tryLook(); if (!look) return true;
    const sig = JSON.stringify([look, draft.cloth.box, draft.cloth.type, draft.cloth.tint]);
    if (sig !== rigSig) { rig = buildRig(look); rigSig = sig; }
    const F = frame(cv);
    const t = performance.now() / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 0; lastT = t;
    if (mode === 'sit') { c.fillStyle = '#c9a477'; c.fillRect(cv.width / 2 - 120, F.y + 560 * F.s, 240, 26); c.fillRect(cv.width / 2 - 110, F.y + 586 * F.s, 18, cv.height); c.fillRect(cv.width / 2 + 92, F.y + 586 * F.s, 18, cv.height); }
    c.fillStyle = 'rgba(110,74,38,.16)'; c.beginPath(); c.ellipse(cv.width / 2, cv.height - 24, 150 * F.s, 14, 0, 0, Math.PI * 2); c.fill();
    if (mode === 'stand') {
      c.save(); c.translate(F.x, F.y); c.scale(F.s, F.s); drawHero(c, look); c.restore();
      if (showOutline && draft.cloth.box) {
        const sb = sampleBox(draft.cloth.type), b = draft.cloth.box;
        c.setLineDash([6, 5]); c.lineWidth = 2;
        c.strokeStyle = 'rgba(80,150,230,.8)'; c.strokeRect(F.x + sb[0] * F.s, F.y + sb[1] * F.s, sb[2] * F.s, sb[3] * F.s);
        c.strokeStyle = drag ? '#e0864a' : 'rgba(224,134,74,.75)'; c.strokeRect(F.x + b[0] * F.s, F.y + b[1] * F.s, b[2] * F.s, b[3] * F.s);
        c.setLineDash([]);
      }
      return true;
    }
    if (!rig) return true;
    let pose;
    if (mode === 'sit') pose = heroPose('cepreview', { seat: 'sit' });
    else if (mode === 'walk') { walkPh += dt * 6; pose = heroPose('cepreview', { walk: { phase: walkPh, amp: 1, dir: 1 } }); }
    else {
      if (mode !== 'stand' && t - lastWave > (mode === 'wave' ? 1.8 : 1.2)) { lastWave = t; if (mode === 'wave') rigAnims.wave('cepreview'); else rigAnims.cheer('cepreview'); }
      pose = heroPose('cepreview', {});
    }
    const sitDrop = mode === 'sit' ? 60 * F.s : 0;
    drawRig(c, rig, { x: F.x, y: F.y + sitDrop, w: W * F.s, h: rig.h * F.s }, pose);
    return true;
  }
  function loop() { stop(); const tick = () => { if (draw()) raf = requestAnimationFrame(tick); else raf = 0; }; raf = requestAnimationFrame(tick); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  // ── Подгонка ──
  function setBox(b, rebuild = true) {
    draft.cloth.box = b.map((v) => Math.round(v * 10) / 10); dirty = true;
    if (rebuild) applyDraft();
    else for (const s of ['t', 'f']) if (HERO_LAYERS[`hero/wear_${DRAFT}_${s}`]) HERO_LAYERS[`hero/wear_${DRAFT}_${s}`] = [Math.round(b[0]), Math.round(b[1])];
    rigSig = '';
  }
  function toCanvas(cv, e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
  function onDown(e) {
    const cv = e.target.closest?.('[data-ce-canvas]'); if (!cv || !draft?.cloth.box) return;
    if (mode !== 'stand') { mode = 'stand'; host.querySelectorAll('[data-ce-mode]').forEach((b) => b.classList.toggle('on', b.dataset.ceMode === 'stand')); }
    const p = toCanvas(cv, e);
    drag = { p, box: draft.cloth.box.slice(), F: frame(cv) };
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!drag) return;
    const cv = host.querySelector('[data-ce-canvas]'), p = toCanvas(cv, e);
    const dx = (p.x - drag.p.x) / drag.F.s, dy = (p.y - drag.p.y) / drag.F.s;
    setBox([drag.box[0] + dx, drag.box[1] + dy, drag.box[2], drag.box[3]], false);
  }
  function onUp() { if (drag) { drag = null; applyDraft(); } }

  // ── Картинки ──
  async function setImage(file) {
    const im = await loadImage(await fileUrl(file));
    const { image, box, drawn, opaque } = fitUpload(im, draft.cloth.type);
    draft.cloth.image = image; draft.cloth.box = box; uploadBox = drawn && drawn.join() !== box.join() ? drawn : null;
    srcIm = await loadImage(image);
    draft.cloth.tint = grayShare(srcIm) > 0.3;
    if (!draft.name) draft.name = file.name.replace(/\.(png|webp|jpe?g)$/i, '').replace(/^wear_/, '').replace(/_/g, ' ').slice(0, 40);
    dirty = true;
    await autoArt();
    if (opaque) toast('У картинки не прозрачный фон — вокруг вещи будет квадрат. Попроси у GPT прозрачный фон или розовый #FF00FF', true);
    else toast(draft.cloth.tint ? 'Готово. Серое будет цветом — выбери цвет «сначала»' : 'Готово. Вещь цветная — игрок её не перекрашивает');
  }
  async function autoArt() {
    if (draft.cloth.own || !draft.cloth.image) return;
    const im = srcIm || await loadImage(draft.cloth.image);
    const s = Math.min(1, 480 / Math.max(im.width, im.height));
    draft.image = colored(im, draft.cloth.tint, draft.cloth.color, im.width * s, im.height * s).toDataURL('image/webp', 0.9);
  }
  // «Сделать похожую»: картинка встроенной вещи (серое — серым) на её месте.
  function likeBuiltin(w) {
    const rect = layerRect('wear_' + w); if (!rect) return;
    const cv = document.createElement('canvas'); cv.width = rect[2]; cv.height = rect[3];
    const c = cv.getContext('2d'); c.translate(-rect[0], -rect[1]); drawPart(c, 'wear_' + w, null);
    draft = fresh(WEAR[w].type);
    draft.name = BUILTIN_NAMES[w] + ' (своя)';
    draft.cloth.image = cv.toDataURL('image/webp', 0.95); draft.cloth.box = rect.slice();
    draft.cloth.color = BUILTIN_COLORS[w]; draft.cloth.tint = !!HERO_LAYERS[`hero/wear_${w}_t`]; uploadBox = null;
    srcIm = null; dirty = true;
  }

  async function save(after) {
    if (busy) return;
    const d = draft;
    d.name = host.querySelector('[data-ce-name]').value.trim();
    if (!d.name) { toast('Дай вещи название', true); return; }
    if (!d.cloth.image) { toast('Загрузи картинку вещи', true); return; }
    busy = true;
    try {
      await autoArt();
      const rec = await saveRecord(d);
      dirty = false;
      store.change((s) => normalize(s), { undo: false });
      actions.restoreMissing?.();
      if (after === 'wear') {
        const ch = heroes().find((c) => c.id === heroId);
        if (ch) { const look = { ...ch.look, wear: { ...ch.look.wear } }; delete look.wear[rec.id]; actions.setLook(ch.id, toggleWear(look, rec.id, rec.cloth.tint ? rec.cloth.color : '#ffffff')); }
        toast(`«${rec.name}» надета на ${CHARS[heroId]?.name || 'героя'}`);
      } else if (after === 'put') { const id = actions.take(rec.id); if (id) actions.placeFromInventory(id); toast(`«${rec.name}» в доме — поднеси её к герою, и он наденет`); }
      else toast(`«${rec.name}» сохранена — она в шкафчике и в гардеробе героя`);
      draft = JSON.parse(JSON.stringify(rec));
    } catch (e) { toast(e.message, true); }
    busy = false;
    render(); onChange();
  }

  async function sendToPlayers() {
    sending = 'Отправляю…'; render();
    try { await sendGameUpdate((t) => { sending = t; render(); }); toast('Готово: у игроков обновится через 1–5 минут'); } catch (e) { toast(e.message, true); }
    sending = ''; render();
  }

  const onClick = async (e) => {
    const b = e.target.closest('button'); if (!b || !host?.contains(b)) return;
    const d = b.dataset;
    if (d.ceNew !== undefined) { draft = fresh(); srcIm = null; uploadBox = null; dirty = false; mode = 'stand'; }
    else if (d.ceLike) { likeBuiltin(d.ceLike); mode = 'stand'; await autoArt(); }
    else if (d.ceEdit) { draft = JSON.parse(JSON.stringify(getRecord(d.ceEdit))); srcIm = null; uploadBox = null; dirty = false; mode = 'stand'; }
    else if (d.ceSend !== undefined) { if (!sending) sendToPlayers(); return; }
    else if (d.ceBack !== undefined) { if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return; draft = null; }
    else if (!draft) return;
    else if (d.ceType) { draft.cloth.type = d.ceType; if (draft.cloth.box && draft.cloth.image) setBox(fitToSample(draft.cloth.box[2] / draft.cloth.box[3], d.ceType)); dirty = true; play('click'); }
    else if (d.ceTemplate !== undefined) { download(templateCanvas(draft.cloth.type), `obrazec_${draft.cloth.type}.png`); toast('Образец скачан. Отправь его GPT вместе с промптом'); return; }
    else if (d.ceColor) { draft.cloth.color = d.ceColor; dirty = true; await autoArt(); await applyDraft(); play('pop'); }
    else if (d.ceAutoart !== undefined) { draft.cloth.own = false; await autoArt(); dirty = true; }
    else if (d.ceHero) { heroId = d.ceHero; rigSig = ''; play('boing'); host.querySelectorAll('[data-ce-hero]').forEach((x) => x.classList.toggle('on', x.dataset.ceHero === heroId)); return; }
    else if (d.ceMode) { mode = d.ceMode; lastWave = 0; host.querySelectorAll('[data-ce-mode]').forEach((x) => x.classList.toggle('on', x.dataset.ceMode === mode)); return; }
    else if (d.ceNudge) { const [x, y] = d.ceNudge.split(',').map(Number), bx = draft.cloth.box; setBox([bx[0] + x * 3, bx[1] + y * 3, bx[2], bx[3]], false); applyDraft(); return; }
    else if (d.ceScale) { const k = Number(d.ceScale), bx = draft.cloth.box, cx = bx[0] + bx[2] / 2, cy = bx[1] + bx[3] / 2; setBox([cx - bx[2] * k / 2, cy - bx[3] * k / 2, bx[2] * k, bx[3] * k]); return; }
    else if (d.ceStretch) { const [kx, ky] = d.ceStretch.split(',').map(Number), bx = draft.cloth.box, cx = bx[0] + bx[2] / 2; setBox([cx - bx[2] * kx / 2, bx[1], bx[2] * kx, bx[3] * ky]); return; }
    else if (d.ceFit !== undefined) { const bx = draft.cloth.box; setBox(fitToSample(bx[2] / bx[3], draft.cloth.type)); return; }
    else if (d.ceAsdrawn !== undefined) { if (uploadBox) setBox(uploadBox.slice()); return; }
    else if (d.ceOutline !== undefined) { showOutline = !showOutline; b.classList.toggle('on', showOutline); return; }
    else if (d.ceSave !== undefined) return save(null);
    else if (d.ceWearit !== undefined) return save('wear');
    else if (d.cePut !== undefined) return save('put');
    else if (d.ceDel !== undefined) {
      if (!confirm(`Удалить «${draft.name}»? С героев она тоже снимется.`)) return;
      try {
        const id = draft.id;
        for (const c of heroes()) if (c.look.wear[id]) { const look = { ...c.look, wear: { ...c.look.wear } }; delete look.wear[id]; actions.setLook(c.id, look); }
        await deleteRecord(id); toast('Удалено'); draft = null; store.change((s) => normalize(s), { undo: false });
      } catch (err) { toast(err.message, true); }
      onChange();
    } else return;
    render();
  };

  const onChangeEv = async (e) => {
    if (!host?.contains(e.target) || !draft) return;
    try {
      if (e.target.matches('[data-ce-file]') && e.target.files[0]) { await setImage(e.target.files[0]); render(); }
      else if (e.target.matches('[data-ce-art]') && e.target.files[0]) {
        const im = await loadImage(await fileUrl(e.target.files[0])), s = Math.min(1, 512 / Math.max(im.width, im.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        draft.image = cv.toDataURL('image/webp', 0.9); draft.cloth.own = true; dirty = true; render();
      } else if (e.target.matches('[data-ce-tint]')) { draft.cloth.tint = e.target.checked; dirty = true; await autoArt(); render(); }
      else if (e.target.matches('[data-ce-give]')) { draft.give = e.target.checked; dirty = true; e.target.parentElement.querySelector('small').textContent = draft.give ? 'придёт всем игрокам подарком после «📤 Отправить игрокам»' : 'только в паках'; }
    } catch (err) { toast(err.message, true); }
    e.target.value && e.target.type === 'file' && (e.target.value = '');
  };
  const onInput = (e) => {
    if (!host?.contains(e.target) || !draft) return;
    if (e.target.matches('[data-ce-w]')) { draft.w = Number(e.target.value); host.querySelector('[data-ce-wv]').textContent = draft.w; dirty = true; }
    if (e.target.matches('[data-ce-name]')) { draft.name = e.target.value; dirty = true; }
  };

  return {
    mount,
    unmount() { stop(); host = null; unregisterGarment(DRAFT); },
    bind(root) {
      root.addEventListener('click', onClick); root.addEventListener('change', onChangeEv); root.addEventListener('input', onInput);
      root.addEventListener('pointerdown', onDown); root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp);
    },
    get dirty() { return dirty; },
  };
}
