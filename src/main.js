// Точка входа: загружает картинки и сохранение, связывает модули, крутит кадры.
import { loadAssets, img } from './assets.js';
import { defaultState } from './core/house.js';
import { createStore } from './core/store.js';
import { createActions, normalize } from './core/actions.js';
import { createCamera } from './world/camera.js';
import { createRenderer } from './render/renderer.js';
import { createViewport } from './input/viewport.js';
import { createInteraction } from './input/interaction.js';
import { createHud } from './ui/hud.js';
import { loadSave, loadLegacyRoom, writeSave } from './save/storage.js';
import { validate, fromLegacyRoom } from './save/migrate.js';
import { loadLibrary, loadBuiltinPacks } from './core/library.js';
import { anims } from './render/anims.js';
import { play } from './audio.js';
import { surfacesOf } from './core/physics.js';
import { mode } from './ui/mode.js';
import { itemDef } from './core/catalog.js';
import { refreshHero } from './render/hero.js';
import { rigAnims, getRig, drawRig } from './render/rig.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  const app = $('app'), canvas = $('scene');
  await loadAssets((n, total) => { $('loadingNote').textContent = `Картинки: ${n} из ${total}`; });

  // Свои предметы — до чтения сохранения, чтобы их экземпляры узнались.
  let libraryNote = '';
  try { libraryNote = await loadLibrary(); } catch (e) { libraryNote = 'Свои предметы не загрузились: ' + e.message; }
  await loadBuiltinPacks(); // паки, встроенные в игру (папка packs/)

  // Сохранение → прошлая версия 0.4.1 → новый дом.
  let state = null, startNote = '';
  try {
    const saved = await loadSave();
    if (saved) state = validate(saved);
  } catch (e) { startNote = 'Сохранение не прочиталось, открыт новый дом. Старые данные не стёрты.'; }
  if (!state) {
    try {
      const legacy = await loadLegacyRoom();
      if (legacy) { state = fromLegacyRoom(legacy); startNote = 'Комната из версии 0.4.1 перенесена в гостиную.'; }
    } catch (e) { /* нет старой комнаты */ }
  }
  if (!state) state = validate(defaultState());
  for (const c of state.chars) refreshHero(c.id, c.look); // картинки героев — до расстановки (нужны размеры)
  const DRINKS = new Set(['milk', 'juice', 'smoothie_banana']);
  normalize(state);

  const store = createStore(state);
  const camera = createCamera();
  const renderer = createRenderer(canvas, store, camera);
  let hud = null;
  const viewport = createViewport(app, (w, h) => { renderer.resize(w, h); camera.worldW = store.layout.width; camera.nudge(0); invalidate(); renderer.warmup(); });
  const actions = createActions(store, camera);
  hud = createHud({ root: $('ui'), store, camera, actions, onChange: () => invalidate() });
  const interaction = createInteraction({ canvas, viewport, camera, renderer, store, isOverStash: hud.isOverStash });
  hud.setDragStarter(interaction.startFromInventory, viewport.toLocal);

  // ── кадры: рисуем только когда что-то меняется или движется ──
  let tapCount = 0;
  const faceNow = new Map(), faceTimers = new Map(); // временное лицо героя (смех после щекотки)
  let running = false, last = 0, night = state.night ? 1 : 0;
  let idleTimer = 0; // редкий кадр для дыхания героев; любое событие — сразу полный кадр
  function invalidate() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; running = false; }
    if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
  }
  // Автокачество: если кадры подряд идут медленно (дольше ~28 мс), снижаем чёткость холста.
  let slowFrames = 0, measured = 0;
  function watchSpeed(ms) {
    if (!last) return;
    measured++;
    slowFrames = ms > 28 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (measured > 20 && slowFrames > 24) { slowFrames = 0; measured = 0; if (renderer.lowerQuality()) camera.viewW = camera.viewW; }
  }
  // Качание мелочи от резкой прокрутки: пружина, которую «толкает» скорость камеры.
  // Медленная прокрутка не качает — только быстрый свайп; при остановке вещи докачиваются.
  let prevCamX = null, swayV = 0;
  function swayStep(dt, fresh) {
    const s = renderer.sway;
    const vel = prevCamX === null || fresh ? 0 : (camera.x - prevCamX) / dt;
    prevCamX = camera.x;
    const thr = camera.viewW * 1.4; // порог «резко»: больше 1.4 экрана в секунду
    const over = Math.abs(vel) - thr;
    const target = over > 0 ? -Math.sign(vel) * Math.min(0.2, (over / camera.viewW) * 0.09) : 0;
    swayV += (-140 * (s.angle - target) - 7 * swayV) * dt;
    s.angle += swayV * dt;
    if (Math.abs(s.angle) < 0.002 && Math.abs(swayV) < 0.02 && target === 0) { s.angle = 0; swayV = 0; return false; }
    return true;
  }
  function frame(t) {
    watchSpeed(t - last);
    const fresh = !last, dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60;
    last = t;
    camera.worldW = store.layout.width;
    let busy = camera.update(dt);
    busy = interaction.frame(dt) || busy;
    busy = anims.active() || busy;
    busy = swayStep(dt, fresh) || busy;
    busy = renderer.animating || rigAnims.active() || !!interaction.drag || busy; // включённый телевизор на экране — мультик идёт
    const goal = store.state.night ? 1 : 0;
    if (Math.abs(goal - night) > 0.005) { night += (goal - night) * Math.min(1, dt * 3); busy = true; } else night = goal;
    renderer.draw(interaction.drag, night, hud.guides);
    hud.sync();
    if (busy) requestAnimationFrame(frame);
    else if (renderer.idleHeroes && !document.hidden) { last = 0; idleTimer = setTimeout(() => { idleTimer = 0; requestAnimationFrame(frame); }, 55); } // герои дышат: ~15 кадров в секунду, бережём батарею
    else running = false;
  }

  // ── сохранение ──
  let saveTimer = 0, savedNoteShown = false;
  function saveNow() {
    clearTimeout(saveTimer);
    return writeSave(store.state).then((res) => {
      if (!res.saved && !savedNoteShown) {
        savedNoteShown = true;
        hud.toast('Браузер не разрешил сохранение. Играть можно, но перед закрытием скачай копию в «Админка → Данные».', true);
      }
      document.documentElement.dataset.save = res.backend;
      return res;
    });
  }
  store.on('change', ({ save }) => { for (const c of store.state.chars) heroUpdate(c.id); invalidate(); if (save) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); } });
  window.addEventListener('pagehide', () => { saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  // ── события касаний ──
  interaction.on('frame', invalidate);
  mode.on('change', () => invalidate());
  interaction.on('dragstart', (g) => { if (g.kind === 'item') hud.showStash(true); });
  interaction.on('dragend', () => { hud.showStash(false); hud.refreshThings(); });
  interaction.on('stash', (on) => hud.hotStash(on));
  // Без текста: звук и движение говорят сами за себя.
  interaction.on('stashed', () => hud.refreshThings());
  // Временное лицо героя (смех, «вкусно»), потом возвращается своё.
  function heroUpdate(id) {
    const c = store.state.chars.find((x) => x.id === id); if (!c?.look) return;
    const grip = store.state.items.some((i) => i.held?.by === id) ? { right: true } : {};
    refreshHero(id, c.look, faceNow.get(id), grip);
  }
  function setFace(id, face, ms) {
    if (!store.state.chars.find((c) => c.id === id)?.look) return;
    faceNow.set(id, face); heroUpdate(id);
    clearTimeout(faceTimers.get(id));
    faceTimers.set(id, setTimeout(() => { faceNow.delete(id); heroUpdate(id); invalidate(); }, ms));
    invalidate();
  }
  // Еда в руке: ко рту — «ам!» — три укуса, и съедено (вещь уходит в шкафчик, её можно взять снова).
  const eating = new Set();
  function eat(charId) {
    const food = store.state.items.find((i) => i.held?.by === charId);
    if (!food || eating.has(charId)) return;
    eating.add(charId);
    rigAnims.eat(charId); setFace(charId, 'yum', 1000);
    setTimeout(() => {
      play(DRINKS.has(food.def) ? 'gulp' : 'chomp');
      const eaten = actions.bite(food.id);
      if (eaten) setTimeout(() => { anims.hop('char:' + charId); rigAnims.cheer(charId); setFace(charId, 'laugh', 900); play('yum'); hud.refreshThings(); invalidate(); }, 300);
      eating.delete(charId);
      invalidate();
    }, 430);
    invalidate();
  }
  // Цвет одежды — по картинке вещи (средний цвет), чтобы на герое была «та же» футболка.
  const clothColors = new Map();
  function colorOfItem(itemId) {
    const it = store.state.items.find((i) => i.id === itemId), def = it && itemDef(it.def);
    if (!def) return null;
    if (clothColors.has(def.id)) return clothColors.get(def.id);
    let hex = null;
    try {
      const im = img(def.art), cv = document.createElement('canvas'); cv.width = cv.height = 24;
      const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(im, 0, 0, 24, 24);
      const d = c.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < d.length; k += 4) {
        const mx = Math.max(d[k], d[k + 1], d[k + 2]), mn = Math.min(d[k], d[k + 1], d[k + 2]);
        if (d[k + 3] > 200 && mx > 90 && mx - mn > 25) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; } // цветные пиксели, без контура
      }
      if (n) { const f = (v) => Math.min(255, Math.round((v / n) * 1.12)).toString(16).padStart(2, '0'); hex = '#' + f(r) + f(g) + f(b); }
    } catch (e) { hex = null; }
    clothColors.set(def.id, hex);
    return hex;
  }
  // Вещь поднесли к герою: одежду — надевает, остальное — берёт в руку.
  interaction.on('give', ({ itemId, charId }) => {
    const res = actions.give(itemId, charId, colorOfItem(itemId));
    if (res === 'wear') { anims.hop('char:' + charId); rigAnims.cheer(charId); setFace(charId, 'laugh', 900); play('pop'); }
    else if (res === 'hold') { anims.squash('char:' + charId); setFace(charId, 'happy', 600); play('pick'); }
    else play('nope');
    hud.refreshThings(); invalidate();
  });

  interaction.on('tap', ({ kind, id }) => {
    if (kind === 'char') {
      if (store.state.items.some((i) => i.held?.by === id && itemDef(i.def)?.group === 'food')) { eat(id); return; }
      const waves = (tapCount = (tapCount + 1) % 2) === 0;
      if (waves && store.state.chars.find((c) => c.id === id)?.look) { rigAnims.wave(id); play('pop'); } // машет рукой
      else { anims.hop('char:' + id); rigAnims.cheer(id); play(id === 'cat' ? 'meow' : 'boing'); } // прыгает, руки вверх
      setFace(id, 'laugh', 1100); // пощекотали — смеётся
    }
    else {
      const it = store.state.items.find((i) => i.id === id);
      if (it?.held && itemDef(it.def)?.group === 'food') { eat(it.held.by); return; } // нажал на еду в руке — откусывает
      const tapKind = itemDef(store.state.items.find((i) => i.id === id)?.def)?.tap;
      if (tapKind === 'ring') { anims.ring('item:' + id); play('ring'); invalidate(); return; }
      if (tapKind === 'squeak') { anims.squash('item:' + id); play('squeak'); invalidate(); return; }
      const lit = actions.togglePower(id); // телевизор, торшер включаются нажатием
      if (lit !== null) {
        anims.squash('item:' + id);
        const pw = itemDef(store.state.items.find((i) => i.id === id)?.def)?.power || {};
        const kind = pw.glow ? 'lamp' : pw.water ? 'water' : 'tv';
        play(kind + (lit ? 'On' : 'Off'));
        invalidate();
        return;
      }
      const opened = actions.toggleOpen(id); // холодильник и т. п. открываются нажатием
      if (opened === null) { anims.wobble('item:' + id); play('pop'); }
      else {
        const snd = itemDef(store.state.items.find((i) => i.id === id)?.def)?.sounds || {};
        anims.squash('item:' + id); play(opened ? snd.open || 'open' : snd.close || 'close');
        // Еда внутри: при открытии покачивается по очереди сверху вниз (как от касания).
        // При закрытии — сразу за дверью, сквозь дверь ничего не видно.
        if (opened) {
          const inside = store.state.items.filter((i) => i.on?.id === id && i.on.s > 0).sort((a, b) => a.on.s - b.on.s || a.x - b.x);
          inside.forEach((i, n) => anims.wobble('item:' + i.id, 0.05 + n * 0.05));
          if (inside.length) setTimeout(() => play('pop'), 120);
        }
      }
    }
    invalidate();
  });
  interaction.on('tapEmpty', () => hud.closePanels());

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); store.undo(); }
    if (e.key === 'ArrowRight') { camera.flyTo(camera.x + camera.viewW * 0.6); invalidate(); }
    if (e.key === 'ArrowLeft') { camera.flyTo(camera.x - camera.viewW * 0.6); invalidate(); }
  });

  viewport.apply();
  // Старт: показываем гостиную (или первую комнату после лужайки).
  const start = store.state.rooms.find((r) => r.type === 'living') || store.state.rooms[1] || store.state.rooms[0];
  const r = store.layout.byId.get(start.id);
  camera.holdAt(r.x0); camera.mode = 'idle';
  $('loading').hidden = true;
  invalidate();
  renderer.warmup(); // фоны остальных комнат — в свободное время
  saveNow().then((res) => {
    const note = { local: 'Дом сохраняется на этом устройстве.', indexeddb: 'Дом сохраняется в запасное хранилище браузера.', session: 'Браузер не разрешает сохранение — скачивай резервную копию.' }[res.backend];
    if (res.saved && (libraryNote || startNote)) hud.toast(libraryNote || startNote, /не /.test(libraryNote));
    hud.setStorageNote(note);
  });

  // Для автотестов и отладки.
  window.__sunny = { rig: { rigAnims, getRig, drawRig }, store, camera, renderer, actions, viewport, saveNow, physics: { surfacesOf }, mode, hud };
}

boot().catch((e) => {
  console.error(e);
  $('loading').innerHTML = `<b>Не удалось открыть игру</b><small>${String(e.message || e)}</small><button onclick="location.reload()">Попробовать ещё раз</button>`;
});
