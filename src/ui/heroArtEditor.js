// Студия → «Герои»: заменить встроенные картинки героев своими от GPT — тело и части тела (для движений),
// голову, лица, причёски, встроенную одежду. Слот → «📥 Образец для GPT» → картинка → подвинуть → «💾 Сохранить».
// Видно сразу на Миле и Тиме (стоит, машет, сидит, идёт). Игрокам — «📤 Отправить игрокам» (пак-подарок, поле heroArt).
import { CHARS } from '../core/catalog.js';
import { canDress, toggleWear } from '../core/looks.js';
import { hasToken, sendGameUpdate } from '../core/publish.js';
import { drawHero, drawPart, partThumb } from '../render/hero.js';
import { buildRig, drawRig, heroPose, rigAnims } from '../render/rig.js';
import { HERO_LAYERS } from '../render/heroLayout.js';
import { layerRect } from '../render/garment.js';
import { colorShare, HERO_GROUPS, SLOT_NAMES, ALL_SLOTS, slotGroup, templateSizeText, fitHeroUpload, heroTemplate, applyHeroArt, ownHeroArt, packHeroArt, saveOwnHeroArt } from '../render/heroArt.js';
import { img, loadImage } from '../assets.js';
import { play } from '../audio.js';
import { escapeHtml as esc } from '../util.js';

const MODES = { stand: '🧍 Стоит', wave: '👋 Машет', sit: '🪑 Сидит', walk: '🚶 Идёт' };
const W = 512;
const THUMB_COLOR = { body: '#efb98f', head: '#efb98f', hair: '#8a5530', face: null };
const WEAR_COLOR = { wear_tshirt: '#6fcfc0', wear_dress: '#ffe27a', wear_pants: '#7fb1f0', wear_skirt: '#ff8fa8', wear_sneakers: '#ff6b6b', wear_cap: '#ffb36b', wear_glasses: '#3d6fc4' };
const GROUP_HELP = {
  body: 'Тело и его части. «Тело целиком» — как герой стоит, остальные части — для движений (руки, ноги, кулачки). Рисуются на одном образце 1024×1536, каждая на своём месте: если наложить все части — получится «тело целиком». Лучше менять весь набор сразу.',
  head: 'Голова без лица и без волос. Шапочка под причёсками подстроится сама.',
  face: 'Лица — только глаза, брови, нос, рот, румянец, без головы. Все 6 — на одном месте. Лица не перекрашиваются.',
  hair: 'Причёски — серые (цвет выбирает игрок), на месте волос на голове. Длинные волосы — две картинки: спереди (у лица) и сзади (за спиной).',
  wear: 'Встроенная одежда — одна картинка вещи, как своя одежда. Рукава и штанины сами поделятся для движений.',
};

async function fileUrl(file) {
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('Выбери PNG, WebP или JPG');
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось открыть файл')); r.readAsDataURL(file); });
}
const download = (cv, name) => cv.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');

export function createHeroArtEditor({ store, actions, toast, onChange }) {
  let host = null, group = 'body', slot = 'body_stand', work = null, dirty = false, busy = false, sending = '';
  let heroId = 'girl', mode = 'stand', raf = 0, rig = null, rigSig = '', drag = null, lastWave = 0, walkPh = 0, lastT = 0, artVer = 0;

  const heroes = () => store.state.chars.filter((c) => canDress(c.id) && c.look);
  const ensureWork = () => { if (!work) work = ownHeroArt(); };

  function mount(el) { host = el; ensureWork(); render(); }

  async function apply() { await applyHeroArt({ ...packHeroArt(), ...work }); artVer++; rigSig = ''; }

  const thumb = (n) => {
    const r = layerRect(n); if (!r) return '';
    const g = slotGroup(n), color = g === 'wear' ? WEAR_COLOR[n] : THUMB_COLOR[g];
    return partThumb([r[0] - 6, r[1] - 6, r[2] + 12, r[3] + 12], (c) => { if (g === 'face') drawPart(c, 'head', '#efb98f'); drawPart(c, n, color); }, 110).toDataURL();
  };

  function html() {
    const G = HERO_GROUPS[group], has = (n) => !!work[n];
    const changed = Object.keys(work).length;
    return `<div class="ie-bar">
        <button class="primary" data-ha-save${dirty && !busy ? '' : ' disabled'}>💾 Сохранить</button>
        <button data-ha-cancel${dirty ? '' : ' disabled'}>Отменить изменения</button>
        <button data-ha-send${!sending && !dirty ? '' : ' disabled'}>📤 Отправить игрокам</button>
        <span class="ie-title">${sending ? '⏳ ' + esc(sending) : `Своих картинок: ${changed}${dirty ? ' · не сохранено' : ''}`}</span></div>
      <div class="ha-groups">${Object.entries(HERO_GROUPS).map(([k, g]) => `<button data-ha-group="${k}" class="${k === group ? 'on' : ''}">${g.icon} ${g.name}${g.slots.some(has) ? ' ✓' : ''}</button>`).join('')}</div>
      <p class="adm-help">${GROUP_HELP[group]}</p>
      <div class="ce-row"><label class="file-btn">📂 Загрузить несколько сразу (по именам файлов)<input type="file" multiple accept="image/png,image/webp,image/jpeg" data-ha-many hidden></label>
        <small class="ce-hint">Имена как в арт-гиде: ${esc(G.slots.slice(0, 3).join('.png, '))}.png…</small></div>
      <div class="ie-form">
        <div class="ie-fields">
          <div class="ha-slots">${G.slots.map((n) => `<button data-ha-slot="${n}" class="ha-slot${n === slot ? ' on' : ''}${has(n) ? ' own' : ''}"><img src="${thumb(n)}" alt=""><b>${SLOT_NAMES[n]}</b><small>${has(n) ? '✓ своя' : 'встроенная'}</small></button>`).join('')}</div>
          <div class="ha-cur">
            <h4>${SLOT_NAMES[slot]} <small>${slot}.png · образец ${templateSizeText(slot)}</small></h4>
            <div class="lv-tools">
              <button data-ha-template>📥 Образец для GPT</button>
              <label class="file-btn">📂 ${has(slot) ? 'Другая картинка' : 'Загрузить картинку'}<input type="file" accept="image/png,image/webp,image/jpeg" data-ha-file hidden></label>
              ${has(slot) ? '<button data-ha-reset>↺ Вернуть встроенную</button>' : ''}
            </div>
            ${has(slot) && slotGroup(slot) !== 'face' ? `<label class="an-give"><input type="checkbox" data-ha-tint${work[slot].tint === false ? '' : ' checked'}> <b>Игрок перекрашивает</b><small>${work[slot].tint === false ? 'картинка всегда такая, как нарисована (кружков цвета в гардеробе нет)' : 'серое и светлое в картинке красится в цвет, который выберет игрок'}</small></label>` : ''}
            ${has(slot) ? `<div class="lv-tools ce-nudge">
              <button data-ha-nudge="0,-1" aria-label="Выше">⬆</button><button data-ha-nudge="0,1" aria-label="Ниже">⬇</button>
              <button data-ha-nudge="-1,0" aria-label="Левее">⬅</button><button data-ha-nudge="1,0" aria-label="Правее">➡</button>
              <button data-ha-scale="1.03" aria-label="Больше">➕</button><button data-ha-scale="0.97" aria-label="Меньше">➖</button>
              <button data-ha-stretch="1.03,1">↔ шире</button><button data-ha-stretch="0.97,1">↔ уже</button>
              <button data-ha-stretch="1,1.03">↕ длиннее</button><button data-ha-stretch="1,0.97">↕ короче</button>
            </div><p class="adm-help">В режиме «Стоит» картинку можно тянуть пальцем. Оранжевая рамка — новая картинка.</p>` : '<p class="adm-help">Нарисованное на образце встанет точно на место. Другая картинка встанет туда, где сейчас эта часть.</p>'}
          </div>
        </div>
        <div class="ie-preview ce-preview">
          <div class="lv-tools">${heroes().map((c) => `<button data-ha-hero="${c.id}" class="${c.id === heroId ? 'on' : ''}">${esc(CHARS[c.id]?.name || c.id)}</button>`).join('')}</div>
          <div class="lv-tools">${Object.entries(MODES).map(([k, n]) => `<button data-ha-mode="${k}" class="${mode === k ? 'on' : ''}">${n}</button>`).join('')}</div>
          <canvas class="ce-canvas" width="440" height="560" data-ha-canvas></canvas>
        </div>
      </div>`;
  }

  function render() { if (!host) return; host.innerHTML = html(); loop(); }

  // Герой для показа: с выбранным лицом, причёской или вещью.
  function showLook() {
    const look0 = heroes().find((c) => c.id === heroId)?.look || heroes()[0]?.look; if (!look0) return { look: null };
    let look = { ...look0, wear: { ...look0.wear } }, face = null;
    const g = slotGroup(slot);
    if (g === 'face') face = slot.slice(5);
    else if (g === 'hair') look.hair = slot.startsWith('hair_long') ? 'long' : slot.slice(5);
    else if (g === 'wear') { const w = slot.slice(5); delete look.wear[w]; look = toggleWear(look, w, WEAR_COLOR[slot]); }
    return { look, face };
  }
  const FEET = () => HERO_LAYERS['hero/body_stand_f'][1] + (img('hero/body_stand_f')?.height || 640);
  function frame(cv) {
    const feet = rig?.h || FEET(), s = Math.min((cv.height - 40) / feet, (cv.width - 20) / W);
    return { s, x: (cv.width - W * s) / 2, y: cv.height - 24 - feet * s };
  }
  function draw() {
    const cv = host?.querySelector('[data-ha-canvas]'); if (!cv) return false;
    const c = cv.getContext('2d');
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#e6d6bb'; c.fillRect(0, cv.height - 24, cv.width, 24);
    const { look, face } = showLook(); if (!look) return true;
    const sig = JSON.stringify([look, face, artVer]);
    if (sig !== rigSig) { rig = buildRig(look, face); rigSig = sig; }
    const F = frame(cv), t = performance.now() / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 0; lastT = t;
    if (mode === 'sit') { c.fillStyle = '#c9a477'; c.fillRect(cv.width / 2 - 120, F.y + 560 * F.s, 240, 26); }
    c.fillStyle = 'rgba(110,74,38,.16)'; c.beginPath(); c.ellipse(cv.width / 2, cv.height - 24, 150 * F.s, 14, 0, 0, Math.PI * 2); c.fill();
    if (mode === 'stand') {
      c.save(); c.translate(F.x, F.y); c.scale(F.s, F.s); drawHero(c, look, { face }); c.restore();
      const b = work[slot]?.box;
      if (b) { c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = drag ? '#e0864a' : 'rgba(224,134,74,.75)'; c.strokeRect(F.x + b[0] * F.s, F.y + b[1] * F.s, b[2] * F.s, b[3] * F.s); c.setLineDash([]); }
      return true;
    }
    let pose;
    if (mode === 'sit') pose = heroPose('hapreview', { seat: 'sit' });
    else if (mode === 'walk') { walkPh += dt * 6; pose = heroPose('hapreview', { walk: { phase: walkPh, amp: 1, dir: 1 } }); }
    else { if (t - lastWave > 1.8) { lastWave = t; rigAnims.wave('hapreview'); } pose = heroPose('hapreview', {}); }
    drawRig(c, rig, { x: F.x, y: F.y + (mode === 'sit' ? 60 * F.s : 0), w: W * F.s, h: rig.h * F.s }, pose);
    return true;
  }
  function loop() { stop(); const tick = () => { if (draw()) raf = requestAnimationFrame(tick); else raf = 0; }; raf = requestAnimationFrame(tick); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  async function setFile(name, file) {
    const im = await loadImage(await fileUrl(file));
    const r = fitHeroUpload(im, name);
    work[name] = { image: r.image, box: r.box };
    // Цветная картинка (яркие пряди, узор) — сразу «не перекрашивать»; серая — перекрашивать.
    if (slotGroup(name) !== 'face' && colorShare(await loadImage(r.image)) > 0.15) work[name].tint = false;
    dirty = true;
    if (r.opaque) toast(`${SLOT_NAMES[name]}: фон не прозрачный — будет квадрат. Попроси у GPT прозрачный фон или #FF00FF`, true);
    return r;
  }
  async function setBox(b) { work[slot] = { ...work[slot], box: b.map((v) => Math.round(v * 10) / 10) }; dirty = true; await apply(); }

  function toCanvas(cv, e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
  function onDown(e) {
    const cv = e.target.closest?.('[data-ha-canvas]'); if (!cv || !work?.[slot]) return;
    if (mode !== 'stand') { mode = 'stand'; host.querySelectorAll('[data-ha-mode]').forEach((b) => b.classList.toggle('on', b.dataset.haMode === 'stand')); }
    drag = { p: toCanvas(cv, e), box: work[slot].box.slice(), F: frame(cv), at: ['t', 'f'].map((s) => HERO_LAYERS[`hero/${slot}_${s}`]?.slice() || null) };
    e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!drag) return;
    const p = toCanvas(host.querySelector('[data-ha-canvas]'), e), dx = (p.x - drag.p.x) / drag.F.s, dy = (p.y - drag.p.y) / drag.F.s;
    work[slot].box = [drag.box[0] + dx, drag.box[1] + dy, drag.box[2], drag.box[3]];
    ['t', 'f'].forEach((s, k) => { const a = drag.at[k]; if (a) HERO_LAYERS[`hero/${slot}_${s}`] = [Math.round(a[0] + dx), Math.round(a[1] + dy)]; });
  }
  async function onUp() { if (!drag) return; drag = null; dirty = true; await setBox(work[slot].box); render(); }

  async function sendToPlayers() {
    sending = 'Отправляю…'; render();
    try { await sendGameUpdate((t) => { sending = t; render(); }); toast('Готово: у игроков обновится через 1–5 минут'); } catch (e) { toast(e.message, true); }
    sending = ''; render();
  }

  const onClick = async (e) => {
    const b = e.target.closest('button'); if (!b || !host?.contains(b)) return;
    const d = b.dataset;
    if (d.haGroup) { group = d.haGroup; slot = HERO_GROUPS[group].slots[0]; rigSig = ''; play('click'); }
    else if (d.haSlot) { slot = d.haSlot; rigSig = ''; play('click'); }
    else if (d.haHero) { heroId = d.haHero; rigSig = ''; play('boing'); }
    else if (d.haMode) { mode = d.haMode; lastWave = 0; }
    else if (d.haTemplate !== undefined) { download(heroTemplate(slot), `obrazec_${slot}.png`); toast('Образец скачан. Отправь его GPT вместе с промптом из арт-гида'); return; }
    else if (d.haReset !== undefined) { delete work[slot]; dirty = true; await apply(); toast('Встроенная картинка вернулась (сохрани, чтобы осталось)'); }
    else if (d.haNudge) { const [x, y] = d.haNudge.split(',').map(Number), bx = work[slot].box; await setBox([bx[0] + x * 2, bx[1] + y * 2, bx[2], bx[3]]); }
    else if (d.haScale) { const k = Number(d.haScale), bx = work[slot].box, cx = bx[0] + bx[2] / 2, cy = bx[1] + bx[3] / 2; await setBox([cx - bx[2] * k / 2, cy - bx[3] * k / 2, bx[2] * k, bx[3] * k]); }
    else if (d.haStretch) { const [kx, ky] = d.haStretch.split(',').map(Number), bx = work[slot].box, cx = bx[0] + bx[2] / 2; await setBox([cx - bx[2] * kx / 2, bx[1], bx[2] * kx, bx[3] * ky]); }
    else if (d.haSave !== undefined) {
      busy = true;
      try { await saveOwnHeroArt(work); work = ownHeroArt(); dirty = false; artVer++; toast('Картинки героев сохранены. Игрокам — «📤 Отправить игрокам»'); } catch (err) { toast(err.message, true); }
      busy = false; onChange();
    } else if (d.haCancel !== undefined) {
      if (!confirm('Отменить несохранённые изменения картинок героев?')) return;
      work = ownHeroArt(); dirty = false; await apply();
    } else if (d.haSend !== undefined) { if (!hasToken()) { toast('Нужен ключ GitHub: нажми вверху «🔑 В игру» и вставь ключ (или загрузи резервную копию студии в «Данные»)', true); return; } if (!sending) sendToPlayers(); return; }
    else return;
    render();
  };

  const onChangeEv = async (e) => {
    if (!host?.contains(e.target)) return;
    try {
      if (e.target.matches('[data-ha-tint]')) {
        if (e.target.checked) delete work[slot].tint; else work[slot].tint = false;
        dirty = true; await apply(); render(); return;
      }
      if (e.target.matches('[data-ha-file]') && e.target.files[0]) {
        const r = await setFile(slot, e.target.files[0]); await apply();
        toast(r.onTemplate === false ? 'Картинка не по образцу — встала на место прежней. Подвинь, если нужно' : 'Готово — смотри на героя');
        render();
      } else if (e.target.matches('[data-ha-many]') && e.target.files.length) {
        let n = 0; const skipped = [];
        for (const f of e.target.files) {
          const stem = f.name.toLowerCase().replace(/\.(png|webp|jpe?g)$/, '');
          if (ALL_SLOTS.includes(stem)) { await setFile(stem, f); n++; if (slotGroup(stem) === group) slot = stem; } else skipped.push(f.name);
        }
        await apply();
        toast(`Загружено картинок: ${n}` + (skipped.length ? ` · не узнал: ${skipped.join(', ')}` : ''), !n);
        render();
      }
    } catch (err) { toast(err.message, true); }
    if (e.target.type === 'file') e.target.value = '';
  };

  return {
    mount,
    unmount() { stop(); host = null; },
    bind(root) {
      root.addEventListener('click', onClick); root.addEventListener('change', onChangeEv);
      root.addEventListener('pointerdown', onDown); root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp);
    },
    get dirty() { return dirty; },
  };
}
