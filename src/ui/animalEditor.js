// Студия → «Животные»: новое животное из картинок частей от GPT (все части — на холстах одного размера,
// каждая на своём месте). Суставы ставятся сами (по нахлёсту частей), их можно двигать пальцем.
// Сразу видно, как животное стоит, идёт, болтается в руке, радуется и спит. Сохраняется как свой предмет
// (группа «Животные») — значит, попадает в шкафчик, паки и магазин.
import { listRecords, getRecord, saveRecord, deleteRecord, newId, getOverride, saveOverride, resetOverride, listOverrides, PACK_FORMAT } from '../core/library.js';
import { allItemDefs, itemDef, originalDef } from '../core/catalog.js';
import { isGiven, studioSetGiven, lockedList } from '../core/access.js';
import { hasToken, sendGameUpdate } from '../core/publish.js';
import { normalize } from '../core/actions.js';
import { ANIMAL_PARTS, JOINT_PARTS, VOICES, buildAnimal, composeAnimal, drawAnimal, animalPose, autoJoint } from '../render/animal.js';
import { img, loadImage, registerImage, forgetImage } from '../assets.js';
import { play } from '../audio.js';
import { escapeHtml as esc } from '../util.js';

const SIDE = 512; // части храним на холсте до 512 px (место части на холсте важно — не обрезаем)

// Файл → WebP на всём холсте (без обрезки), розовый фон #FF00FF → прозрачный.
async function prepareFull(file) {
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('Выбери PNG, WebP или JPG');
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось открыть файл')); r.readAsDataURL(file); });
  const im = await loadImage(url);
  const s = Math.min(1, SIDE / Math.max(im.width, im.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(im, 0, 0, cv.width, cv.height);
  const d = c.getImageData(0, 0, cv.width, cv.height), px = d.data;
  let any = false;
  for (let k = 0; k < px.length; k += 4) {
    if (px[k] > 200 && px[k + 2] > 200 && px[k + 1] < 90) px[k + 3] = 0;
    if (px[k + 3] < 60) px[k + 3] = 0; // еле видная «пыль» вокруг части
    if (px[k + 3] > 40) any = true;
  }
  if (!any) throw new Error('Картинка пустая');
  c.putImageData(d, 0, 0);
  return cv.toDataURL('image/webp', 0.9);
}

// Какая это часть — по имени файла от GPT (animal_dog_leg_front_near.png → legFN).
function partByName(name) {
  const n = name.toLowerCase().replace(/\.(png|webp|jpe?g)$/, '');
  const list = Object.entries(ANIMAL_PARTS).sort((a, b) => b[1].file.length - a[1].file.length); // длинные суффиксы первыми (head_sleep раньше head)
  for (const [k, p] of list) if (n.endsWith('_' + p.file) || n === p.file) return k;
  return null;
}

const MODES = { idle: '🙂 Стоит', walk: '🚶 Идёт', carried: '✋ В руке', happy: '🎉 Радуется', sleep: '😴 Спит' };

export function createAnimalEditor({ store, actions, toast, onChange }) {
  let host = null, draft = null, dirty = false, busy = false, rig = null, mode = 'idle', showJoints = true, raf = 0, dragJ = null;

  const fresh = () => ({ id: newId(), name: '', group: 'animals', place: 'floor', w: 200, image: '', give: false, animal: { parts: {}, joints: {}, voice: 'woof' } });
  const animals = () => listRecords().filter((r) => r.animal);
  const builtins = () => allItemDefs().filter((d) => d.builtin && d.animal);
  let sending = '';

  // Встроенное животное (щенок): правка — имя, размер, голос, суставы; картинки — встроенные.
  function builtinDraft(id) {
    const d = itemDef(id), base = originalDef(id);
    return { builtin: true, id, name: d.name, w: d.w, baseW: base.w, baseName: base.name, image: img(d.art)?.src || '', give: isGiven(id),
      animal: { parts: Object.fromEntries(Object.entries(d.animal.parts).map(([k, key]) => [k, img(key)?.src]).filter(([, v]) => v)), joints: JSON.parse(JSON.stringify(d.animal.joints || {})), voice: d.animal.voice || '' } };
  }

  // «Отправить игрокам»: кого из встроенных не выдавать + подарок со своими животными (галочка «выдать»).
  async function sendToPlayers() {
    sending = 'Отправляю…'; render();
    try {
      await sendGameUpdate((t) => { sending = t; render(); });
      toast('Готово: у игроков обновится через 1–5 минут');
    } catch (e) { toast(e.message, true); }
    sending = ''; render();
  }

  function mount(el) { host = el; render(); }

  function listHtml() {
    const mine = animals();
    const badge = (given) => (given ? '✓ у игрока' : '🔒 только в паках');
    return `<div class="ie-bar"><button class="primary" data-an-new>＋ Новое животное</button>
        <button data-an-send${hasToken() && !sending ? '' : ' disabled'}>📤 Отправить игрокам</button>
        <span class="ie-title">${sending ? '⏳ ' + esc(sending) : `Своих животных: ${mine.length}`}</span></div>
      <p class="adm-help"><b>Выдать игроку</b> — животное есть у всех игроков бесплатно. Без галочки — его получают только из пака (отметь его в «Паки»). Галочки и правки встроенных доходят до игроков после «📤 Отправить игрокам» (нужен ключ GitHub, как для паков); свои животные с галочкой приходят игрокам подарком сами.</p>
      <h4>Встроенные</h4>
      <div class="ie-grid">${builtins().map((d) => `<button class="ie-card${getOverride(d.id) ? ' changed' : ''}" data-an-builtin="${esc(d.id)}"><img src="${img(d.art)?.src || ''}" alt=""><b>${esc(d.name)}</b><small>${badge(isGiven(d.id))}</small></button>`).join('')}</div>
      <h4>Свои</h4>
      <p class="adm-help">Животное собирается из частей на одном «скелете»: туловище, голова (и голова «спит»), хвост и 4 лапы. Картинки от GPT — одного размера, каждая часть на своём месте. Можно выбрать все файлы сразу — части разложатся по именам.</p>
      <div class="ie-grid">${mine.map((r) => `<button class="ie-card" data-an-edit="${esc(r.id)}"><img src="${r.image}" alt=""><b>${esc(r.name)}</b><small>${r.give ? '✓ подарок игрокам' : '🔒 только в паках'}</small></button>`).join('')}</div>`;
  }

  function formHtml() {
    const d = draft, a = d.animal;
    const B = !!d.builtin;
    const slots = Object.entries(ANIMAL_PARTS).map(([k, p]) => `<label class="an-slot${a.parts[k] ? ' has' : ''}">
        ${a.parts[k] ? `<img src="${a.parts[k]}" alt="">` : '<span>＋</span>'}
        <small>${p.name}${p.need ? '' : ' (можно без)'}</small>
        ${B ? '' : `<input type="file" accept="image/png,image/webp,image/jpeg" data-an-part="${k}">`}</label>`).join('');
    return `<div class="ie-bar"><button data-an-back>← К списку</button><span class="ie-title">${B ? 'Встроенное животное' : getRecord(d.id) ? 'Животное' : 'Новое животное'}</span></div>
      <div class="ie-form">
        <div class="ie-fields">
          <label class="adm-field">Название<input data-an-name maxlength="40" value="${esc(d.name)}" placeholder="Щенок"></label>
          <label class="adm-field">Размер · <b data-an-wv>${d.w}</b><input type="range" data-an-w min="80" max="520" value="${d.w}"></label>
          <label class="adm-field">Голос<select data-an-voice>${Object.entries(VOICES).map(([k, n]) => `<option value="${k}"${k === a.voice ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="an-give"><input type="checkbox" data-an-give${d.give ? ' checked' : ''}> <b>Выдать игроку</b><small>${d.give ? 'есть у всех игроков бесплатно' : 'только в паках'}</small></label>
          ${B ? '<p class="adm-help">Картинки встроенного животного менять нельзя — можно имя, размер, голос и суставы.</p>' : '<label class="ie-upload small"><em>📂 Выбрать все части сразу</em><input type="file" multiple accept="image/png,image/webp,image/jpeg" data-an-all></label>'}
          <div class="an-slots">${slots}</div>
        </div>
        <div class="ie-preview an-preview">
          <div class="lv-tools">${Object.entries(MODES).map(([k, n]) => `<button data-an-mode="${k}" class="${mode === k ? 'on' : ''}">${n}</button>`).join('')}</div>
          <canvas class="lv-canvas" width="560" height="380" data-an-canvas></canvas>
          <div class="lv-tools"><button data-an-joints class="${showJoints ? 'on' : ''}">📍 Суставы</button><button data-an-autojoints>↺ Суставы — сами</button></div>
          <p class="adm-help">${rig ? 'Точки — суставы: за них часть крепится к туловищу и вокруг них поворачивается. Перетащи точку, если лапа или хвост «отрываются».' : 'Загрузи хотя бы туловище, голову и 4 лапы.'}</p>
        </div>
      </div>
      <div class="ie-actions">
        <button class="primary" data-an-save>Сохранить</button>
        <button data-an-put>Сохранить и поставить в дом</button>
        ${B ? (getOverride(d.id) ? '<button data-an-reset>Вернуть как было</button>' : '') : getRecord(d.id) ? '<button data-an-del>Удалить</button>' : ''}
      </div>`;
  }

  function render() {
    if (!host) return;
    host.innerHTML = draft ? formHtml() : listHtml();
    if (draft) { rebuild().then(loop); } else stop();
  }

  // Картинки частей → временные ключи → скелет для показа.
  async function rebuild() {
    const a = draft?.animal; if (!a) return;
    const parts = {};
    for (const k of Object.keys(ANIMAL_PARTS)) {
      const key = 'animaldraft/' + k;
      if (a.parts[k]) { if (img(key)?.src !== a.parts[k]) registerImage(key, await loadImage(a.parts[k])); parts[k] = key; }
      else forgetImage(key);
    }
    // Суставы, которых ещё нет, — «сами».
    if (parts.body) for (const k of JOINT_PARTS) if (parts[k] && !a.joints[k]) a.joints[k] = autoJoint(img(parts[k]), img(parts.body), k).map((v) => Math.round(v * 10000) / 10000);
    rig = buildAnimal({ parts, joints: a.joints });
    const help = host?.querySelector('.an-preview .adm-help');
    if (help && rig) help.textContent = 'Точки — суставы: за них часть крепится к туловищу и вокруг них поворачивается. Перетащи точку, если лапа или хвост «отрываются».';
  }

  // Где животное на холсте показа.
  function frame(cv) {
    const [x0, y0, x1, y1] = rig.box, bw = x1 - x0, bh = y1 - y0;
    const s = Math.min((cv.width - 80) / bw, (cv.height - 90) / bh);
    const w = bw * s, h = bh * s;
    return { b: { x: (cv.width - w) / 2, y: cv.height - 40 - h, w, h }, s, x0, y0 };
  }

  let walkPh = 0, lastT = 0;
  function draw() {
    const cv = host?.querySelector('[data-an-canvas]'); if (!cv) return false;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#f7efe0'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#e6d6bb'; c.fillRect(0, cv.height - 40, cv.width, 40);
    if (!rig) return true;
    const t = performance.now() / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 0; lastT = t;
    const F = frame(cv);
    let pose, dx = 0, dy = 0;
    if (mode === 'walk') { walkPh += dt * 7; pose = animalPose('0', { walk: { phase: walkPh, amp: 1 } }); }
    else if (mode === 'carried') { pose = animalPose('0', { carried: true, tilt: Math.sin(t * 1.5) * 0.15 }); dy = -30; }
    else if (mode === 'sleep') pose = animalPose('0', { sleep: true, rig });
    else pose = animalPose('0', {});
    if (mode === 'happy') { const q = (t * 0.8) % 1; dy = -Math.max(0, Math.sin(q * Math.PI * 2)) * 40; }
    if (mode !== 'carried') { c.fillStyle = 'rgba(70,45,20,.15)'; c.beginPath(); c.ellipse(cv.width / 2, cv.height - 40, F.b.w * 0.4, 9, 0, 0, Math.PI * 2); c.fill(); }
    drawAnimal(c, rig, { ...F.b, x: F.b.x + dx, y: F.b.y + dy }, pose);
    if (showJoints && mode === 'idle') {
      for (const k of JOINT_PARTS) {
        const j = rig.joints[k]; if (!j) continue;
        const x = F.b.x + (j[0] - F.x0) * F.s, y = F.b.y + (j[1] - F.y0) * F.s;
        c.fillStyle = dragJ === k ? '#e0864a' : '#4a7fe0'; c.strokeStyle = '#fff'; c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
    return true;
  }
  function loop() { stop(); const tick = () => { if (draw() && draft) raf = requestAnimationFrame(tick); else raf = 0; }; raf = requestAnimationFrame(tick); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function toCanvas(cv, e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
  function onDown(e) {
    const cv = e.target.closest?.('[data-an-canvas]'); if (!cv || !rig || !draft) return;
    if (mode !== 'idle') { mode = 'idle'; host.querySelectorAll('[data-an-mode]').forEach((b) => b.classList.toggle('on', b.dataset.anMode === 'idle')); }
    const p = toCanvas(cv, e), F = frame(cv);
    let best = null, bd = 26;
    for (const k of JOINT_PARTS) {
      const j = rig.joints[k]; if (!j) continue;
      const d = Math.hypot(F.b.x + (j[0] - F.x0) * F.s - p.x, F.b.y + (j[1] - F.y0) * F.s - p.y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best) { dragJ = best; showJoints = true; e.preventDefault(); cv.setPointerCapture?.(e.pointerId); }
  }
  function onMove(e) {
    if (!dragJ) return;
    const cv = host.querySelector('[data-an-canvas]'), p = toCanvas(cv, e), F = frame(cv);
    const fx = (p.x - F.b.x) / F.s + F.x0, fy = (p.y - F.b.y) / F.s + F.y0;
    rig.joints[dragJ] = [fx, fy];
    draft.animal.joints[dragJ] = [Math.round(fx / rig.W * 10000) / 10000, Math.round(fy / rig.H * 10000) / 10000];
    dirty = true;
  }
  function onUp() { if (dragJ) { dragJ = null; rebuild(); } }

  async function setPart(k, file) {
    draft.animal.parts[k] = await prepareFull(file);
    delete draft.animal.joints[k];
    if (k === 'body') draft.animal.joints = {}; // новое туловище — все суставы заново
    dirty = true;
  }

  async function saveBuiltin(put) {
    const d = draft;
    busy = true;
    try {
      await saveOverride({ ...(getOverride(d.id) || {}), id: d.id, name: d.name !== d.baseName ? d.name : undefined, size: d.w !== d.baseW ? d.w : undefined, animal: { joints: d.animal.joints, voice: d.animal.voice } });
      studioSetGiven(d.id, d.give);
      dirty = false;
      store.change((s) => normalize(s), { undo: false });
      if (put) { const id = actions.take(d.id); if (id) actions.placeFromInventory(id); }
      toast(`«${d.name}» сохранён${d.give ? '' : ' — у игроков только в паках'}. Игрокам — «📤 Отправить игрокам»`);
      draft = builtinDraft(d.id);
    } catch (e) { toast(e.message, true); }
    busy = false;
    render(); onChange();
  }

  async function save(put) {
    if (busy) return;
    const d = draft;
    d.name = host.querySelector('[data-an-name]').value.trim();
    if (!d.name) { toast('Дай животному имя', true); return; }
    if (d.builtin) return saveBuiltin(put);
    if (!rig) { toast('Нужны туловище, голова и 4 лапы', true); return; }
    const sizes = new Set(Object.values(d.animal.parts).map((src) => { const im = img('animaldraft/' + Object.keys(d.animal.parts).find((k) => d.animal.parts[k] === src)); return im ? im.width + 'x' + im.height : ''; }));
    if (sizes.size > 1) toast('Картинки частей разного размера — части могут встать не на место', true);
    busy = true;
    try {
      d.image = composeAnimal(rig).toDataURL('image/webp', 0.9);
      const rec = await saveRecord(d);
      dirty = false;
      store.change((s) => normalize(s), { undo: false });
      actions.restoreMissing();
      if (put) { const id = actions.take(rec.id); if (id) actions.placeFromInventory(id); toast(`«${rec.name}» в доме — потяни его медленно, и он пойдёт`); }
      else toast(`«${rec.name}» сохранён — он в шкафчике`);
      draft = JSON.parse(JSON.stringify(rec));
    } catch (e) { toast(e.message, true); }
    busy = false;
    render(); onChange();
  }

  const onClick = async (e) => {
    const b = e.target.closest('button, .ie-card'); if (!b || !host?.contains(b)) return;
    if (b.dataset.anNew !== undefined) { draft = fresh(); dirty = false; mode = 'idle'; }
    else if (b.dataset.anEdit) { draft = JSON.parse(JSON.stringify(getRecord(b.dataset.anEdit))); dirty = false; mode = 'idle'; }
    else if (b.dataset.anBuiltin) { draft = builtinDraft(b.dataset.anBuiltin); dirty = false; mode = 'idle'; }
    else if (b.dataset.anSend !== undefined) { if (!sending) sendToPlayers(); return; }
    else if (b.dataset.anReset !== undefined) {
      if (!confirm('Вернуть встроенное животное как было (имя, размер, голос, суставы)?')) return;
      await resetOverride(draft.id); store.change((s) => normalize(s), { undo: false }); draft = builtinDraft(draft.id); dirty = false; toast('Как было'); onChange();
    }
    else if (b.dataset.anBack !== undefined) { if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return; draft = null; rig = null; }
    else if (b.dataset.anMode) {
      mode = b.dataset.anMode;
      if (mode === 'happy' && draft.animal.voice) play(draft.animal.voice);
      host.querySelectorAll('[data-an-mode]').forEach((x) => x.classList.toggle('on', x.dataset.anMode === mode));
      return;
    }
    else if (b.dataset.anJoints !== undefined) { showJoints = !showJoints; b.classList.toggle('on', showJoints); return; }
    else if (b.dataset.anAutojoints !== undefined) { draft.animal.joints = {}; dirty = true; await rebuild(); return; }
    else if (b.dataset.anSave !== undefined) return save(false);
    else if (b.dataset.anPut !== undefined) return save(true);
    else if (b.dataset.anDel !== undefined) {
      if (!confirm(`Удалить «${draft.name}»? Из дома оно тоже пропадёт.`)) return;
      try { await deleteRecord(draft.id); toast('Удалено'); draft = null; rig = null; store.change((s) => normalize(s), { undo: false }); } catch (err) { toast(err.message, true); }
      onChange();
    } else return;
    render();
  };

  const onChangeEv = async (e) => {
    if (!host?.contains(e.target) || !draft) return;
    try {
      if (e.target.matches('[data-an-part]') && e.target.files[0]) { await setPart(e.target.dataset.anPart, e.target.files[0]); render(); }
      else if (e.target.matches('[data-an-all]') && e.target.files.length) {
        let n = 0; const skipped = [];
        for (const f of e.target.files) { const k = partByName(f.name); if (k) { await setPart(k, f); n++; } else if (!/_full\./i.test(f.name)) skipped.push(f.name); }
        toast(`Частей загружено: ${n}` + (skipped.length ? ` · не узнал: ${skipped.join(', ')}` : ''), !n);
        render();
      } else if (e.target.matches('[data-an-give]')) { draft.give = e.target.checked; dirty = true; e.target.parentElement.querySelector('small').textContent = draft.give ? 'есть у всех игроков бесплатно' : 'только в паках'; }
      else if (e.target.matches('[data-an-voice]')) { draft.animal.voice = e.target.value; dirty = true; if (draft.animal.voice) play(draft.animal.voice); }
    } catch (err) { toast(err.message, true); }
  };
  const onInput = (e) => {
    if (!host?.contains(e.target) || !draft) return;
    if (e.target.matches('[data-an-w]')) { draft.w = Number(e.target.value); host.querySelector('[data-an-wv]').textContent = draft.w; dirty = true; }
    if (e.target.matches('[data-an-name]')) { draft.name = e.target.value; dirty = true; }
  };

  return {
    mount,
    unmount() { stop(); host = null; },
    bind(root) {
      root.addEventListener('click', onClick); root.addEventListener('change', onChangeEv); root.addEventListener('input', onInput);
      root.addEventListener('pointerdown', onDown); root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp);
    },
    get dirty() { return dirty; },
  };
}
