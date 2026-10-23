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
import { initShop, autoGifts } from './core/shop.js';
import { studioLoad } from './core/access.js';
import { findRecipe, isMachine } from './core/recipes.js';
import { anims } from './render/anims.js';
import { play } from './audio.js';
import { surfacesOf, syncChildren } from './core/physics.js';
import { mode } from './ui/mode.js';
import { itemBounds } from './core/placement.js';
import { itemDef, allItemDefs, machineOf } from './core/catalog.js';
import { refreshHero } from './render/hero.js';
import { rigAnims, getRig, drawRig, LIE } from './render/rig.js';
import { animalAnims, setupAnimal } from './render/animal.js';
import { createPets } from './core/pets.js';
import { createMap } from './ui/map.js';
import { createVisit } from './net/visit.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  const app = $('app'), canvas = $('scene');
  await loadAssets((n, total) => { $('loadingNote').textContent = `Картинки: ${n} из ${total}`; });

  // Свои предметы — до чтения сохранения, чтобы их экземпляры узнались.
  let libraryNote = '';
  try { libraryNote = await loadLibrary(); } catch (e) { libraryNote = 'Свои предметы не загрузились: ' + e.message; }
  for (const d of allItemDefs()) if (d.builtin && d.animal) setupAnimal(d); // встроенные животные — на скелет
  await loadBuiltinPacks(); // паки, встроенные в игру (папка packs/)
  await initShop().catch(() => {}); // паки, скачанные в магазине

  if (__STUDIO__) studioLoad(); // студия: своя галочка «выдать игроку» (до нового дома — щенок)

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
  // Животные гуляют сами; в редакторе комнаты, ночью и пока что-то тянут пальцем — отдыхают.
  const pets = createPets({
    store, camera,
    isPaused: () => mode.design || store.state.night || !!interaction.drag || visit?.mode === 'guest', // в гостях животными управляет хозяин
    onAct: (id, what, toyId) => { // сами решили: гавкнуть (слышно, только если на экране), запрыгнуть на диван
      const i = store.state.items.find((x) => x.id === id), r = i && store.layout.byId.get(i.room);
      const seen = r && r.x0 + i.x > camera.x - 50 && r.x0 + i.x < camera.x + camera.viewW + 50;
      if (what === 'bark' && seen) { animalAnims.happy(id); anims.hop('item:' + id); play(itemDef(i.def)?.animal?.voice || 'pop'); }
      if (what === 'hop') { anims.fall('item:' + id, -60); if (seen) play('boing'); }
      if (what === 'eat' && seen) for (let k = 0; k < 5; k++) setTimeout(() => play('chomp'), 300 + k * 650); // хрум-хрум
      if (what === 'happy') { animalAnims.happy(id); anims.hop('item:' + id); if (seen) play(itemDef(i.def)?.animal?.voice || 'pop'); }
      if (what === 'grab' && seen) play('pick');
      if (what === 'drop') { anims.fall('item:' + toyId, -40); if (seen) play('drop'); }
      invalidate();
    },
    onWalk: (id, w) => visit?.petWalk(id, w), // гостям — куда пошло животное
    onArrive: (id, called) => { if (called) { anims.hop('item:' + id); animalAnims.happy(id); play(itemDef(store.state.items.find((i) => i.id === id)?.def)?.animal?.voice || 'pop'); } },
  });
  renderer.setPets(pets);
  // Карта-планета: дом и другие места (пока строятся).
  const map = createMap({ root: $('app'), viewport, isNight: () => !!store.state.night, onEnter: () => { invalidate(); } });
  hud.setMap(() => map.open());
  // В гости к друзьям и гости у меня (net/visit.js).
  const visit = createVisit({
    friends: hud.friends, store, getMe: hud.getMe, camera, toast: hud.toast, pets,
    onEmote: () => { play('pop'); invalidate(); },
    isDragging: () => !!interaction.drag,
    onMode: (m) => { hud.setVisiting(m === 'guest'); play(m === 'guest' ? 'ding' : 'whoosh'); invalidate(); },
    onArrive: (uid, g) => { play('ding'); hud.toast('👋 ' + (g.nick || 'Друг') + ' пришёл в гости'); invalidate(); },
  });
  renderer.setVisit(visit); interaction.setVisit(visit); hud.setVisit(visit);
  setInterval(() => { if (!running && visit.inSession()) invalidate(); }, 1000); // друзья в доме — изредка кадр (их смайлики, перенос вещей)
  interaction.on('dragend', () => visit.dragEnded());
  hud.setPets(pets, (id) => { if (pets.call(id)) { play('whoosh'); invalidate(); } });
  setInterval(() => { if (!running && !document.hidden && pets.wantsFrame()) invalidate(); }, 600); // кадров нет, а кому-то пора гулять
  // Подарки игрокам из магазина (свои животные с «выдать игроку») — ставятся сами, без кнопок.
  setTimeout(() => autoGifts((ids) => {
    actions.restoreMissing();
    // Подаренное животное сразу прибегает в дом (если такого ещё нет).
    for (const id of ids) if (itemDef(id)?.animal && !store.state.items.some((i) => i.def === id)) { const it = actions.take(id); if (it) actions.placeFromInventory(it); }
    hud.refreshThings(); invalidate();
  }).catch(() => {}), 2500);

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
    busy = pets.tick(dt) || busy;
    busy = visit.tick(dt) || busy; // друзья тянут вещи, смайлики
    if (interaction.drag) visit.sendDrag(interaction.drag);
    busy = anims.active() || busy;
    busy = swayStep(dt, fresh) || busy;
    busy = renderer.animating || rigAnims.active() || animalAnims.active() || !!interaction.drag || busy; // включённый телевизор на экране — мультик идёт
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
    if (visit?.mode === 'guest') return Promise.resolve({ saved: true, backend: 'guest' }); // в гостях свой дом не трогаем
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
  interaction.on('dragstart', (g) => { if (g.kind === 'item') { hud.showStash(true); if (itemDef(g.obj.def)?.animal) pets.stop(g.id); else pets.release(g.id); } });
  interaction.on('dragend', () => { hud.showStash(false); hud.refreshThings(); });
  interaction.on('stash', (on) => hud.hotStash(on));
  // Без текста: звук и движение говорят сами за себя.
  interaction.on('stashed', () => hud.refreshThings());
  // Временное лицо героя (смех, «вкусно»), потом возвращается своё.
  function heroUpdate(id) {
    const c = store.state.chars.find((x) => x.id === id); if (!c?.look) return;
    const grip = store.state.items.some((i) => i.held?.by === id) ? { right: true } : {};
    refreshHero(id, c.look, faceNow.get(id) || (c.seat?.lie ? 'sleep' : null), grip); // в кровати — спит
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
      play(itemDef(food.def)?.drink ? 'gulp' : 'chomp');
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
  // ── Готовка ──
  // Нажали на прибор, на котором лежат продукты: есть рецепт — прибор работает и выдаёт результат;
  // рецепта нет — продукты подпрыгивают (ничего «нельзя», просто не получилось).
  const cooking = new Map(); // прибор → { t0, dur, mc, kids } (рисует renderer: барабан, пар, свет)
  renderer.setCooking(cooking);
  function tryCook(id) {
    const m = store.state.items.find((i) => i.id === id);
    if (!m || !isMachine(m.def) || cooking.has(id)) return cooking.has(id);
    const kids = store.state.items.filter((i) => i.on?.id === id);
    if (!kids.length) return false;
    const recipe = findRecipe(m.def, kids.map((k) => k.def));
    if (!recipe) {
      anims.wobble('item:' + id); kids.forEach((k, n) => anims.wobble('item:' + k.id, n * 0.05)); play('boing'); invalidate();
      return true;
    }
    // Как работает прибор — настраивается в студии («Оживить» → «Прибор»).
    const mc = machineOf(itemDef(m.def));
    cooking.set(id, { t0: performance.now() / 1000, dur: recipe.time, mc, kids: kids.map((k) => k.def) });
    if (mc.move === 'shake') anims.shake('item:' + id, recipe.time);
    else if (mc.move === 'bounce') anims.bounce('item:' + id, recipe.time);
    if (mc.hide) play('stash'); // продукты ушли внутрь
    const snd = setInterval(() => play(recipe.sound), recipe.sound === 'tick' ? 300 : recipe.sound === 'slosh' ? 420 : 140);
    setTimeout(() => {
      clearInterval(snd); cooking.delete(id);
      const before = store.state.items.find((i) => i.id === id);
      const made = actions.cook(id, recipe, mc.out);
      const mm = store.state.items.find((i) => i.id === id) || before;
      for (const n of made) {
        const it = store.state.items.find((i) => i.id === n);
        if (mc.out === 'pop' && it && !it.on) anims.pop('item:' + n, mm.x - it.x, (mm.y - itemBounds(mm).h * 0.5) - it.y); // из середины прибора — по дуге на пол
        else anims.fall('item:' + n, mc.hide ? -110 : -70);
      }
      renderer.sparkle(made);
      anims.squash('item:' + id); play('ding'); setTimeout(() => play('pop'), 180);
      hud.refreshThings(); invalidate();
    }, recipe.time * 1000);
    invalidate();
    return true;
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
      if (store.state.chars.find((c) => c.id === id)?.seat?.lie) { // спит — на миг открывает глаза и потягивается
        anims.squash('char:' + id); setFace(id, 'happy', 1300); play('pop'); return;
      }
      if (store.state.items.some((i) => i.held?.by === id && itemDef(i.def)?.group === 'food')) { eat(id); return; }
      const waves = (tapCount = (tapCount + 1) % 2) === 0;
      if (waves && store.state.chars.find((c) => c.id === id)?.look) { rigAnims.wave(id); play('pop'); } // машет рукой
      else { anims.hop('char:' + id); rigAnims.cheer(id); play('boing'); } // прыгает, руки вверх
      setFace(id, 'laugh', 1100); // пощекотали — смеётся
    }
    else {
      const it = store.state.items.find((i) => i.id === id);
      if (it?.held && itemDef(it.def)?.group === 'food') { eat(it.held.by); return; } // нажал на еду в руке — откусывает
      const an = itemDef(it?.def)?.animal;
      if (an && !it.held) { pets.stop(id); anims.hop('item:' + id); animalAnims.happy(id); play(an.voice || 'pop'); invalidate(); return; } // животное радуется: прыжок, хвост, голос
      if (tryCook(id)) return; // прибор с продуктами — готовит
      const pk = itemDef(it?.def)?.pet;
      if (pk === 'food' && pourFood(id)) return;
      if (pk === 'fetch' && !itemDef(it.def).tap) { anims.hop('item:' + id); play('boing'); if (pets.fetch(id)) invalidate(); invalidate(); return; } // мячик прыгает — щенок бежит
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

  // ── Вещи для животных ──
  // Корм поставили к миске (или нажали на него рядом с миской) — корм сыплется, животное бежит есть.
  function pourFood(bagId) {
    const bag = store.state.items.find((i) => i.id === bagId && !i.inv); if (!bag) return false;
    const bowls = store.state.items.filter((i) => !i.inv && i.room === bag.room && itemDef(i.def)?.pet === 'bowl' && Math.abs(i.x - bag.x) < 190).sort((a, b) => Math.abs(a.x - bag.x) - Math.abs(b.x - bag.x));
    const bowl = bowls[0]; if (!bowl) return false;
    anims.wobble('item:' + bagId); play('kibble');
    if (!bowl.full) setTimeout(() => {
      store.change((s) => { const b = s.items.find((i) => i.id === bowl.id); if (b) b.full = true; }, { undo: false });
      anims.squash('item:' + bowl.id); play('pop'); pets.callToBowl(bowl.id); invalidate();
    }, 380);
    else anims.squash('item:' + bowl.id);
    invalidate();
    return true;
  }
  interaction.on('placed', ({ id }) => {
    const it = store.state.items.find((i) => i.id === id), k = itemDef(it?.def)?.pet;
    if (k === 'food') pourFood(id);
    else if ((k === 'fetch' || k === 'chew') && pets.fetch(id)) invalidate(); // бросили игрушку — несётся за ней
  });

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
  window.__sunny = { map, pets, visit, interaction, rig: { rigAnims, getRig, drawRig, LIE }, store, camera, renderer, actions, viewport, saveNow, physics: { surfacesOf, syncChildren }, mode, hud };
}

boot().catch((e) => {
  console.error(e);
  $('loading').innerHTML = `<b>Не удалось открыть игру</b><small>${String(e.message || e)}</small><button onclick="location.reload()">Попробовать ещё раз</button>`;
});
