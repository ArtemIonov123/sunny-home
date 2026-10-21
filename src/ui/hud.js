// Интерфейс поверх сцены: кнопки, кнопки комнат, панели «Вещи», «Отделка» и админка.
// Кнопки задаются в обычных CSS-пикселях, поэтому на телефоне они не мельчают.
import { VERSION } from '../config.js';
import { itemDef, allItemDefs, GROUPS, ROOM_TYPES, WALL_PATTERNS, FLOOR_MATERIALS, WALL_SWATCHES, FLOOR_SWATCHES } from '../core/catalog.js';
import { img } from '../assets.js';
import { escapeHtml as esc } from '../util.js';
import { createAdmin } from './admin.js';
import { installFastTap } from './tap.js';

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
    <div class="stash" aria-hidden="true">📦<small>В шкафчик</small></div>
    <aside class="panel" data-panel="things" hidden></aside>
    <aside class="panel" data-panel="finish" hidden></aside>
    <div class="toast" role="status" aria-live="polite"></div>`;

  installFastTap(root);
  const q = (s) => root.querySelector(s);
  const roomsNav = q('.rooms'), toastEl = q('.toast');
  let openPanel = null, toastTimer = 0, activeRoom = null, thingsTab = 'mine', startDrag = null, toLocal = (x, y) => ({ x, y }), press = null, suppressUntil = 0;
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

  // «Вещи»: Шкафчик — твои экземпляры; Каталог — получить новую вещь.
  function renderThings() {
    const r = actions.roomInView();
    const el = q('[data-panel=things]');
    const tabs = `<nav class="ptabs"><button class="ptab${thingsTab === 'mine' ? ' on' : ''}" data-ttab="mine">Шкафчик</button><button class="ptab${thingsTab === 'shop' ? ' on' : ''}" data-ttab="shop">Каталог</button></nav>`;
    let body = '';
    if (thingsTab === 'mine') {
      const stacks = new Map();
      for (const i of store.state.items) if (i.inv && itemDef(i.def)) stacks.set(i.def, (stacks.get(i.def) || 0) + 1);
      body = stacks.size
        ? `<div class="grid">${[...stacks].map(([def, n]) => { const d = itemDef(def); return `<div class="stack" data-stack="${esc(def)}" role="button" tabindex="0" aria-label="${esc(d.name)}, ${n} шт."><img src="${img(d.art).src}" alt="" draggable="false"><span>${esc(d.name)}</span>${n > 1 ? `<b class="count">×${n}</b>` : ''}<button class="discard" data-discard="${esc(def)}" aria-label="Выбросить одну">🗑</button></div>`; }).join('')}</div>
          <p class="note">Потяни вещь влево — в комнату. Или нажми — она встанет в «${esc(r?.room.name || '')}». Чтобы убрать вещь обратно, перетащи её на 📦 слева внизу.</p>`
        : `<p class="note">Шкафчик пуст. Убранные из дома вещи попадают сюда, новые — во вкладке «Каталог».</p>`;
    } else {
      const defs = allItemDefs();
      body = Object.entries(GROUPS).map(([g, gname]) => {
        const list = defs.filter((d) => d.group === g);
        if (!list.length) return '';
        return `<h4>${gname}</h4><div class="grid">${list.map((d) => `<button class="thing" data-get="${esc(d.id)}"><img src="${img(d.art).src}" alt=""><span>${esc(d.name)}</span><small>${d.builtin ? '+ в шкафчик' : 'свой · + в шкафчик'}</small></button>`).join('')}</div>`;
      }).join('') + `<p class="note">Пока всё бесплатно — магазин и деньги появятся позже. Свои предметы добавляются в «Админка → Предметы».</p>`;
    }
    el.innerHTML = `<header><b>Вещи</b><button class="close" data-close>×</button></header>${tabs}${body}`;
  }

  // Перетаскивание из шкафчика: горизонтальное движение — тянем вещь, вертикальное — листаем список.
  const thingsPanel = q('[data-panel=things]');
  thingsPanel.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.stack');
    if (!card || e.target.closest('.discard')) return;
    const p = toLocal(e.clientX, e.clientY); // в координатах игры (экран может быть повёрнут)
    press = { id: e.pointerId, x: p.x, y: p.y, def: card.dataset.stack };
  });
  thingsPanel.addEventListener('pointermove', (e) => {
    if (!press || press.id !== e.pointerId || !startDrag) return;
    const p = toLocal(e.clientX, e.clientY), dx = p.x - press.x, dy = p.y - press.y;
    if (Math.hypot(dx, dy) < 10) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.2) { press = null; return; } // это прокрутка списка
    const item = store.state.items.find((i) => i.inv && i.def === press.def);
    press = null;
    if (item && startDrag(e, item.id)) { suppressUntil = performance.now() + 500; showPanel(null); }
  });
  const endPress = () => { press = null; };
  thingsPanel.addEventListener('pointerup', endPress);
  thingsPanel.addEventListener('pointercancel', endPress);

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
    const t = e.target.closest('button, .stack'); if (!t || !root.contains(t)) return;
    const act = t.dataset.act;
    if (performance.now() < suppressUntil && t.closest('.panel')) return; // клик-хвост от перетаскивания
    if (act === 'undo') { if (store.undo()) toast('Отменено'); else toast('Нечего отменять'); }
    else if (act === 'night') actions.toggleNight();
    else if (act === 'full') fullscreen();
    else if (act === 'admin') { showPanel(null); admin.open(); }
    else if (act === 'things' || act === 'finish') showPanel(act);
    else if (t.dataset.close !== undefined) showPanel(null);
    else if (t.dataset.room) goTo(t.dataset.room);
    else if (t.dataset.ttab) { thingsTab = t.dataset.ttab; renderThings(); }
    else if (t.dataset.get) {
      const res = actions.obtain(t.dataset.get);
      const n = store.state.items.filter((i) => i.inv && i.def === t.dataset.get).length;
      toast(res.ok ? `${itemDef(t.dataset.get).name} — в шкафчике (×${n})` : res.reason, !res.ok);
    } else if (t.dataset.discard) {
      const item = store.state.items.find((i) => i.inv && i.def === t.dataset.discard);
      if (item) { actions.discard(item.id); toast(`Выброшено: ${itemDef(item.def).name}. Отменить — ↶`); renderThings(); }
    } else if (t.dataset.stack) {
      const item = store.state.items.find((i) => i.inv && i.def === t.dataset.stack);
      const res = item ? actions.placeFromInventory(item.id) : { ok: false, reason: 'Вещь не найдена' };
      toast(res.ok ? `${itemDef(item.def).name} — в комнате. Перетащи на нужное место.` : res.reason, !res.ok);
      renderThings();
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
      // Прокручиваем только саму полоску комнат (scrollIntoView мог бы сдвинуть всю страницу).
      const chip = roomsNav.querySelector('.active');
      if (chip) roomsNav.scrollLeft = chip.offsetLeft - (roomsNav.clientWidth - chip.offsetWidth) / 2;
      if (changedRoom && openPanel === 'finish') renderFinish();
      if (changedRoom && openPanel === 'things') renderThings();
    }
    q('[data-act=undo]').disabled = !store.canUndo;
    q('[data-act=night]').textContent = store.state.night ? '☀' : '☾';
    admin.sync();
  }

  return {
    toast, sync, goTo,
    showStash(on) { q('.stash').classList.toggle('show', on); },
    hotStash(on) { q('.stash').classList.toggle('hot', on); },
    isOverStash(cx, cy) { const el = document.elementFromPoint(cx, cy); return !!el?.closest?.('.stash.show'); },
    setDragStarter(fn, localFn) { startDrag = fn; if (localFn) toLocal = localFn; },
    refreshThings() { if (openPanel === 'things') renderThings(); },
    get guides() { return admin.guides; },
    setStorageNote: (t) => admin.setStorageNote(t),
    closePanels() { showPanel(null); },
  };
}

