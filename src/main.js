// Точка входа: загружает картинки и сохранение, связывает модули, крутит кадры.
import { loadAssets } from './assets.js';
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
import { loadLibrary } from './core/library.js';
import { anims } from './render/anims.js';
import { play } from './audio.js';
import { surfacesOf } from './core/physics.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  const app = $('app'), canvas = $('scene');
  await loadAssets((n, total) => { $('loadingNote').textContent = `Картинки: ${n} из ${total}`; });

  // Свои предметы — до чтения сохранения, чтобы их экземпляры узнались.
  let libraryNote = '';
  try { libraryNote = await loadLibrary(); } catch (e) { libraryNote = 'Свои предметы не загрузились: ' + e.message; }

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
  let running = false, last = 0, night = state.night ? 1 : 0;
  function invalidate() { if (!running) { running = true; last = 0; requestAnimationFrame(frame); } }
  // Автокачество: если кадры подряд идут медленно (дольше ~28 мс), снижаем чёткость холста.
  let slowFrames = 0, measured = 0;
  function watchSpeed(ms) {
    if (!last) return;
    measured++;
    slowFrames = ms > 28 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (measured > 20 && slowFrames > 24) { slowFrames = 0; measured = 0; if (renderer.lowerQuality()) camera.viewW = camera.viewW; }
  }
  function frame(t) {
    watchSpeed(t - last);
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60;
    last = t;
    camera.worldW = store.layout.width;
    let busy = camera.update(dt);
    busy = interaction.frame(dt) || busy;
    busy = anims.active() || busy;
    const goal = store.state.night ? 1 : 0;
    if (Math.abs(goal - night) > 0.005) { night += (goal - night) * Math.min(1, dt * 3); busy = true; } else night = goal;
    renderer.draw(interaction.drag, night, hud.guides);
    hud.sync();
    if (busy) requestAnimationFrame(frame); else running = false;
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
  store.on('change', ({ save }) => { invalidate(); if (save) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); } });
  window.addEventListener('pagehide', () => { saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  // ── события касаний ──
  interaction.on('frame', invalidate);
  interaction.on('dragstart', (g) => { if (g.kind === 'item') hud.showStash(true); });
  interaction.on('dragend', () => { hud.showStash(false); hud.refreshThings(); });
  interaction.on('stash', (on) => hud.hotStash(on));
  // Без текста: звук и движение говорят сами за себя.
  interaction.on('stashed', () => hud.refreshThings());
  interaction.on('tap', ({ kind, id }) => {
    if (kind === 'char') { anims.hop('char:' + id); play(id === 'cat' ? 'meow' : 'boing'); }
    else {
      const opened = actions.toggleOpen(id); // холодильник и т. п. открываются нажатием
      if (opened === null) { anims.wobble('item:' + id); play('pop'); }
      else { anims.squash('item:' + id); play(opened ? 'open' : 'close'); }
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
  window.__sunny = { store, camera, renderer, actions, viewport, saveNow, physics: { surfacesOf } };
}

boot().catch((e) => {
  console.error(e);
  $('loading').innerHTML = `<b>Не удалось открыть игру</b><small>${String(e.message || e)}</small><button onclick="location.reload()">Попробовать ещё раз</button>`;
});
