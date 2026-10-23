// Студия → «Карта»: районы карты, живые здания на них и свои места.
// • Район — картинка от GPT (как встроенные); свой можно добавить, назвать, поставить на площадку главное место.
// • Зона — обведённое здание на картинке района: пружинит со звуком; если выбрать место — через него заходят.
// • Своё место — название, картинка здания и обстановка (комнаты и вещи), которую собираешь обычным редактором:
//   «Зайти и обставить» → расставить → «Сохранить обстановку».
// Всё хранится в студии; игрокам — кнопкой «📤 В игру» (паком-подарком: поля mapZones и world).
import { img } from '../assets.js';
import { play } from '../audio.js';
import { zonesOf, saveOwnZones, hasOwnZones, ZONE_SOUNDS } from '../core/mapZones.js';
import { PLACE_IDS, isReady, BUILTIN_PLACES } from '../core/places.js';
import { districtList, ownWorld, saveOwnWorld, newDistrictId, newPlaceId, placeName } from '../core/world.js';
import { newRoom } from '../core/house.js';
import { ROOM_TYPES } from '../core/catalog.js';
import { prepareImage } from './itemEditor.js';
import { loadImage } from '../assets.js';
import { escapeHtml as esc } from '../util.js';

const NAMES = { home: 'Дом', shop: 'Магазин', disco: 'Дискотека', cafe: 'Кафе', salon: 'Салон' };

export function createMapEditor({ toast, store, enterPlace }) {
  let host = null, district = 'home', list = [], sel = -1, dirty = false, drawing = null, moving = null, part = 'map'; // part: map — районы и здания, places — свои места
  const load = () => { list = JSON.parse(JSON.stringify(zonesOf(district))); sel = -1; dirty = false; };
  load();
  const opt = (obj, cur) => Object.entries(obj).map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');

  const nameOf = (id) => NAMES[id] || placeName(id) || id;
  const dOf = () => districtList().find((d) => d.id === district) || districtList()[0];
  function html() {
    const z = list[sel], D = districtList(), cur = dOf(), w = ownWorld(), own = w.districts.find((d) => d.id === district);
    const places = Object.entries(w.places), here = store.state.place || 'home';
    const tabs = `<div class="ie-bar mz-parts"><button class="${part === 'map' ? 'primary' : ''}" data-mz-part-tab="map">🗺️ Районы и здания</button><button class="${part === 'places' ? 'primary' : ''}" data-mz-part-tab="places">🏠 Свои места (${places.length})</button></div>`;
    if (part === 'places') return tabs + placesHtml(places, here);
    return tabs + `<h4>Районы карты</h4><div class="ie-bar">${D.map((d) => `<button class="${d.id === district ? 'primary' : ''}" data-mz-d="${d.id}">${esc(d.name || NAMES[d.id] || d.id)}</button>`).join('')}
        <label class="ie-upload small mz-add"><em>＋ Свой район</em><input type="file" accept="image/png,image/webp,image/jpeg" data-mz-newd></label></div>
      ${own ? `<div class="lv-row">
        <label class="adm-field">Название района<input data-mz-dname maxlength="30" value="${esc(own.name)}"></label>
        <label class="adm-field">На площадке посередине<select data-mz-dplace>${opt({ '': 'Ничего (только домики района)', ...Object.fromEntries(PLACE_IDS.map((id) => [id, nameOf(id)])), __new: '＋ Создать новое место…' }, own.place || '')}</select></label>
        <label class="ie-upload small"><em>Заменить картинку</em><input type="file" accept="image/png,image/webp,image/jpeg" data-mz-dimg></label>
        <button class="danger" data-mz-ddel>Убрать район</button></div>` : `<p class="adm-help">Встроенный район «${esc(NAMES[cur.id] || cur.id)}». Свой район — картинка от GPT по тому же промпту, что и встроенные (2048×1024, прозрачное небо, дорога на 70% высоты, пустая площадка посередине).</p>`}
      <h4>Живые здания района</h4>
      <div class="ie-bar"><span class="ie-title">${hasOwnZones(district) ? 'свои зоны' : 'встроенные зоны'}${dirty ? ' · есть изменения' : ''}</span></div>
      <p class="adm-help">Обведи здание на картинке (из угла в угол) — оно оживёт: в игре пружинит со звуком. Нажми на зону, чтобы выбрать; тяни — чтобы передвинуть. Для зоны можно выбрать место — через это здание будут заходить внутрь. Игрокам изменения уходят кнопкой «📤 В игру».</p>
      <canvas class="mz-canvas" width="1000" height="500" data-mz-canvas></canvas>
      ${z ? `<div class="lv-row">
        <label class="adm-field">Звук<select data-mz-snd>${opt(ZONE_SOUNDS, z.snd)}</select></label>
        <label class="adm-field">Заходить внутрь<select data-mz-place>${opt({ '': 'Нет — только пружинит', ...Object.fromEntries(PLACE_IDS.map((id) => [id, nameOf(id) + (isReady(id) ? '' : ' (ещё строится)')])), __new: '＋ Создать новое место…' }, z.place || '')}</select></label>
        <button data-mz-test>▶ Звук</button><button class="danger" data-mz-del>Убрать зону</button></div>` : ''}
      <div class="ie-actions"><button class="primary" data-mz-save${dirty ? '' : ' disabled'}>Сохранить зоны</button><button data-mz-reset>Как было</button></div>
`;
  }
  function placesHtml(places, here) {
    return `<h4>Свои места</h4>
      <p class="adm-help">Место — как дом: свои комнаты и вещи. Создай место, нажми «Зайти и обставить» — откроется само место, расставь мебель и вещи как обычно (✎ редактор комнаты, комнаты — во вкладке «Комнаты»), потом вернись сюда и нажми «Сохранить обстановку». Игроки получат такую обстановку при первом приходе. Чтобы в место можно было зайти — поставь его на площадку района или выбери у зоны «Заходить внутрь».</p>
      <div class="ie-bar"><select data-mz-ptype>${opt(Object.fromEntries(Object.entries(ROOM_TYPES).filter(([t]) => t !== 'lawn').map(([t, d]) => [t, d.name])), 'shop')}</select><button class="primary" data-mz-newp>＋ Новое место</button></div>
      <div class="mz-places">${places.map(([id, p]) => `<div class="mz-place${here === id ? ' here' : ''}">
        ${p.art ? `<img src="${p.art}" alt="">` : '<span class="mz-noart">🏠</span>'}
        <input data-mz-pname="${id}" maxlength="30" value="${esc(p.name)}">
        <small>комнат: ${p.rooms.length}, вещей: ${p.items.length}</small>
        <label class="ie-upload small"><em>${p.art ? 'Заменить здание' : '＋ Картинка здания'}</em><input type="file" accept="image/png,image/webp,image/jpeg" data-mz-part="${id}"></label>
        ${here === id ? `<button class="primary" data-mz-psave="${id}">💾 Сохранить обстановку</button>` : `<button data-mz-penter="${id}">Зайти и обставить</button>`}
        <button class="danger" data-mz-pdel="${id}">Убрать</button></div>`).join('') || '<p class="adm-help">Своих мест пока нет.</p>'}</div>`;
  }

  // Картинка района целиком в холсте (с небом).
  function frame(cv) { const s = Math.min(cv.width / 1600, cv.height / 800); return { s, x: (cv.width - 1600 * s) / 2, y: (cv.height - 800 * s) / 2, w: 1600 * s, h: 800 * s }; }
  function draw() {
    const cv = host?.querySelector('[data-mz-canvas]'); if (!cv) return;
    const c = cv.getContext('2d'), F = frame(cv), im = img(dOf().image);
    c.fillStyle = '#9fd3f5'; c.fillRect(0, 0, cv.width, cv.height);
    if (im) c.drawImage(im, F.x, F.y, F.w, F.h);
    list.forEach((z, i) => {
      const [u0, v0, u1, v1] = z.box, on = i === sel;
      c.lineWidth = on ? 4 : 2.5; c.setLineDash(on ? [] : [6, 4]);
      c.strokeStyle = z.place ? '#e0864a' : '#3f9a5a'; c.fillStyle = on ? 'rgba(255,220,120,.35)' : z.place ? 'rgba(224,134,74,.22)' : 'rgba(63,154,90,.2)';
      c.fillRect(F.x + u0 * F.w, F.y + v0 * F.h, (u1 - u0) * F.w, (v1 - v0) * F.h);
      c.strokeRect(F.x + u0 * F.w, F.y + v0 * F.h, (u1 - u0) * F.w, (v1 - v0) * F.h);
      if (z.place) { c.font = '22px sans-serif'; c.fillText('🚪', F.x + u0 * F.w + 4, F.y + v0 * F.h + 24); }
    });
    c.setLineDash([]);
    if (drawing) { c.strokeStyle = '#4a7fe0'; c.lineWidth = 3; c.setLineDash([5, 4]); c.strokeRect(drawing.x0, drawing.y0, drawing.x1 - drawing.x0, drawing.y1 - drawing.y0); c.setLineDash([]); }
  }
  function render() { if (!host) return; host.innerHTML = html(); draw(); }

  const toFrac = (cv, e) => {
    const b = cv.getBoundingClientRect(), F = frame(cv);
    const x = (e.clientX - b.left) * cv.width / b.width, y = (e.clientY - b.top) * cv.height / b.height;
    return { x, y, u: (x - F.x) / F.w, v: (y - F.y) / F.h };
  };
  const r3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

  function down(e) {
    const cv = e.target.closest?.('[data-mz-canvas]'); if (!cv) return;
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
    const p = toFrac(cv, e);
    const hit = list.map((z, i) => ({ z, i })).filter(({ z }) => p.u > z.box[0] && p.u < z.box[2] && p.v > z.box[1] && p.v < z.box[3])
      .sort((a, b) => (a.z.box[2] - a.z.box[0]) * (a.z.box[3] - a.z.box[1]) - (b.z.box[2] - b.z.box[0]) * (b.z.box[3] - b.z.box[1]))[0];
    if (hit) { sel = hit.i; moving = { p, box: [...hit.z.box], moved: false }; render(); return; }
    drawing = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, p0: p };
  }
  function move(e) {
    const cv = host?.querySelector('[data-mz-canvas]'); if (!cv || (!drawing && !moving)) return;
    const p = toFrac(cv, e);
    if (drawing) { drawing.x1 = p.x; drawing.y1 = p.y; drawing.p1 = p; draw(); return; }
    const du = p.u - moving.p.u, dv = p.v - moving.p.v, b = moving.box;
    if (Math.abs(du) + Math.abs(dv) > 0.005) moving.moved = true;
    const w = b[2] - b[0], h = b[3] - b[1], u0 = Math.max(0, Math.min(1 - w, b[0] + du)), v0 = Math.max(0, Math.min(1 - h, b[1] + dv));
    list[sel].box = [r3(u0), r3(v0), r3(u0 + w), r3(v0 + h)]; draw();
  }
  function up() {
    if (moving) { if (moving.moved) { dirty = true; render(); } moving = null; return; }
    if (!drawing) return;
    const a = drawing.p0, b = drawing.p1 || a; drawing = null;
    if (Math.abs(b.u - a.u) > 0.02 && Math.abs(b.v - a.v) > 0.02) {
      list.push({ box: [r3(Math.min(a.u, b.u)), r3(Math.min(a.v, b.v)), r3(Math.max(a.u, b.u)), r3(Math.max(a.v, b.v))], snd: 'boing' });
      sel = list.length - 1; dirty = true; play('pop');
    }
    render();
  }

  // Изменить свой мир (районы и места) и сохранить.
  async function world(fn, msg) {
    try { const w = ownWorld(); fn(w); await saveOwnWorld(w); if (msg) toast(msg); } catch (err) { toast(err.message, true); }
    render();
  }
  // Картинка района: любой размер → 1600×800 (как встроенные).
  async function districtImage(file) {
    if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('Выбери PNG, WebP или JPG');
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось открыть файл')); r.readAsDataURL(file); });
    const im = await loadImage(url), cv = document.createElement('canvas'); cv.width = 1600; cv.height = 800;
    const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(im, 0, 0, 1600, 800);
    const data = c.getImageData(0, 0, 1600, 800), px = data.data;
    for (let k = 0; k < px.length; k += 4) if (px[k] > 200 && px[k + 2] > 200 && px[k + 1] < 90) px[k + 3] = 0; // розовый фон → небо
    c.putImageData(data, 0, 0);
    return cv.toDataURL('image/webp', 0.85);
  }
  // Новое место: одна комната выбранного типа, без вещей. Возвращает id.
  async function createPlace(type = 'shop', after = null) {
    const id = newPlaceId(), room = newRoom(type, 'r1');
    room.name = ROOM_TYPES[type]?.name || 'Комната';
    await world((w) => { w.places[id] = { name: 'Новое место', rooms: [room], items: [] }; after?.(w, id); }, 'Место создано — оно во вкладке «🏠 Свои места»: назови, добавь картинку здания и обставь');
    return id;
  }
  async function click(e) {
    const b = e.target.closest('button'); if (!b || !host?.contains(b)) return;
    const d = b.dataset;
    if (d.mzDdel !== undefined) { if (!confirm('Убрать этот район с карты?')) return; await world((w) => { w.districts = w.districts.filter((x) => x.id !== district); }, 'Район убран'); district = 'home'; load(); render(); return; }
    if (d.mzPartTab) { part = d.mzPartTab; render(); return; }
    if (d.mzNewp !== undefined) { await createPlace(host.querySelector('[data-mz-ptype]').value); return; }
    if (d.mzPenter) { enterPlace(d.mzPenter); return; }
    if (d.mzPsave) {
      const s0 = store.state;
      if ((s0.place || 'home') !== d.mzPsave) { toast('Сначала зайди в это место', true); return; }
      const items = s0.items.filter((i) => !i.inv && !i.held).map((i) => JSON.parse(JSON.stringify(i)));
      await world((w) => { if (w.places[d.mzPsave]) { w.places[d.mzPsave].rooms = JSON.parse(JSON.stringify(s0.rooms)); w.places[d.mzPsave].items = items; } }, 'Обстановка сохранена. Игрокам — «📤 В игру»');
      return;
    }
    if (d.mzPdel) {
      if ((store.state.place || 'home') === d.mzPdel) { toast('Сначала выйди из этого места (🗺️ → дом)', true); return; }
      if (!confirm('Убрать это место? Игроки, у которых оно уже было, вернутся домой.')) return;
      await world((w) => { delete w.places[d.mzPdel]; for (const x of w.districts) if (x.place === d.mzPdel) delete x.place; }, 'Место убрано');
      return;
    }
    if (d.mzD) { if (dirty && !confirm('Есть несохранённые зоны. Перейти без сохранения?')) return; district = d.mzD; load(); }
    else if (d.mzDel !== undefined) { list.splice(sel, 1); sel = -1; dirty = true; }
    else if (d.mzTest !== undefined) { play(list[sel]?.snd || 'pop'); return; }
    else if (d.mzSave !== undefined) { saveOwnZones(district, list); dirty = false; toast('Зоны сохранены. Игрокам — «📤 В игру»'); }
    else if (d.mzReset !== undefined) { if (!confirm('Вернуть встроенные зоны этого района?')) return; saveOwnZones(district, null); load(); toast('Вернули как было'); }
    else return;
    render();
  }
  async function change(e) {
    if (!host?.contains(e.target)) return;
    const t = e.target;
    try {
      if (t.matches('[data-mz-newd]') && t.files?.[0]) {
        toast('Готовлю картинку района…');
        const image = await districtImage(t.files[0]), id = newDistrictId(); t.value = '';
        await world((w) => { w.districts.push({ id, name: 'Новый район', image }); }, 'Район добавлен — он в конце карты');
        district = id; load(); render(); return;
      }
      if (t.matches('[data-mz-dimg]') && t.files?.[0]) { const image = await districtImage(t.files[0]); t.value = ''; await world((w) => { const x = w.districts.find((q) => q.id === district); if (x) x.image = image; }, 'Картинка района заменена'); return; }
      if (t.matches('[data-mz-dname]')) { await world((w) => { const x = w.districts.find((q) => q.id === district); if (x) x.name = t.value; }); return; }
      if (t.matches('[data-mz-dplace]')) {
        if (t.value === '__new') { await createPlace('shop', (w, id) => { const x = w.districts.find((q) => q.id === district); if (x) x.place = id; }); return; }
        await world((w) => { const x = w.districts.find((q) => q.id === district); if (x) { if (t.value) x.place = t.value; else delete x.place; } }); return;
      }
      if (t.matches('[data-mz-pname]')) { await world((w) => { if (w.places[t.dataset.mzPname]) w.places[t.dataset.mzPname].name = t.value; }); return; }
      if (t.matches('[data-mz-part]') && t.files?.[0]) { const res = await prepareImage(t.files[0]); const id = t.dataset.mzPart; t.value = ''; await world((w) => { if (w.places[id]) w.places[id].art = res.src; }, 'Здание готово'); return; }
    } catch (err) { toast(err.message, true); return; }
    if (!list[sel]) return;
    if (t.matches('[data-mz-snd]')) { list[sel].snd = t.value; play(t.value); }
    else if (t.matches('[data-mz-place]')) {
      if (t.value === '__new') { const id = await createPlace('shop'); list[sel].place = id; dirty = true; render(); return; }
      if (t.value) list[sel].place = t.value; else delete list[sel].place;
    }
    else return;
    dirty = true; render();
  }

  return {
    mount(el) { host = el; render(); },
    bind(root) {
      root.addEventListener('click', click); root.addEventListener('change', change);
      root.addEventListener('pointerdown', down); root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', up); root.addEventListener('pointercancel', () => { drawing = null; moving = null; });
    },
  };
}
