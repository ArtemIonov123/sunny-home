// Выдвижная панель «Герои»: слева большой герой на своём холсте, справа — кожа, волосы, лицо, одежда.
// Без текста: всё выбирается картинками и цветными кружками. Каждое нажатие — через actions.setLook
// (работают отмена и сохранение, герой в доме меняется сразу).
import { CHARS } from '../core/catalog.js';
import { SKINS, HAIR_COLORS, WEAR_COLORS, HAIRS, FACES, WEAR, canDress, toggleWear } from '../core/looks.js';
import { drawHero, drawPart, partThumb } from '../render/hero.js';
import { HERO_LAYERS } from '../render/heroLayout.js';
import { img } from '../assets.js';
import { play } from '../audio.js';

const TABS = [['skin', '🎨', 'Кожа'], ['hair', '💇', 'Причёска'], ['face', '😊', 'Лицо'], ['wear', '👕', 'Одежда']];
const HEAD_BOX = [78, 8, 352, 300];
const WEAR_LIST = ['tshirt', 'dress', 'pants', 'skirt', 'sneakers', 'cap', 'glasses'];
const PLAIN = '#f6f2ea'; // ненадетая вещь на кнопке — белая

// Рамка слоя на холсте героя (для картинки-кнопки вещи).
function layerBox(name, pad = 10) {
  const k = `hero/${name}_f`, at = HERO_LAYERS[k], im = img(k);
  if (!at || !im) return HEAD_BOX;
  return [at[0] - pad, at[1] - pad, im.width + pad * 2, im.height + pad * 2];
}

export function createHeroEditor({ root, store, actions, onChange }) {
  const sheet = document.createElement('section');
  sheet.className = 'hero-sheet';
  sheet.setAttribute('aria-label', 'Герои');
  sheet.hidden = true;
  sheet.innerHTML = `
    <header class="hs-head">
      <div class="hs-who"></div>
      <div class="hs-tabs">${TABS.map(([k, i, n]) => `<button class="hs-tab" data-hs-tab="${k}" aria-label="${n}" title="${n}">${i}</button>`).join('')}</div>
      <button class="close" data-hs-close aria-label="Закрыть">×</button>
    </header>
    <div class="hs-body"><div class="hs-stage"><canvas></canvas></div><div class="hs-opts"></div></div>`;
  root.appendChild(sheet);
  const q = (s) => sheet.querySelector(s);
  const stage = q('.hs-stage canvas'), opts = q('.hs-opts'), who = q('.hs-who');
  let current = 'girl', tab = 'skin', picked = null; // picked — какая вещь красится кружками

  const heroes = () => store.state.chars.filter((c) => canDress(c.id) && c.look);
  const lookOf = (id) => heroes().find((c) => c.id === id)?.look;
  const url = (cv) => cv.toDataURL();

  let bounceNext = false, lastSig = '';
  function setLook(look) { bounceNext = true; actions.setLook(current, look); onChange(); }

  function drawStage(bounce) {
    const look = lookOf(current); if (!look) return;
    const box = stage.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const Hpx = Math.max(120, box.height - 8), Wpx = Math.max(80, box.width - 8);
    stage.width = Math.round(Wpx * dpr); stage.height = Math.round(Hpx * dpr);
    stage.style.width = Wpx + 'px'; stage.style.height = Hpx + 'px';
    const c = stage.getContext('2d');
    const full = [0, 0, 512, 875], s = Math.min(stage.width / full[2], stage.height / full[3]) * 0.96;
    c.clearRect(0, 0, stage.width, stage.height);
    c.fillStyle = 'rgba(110,74,38,.16)'; // тень под ногами
    c.beginPath(); c.ellipse(stage.width / 2, stage.height - 10 * dpr, 150 * s, 22 * s, 0, 0, Math.PI * 2); c.fill();
    c.save(); c.translate((stage.width - full[2] * s) / 2, stage.height - full[3] * s - 6 * dpr); c.scale(s, s);
    drawHero(c, look);
    c.restore();
    if (bounce) { stage.classList.remove('boing'); void stage.offsetWidth; stage.classList.add('boing'); }
  }

  function renderWho() {
    who.innerHTML = heroes().map((c) => {
      const t = partThumb(HEAD_BOX, (ctx) => { drawPart(ctx, 'head', c.look.skin); drawPart(ctx, 'face_' + c.look.face); if (c.look.hair !== 'none') { drawPart(ctx, 'hair_cap', c.look.hairColor); drawPart(ctx, 'hair_' + (c.look.hair === 'long' ? 'long_front' : c.look.hair), c.look.hairColor); } }, 72);
      return `<button class="hs-hero${c.id === current ? ' on' : ''}" data-hs-hero="${c.id}" aria-label="${CHARS[c.id].name}"><img src="${url(t)}" alt=""></button>`;
    }).join('');
  }

  const swatches = (list, cur, attr) => `<div class="hs-swatches">${list.map((c) => `<button class="swatch${c === cur ? ' on' : ''}" style="--c:${c}" data-${attr}="${c}" aria-label="${c}"></button>`).join('')}</div>`;

  function renderOpts() {
    const look = lookOf(current); if (!look) return;
    for (const b of sheet.querySelectorAll('.hs-tab')) b.classList.toggle('on', b.dataset.hsTab === tab);
    if (tab === 'skin') {
      opts.innerHTML = swatches(SKINS, look.skin, 'hs-skin');
    } else if (tab === 'hair') {
      opts.innerHTML = `<div class="hs-grid">${HAIRS.map((h) => {
        const t = partThumb(HEAD_BOX, (c) => {
          if (h === 'long') drawPart(c, 'hair_long_back', look.hairColor);
          drawPart(c, 'head', look.skin); drawPart(c, 'face_' + look.face);
          if (h !== 'none') { drawPart(c, 'hair_cap', look.hairColor); drawPart(c, 'hair_' + (h === 'long' ? 'long_front' : h), look.hairColor); }
        });
        return `<button class="hs-pick${h === look.hair ? ' on' : ''}" data-hs-hair="${h}" aria-label="${h}"><img src="${url(t)}" alt=""></button>`;
      }).join('')}</div>${swatches(HAIR_COLORS, look.hairColor, 'hs-haircolor')}`;
    } else if (tab === 'face') {
      opts.innerHTML = `<div class="hs-grid">${FACES.map((f) => {
        const t = partThumb([150, 100, 210, 180], (c) => { drawPart(c, 'head', look.skin); drawPart(c, 'face_' + f); });
        return `<button class="hs-pick${f === look.face ? ' on' : ''}" data-hs-face="${f}" aria-label="${f}"><img src="${url(t)}" alt=""></button>`;
      }).join('')}</div>`;
    } else {
      if (picked && !look.wear[picked]) picked = null;
      if (!picked) picked = Object.keys(look.wear)[0] || null;
      opts.innerHTML = `<div class="hs-grid">${WEAR_LIST.map((w) => {
        const t = partThumb(layerBox('wear_' + w), (c) => drawPart(c, 'wear_' + w, look.wear[w] || PLAIN));
        const cls = (look.wear[w] ? ' on' : '') + (w === picked ? ' picked' : '');
        return `<button class="hs-pick wear${cls}" data-hs-wear="${w}" aria-label="${w}"><img src="${url(t)}" alt=""></button>`;
      }).join('')}</div>${picked ? swatches(WEAR_COLORS, look.wear[picked], 'hs-wearcolor') : ''}`;
    }
  }

  function render(bounce = false) { lastSig = JSON.stringify([current, tab, picked, heroes().map((c) => c.look)]); renderWho(); renderOpts(); drawStage(bounce); }

  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || !sheet.contains(t)) return;
    e.stopPropagation();
    const d = t.dataset, look = lookOf(current);
    if (d.hsClose !== undefined) { close(); return; }
    if (d.hsTab) { tab = d.hsTab; play('click'); renderOpts(); return; }
    if (d.hsHero) { current = d.hsHero; play('boing'); render(true); return; }
    if (!look) return;
    if (d.hsSkin) setLook({ ...look, skin: d.hsSkin });
    else if (d.hsHair) setLook({ ...look, hair: d.hsHair });
    else if (d.hsHaircolor) setLook({ ...look, hairColor: d.hsHaircolor });
    else if (d.hsFace) setLook({ ...look, face: d.hsFace });
    else if (d.hsWear) {
      const w = d.hsWear, on = !!look.wear[w];
      // Нажал на надетую, но не выбранную — просто выбрать её для покраски; иначе надеть/снять.
      if (on && picked !== w) { picked = w; play('click'); renderOpts(); return; }
      const next = toggleWear(look, w, on ? null : (WEAR_COLORS[(WEAR_LIST.indexOf(w) * 5) % WEAR_COLORS.length]));
      picked = next.wear[w] ? w : null;
      setLook(next);
      play(next.wear[w] ? 'pop' : 'stash');
      return;
    } else if (d.hsWearcolor && picked) setLook({ ...look, wear: { ...look.wear, [picked]: d.hsWearcolor } });
    else return;
    play('pop');
  });

  function open(id) {
    if (id && lookOf(id)) current = id;
    if (!lookOf(current)) current = heroes()[0]?.id;
    if (!current) return;
    sheet.hidden = false;
    requestAnimationFrame(() => { sheet.classList.add('open'); render(); });
    root.closest('#app')?.classList.add('heroes');
    play('open');
  }
  function close() {
    sheet.classList.remove('open');
    root.closest('#app')?.classList.remove('heroes');
    setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 260);
    play('close');
  }
  // После «отменить» и т. п. — показать актуальное.
  store.on('change', () => {
    if (sheet.hidden) return;
    const sig = JSON.stringify([current, tab, picked, heroes().map((c) => c.look)]);
    if (sig !== lastSig) { render(bounceNext); }
    bounceNext = false;
  });
  window.addEventListener('resize', () => { if (!sheet.hidden) drawStage(); });

  return { open, close, get isOpen() { return !sheet.hidden; }, toggle(id) { if (sheet.hidden) open(id); else close(); } };
}
