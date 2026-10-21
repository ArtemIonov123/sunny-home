// Интерфейс поверх сцены: кнопки, кнопки комнат, панели «Вещи», «Отделка» и админка.
// Кнопки задаются в обычных CSS-пикселях, поэтому на телефоне они не мельчают.
import { VERSION } from '../config.js';
import { itemDef, allItemDefs, GROUPS, ROOM_TYPES, WALL_PATTERNS, FLOOR_MATERIALS, WALL_SWATCHES, FLOOR_SWATCHES } from '../core/catalog.js';
import { img } from '../assets.js';
import { escapeHtml as esc } from '../util.js';
import { createAdmin } from './admin.js';
import { installFastTap } from './tap.js';
import { anims } from '../render/anims.js';
import { play, soundOn, setSound } from '../audio.js';
import { mode } from './mode.js';
import { isSmall } from '../core/physics.js';

// Иконки комнат: ребёнку не нужно читать, чтобы найти кухню.
const ROOM_ICONS = { lawn: '🌳', living: '🛋️', kitchen: '🍳', kids: '🧸', bath: '🛁', bedroom: '🛏️' };
// Разделы редактора комнаты (как в Toca Boca: иконки сверху).
const DESIGN_TABS = [['furniture', '🛋️', 'Мебель'], ['appliances', '🔌', 'Техника'], ['decor', '🖼️', 'Декор'], ['build', '🪟', 'Окна и двери'], ['garden', '🌳', 'Сад'], ['finish', '🖌️', 'Отделка']];

export function createHud({ root, store, camera, actions, onChange }) {
  root.innerHTML = `
    <div class="hud-top-left"><div class="brand"><span class="sun">✺</span>Солнечный дом<small>${VERSION}</small></div></div>
    <div class="hud-top-right">
      <button class="btn icon" data-act="undo" aria-label="Отменить" title="Отменить">↶</button>
      <button class="btn icon" data-act="night" aria-label="День или вечер" title="День / вечер">☾</button>
      <button class="btn icon" data-act="sound" aria-label="Звук" title="Звук">🔊</button>
      <button class="btn icon" data-act="full" aria-label="На весь экран" title="На весь экран">⛶</button>
      <button class="btn admin" data-act="admin">✎ Админка</button>
    </div>
    <nav class="rooms" aria-label="Комнаты"></nav>
    <div class="hud-bottom-right">
      <button class="btn big round" data-act="design" aria-label="Редактор комнаты" title="Редактор комнаты">🛠️</button>
      <button class="btn big round primary" data-act="things" aria-label="Вещи" title="Вещи">🧺</button>
    </div>
    <nav class="design-bar" aria-label="Редактор комнаты">
      ${DESIGN_TABS.map(([k, icon, name]) => `<button class="dtab" data-dtab="${k}" aria-label="${name}" title="${name}">${icon}</button>`).join('')}
      <button class="dtab arrange" data-act="arrange" aria-label="Расставить по местам" title="Расставить по местам">✨</button>
      <button class="dtab done" data-act="done" aria-label="Готово" title="Готово">✓</button>
    </nav>
    <div class="stash" aria-hidden="true">📦<small>В шкафчик</small></div>
    <aside class="panel" data-panel="things" hidden></aside>
    <aside class="panel" data-panel="finish" hidden></aside>
    <div class="toast" role="status" aria-live="polite"></div>`;

  installFastTap(root);
  const q = (s) => root.querySelector(s);
  const roomsNav = q('.rooms'), toastEl = q('.toast');
  let openPanel = null, toastTimer = 0, activeRoom = null, designTab = 'furniture', startDrag = null, toLocal = (x, y) => ({ x, y }), press = null, suppressUntil = 0;
  const admin = createAdmin({ root, store, camera, actions, toast, onChange });

  const last = {};
  function syncSound() { const t = soundOn() ? '🔊' : '🔇'; if (last.sound !== t) { last.sound = t; q('[data-act=sound]').textContent = t; } }

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
      `<button class="room-chip${r.room.id === activeRoom ? ' active' : ''}" data-room="${esc(r.room.id)}" aria-label="${esc(r.room.name)}"><i>${ROOM_ICONS[r.room.type] || '🏠'}</i><span>${esc(r.room.name)}</span></button>`).join('');
  }

  function showPanel(name, force = false) {
    openPanel = !force && openPanel === name ? null : name;
    for (const p of root.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== openPanel;
    q('[data-act=things]').classList.toggle('on', openPanel === 'things');
    for (const b of root.querySelectorAll('.dtab[data-dtab]')) b.classList.toggle('on', mode.design && (openPanel === 'finish' ? b.dataset.dtab === 'finish' : openPanel === 'things' && b.dataset.dtab === designTab));
    if (openPanel === 'things') renderThings();
    if (openPanel === 'finish') renderFinish();
  }

  // «Вещи». В игре — мелочь (еда, игрушки, одежда, тостер…), в редакторе — мебель выбранного раздела.
  // Сверху то, что уже есть в шкафчике (тянуть в комнату), ниже — «взять ещё» из каталога.
  function scopeDefs() {
    const all = allItemDefs();
    return mode.design ? all.filter((d) => d.group === designTab && !isSmall(d)) : all.filter((d) => isSmall(d));
  }
  function renderThings() {
    const el = q('[data-panel=things]');
    const defs = scopeDefs(), ids = new Set(defs.map((d) => d.id));
    const stacks = new Map();
    for (const i of store.state.items) if (i.inv && ids.has(i.def)) stacks.set(i.def, (stacks.get(i.def) || 0) + 1);
    const title = mode.design ? DESIGN_TABS.find(([k]) => k === designTab)?.[2] || 'Мебель' : 'Вещи';
    const mine = stacks.size
      ? `<div class="grid">${[...stacks].map(([def, n]) => { const d = itemDef(def); return `<div class="stack" data-stack="${esc(def)}" role="button" tabindex="0" aria-label="${esc(d.name)}, ${n} шт."><img src="${img(d.art).src}" alt="" draggable="false"><span>${esc(d.name)}</span>${n > 1 ? `<b class="count">×${n}</b>` : ''}</div>`; }).join('')}</div>`
      : '<p class="note">🧺 пусто</p>';
    const shop = defs.length
      ? `<div class="grid">${defs.map((d) => `<button class="thing" data-get="${esc(d.id)}" aria-label="Взять: ${esc(d.name)}"><img src="${img(d.art).src}" alt=""><span>${esc(d.name)}</span><small>＋</small></button>`).join('')}</div>`
      : '';
    el.innerHTML = `<header><b>${esc(title)}</b><button class="close" data-close>×</button></header>
      <h4>🧺 <small>Шкафчик</small></h4>${mine}
      <h4>🛍️ <small>Взять ещё</small></h4>${shop}`;
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
    // Почти вертикально и ещё внутри панели — это прокрутка списка; иначе тянем вещь.
    const r = thingsPanel.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside && Math.abs(dy) > Math.abs(dx) * 2) { press = null; return; }
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
    if (act === 'undo') { play(store.undo() ? 'whoosh' : 'nope'); }
    else if (act === 'sound') { setSound(!soundOn()); syncSound(); }
    else if (act === 'night') actions.toggleNight();
    else if (act === 'full') fullscreen();
    else if (act === 'admin') { showPanel(null); admin.open(); }
    else if (act === 'things') showPanel('things');
    else if (act === 'design') setDesign(true);
    else if (act === 'done') setDesign(false);
    else if (act === 'arrange') {
      const r = actions.roomInView();
      if (r && actions.arrangeRoom(r.room.id)) { play('whoosh'); for (const i of store.state.items) if (!i.inv && i.room === r.room.id) anims.squash('item:' + i.id); onChange(); }
    }
    else if (t.dataset.dtab) { if (t.dataset.dtab === 'finish') showPanel('finish', true); else { designTab = t.dataset.dtab; showPanel('things', true); } play('click'); }
    else if (t.dataset.close !== undefined) showPanel(null);
    else if (t.dataset.room) goTo(t.dataset.room);
    else if (t.dataset.get) {
      const res = actions.obtain(t.dataset.get);
      if (res.ok) { play('pop'); t.classList.remove('got'); void t.offsetWidth; t.classList.add('got'); }
      else { play('nope'); toast(res.reason, true); }
    } else if (t.dataset.discard) {
      const item = store.state.items.find((i) => i.inv && i.def === t.dataset.discard);
      if (item) { actions.discard(item.id); play('stash'); renderThings(); }
    } else if (t.dataset.stack) {
      const item = store.state.items.find((i) => i.inv && i.def === t.dataset.stack);
      const res = item ? actions.placeFromInventory(item.id) : { ok: false, reason: 'Вещь не найдена' };
      if (res.ok) { anims.fall('item:' + item.id, res.fall); setTimeout(() => play('land'), 150); onChange(); }
      else { play('nope'); toast(res.reason, true); }
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

  function setDesign(on) {
    mode.set(on);
    root.closest('#app')?.classList.toggle('design', on);
    play(on ? 'open' : 'close');
    if (on) showPanel('things', true); else showPanel(null);
    onChange();
  }

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
    // Меняем DOM только если что-то изменилось: запись в DOM каждый кадр заставляет
    // браузер пересчитывать вёрстку — на телефоне это и было «подвисание».
    const undoOff = !store.canUndo, night = store.state.night ? '☀' : '☾';
    if (last.undo !== undoOff) { last.undo = undoOff; q('[data-act=undo]').disabled = undoOff; }
    if (last.night !== night) { last.night = night; q('[data-act=night]').textContent = night; }
    syncSound();
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
    closePanels() { if (!mode.design) showPanel(null); },
    setDesign,
  };
}

