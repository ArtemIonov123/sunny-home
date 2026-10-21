// Интерфейс поверх сцены: кнопки, кнопки комнат, панели «Вещи», «Отделка» и админка.
// Кнопки задаются в обычных CSS-пикселях, поэтому на телефоне они не мельчают.
import { VERSION } from '../config.js';
import { ITEMS, ROOM_TYPES, WALL_PATTERNS, FLOOR_MATERIALS, WALL_SWATCHES, FLOOR_SWATCHES } from '../core/catalog.js';
import { img } from '../assets.js';
import { escapeHtml as esc } from '../util.js';
import { createAdmin } from './admin.js';

export function createHud({ root, store, camera, actions, onChange }) {
  root.innerHTML = `
    <div class="hud-top-left"><div class="brand"><span class="sun">✺</span>Солнечный дом<small>${VERSION}</small></div></div>
    <div class="hud-top-right">
      <button class="btn icon" data-act="undo" aria-label="Отменить" title="Отменить">↶</button>
      <button class="btn icon" data-act="night" aria-label="День или вечер" title="День / вечер">☾</button>
      <button class="btn icon" data-act="full" aria-label="На весь экран" title="На весь экран">⛶</button>
      <button class="btn admin" data-act="admin">✎ Админка</button>
    </div>
    <nav class="rooms" aria-label="Комнаты"></nav>
    <div class="hud-bottom-right">
      <button class="btn big" data-act="finish">🎨 Отделка</button>
      <button class="btn big primary" data-act="things">▤ Вещи</button>
    </div>
    <div class="trash" aria-hidden="true">🗑<small>Убрать</small></div>
    <aside class="panel" data-panel="things" hidden></aside>
    <aside class="panel" data-panel="finish" hidden></aside>
    <div class="toast" role="status" aria-live="polite"></div>`;

  const q = (s) => root.querySelector(s);
  const roomsNav = q('.rooms'), toastEl = q('.toast');
  let openPanel = null, toastTimer = 0, activeRoom = null;
  const admin = createAdmin({ root, store, camera, actions, toast, onChange });

  function toast(text, error = false) {
    toastEl.textContent = text;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), error ? 4200 : 2600);
  }

  function goTo(roomId) {
    const r = store.layout.byId.get(roomId);
    if (r) camera.flyTo(r.x0 + r.room.width / 2 - camera.viewW / 2);
    onChange();
  }

  function renderRooms() {
    roomsNav.innerHTML = store.layout.list.map((r) =>
      `<button class="room-chip${r.room.id === activeRoom ? ' active' : ''}" data-room="${esc(r.room.id)}">${esc(r.room.name)}</button>`).join('');
  }

  function showPanel(name) {
    openPanel = openPanel === name ? null : name;
    for (const p of root.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== openPanel;
    q('[data-act=things]').classList.toggle('on', openPanel === 'things');
    q('[data-act=finish]').classList.toggle('on', openPanel === 'finish');
    if (openPanel === 'things') renderThings();
    if (openPanel === 'finish') renderFinish();
  }

  function renderThings() {
    const r = actions.roomInView();
    q('[data-panel=things]').innerHTML = `
      <header><b>Вещи</b><small>в комнату «${esc(r?.room.name || '')}»</small><button class="close" data-close>×</button></header>
      <div class="grid">${Object.entries(ITEMS).map(([id, d]) =>
        `<button class="thing" data-add="${id}"><img src="${img(d.art).src}" alt=""><span>${esc(d.name)}</span></button>`).join('')}</div>
      <p class="note">Нажми на вещь — она появится в комнате на экране. Убрать вещь: перетащи её в корзину слева внизу.</p>`;
  }

  function renderFinish() {
    const r = actions.roomInView(); if (!r) return;
    const room = r.room, outdoor = ROOM_TYPES[room.type].outdoor;
    const el = q('[data-panel=finish]');
    if (outdoor) {
      el.innerHTML = `<header><b>Отделка</b><small>${esc(room.name)}</small><button class="close" data-close>×</button></header><p class="note">На лужайке нет стен и пола для перекраски. Пролистай к комнате.</p>`;
      return;
    }
    const sw = (list, kind, cur) => list.map((c) => `<button class="swatch${c === cur ? ' on' : ''}" style="--c:${c}" data-${kind}="${c}" aria-label="${c}"></button>`).join('');
    el.innerHTML = `
      <header><b>Отделка</b><small>${esc(room.name)}</small><button class="close" data-close>×</button></header>
      <h4>Стены</h4>
      <div class="swatches">${sw(WALL_SWATCHES, 'wall', room.wall.color)}<label class="swatch custom" aria-label="Свой цвет стены"><input type="color" data-wallcolor value="${room.wall.color}"></label></div>
      <div class="chips">${Object.entries(WALL_PATTERNS).map(([k, n]) => `<button class="chip${room.wall.pattern === k ? ' on' : ''}" data-pattern="${k}">${n}</button>`).join('')}</div>
      <h4>Пол</h4>
      <div class="chips">${Object.entries(FLOOR_MATERIALS).map(([k, n]) => `<button class="chip${room.floor.material === k ? ' on' : ''}" data-material="${k}">${n}</button>`).join('')}</div>
      <div class="swatches">${sw(FLOOR_SWATCHES, 'floor', room.floor.color)}<label class="swatch custom" aria-label="Свой цвет пола"><input type="color" data-floorcolor value="${room.floor.color}"></label></div>`;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || !root.contains(t)) return;
    const act = t.dataset.act;
    if (act === 'undo') { if (store.undo()) toast('Отменено'); else toast('Нечего отменять'); }
    else if (act === 'night') actions.toggleNight();
    else if (act === 'full') fullscreen();
    else if (act === 'admin') { showPanel(null); admin.open(); }
    else if (act === 'things' || act === 'finish') showPanel(act);
    else if (t.dataset.close !== undefined) showPanel(null);
    else if (t.dataset.room) goTo(t.dataset.room);
    else if (t.dataset.add) {
      const res = actions.addItem(t.dataset.add);
      toast(res.ok ? `Добавлено: ${ITEMS[t.dataset.add].name}. Перетащи на нужное место.` : res.reason, !res.ok);
    } else {
      const r = actions.roomInView(); if (!r) return;
      if (t.dataset.wall) actions.setWall(r.room.id, { color: t.dataset.wall });
      else if (t.dataset.pattern) actions.setWall(r.room.id, { pattern: t.dataset.pattern });
      else if (t.dataset.floor) actions.setFloor(r.room.id, { color: t.dataset.floor });
      else if (t.dataset.material) actions.setFloor(r.room.id, { material: t.dataset.material });
      else return;
      renderFinish();
    }
  });
  root.addEventListener('change', (e) => {
    const r = actions.roomInView(); if (!r) return;
    if (e.target.matches('[data-wallcolor]')) actions.setWall(r.room.id, { color: e.target.value });
    else if (e.target.matches('[data-floorcolor]')) actions.setFloor(r.room.id, { color: e.target.value });
    else return;
    renderFinish();
  });

  async function fullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      const el = document.documentElement;
      if (el.requestFullscreen) { await el.requestFullscreen(); try { await screen.orientation.lock('landscape'); } catch (e) { /* не везде можно */ } }
      else toast('Поверни телефон горизонтально. В Safari: «На экран Домой».');
    } catch (e) { toast('Полноэкранный режим недоступен в этом браузере', true); }
  }

  // Вызывается после каждого кадра/изменения: подсветка текущей комнаты и т. п.
  function sync() {
    const r = actions.roomInView();
    const id = r?.room.id || null;
    const sig = store.layout.list.map((x) => x.room.id + x.room.name).join('|');
    if (id !== activeRoom || sig !== roomsNav.dataset.sig) {
      const changedRoom = id !== activeRoom;
      activeRoom = id; roomsNav.dataset.sig = sig; renderRooms();
      roomsNav.querySelector('.active')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
      if (changedRoom && openPanel === 'finish') renderFinish();
      if (changedRoom && openPanel === 'things') renderThings();
    }
    q('[data-act=undo]').disabled = !store.canUndo;
    q('[data-act=night]').textContent = store.state.night ? '☀' : '☾';
    admin.sync();
  }

  return {
    toast, sync, goTo,
    showTrash(on) { q('.trash').classList.toggle('show', on); },
    hotTrash(on) { q('.trash').classList.toggle('hot', on); },
    isOverTrash(cx, cy) { const el = document.elementFromPoint(cx, cy); return !!el?.closest?.('.trash.show'); },
    get guides() { return admin.guides; },
    setStorageNote: (t) => admin.setStorageNote(t),
    closePanels() { showPanel(null); },
  };
}

