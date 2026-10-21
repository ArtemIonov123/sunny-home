// Админка. Разделы: «Комнаты» (порядок, ширина, добавить/убрать),
// «Разметка» (граница стены и пола, область движения), «Данные» (резервная копия).
// Позже здесь появятся «Предметы» и «Рецепты».
import { ROOM_TYPES } from '../core/catalog.js';
import { ROOM_WIDTHS, MAX_ROOMS, defaultState } from '../core/house.js';
import { escapeHtml as esc } from '../util.js';
import { validate } from '../save/migrate.js';
import { normalize } from '../core/actions.js';

export function createAdmin({ root, store, camera, actions, toast, onChange }) {
  const el = document.createElement('section');
  el.className = 'admin-sheet';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Админка');
  root.append(el);
  let tab = 'rooms', isOpen = false, storageNote = '';

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

  function dataTab() {
    return `<p class="adm-help">${esc(storageNote || 'Дом сохраняется на этом устройстве автоматически.')}</p>
      <div class="adm-buttons">
        <button data-export class="primary">↓ Скачать резервную копию (JSON)</button>
        <button data-import>↑ Загрузить из файла</button>
        <button data-reset class="danger">Начать дом заново</button>
      </div>
      <input type="file" accept="application/json,.json" data-file hidden>`;
  }

  function render() {
    if (!isOpen) return;
    const tabs = { rooms: 'Комнаты', markup: 'Разметка', data: 'Данные' };
    el.innerHTML = `<header><b>Админка</b>
        <nav>${Object.entries(tabs).map(([k, n]) => `<button class="tab${tab === k ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('')}</nav>
        <button class="close" data-x aria-label="Закрыть">×</button></header>
      <div class="adm-body">${tab === 'rooms' ? roomsTab() : tab === 'markup' ? markupTab() : dataTab()}</div>`;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('.adm-row')?.dataset.id;
    if (b.dataset.x !== undefined) return close();
    if (b.dataset.tab) { tab = b.dataset.tab; render(); onChange(); return; }
    if (b.dataset.up !== undefined) actions.moveRoom(id, -1);
    else if (b.dataset.down !== undefined) actions.moveRoom(id, 1);
    else if (b.dataset.show !== undefined) { const r = store.layout.byId.get(id); camera.flyTo(r.x0 + r.room.width / 2 - camera.viewW / 2); }
    else if (b.dataset.del !== undefined) {
      const room = store.state.rooms.find((r) => r.id === id);
      if (!confirm(`Убрать комнату «${room.name}»?`)) return;
      const res = actions.removeRoom(id);
      toast(res.ok ? 'Комната убрана' : res.reason, !res.ok);
    } else if (b.dataset.addroom !== undefined) {
      const res = actions.addRoom(el.querySelector('.adm-type-new').value);
      if (!res.ok) toast(res.reason, true);
      else { const r = store.layout.byId.get(res.id); camera.flyTo(r.x0); toast('Комната добавлена в конец дома'); }
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
    else if (e.target.matches('[data-split],[data-walk]')) { render(); return; }
    else return;
    render(); onChange();
  });

  // Ползунки: живое изменение, один шаг отмены на всё движение.
  let sliding = false;
  el.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range]')) { store.checkpoint(); sliding = true; } });
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
  el.addEventListener('change', (e) => { if (e.target.matches('input[type=range]')) sliding = false; });

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
