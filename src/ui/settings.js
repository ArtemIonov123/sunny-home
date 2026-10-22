// ⚙️ Настройки: аватарка (лицо своего героя на цветном круге), имя, звук, вибрация.
// Друзья (код дружбы, запросы, гости) — следующий шаг, нужен сервер (Firebase).
import { img } from '../assets.js';
import { play, soundOn, setSound, vibroOn, setVibro } from '../audio.js';
import { getProfile, setProfile, cleanNick, AVATAR_BG } from '../core/profile.js';
import { escapeHtml as esc } from '../util.js';
import { composeHero } from '../render/hero.js';

// Аватарка друга — из его внешности (look), как своя.
const lookCache = new Map();
export function avatarFromLook(look, bg = '#ffd68c', size = 72) {
  if (!look) return '';
  const key = JSON.stringify(look) + bg + size;
  if (lookCache.has(key)) return lookCache.get(key);
  let hero; try { hero = composeHero(look); } catch (e) { return ''; }
  const url = drawAvatar(hero, bg, size);
  if (lookCache.size > 60) lookCache.clear();
  lookCache.set(key, url);
  return url;
}
function drawAvatar(hero, bg, size) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  c.fillStyle = bg; c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); c.fill();
  c.save(); c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); c.clip();
  const S = hero.width * 0.72, sx = (hero.width - S) / 2;
  c.drawImage(hero, sx, 0, S, S, size * 0.04, size * 0.1, size * 0.92, size * 0.92);
  c.restore();
  return cv.toDataURL('image/png');
}
const GATE_MS = 3000;

// Аватарка: голова героя (из его собранной картинки) на круге цвета bg.
const cache = new WeakMap(); // картинка героя (новая при смене внешности) → { ключ → аватарка }
export function avatarSrc(face, bg, size = 120) {
  const hero = img('hero/' + face); if (!hero) return '';
  let per = cache.get(hero); if (!per) { per = new Map(); cache.set(hero, per); }
  const key = bg + size;
  if (per.has(key)) return per.get(key);
  const url = drawAvatar(hero, bg, size); // голова — верх картинки героя
  per.set(key, url);
  return url;
}

export function createSettings({ root, onChange, friends = null, toast = () => {} }) {
  let gate = null, adding = false, addMsg = '', naming = false, nickMsg = '', visit = null;
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
        ${naming ? `<div class="st-name st-name-edit"><input data-st-nickin maxlength="16" value="${esc(p.nick)}" autocomplete="off"><button class="primary" data-st-nicksave aria-label="Готово">✓</button></div>${nickMsg ? `<p class="fr-msg">${esc(nickMsg)}</p>` : ''}`
          : `<button class="st-name" data-st-nick aria-label="Изменить имя"><b>${esc(p.nick)}</b><span>✏️</span></button>`}
      </div>
      <div class="st-row st-faces">${['girl', 'boy'].map((f) => `<button class="st-face${p.face === f ? ' on' : ''}" data-st-face="${f}"><img src="${avatarSrc(f, p.bg, 96)}" alt=""></button>`).join('')}</div>
      <div class="st-row st-colors">${AVATAR_BG.map((c) => `<button class="swatch${p.bg === c ? ' on' : ''}" style="--c:${c}" data-st-bg="${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="st-row st-toggles">
        <button class="st-toggle${soundOn() ? ' on' : ''}" data-st-sound aria-label="Звук">${soundOn() ? '🔊' : '🔇'}<small>Звук</small></button>
        <button class="st-toggle${vibroOn() ? ' on' : ''}" data-st-vibro aria-label="Вибрация">${vibroOn() ? '📳' : '📴'}<small>Вибрация</small></button>
      </div>
      ${friendsHtml()}
      ${gate ? `<div class="st-gate"><p>Для взрослых: держи кнопку 3 секунды</p>
        <button class="gate-btn" data-st-gate aria-label="Держать 3 секунды"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="gate-track"/><circle cx="50" cy="50" r="44" class="gate-ring"/></svg><span>✋</span></button>
        <button class="gate-cancel" data-st-gatecancel>Отмена</button></div>` : ''}
    </div>`;
    bindGate();
  }

  // ── Друзья ──
  function friendsHtml() {
    const st = friends?.state;
    if (!friends) return '';
    if (st.status !== 'on') {
      return `<div class="st-friends"><span>${st.status === 'error' ? '📡' : '⏳'}</span><div><b>Друзья</b>
        <small>${st.status === 'error' ? 'Нет связи с сервером.' : st.status === 'connecting' ? 'Подключаюсь…' : 'Нужен интернет.'}</small>${st.status === 'error' && st.error ? `<small class="fr-err">${esc(st.error)}</small>` : ''}</div>
        ${st.status !== 'connecting' ? '<button data-fr-retry aria-label="Ещё раз">🔄</button>' : ''}</div>`;
    }
    const person = (f, extra) => `<div class="fr-person"><span class="fr-ava${f.online ? ' on' : ''}"><img src="${avatarFromLook(f.look, f.bg)}" alt=""></span><b>${esc(f.nick || '…')}</b>${extra}</div>`;
    return `<div class="st-friends st-friends-on">
      <div class="fr-code"><span>🤝</span><div><small>Мой код дружбы</small><b>${esc(st.code)}</b></div><button data-fr-copy aria-label="Скопировать">📋</button></div>
      ${st.requests.length ? `<div class="fr-list fr-req">${st.requests.map((f) => person(f, `<button class="fr-yes" data-fr-accept="${esc(f.id)}" aria-label="Дружить">✓</button><button class="fr-no" data-fr-decline="${esc(f.id)}" aria-label="Нет">✗</button>`)).join('')}</div>` : ''}
      <div class="fr-list">${st.friends.map((f) => person(f, `<button class="fr-visit" data-fr-visit="${esc(f.id)}"${f.online ? '' : ' disabled'} aria-label="В гости">🏠</button><button class="fr-del" data-fr-remove="${esc(f.id)}" aria-label="Убрать из друзей">×</button>`)).join('') || '<p class="fr-empty">Пока нет друзей</p>'}</div>
      ${adding ? `<div class="fr-add"><input data-fr-code maxlength="12" placeholder="ABCD-2345" autocomplete="off" autocapitalize="characters"><button class="primary" data-fr-send>Отправить</button></div>${addMsg ? `<p class="fr-msg">${esc(addMsg)}</p>` : ''}`
        : '<button class="fr-addbtn" data-fr-add>➕ Добавить друга</button>'}
    </div>`;
  }

  // Родительский замок: держать 3 секунды → действие.
  function askGate(action) { gate = action; render(); }
  function bindGate() {
    const b = el.querySelector('[data-st-gate]'); if (!b) return;
    let t = 0;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('holding'); t = setTimeout(() => { const a = gate; gate = null; play('pop'); render(); a?.(); }, GATE_MS); });
    const stop = () => { clearTimeout(t); b.classList.remove('holding'); };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  }
  const ADD_MSG = { sent: 'Запрос отправлен — друг увидит его у себя', friends: 'Готово — вы друзья!', already: 'Вы уже друзья', self: 'Это твой собственный код', nocode: 'Такого кода нет', bad: 'Код — 8 букв и цифр, например ABCD-2345' };
  async function frAction(d) {
    try {
      if (d.frRetry !== undefined) { friends.start(); return; }
      if (d.frCopy !== undefined) { try { await navigator.clipboard.writeText(friends.state.code); toast('Код скопирован'); } catch (e) { toast('Код: ' + friends.state.code); } return; }
      if (d.frAdd !== undefined) return askGate(() => { adding = true; addMsg = ''; render(); el.querySelector('[data-fr-code]')?.focus(); });
      if (d.frSend !== undefined) { const r = await friends.add(el.querySelector('[data-fr-code]').value); addMsg = ADD_MSG[r] || ''; if (r === 'sent' || r === 'friends') { adding = false; toast(addMsg); play('ding'); } else play('nope'); render(); return; }
      if (d.frAccept) return askGate(async () => { await friends.accept(d.frAccept); play('yum'); });
      if (d.frDecline) { await friends.decline(d.frDecline); play('click'); return; }
      if (d.frRemove) return askGate(async () => { await friends.remove(d.frRemove); play('stash'); });
      if (d.frVisit) { if (!visit) return; toast('Идём в гости…'); play('whoosh'); close(); await visit.join(d.frVisit); }
    } catch (e) { toast('Не получилось: ' + (e?.message || e), true); }
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === el) close(); return; } // нажали мимо карточки — закрыть
    const d = b.dataset;
    if (d.stClose !== undefined) return close();
    if (d.stGatecancel !== undefined) { gate = null; render(); return; }
    if (Object.keys(d).some((k) => k.startsWith('fr'))) { frAction(d); return; }
    if (d.stNick !== undefined) { askGate(() => { naming = true; nickMsg = ''; render(); const i = el.querySelector('[data-st-nickin]'); i?.focus(); i?.select(); }); return; }
    else if (d.stNicksave !== undefined) {
      const n = cleanNick(el.querySelector('[data-st-nickin]').value);
      if (!n) { nickMsg = 'Имя — от 2 до 16 букв или цифр (без ссылок и телефонов)'; play('nope'); render(); return; }
      setProfile({ nick: n }); naming = false; nickMsg = ''; play('yum');
    }
    else if (d.stFace) { setProfile({ face: d.stFace }); play('boing'); }
    else if (d.stBg) { setProfile({ bg: d.stBg }); play('click'); }
    else if (d.stSound !== undefined) { setSound(!soundOn()); play('pop'); }
    else if (d.stVibro !== undefined) setVibro(!vibroOn());
    else return;
    render(); onChange?.(); friends?.updateProfile();
  });

  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-st-nickin]')) el.querySelector('[data-st-nicksave]')?.click(); if (e.key === 'Enter' && e.target.matches('[data-fr-code]')) el.querySelector('[data-fr-send]')?.click(); });
  function open() { render(); el.hidden = false; play('pop'); if (friends && friends.state.status !== 'on') friends.start(); }
  function close() { el.hidden = true; gate = null; adding = false; naming = false; play('click'); }
  // Друзья обновились (пришёл запрос, друг вышел в сеть) — перерисовать, если открыто и не идёт ввод кода.
  function refresh() { if (!el.hidden && !gate && !naming && !(adding && document.activeElement?.matches?.('[data-fr-code]'))) render(); }
  return { open, close, refresh, setVisit(v) { visit = v; }, get isOpen() { return !el.hidden; } };
}
