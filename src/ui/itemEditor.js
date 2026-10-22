// Админка → «Предметы»: свои предметы из картинок GPT.
// Картинка → название → группа → куда ставится → размер (сравнение с Милой) → сохранить.
import { GROUPS, PLACES, allItemDefs, itemDef } from '../core/catalog.js';
import { listRecords, getRecord, saveRecord, deleteRecord, importPack, exportPack, newId, MIN_W, MAX_W, LIBRARY_LIMIT } from '../core/library.js';
import { normalize } from '../core/actions.js';
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
  return src;
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
      <details class="ie-builtins"><summary>Встроенные предметы (${builtins.length})</summary><p class="adm-help">${builtins.map((d) => esc(d.name)).join(' · ')}</p></details>`;
  }

  function form() {
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
      <div class="ie-actions">
        <button data-ie-save class="primary">Сохранить</button>
        <button data-ie-save-put>Сохранить и поставить в дом</button>
        ${exists ? '<button data-ie-copy>Копия</button><button data-ie-del class="danger">Удалить</button>' : ''}
      </div>`;
  }

  function render() {
    if (!host) return;
    host.innerHTML = draft ? form() : list();
    if (draft) drawPreview();
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
    if (!draft.image) { c.fillStyle = '#b9a07c'; c.font = '16px system-ui'; c.textAlign = 'center'; c.fillText('Загрузи картинку', W * 0.66, H * 0.4); return; }
    if (!previewIm || previewIm.src !== draft.image) { try { previewIm = await loadImage(draft.image); } catch (e) { return; } }
    const w = draft.w * k, h = w * previewIm.height / previewIm.width, x = W * 0.66 - w / 2;
    const y = draft.place === 'wall' ? Math.max(6, floorY * 0.45 - h / 2) : draft.place === 'doorway' ? floorY - h : standY - h;
    c.drawImage(previewIm, x, y, w, h);
    if (draft.place === 'wall' && y + h > floorY - 8) { c.fillStyle = '#b0563d'; c.font = '600 14px system-ui'; c.textAlign = 'center'; c.fillText('Слишком большой для стены', W * 0.66, H - 14); }
  }

  function read() {
    const v = (s) => host.querySelector(s)?.value;
    draft.name = v('[data-ie-name]') ?? draft.name;
    draft.group = v('[data-ie-group]') ?? draft.group;
    draft.place = v('[data-ie-place]') ?? draft.place;
    draft.w = Number(v('[data-ie-w]') ?? draft.w);
  }

  async function canLeave() { return !dirty || confirm('Есть несохранённые изменения. Выйти без сохранения?'); }

  async function save(putToInventory) {
    if (busy) return;
    read();
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

  host = null;
  const onClick = async (e) => {
    const b = e.target.closest('button, .ie-card'); if (!b || !host?.contains(b)) return;
    if (b.dataset.ieNew !== undefined) { draft = fresh(); dirty = false; }
    else if (b.dataset.ieEdit) { draft = { ...getRecord(b.dataset.ieEdit) }; dirty = false; }
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
    if (e.target.matches('[data-ie-file]')) {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      read();
      try {
        toast('Готовлю картинку…');
        draft.image = await prepareImage(file);
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
  };

  const onInput = (e) => {
    if (!host?.contains(e.target) || !draft) return;
    if (e.target.matches('[data-ie-w]')) { read(); dirty = true; host.querySelector('[data-ie-wv]').textContent = draft.w; drawPreview(); }
    if (e.target.matches('[data-ie-name]')) { dirty = true; }
  };

  return {
    mount,
    bind(root) { root.addEventListener('click', onClick); root.addEventListener('change', onChangeEv); root.addEventListener('input', onInput); },
    get dirty() { return dirty; },
    has: (id) => !!itemDef(id),
  };
}
