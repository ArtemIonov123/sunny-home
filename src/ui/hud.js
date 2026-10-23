// Интерфейс поверх сцены: кнопки, кнопки комнат, панели «Вещи», «Отделка» и админка.
// Кнопки задаются в обычных CSS-пикселях, поэтому на телефоне они не мельчают.
import { VERSION, STUDIO } from '../config.js';
import { itemDef, allItemDefs, GROUPS, ROOM_TYPES, WALL_PATTERNS, FLOOR_MATERIALS, WALL_SWATCHES, FLOOR_SWATCHES, CUSTOM_FINISHES } from '../core/catalog.js';
import { img } from '../assets.js';
import { escapeHtml as esc } from '../util.js';
import { createAdmin } from './admin.js';
import { createHeroEditor } from './heroEditor.js';
import { createShop } from './shop.js';
import { isNew, seen } from '../core/shop.js';
import { installFastTap } from './tap.js';
import { anims } from '../render/anims.js';
import { play, soundOn, setSound } from '../audio.js';
import { mode } from './mode.js';
import { createSettings, avatarSrc } from './settings.js';
import { getProfile } from '../core/profile.js';
import { createFriends } from '../net/friends.js';
import { getAnimal } from '../render/animal.js';
import { isLocked } from '../core/access.js';
import { isSmall } from '../core/physics.js';

// Иконки комнат: ребёнку не нужно читать, чтобы найти кухню.
const EMOTES = ['👋', '❤️', '😂', '⭐', '😮', '👍'];
const ROOM_ICONS = { lawn: '🌳', living: '🛋️', kitchen: '🍳', kids: '🧸', bath: '🛁', bedroom: '🛏️', shop: '🛒' };
// Разделы редактора комнаты (как в Toca Boca: иконки сверху).
const DESIGN_TABS = [['furniture', '🛋️', 'Мебель'], ['appliances', '🔌', 'Техника'], ['decor', '🖼️', 'Декор'], ['build', '🪟', 'Окна и двери'], ['garden', '🌳', 'Сад'], ['finish', '🖌️', 'Отделка']];

export function createHud({ root, store, camera, actions, onChange }) {
  root.innerHTML = `
    <div class="hud-top-left"><button class="avatar-btn" data-act="settings" aria-label="Настройки и профиль"><img alt=""></button><button class="btn home-btn" data-act="home" aria-label="Домой">🏠</button><div class="brand"><span class="sun">✺</span>Солнечный дом${STUDIO ? ' · студия' : ''}<small>${VERSION}</small></div></div>
    <div class="hud-top-right">
      <button class="btn icon map-btn" data-act="map" aria-label="Карта" title="Карта">🗺️</button>
      <button class="btn icon" data-act="undo" aria-label="Отменить" title="Отменить">↶</button>
      <button class="btn icon" data-act="night" aria-label="День или вечер" title="День / вечер">☾</button>
      <button class="btn icon" data-act="settings" aria-label="Настройки" title="Настройки">⚙️</button>
      <button class="btn icon" data-act="full" aria-label="На весь экран" title="На весь экран">⛶</button>
      ${STUDIO ? '<button class="btn admin" data-act="admin">✎ Админка</button>' : ''}
    </div>
    <nav class="rooms" aria-label="Комнаты"></nav>
    <div class="pets" aria-label="Позвать животное"></div>
    <div class="emote-bar"><button class="btn round emote-btn" data-act="emote" aria-label="Смайлики">💬</button><div class="emote-pick" hidden>${EMOTES.map((e) => `<button class="emote-one" data-emote="${e}">${e}</button>`).join('')}</div></div>
    <div class="hud-bottom-right">
      <button class="btn big round" data-act="shop" aria-label="Магазин" title="Магазин">🛍️</button>
      <button class="btn big round" data-act="heroes" aria-label="Герои" title="Герои">😊</button>
      <button class="btn big round" data-act="design" aria-label="Редактор комнаты" title="Редактор комнаты">🛠️</button>
      <button class="btn big round primary" data-act="things" aria-label="Вещи" title="Вещи">🧺</button>
    </div>
    <nav class="design-bar" aria-label="Редактор комнаты">
      ${DESIGN_TABS.map(([k, icon, name]) => `<button class="dtab" data-dtab="${k}" aria-label="${name}" title="${name}">${icon}</button>`).join('')}
      <button class="dtab arrange" data-act="arrange" aria-label="Расставить по местам" title="Расставить по местам">✨</button>
      <button class="dtab done" data-act="done" aria-label="Готово" title="Готово">✓</button>
    </nav>
    <div class="stash" aria-hidden="true">↩<small>Убрать</small></div>
    <aside class="panel" data-panel="things" hidden></aside>
    <aside class="panel" data-panel="finish" hidden></aside>
    <div class="toast" role="status" aria-live="polite"></div>`;

  installFastTap(root);
  const q = (s) => root.querySelector(s);
  const roomsNav = q('.rooms'), toastEl = q('.toast');
  let openPanel = null, toastTimer = 0, activeRoom = null, designTab = 'furniture', startDrag = null, toLocal = (x, y) => ({ x, y }), press = null, suppressUntil = 0;
  // В игре админки нет вовсе (код студии не попадает в сборку игры).
  const admin = __STUDIO__ ? createAdmin({ root, store, camera, actions, toast, onChange }) : { open() {}, sync() {}, guides: null, setStorageNote() {} };
  const heroEditor = createHeroEditor({ root, store, actions, onChange });
  // Друзья (сервер Firebase): запускаются сами при старте, если есть интернет.
  // Мой профиль для друзей: имя, аватарка и внешность героя из профиля (в гостях я — этот герой).
  // Внешность берётся из своего дома, даже когда я в гостях.
  let homeLook = null;
  const getMe = () => { const p = getProfile(); const c = (visit?.mode === 'guest' ? null : store.state.chars.find((c) => c.id === p.face)); if (c?.look) homeLook = { ...homeLook, [p.face]: c.look }; return { ...p, look: c?.look || homeLook?.[p.face] || null }; };
  let visit = null;
  const friends = createFriends({
    getMe,
    onUpdate: (st) => {
      settings?.refresh();
      const n = st.requests.length, badge = q('.avatar-btn');
      if (badge.dataset.n !== String(n)) { badge.dataset.n = n; badge.classList.toggle('has-req', n > 0); }
      if (st.newRequest && st.newRequest !== lastReq) { lastReq = st.newRequest; play('ding'); } // пришёл запрос в друзья
    },
  });
  let lastReq = 0;
  const settings = createSettings({ root, onChange, friends, toast });
  setTimeout(() => { if (navigator.onLine !== false) friends.start(); }, 1500);
  const shop = createShop({ root, onInstalled: () => { actions.restoreMissing(); onChange(); }, openThings: () => showPanel('things', true) });

  const last = {};
  // Аватарка вверху слева: лицо своего героя (меняется вместе с его внешностью).
  function syncSound() { const p = getProfile(), src = avatarSrc(p.face, p.bg, 96); if (last.avatar !== src) { last.avatar = src; q('.avatar-btn img').src = src; } }

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
    const all = allItemDefs().filter((d) => !isLocked(d.id)); // закрытые встроенные (щенок «только в паках») не показываем
    return mode.design ? all.filter((d) => d.group === designTab && !isSmall(d)) : all.filter((d) => isSmall(d));
  }
  // Один список: тянешь карточку — вещь сразу в комнате, нажал — встала на свободное место.
  // (Убранные вещи хранятся незаметно и используются снова, когда берёшь такую же.)
  function renderThings() {
    const el = q('[data-panel=things]');
    const defs = scopeDefs().sort((a, b) => isNew(b.id) - isNew(a.id)); // новое из магазина — первым
    const title = mode.design ? DESIGN_TABS.find(([k]) => k === designTab)?.[2] || 'Мебель' : 'Вещи';
    el.innerHTML = `<header><b>${esc(title)}</b><button class="close" data-close>×</button></header>
      <div class="grid">${defs.map((d) => `<div class="stack" data-stack="${esc(d.id)}" role="button" tabindex="0" aria-label="${esc(d.name)}"><img src="${img(d.art).src}" alt="" draggable="false"><span>${esc(d.name)}</span>${isNew(d.id) ? '<i class="new">⭐</i>' : ''}</div>`).join('')}</div>`;
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
    const id = actions.take(press.def);
    seen(press.def);
    press = null;
    if (id && startDrag(e, id)) { suppressUntil = performance.now() + 500; showPanel(null); }
    else if (!id) { play('nope'); }
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
      <div class="chips">${Object.entries(WALL_PATTERNS).map(([k, n]) => `<button class="chip${room.wall.pattern === k ? ' on' : ''}" data-pattern="${k}">${n}</button>`).join('')}${Object.entries(CUSTOM_FINISHES.wall).map(([k, f]) => `<button class="chip own${room.wall.pattern === k ? ' on' : ''}" data-pattern="${k}" style="--img:url(${f.image})">${esc(f.name)}</button>`).join('')}</div>
      <h4>Пол</h4>
      <div class="chips">${Object.entries(FLOOR_MATERIALS).map(([k, n]) => `<button class="chip${room.floor.material === k ? ' on' : ''}" data-material="${k}">${n}</button>`).join('')}${Object.entries(CUSTOM_FINISHES.floor).map(([k, f]) => `<button class="chip own${room.floor.material === k ? ' on' : ''}" data-material="${k}" style="--img:url(${f.image})">${esc(f.name)}</button>`).join('')}</div>
      <div class="swatches">${sw(FLOOR_SWATCHES, 'floor', room.floor.color)}<label class="swatch custom" aria-label="Свой цвет пола"><input type="color" data-floorcolor value="${room.floor.color}"></label></div>`;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, .stack'); if (!t || !root.contains(t)) return;
    const act = t.dataset.act;
    if (performance.now() < suppressUntil && t.closest('.panel')) return; // клик-хвост от перетаскивания
    if (act === 'undo') { play(store.undo() ? 'whoosh' : 'nope'); }
    else if (act === 'settings') { showPanel(null); settings.open(); }
    else if (act === 'home') { visit?.leave(); play('whoosh'); }
    else if (act === 'emote') { const p = q('.emote-pick'); p.hidden = !p.hidden; play('click'); }
    else if (t.dataset.emote) { q('.emote-pick').hidden = true; if (visit?.emote(t.dataset.emote)) { play('pop'); onChange(); } }
    else if (act === 'map') { showPanel(null); if (heroEditor.isOpen) heroEditor.close(); onMap?.(); }
    else if (act === 'night') actions.toggleNight();
    else if (act === 'full') fullscreen();
    else if (act === 'admin') { showPanel(null); admin.open(); }
    else if (act === 'things') showPanel('things');
    else if (t.dataset.pet) { callPet?.(Number(t.dataset.pet)); t.classList.remove('ping'); void t.offsetWidth; t.classList.add('ping'); }
    else if (act === 'shop') { showPanel(null); if (heroEditor.isOpen) heroEditor.close(); shop.toggle(); }
    else if (act === 'heroes') { showPanel(null); heroEditor.toggle(nearestHero()); }
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
      seen(t.dataset.stack);
      const id = actions.take(t.dataset.stack);
      const res = id ? actions.placeFromInventory(id) : { ok: false };
      if (res.ok) { anims.fall('item:' + id, res.fall); setTimeout(() => play('land'), 150); onChange(); }
      else play('nope');
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

  // Какого героя открыть в «Героях»: того, кто сейчас в кадре (ближе к середине экрана).
  function nearestHero() {
    const mid = camera.x + camera.viewW / 2;
    let best = null, bd = Infinity;
    for (const c of store.state.chars) {
      if (!c.look) continue;
      const r = store.layout.byId.get(c.room); if (!r) continue;
      const d = Math.abs(r.x0 + c.x - mid);
      if (d < bd) { bd = d; best = c.id; }
    }
    return best;
  }

  function setDesign(on) {
    if (on && heroEditor.isOpen) heroEditor.close();
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
    syncPets();
    const social = !!visit?.inSession(); // смайлики — когда в доме есть друзья
    if (last.social !== social) { last.social = social; root.closest('#app')?.classList.toggle('social', social); if (!social) q('.emote-pick').hidden = true; }
    admin.sync();
  }

  // Кнопки «позвать»: по одной на каждое животное в доме, с его мордочкой.
  let pets = null, callPet = null, onMap = null;
  const faces = new Map(); // id определения → картинка мордочки
  function faceOf(defId) {
    if (faces.has(defId)) return faces.get(defId);
    const head = getAnimal(defId)?.parts.head; if (!head) return '';
    const S = 96, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const k = Math.min(S / head.cv.width, S / head.cv.height);
    cv.getContext('2d').drawImage(head.cv, (S - head.cv.width * k) / 2, (S - head.cv.height * k) / 2, head.cv.width * k, head.cv.height * k);
    const url = cv.toDataURL('image/webp', 0.9);
    faces.set(defId, url);
    return url;
  }
  function syncPets() {
    if (!pets) return;
    const list = pets.list.slice(0, 4);
    const sig = list.map((i) => i.id + ':' + i.def).join('|');
    if (last.pets === sig) return;
    last.pets = sig;
    q('.pets').innerHTML = list.map((i) => `<button class="btn round pet" data-pet="${i.id}" aria-label="Позвать: ${esc(itemDef(i.def)?.name || '')}"><img src="${faceOf(i.def)}" alt="" draggable="false"></button>`).join('');
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
    setPets(p, onCall) { pets = p; callPet = onCall; },
    setMap(f) { onMap = f; },
    friends, getMe,
    setVisit(v) { visit = v; settings.setVisit(v); },
    // В гостях: нет «Вещей», редактора, магазина, отмены, ночи, героев и кнопок животных; есть «домой».
    setVisiting(on) { root.closest('#app')?.classList.toggle('visiting', on); showPanel(null); if (on && heroEditor.isOpen) heroEditor.close(); },
  };
}

