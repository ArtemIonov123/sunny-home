// Админка. Разделы: «Комнаты» (порядок, ширина, добавить/убрать),
// «Разметка» (граница стены и пола, область движения), «Предметы» (свои предметы),
// «Данные» (резервная копия, счётчик экземпляров). Позже — «Рецепты».
import { ROOM_TYPES } from '../core/catalog.js';
import { ROOM_WIDTHS, MAX_ROOMS, defaultState } from '../core/house.js';
import { escapeHtml as esc } from '../util.js';
import { validate } from '../save/migrate.js';
import { normalize } from '../core/actions.js';
import { createItemEditor } from './itemEditor.js';
import { listRecords, listPacks, makePack, listOverrides } from '../core/library.js';
import { resetShop } from '../core/shop.js';

export function createAdmin({ root, store, camera, actions, toast, onChange }) {
  const el = document.createElement('section');
  el.className = 'admin-sheet';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Админка');
  root.append(el);
  let tab = 'rooms', isOpen = false, storageNote = '';
  const items = createItemEditor({ store, actions, toast, onChange });
  items.bind(el);

  const open = () => { isOpen = true; el.hidden = false; render(); onChange(); };
  const close = () => { isOpen = false; el.hidden = true; onChange(); };

  function roomsTab() {
    const rows = store.state.rooms.map((r, i, all) => {
      const lawn = r.type === 'lawn';
      const widths = Object.entries(ROOM_WIDTHS).map(([w, n]) => `<option value="${w}"${Number(w) === r.width ? ' selected' : ''}>${n}</option>`).join('');
      return `<div class="adm-row" data-id="${esc(r.id)}">
        <span class="adm-num">${i + 1}</span>
        <input class="adm-name" value="${esc(r.name)}" maxlength="30" aria-label="Название комнаты">
        <small class="adm-type">${ROOM_TYPES[r.type].name}</small>
        <select class="adm-width" aria-label="Ширина"${lawn ? ' disabled' : ''}>${widths}</select>
        <button data-up${lawn || i <= 1 ? ' disabled' : ''} aria-label="Левее">←</button>
        <button data-down${lawn || i === all.length - 1 ? ' disabled' : ''} aria-label="Правее">→</button>
        <button data-show aria-label="Показать">👁</button>
        <button data-del class="danger"${lawn ? ' disabled' : ''} aria-label="Убрать комнату">×</button>
      </div>`;
    }).join('');
    const types = Object.entries(ROOM_TYPES).filter(([t]) => t !== 'lawn').map(([t, d]) => `<option value="${t}">${d.name}</option>`).join('');
    return `<p class="adm-help">Порядок слева направо. Лужайка всегда первая — через неё вход. Вещи едут вместе со своей комнатой.</p>
      <div class="adm-list">${rows}</div>
      <div class="adm-add"><select class="adm-type-new">${types}</select><button data-addroom class="primary"${store.state.rooms.length >= MAX_ROOMS ? ' disabled' : ''}>+ Добавить комнату</button></div>`;
  }

  function markupTab() {
    const r = actions.roomInView()?.room;
    if (!r) return '';
    if (ROOM_TYPES[r.type].outdoor) return `<p class="adm-help">Сейчас на экране «${esc(r.name)}». Пролистай дом к комнате, разметку которой хочешь изменить.</p>`;
    return `<p class="adm-help">Комната на экране: <b>${esc(r.name)}</b>. Линии видны на сцене: коричневая — граница стены и пола, зелёная — откуда начинают ходить герои.</p>
      <label class="adm-field">Граница пола · <b>${Math.round(r.split * 100)}%</b><input type="range" data-split min="42" max="70" value="${Math.round(r.split * 100)}"></label>
      <label class="adm-field">Начало движения героев · <b>${Math.round(r.walkTop * 100)}%</b><input type="range" data-walk min="46" max="88" value="${Math.round(r.walkTop * 100)}"></label>
      <p class="adm-help">Вещи и герои сами прижмутся к новым границам.</p>`;
  }

  // «Паки»: собрать из своих предметов пак-файл. Файл пака кладётся в папку packs/ — и он в игре.
  let packName = '', packPick = new Set(), packPrice = 0;
  function packsTab() {
    const recs = listRecords(), built = listPacks();
    const items = recs.length ? recs.map((r) => `<label class="pk-item"><input type="checkbox" data-pk="${esc(r.id)}"${packPick.has(r.id) ? ' checked' : ''}><img src="${r.image}" alt=""><span>${esc(r.name)}</span></label>`).join('')
      : '<p class="adm-help">Своих предметов пока нет — создай их во вкладке «Предметы».</p>';
    return `<p class="adm-help">Пак — набор предметов одним файлом. Отметь предметы, дай паку название и скачай файл. Чтобы пак появился в игре у игроков, файл кладётся в папку <b>packs/</b> игры (пришли его — встрою).</p>
      <label class="adm-field">Название пака<input type="text" data-pkname maxlength="40" value="${esc(packName)}" placeholder="Например: Пляж"></label>
      <label class="adm-field">Цена, zł (0 — бесплатно)<input type="number" data-pkprice min="0" max="500" step="0.01" value="${packPrice}"></label>
      <div class="pk-grid">${items}</div>
      ${listOverrides().length ? `<p class="adm-help">Правки встроенных предметов (${listOverrides().length}) тоже войдут в пак.</p>` : ''}
      <div class="adm-buttons"><button data-pkall>Отметить все</button><button data-pkexport class="primary"${packPick.size || listOverrides().length ? '' : ' disabled'}>↓ Скачать пак (${packPick.size}${listOverrides().length ? ' + правки' : ''})</button></div>
      <p class="adm-help">Как пак попадает в магазин игры: пришли скачанный файл — я добавлю его в магазин (store/ на GitHub), обложка соберётся из картинок вещей. Покупки сейчас тестовые (без денег).</p>
      <div class="adm-buttons"><button data-shopreset>Сбросить тестовые покупки</button></div>
      <h4>Паки внутри игры</h4>
      ${built.length ? `<ul class="pk-list">${built.map((p) => `<li><b>${esc(p.name)}</b> · предметов: ${p.count}${p.fixes ? ` · правок: ${p.fixes}` : ''}</li>`).join('')}</ul>` : '<p class="adm-help">Пока нет. Встроенные паки появятся здесь.</p>'}`;
  }

  function dataTab() {
    const c = actions.counts();
    return `<p class="adm-help">${esc(storageNote || 'Дом сохраняется на этом устройстве автоматически.')}</p>
      <p class="adm-help"><b>Вещей всего: ${c.total}</b> · в доме ${c.placed} · в шкафчике ${c.inventory}${c.missing ? ` · спрятано (нет предмета в библиотеке): ${c.missing}` : ''}</p>
      <div class="adm-buttons">
        <button data-export class="primary">↓ Скачать резервную копию (JSON)</button>
        <button data-import>↑ Загрузить из файла</button>
        <button data-reset class="danger">Начать дом заново</button>
      </div>
      <input type="file" accept="application/json,.json" data-file hidden>`;
  }

  function render() {
    if (!isOpen) return;
    const tabs = { rooms: 'Комнаты', markup: 'Разметка', items: 'Предметы', packs: 'Паки', data: 'Данные' };
    el.innerHTML = `<header><b>Админка</b>
        <nav>${Object.entries(tabs).map(([k, n]) => `<button class="tab${tab === k ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('')}</nav>
        <button class="close" data-x aria-label="Закрыть">×</button></header>
      <div class="adm-body">${tab === 'rooms' ? roomsTab() : tab === 'markup' ? markupTab() : tab === 'items' ? '<div class="items-tab"></div>' : tab === 'packs' ? packsTab() : dataTab()}</div>`;
    if (tab === 'items') items.mount(el.querySelector('.items-tab'));
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.closest('.items-tab')) return; // «Предметы» обрабатывает свой модуль
    const id = b.closest('.adm-row')?.dataset.id;
    if (b.dataset.x !== undefined) { if (items.dirty && tab === 'items') toast('Черновик предмета сохранится до следующего открытия админки'); return close(); }
    if (b.dataset.tab) { tab = b.dataset.tab; render(); onChange(); return; }
    if (b.dataset.up !== undefined) actions.moveRoom(id, -1);
    else if (b.dataset.down !== undefined) actions.moveRoom(id, 1);
    else if (b.dataset.show !== undefined) { const r = store.layout.byId.get(id); camera.flyTo(r.x0 + r.room.width / 2 - camera.viewW / 2); }
    else if (b.dataset.del !== undefined) {
      const room = store.state.rooms.find((r) => r.id === id);
      if (!confirm(`Убрать комнату «${room.name}»? Вещи из неё уйдут в шкафчик.`)) return;
      const res = actions.removeRoom(id);
      toast(res.ok ? 'Комната убрана' + (res.moved ? `, вещи (${res.moved}) ушли в шкафчик` : '') : res.reason, !res.ok);
    } else if (b.dataset.addroom !== undefined) {
      const res = actions.addRoom(el.querySelector('.adm-type-new').value);
      if (!res.ok) toast(res.reason, true);
      else { const r = store.layout.byId.get(res.id); camera.flyTo(r.x0); toast('Комната добавлена в конец дома'); }
    } else if (b.dataset.pkall !== undefined) { const all = listRecords().map((r) => r.id); packPick = packPick.size === all.length ? new Set() : new Set(all); }
    else if (b.dataset.shopreset !== undefined) { await resetShop(); toast('Тестовые покупки сброшены — перезапусти игру'); }
    else if (b.dataset.pkexport !== undefined) {
      try {
        const pack = makePack(packName, [...packPick], true, packPrice);
        download(JSON.stringify(pack), `pack_${pack.id}.json`);
        toast(`Пак «${pack.name}» скачан: ${pack.items.length} предм.` + (pack.overrides.length ? `, правок: ${pack.overrides.length}` : ''));
      } catch (err) { toast(err.message, true); }
    } else if (b.dataset.export !== undefined) exportJson();
    else if (b.dataset.import !== undefined) el.querySelector('[data-file]').click();
    else if (b.dataset.reset !== undefined) {
      if (!confirm('Начать дом заново? Это можно отменить кнопкой ↶.')) return;
      const s = validate(defaultState()); normalize(s); store.replace(s); camera.flyTo(0);
    }
    render(); onChange();
  });

  el.addEventListener('change', (e) => {
    const id = e.target.closest('.adm-row')?.dataset.id;
    if (e.target.matches('.adm-name')) actions.renameRoom(id, e.target.value);
    else if (e.target.matches('.adm-width')) actions.setWidth(id, Number(e.target.value));
    else if (e.target.matches('[data-file]')) return importJson(e.target);
    else if (e.target.matches('[data-pk]')) { if (e.target.checked) packPick.add(e.target.dataset.pk); else packPick.delete(e.target.dataset.pk); }
    else if (e.target.matches('[data-pkname]')) { packName = e.target.value; return; }
    else if (e.target.matches('[data-pkprice]')) { packPrice = Number(e.target.value) || 0; return; }
    else if (e.target.matches('[data-split],[data-walk]')) { render(); return; }
    else return;
    render(); onChange();
  });

  // Ползунки: живое изменение, один шаг отмены на всё движение.
  let sliding = false;
  el.addEventListener('pointerdown', (e) => { if (e.target.matches('[data-split],[data-walk]')) { store.checkpoint(); sliding = true; } });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('[data-split],[data-walk]')) return;
    const r = actions.roomInView()?.room; if (!r) return;
    const split = Number(el.querySelector('[data-split]').value) / 100, walk = Number(el.querySelector('[data-walk]').value) / 100;
    if (!sliding) store.checkpoint();
    sliding = true;
    actions.setMarkup(r.id, split, walk, { undo: false });
    const labels = el.querySelectorAll('.adm-field b');
    labels[0].textContent = Math.round(r.split * 100) + '%';
    labels[1].textContent = Math.round(r.walkTop * 100) + '%';
    onChange();
  });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-split],[data-walk]')) sliding = false; });

  function download(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  function exportJson() {
    const text = JSON.stringify({ format: 'sunny-home', ...store.state }, null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'Sunny_Home_House.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('Резервная копия скачана');
  }

  async function importJson(input) {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Файл слишком большой');
      const data = JSON.parse(await file.text());
      if (data.format !== 'sunny-home') throw new Error('Это не файл «Солнечного дома»');
      const s = validate(data); normalize(s);
      if (!confirm('Заменить текущий дом домом из файла? Это можно отменить кнопкой ↶.')) return;
      store.replace(s);
      toast('Дом загружен из файла');
    } catch (err) { toast('Не удалось загрузить: ' + (err instanceof SyntaxError ? 'файл повреждён' : err.message), true); }
    render();
  }

  return {
    open, close,
    sync() { if (isOpen && tab === 'markup' && !sliding) { const r = actions.roomInView()?.room?.id; if (r !== el.dataset.room) { el.dataset.room = r; render(); } } },
    setStorageNote(t) { storageNote = t; if (tab === 'data') render(); },
    get guides() { return isOpen && tab === 'markup' ? actions.roomInView()?.room.id : null; },
  };
}
