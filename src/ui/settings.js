// ⚙️ Настройки: аватарка (лицо своего героя на цветном круге), имя, звук, вибрация.
// Друзья (код дружбы, запросы, гости) — следующий шаг, нужен сервер (Firebase).
import { img } from '../assets.js';
import { play, soundOn, setSound, vibroOn, setVibro } from '../audio.js';
import { getProfile, setProfile, randomNick, AVATAR_BG } from '../core/profile.js';
import { escapeHtml as esc } from '../util.js';

// Аватарка: голова героя (из его собранной картинки) на круге цвета bg.
const cache = new WeakMap(); // картинка героя (новая при смене внешности) → { ключ → аватарка }
export function avatarSrc(face, bg, size = 120) {
  const hero = img('hero/' + face); if (!hero) return '';
  let per = cache.get(hero); if (!per) { per = new Map(); cache.set(hero, per); }
  const key = bg + size;
  if (per.has(key)) return per.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  c.fillStyle = bg; c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); c.fill();
  c.save(); c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); c.clip();
  const S = hero.width * 0.72, sx = (hero.width - S) / 2; // голова — верх картинки героя
  c.drawImage(hero, sx, 0, S, S, size * 0.04, size * 0.1, size * 0.92, size * 0.92);
  c.restore();
  const url = cv.toDataURL('image/png');
  per.set(key, url);
  return url;
}

export function createSettings({ root, onChange }) {
  const el = document.createElement('div');
  el.className = 'settings-sheet';
  el.hidden = true;
  root.appendChild(el);

  function render() {
    const p = getProfile();
    el.innerHTML = `<div class="st-card" role="dialog" aria-label="Настройки">
      <header><b>⚙️</b><button class="close" data-st-close aria-label="Закрыть">×</button></header>
      <div class="st-me">
        <img class="st-avatar" src="${avatarSrc(p.face, p.bg, 160)}" alt="">
        <div class="st-name"><b>${esc(p.nick)}</b><button data-st-nick aria-label="Другое имя">🎲</button></div>
      </div>
      <div class="st-row st-faces">${['girl', 'boy'].map((f) => `<button class="st-face${p.face === f ? ' on' : ''}" data-st-face="${f}"><img src="${avatarSrc(f, p.bg, 96)}" alt=""></button>`).join('')}</div>
      <div class="st-row st-colors">${AVATAR_BG.map((c) => `<button class="swatch${p.bg === c ? ' on' : ''}" style="--c:${c}" data-st-bg="${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="st-row st-toggles">
        <button class="st-toggle${soundOn() ? ' on' : ''}" data-st-sound aria-label="Звук">${soundOn() ? '🔊' : '🔇'}<small>Звук</small></button>
        <button class="st-toggle${vibroOn() ? ' on' : ''}" data-st-vibro aria-label="Вибрация">${vibroOn() ? '📳' : '📴'}<small>Вибрация</small></button>
      </div>
      <div class="st-friends"><span>🤝</span><div><b>Друзья</b><small>Скоро: код дружбы, добавить друга, прийти в гости.</small></div></div>
    </div>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === el) close(); return; } // нажали мимо карточки — закрыть
    const d = b.dataset;
    if (d.stClose !== undefined) return close();
    if (d.stNick !== undefined) { setProfile({ nick: randomNick() }); play('pop'); }
    else if (d.stFace) { setProfile({ face: d.stFace }); play('boing'); }
    else if (d.stBg) { setProfile({ bg: d.stBg }); play('click'); }
    else if (d.stSound !== undefined) { setSound(!soundOn()); play('pop'); }
    else if (d.stVibro !== undefined) setVibro(!vibroOn());
    else return;
    render(); onChange?.();
  });

  function open() { render(); el.hidden = false; play('pop'); }
  function close() { el.hidden = true; play('click'); }
  return { open, close, get isOpen() { return !el.hidden; } };
}
