// Магазин в игре: большие карточки паков (обложка, вещи, значок цены), без чтения.
// Платное — только через «родительский замок» (держать кнопку 3 секунды), затем покупка
// (сейчас ТЕСТОВАЯ, без денег). Скачанный пак сразу в «Вещах», новые вещи — со звёздочкой.
import { loadCatalog, getCatalog, isOffline, status, buy, download, TEST_PURCHASES, STORE_BASE } from '../core/shop.js';
import { escapeHtml as esc } from '../util.js';
import { play } from '../audio.js';

const GATE_MS = 3000;

export function createShop({ root, onInstalled, openThings }) {
  const el = document.createElement('section');
  el.className = 'shop'; el.hidden = true;
  el.setAttribute('aria-label', 'Магазин');
  el.innerHTML = `
    <header class="shop-head"><b class="shop-title">🛍️</b><span class="shop-off" hidden title="Нет сети — показаны паки, известные игре">📶✕</span><button class="close" data-sh-close aria-label="Закрыть">×</button></header>
    <div class="shop-grid"></div>
    <div class="shop-detail" hidden></div>
    <div class="shop-gate" hidden>
      <p>Для взрослых: <b>держи кнопку 3 секунды</b></p>
      <button class="gate-btn" data-gate aria-label="Держать 3 секунды"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="gate-track"/><circle cx="50" cy="50" r="44" class="gate-ring"/></svg><span>✋</span></button>
      <button class="gate-cancel" data-gate-cancel>Отмена</button>
    </div>
    <div class="shop-pay" hidden></div>`;
  root.appendChild(el);
  const q = (s) => el.querySelector(s);
  const grid = q('.shop-grid'), detail = q('.shop-detail'), gate = q('.shop-gate'), pay = q('.shop-pay');
  let current = null, busy = false;

  const badge = (p) => {
    const st = status(p);
    if (st === 'installed') return '<i class="sh-badge ok">✓</i>';
    if (st === 'update') return '<i class="sh-badge get">⟳</i>';
    if (st === 'get') return '<i class="sh-badge get">⬇️</i>';
    return `<i class="sh-badge buy">🔒 ${esc(p.priceLabel)}</i>`;
  };

  function renderGrid() {
    const c = getCatalog();
    q('.shop-off').hidden = !isOffline();
    grid.innerHTML = (c?.packs || []).map((p) => `<button class="sh-card" data-sh-pack="${esc(p.id)}" aria-label="${esc(p.name)}">
        <img src="${p.cover}" alt="">${badge(p)}${p.slides?.length ? `<i class="sh-count">${'●'.repeat(Math.min(6, p.slides.length + 1))}</i>` : ''}<span class="sh-name">${esc(p.name)}</span></button>`).join('')
      || '<p class="sh-empty">⏳</p>';
  }

  function renderDetail() {
    const p = current; if (!p) { detail.hidden = true; return; }
    const st = status(p);
    const action = st === 'installed' ? `<button class="sh-act ok" data-sh-open aria-label="К вещам">✓ 🧺</button>`
      : st === 'buy' ? `<button class="sh-act buy" data-sh-buy>🔒 ${esc(p.priceLabel)}</button>`
      : `<button class="sh-act get" data-sh-get>${st === 'update' ? '⟳' : '⬇️'}</button>`;
    // Фон страницы пака (цвет и/или картинка с GitHub; без сети — только цвет).
    const page = p.page || {};
    detail.style.backgroundColor = page.color || '';
    detail.style.backgroundImage = page.image ? `url("${STORE_BASE}${page.image}")` : '';
    detail.classList.toggle('has-bg', !!(page.image || page.color));
    detail.innerHTML = `<button class="sh-back" data-sh-back aria-label="Назад">←</button>
      ${carousel(p)}
      <div class="sh-strip" role="list">${(p.preview || []).map((src, k) => `<button class="sh-thing" data-sh-thing role="listitem" style="animation-delay:${(k % 6) * 0.15}s"><img src="${src}" alt=""></button>`).join('')}</div>
      <div class="sh-row"><b>${esc(p.name)}</b>${action}</div>`;
    detail.hidden = false;
  }

  // Слайды пака: обложка + картинки «что внутри», листаются пальцем вправо-влево; точки — какой сейчас.
  function carousel(p) {
    const list = [p.cover, ...(p.slides || []).map((s) => STORE_BASE + s)];
    const many = list.length > 1;
    return `<div class="sh-carousel${many ? ' many' : ''}">
      ${many ? '<button class="sh-arrow l" data-sh-slide="-1" aria-label="Назад">‹</button>' : ''}
      <div class="sh-slides">${list.map((src) => `<img class="sh-slide" src="${src}" alt="" draggable="false">`).join('')}</div>
      ${many ? '<button class="sh-arrow r" data-sh-slide="1" aria-label="Дальше">›</button>' : ''}
      ${many ? `<div class="sh-dots">${list.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    </div>`;
  }
  // Точки следуют за прокруткой слайдов.
  detail.addEventListener('scroll', (e) => {
    const box = e.target.closest?.('.sh-slides'); if (!box) return;
    const k = Math.round(box.scrollLeft / Math.max(1, box.clientWidth));
    detail.querySelectorAll('.sh-dots i').forEach((d, i) => d.classList.toggle('on', i === k));
  }, true);

  async function open() {
    el.hidden = false; requestAnimationFrame(() => el.classList.add('open'));
    root.closest('#app')?.classList.add('shopping');
    play('open');
    current = null; detail.hidden = true; gate.hidden = true; pay.hidden = true;
    if (!getCatalog()) { renderGrid(); await loadCatalog(); } else loadCatalog().then(() => { if (!el.hidden && !current) renderGrid(); });
    renderGrid();
  }
  function close() {
    el.classList.remove('open'); root.closest('#app')?.classList.remove('shopping');
    setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 250);
    play('close');
  }

  async function getPack() {
    if (busy) return; busy = true;
    const btn = q('[data-sh-get]'); if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
    try {
      await download(current);
      play('yum'); onInstalled?.();
      detail.classList.remove('tada'); void detail.offsetWidth; detail.classList.add('tada');
    } catch (e) { play('nope'); if (btn) { btn.textContent = '📶✕'; } }
    busy = false;
    renderDetail(); renderGrid();
  }

  // Родительский замок: держать кнопку 3 секунды.
  let gateTimer = 0;
  const gateBtn = q('[data-gate]');
  gateBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); gateBtn.classList.add('holding');
    gateTimer = setTimeout(() => { gateBtn.classList.remove('holding'); gate.hidden = true; play('pop'); showPay(); }, GATE_MS);
  });
  const stopGate = () => { clearTimeout(gateTimer); gateBtn.classList.remove('holding'); };
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) gateBtn.addEventListener(ev, stopGate);

  function showPay() {
    pay.innerHTML = `<div class="pay-box">
        <p class="pay-note">${TEST_PURCHASES ? 'Тестовая покупка — деньги не списываются' : 'Покупка'}</p>
        <img src="${current.cover}" alt=""><b>${esc(current.name)}</b><p class="pay-price">${esc(current.priceLabel)}</p>
        <div class="pay-btns"><button class="primary" data-pay-ok>Купить</button><button data-pay-no>Отмена</button></div></div>`;
    pay.hidden = false;
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t || !el.contains(t)) return;
    e.stopPropagation();
    const d = t.dataset;
    if (d.shClose !== undefined) return close();
    if (d.shPack) { current = getCatalog().packs.find((p) => p.id === d.shPack); play('pop'); renderDetail(); return; }
    if (d.shSlide) { const box = detail.querySelector('.sh-slides'); box?.scrollBy({ left: Number(d.shSlide) * box.clientWidth, behavior: 'smooth' }); play('click'); return; }
    if (d.shThing !== undefined) { t.classList.remove('boing'); void t.offsetWidth; t.classList.add('boing'); play('pop'); return; } // вещь в паке отзывается
    if (d.shBack !== undefined) { current = null; detail.hidden = true; play('click'); renderGrid(); return; }
    if (d.shGet !== undefined) return getPack();
    if (d.shBuy !== undefined) { gate.hidden = false; play('click'); return; }
    if (d.gateCancel !== undefined) { gate.hidden = true; stopGate(); return; }
    if (d.payNo !== undefined) { pay.hidden = true; return; }
    if (d.payOk !== undefined) { pay.hidden = true; try { await buy(current); play('pop'); } catch (err) { play('nope'); return; } return getPack(); }
    if (d.shOpen !== undefined) { close(); openThings?.(); }
  });

  return { open, close, get isOpen() { return !el.hidden; }, toggle() { if (el.hidden) open(); else close(); } };
}
