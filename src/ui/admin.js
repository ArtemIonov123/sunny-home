// Админка. Разделы: «Комнаты» (порядок, ширина, добавить/убрать),
// «Разметка» (граница стены и пола, область движения), «Предметы» (свои предметы),
// «Данные» (резервная копия, счётчик экземпляров). Позже — «Рецепты».
import { ROOM_TYPES } from '../core/catalog.js';
import { isGiven } from '../core/access.js';
import { ROOM_WIDTHS, MAX_ROOMS, defaultState } from '../core/house.js';
import { escapeHtml as esc } from '../util.js';
import { validate } from '../save/migrate.js';
import { normalize } from '../core/actions.js';
import { createItemEditor } from './itemEditor.js';
import { createAnimalEditor } from './animalEditor.js';
import { createMapEditor } from './mapEditor.js';
import { listRecords, listPacks, makePack, listOverrides } from '../core/library.js';
import { resetShop, loadCatalog } from '../core/shop.js';
import { getSettings, saveSettings, hasToken, testToken, readCatalog, publishPack, sendGameUpdate, removePack, fetchStorePack, makeCover, COVER_COLORS } from '../core/publish.js';
import { importPack, saveOwnRecipe, deleteOwnRecipe } from '../core/library.js';
import { allRecipes, listOwnRecipes, BUILTIN_RECIPES, SOUNDS } from '../core/recipes.js';
import { allItemDefs, itemDef } from '../core/catalog.js';
import { isSmall } from '../core/physics.js';
import { img } from '../assets.js';

const STORE_RAW = 'https://raw.githubusercontent.com/ArtemIonov123/sunny-home/main/store/';

export function createAdmin({ root, store, camera, actions, toast, onChange }) {
  const el = document.createElement('section');
  el.className = 'admin-sheet';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Админка');
  root.append(el);
  let tab = 'rooms', isOpen = false, storageNote = '';
  const items = createItemEditor({ store, actions, toast, onChange });
  items.bind(el);
  const animals = createAnimalEditor({ store, actions, toast, onChange });
  animals.bind(el);
  const mapEd = createMapEditor({ toast });
  mapEd.bind(el);

  const open = () => { isOpen = true; el.hidden = false; render(); onChange(); };
  const close = () => { isOpen = false; el.hidden = true; onChange(); };

  function roomsTab() {
    const rows = store.state.rooms.map((r, i, all) => {
      const lawn = r.type === 'lawn';
      const widths = Object.entries(ROOM_WIDTHS).map(([w, n]) => `<option value="${w}"${Number(w) === r.width ? ' selected' : ''}>${n}</option>`).join('');
      return `<div class="adm-row" data-id="${esc(r.id)}">
        <span class="adm-num">${i + 1}</span>
        <input class="adm-name" value="${esc(r.name)}" maxlength="30" aria-label="Название комнаты">
        <small class="adm-type">${ROOM_TYPES[r.type].name}</small>
        <select class="adm-width" aria-label="Ширина"${lawn ? ' disabled' : ''}>${widths}</select>
        <button data-up${lawn || i <= 1 ? ' disabled' : ''} aria-label="Левее">←</button>
        <button data-down${lawn || i === all.length - 1 ? ' disabled' : ''} aria-label="Правее">→</button>
        <button data-show aria-label="Показать">👁</button>
        <button data-del class="danger"${lawn ? ' disabled' : ''} aria-label="Убрать комнату">×</button>
      </div>`;
    }).join('');
    const types = Object.entries(ROOM_TYPES).filter(([t, d]) => t !== 'lawn' && !d.place).map(([t, d]) => `<option value="${t}">${d.name}</option>`).join('');
    return `<p class="adm-help">Порядок слева направо. Лужайка всегда первая — через неё вход. Вещи едут вместе со своей комнатой.</p>
      <div class="adm-list">${rows}</div>
      <div class="adm-add"><select class="adm-type-new">${types}</select><button data-addroom class="primary"${store.state.rooms.length >= MAX_ROOMS ? ' disabled' : ''}>+ Добавить комнату</button></div>`;
  }

  function markupTab() {
    const r = actions.roomInView()?.room;
    if (!r) return '';
    if (ROOM_TYPES[r.type].outdoor) return `<p class="adm-help">Сейчас на экране «${esc(r.name)}». Пролистай дом к комнате, разметку которой хочешь изменить.</p>`;
    return `<p class="adm-help">Комната на экране: <b>${esc(r.name)}</b>. Линии видны на сцене: коричневая — граница стены и пола, зелёная — откуда начинают ходить герои.</p>
      <label class="adm-field">Граница пола · <b>${Math.round(r.split * 100)}%</b><input type="range" data-split min="42" max="70" value="${Math.round(r.split * 100)}"></label>
      <label class="adm-field">Начало движения героев · <b>${Math.round(r.walkTop * 100)}%</b><input type="range" data-walk min="46" max="88" value="${Math.round(r.walkTop * 100)}"></label>
      <p class="adm-help">Вещи и герои сами прижмутся к новым границам.</p>`;
  }

  // «Паки»: собрать из своих предметов пак-файл. Файл пака кладётся в папку packs/ — и он в игре.
  let packName = '', packPick = new Set(), packPrice = 0;
  // Магазин в студии: ключ GitHub, собрать пак, опубликовать, список паков в магазине.
  let storeCat = null, storeNote = '', storeBusy = '', target = '', showKey = !hasToken();
  let ghDraft = null; // набранное в полях ключа (переживает перерисовку панели)
  let coverStyle = {}; // фон обложки пака: { color } | { bg } | { full }
  let pageStyle = {};  // фон страницы пака в магазине: { color, image }
  let slides = [];     // слайды-обложки «что внутри» (картинки), листаются в магазине
  // Картинка для фона: без вырезания розового, только уменьшить (до 960×600) — фон должен быть цельным.
  async function bgImage(file) {
    if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) throw new Error('Выбери PNG, WebP или JPG');
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Не удалось открыть файл')); r.readAsDataURL(file); });
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Картинка не открылась')); i.src = url; });
    const max = arguments[1] || [960, 600], s = Math.min(1, max[0] / im.width, max[1] / im.height), cv = document.createElement('canvas');
    cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/webp', 0.85);
  }
  let coverTimer = 0;
  function drawCoverPreview() {
    clearTimeout(coverTimer);
    coverTimer = setTimeout(async () => {
      const imgs = el.querySelectorAll('[data-cover-preview]'); if (!imgs.length) return;
      const items = [...allItemDefs().filter((d) => d.builtin && d.animal && packPick.has(d.id)).map((d) => ({ image: img(d.art)?.src })), ...listRecords().filter((r) => packPick.has(r.id))];
      try { const src = await makeCover(items, 0, coverStyle); for (const im of imgs) im.src = src; } catch (e) { /* пропуск */ }
    }, 60);
  }
  async function refreshStore() {
    storeNote = '';
    try { storeCat = hasToken() ? (await readCatalog()).cat : await loadCatalog(); }
    catch (e) { storeCat = null; storeNote = e.message; }
    if (tab === 'packs') render();
  }
  function packsTab() {
    if (storeCat === null && !storeNote) refreshStore();
    const recs = listRecords(), built = listPacks(), gs = getSettings(), ovs = listOverrides().length;
    // Встроенные животные тоже можно положить в пак (если их не выдают всем — пак их «откроет»).
    const pets = allItemDefs().filter((d) => d.builtin && d.animal).map((d) => `<label class="pk-item"><input type="checkbox" data-pk="${esc(d.id)}"${packPick.has(d.id) ? ' checked' : ''}><img src="${img(d.art)?.src || ''}" alt=""><span>${esc(d.name)}${isGiven(d.id) ? '' : ' 🔒'}</span></label>`).join('');
    const items = recs.length || pets ? pets + recs.map((r) => `<label class="pk-item"><input type="checkbox" data-pk="${esc(r.id)}"${packPick.has(r.id) ? ' checked' : ''}><img src="${r.image}" alt=""><span>${esc(r.name)}</span></label>`).join('')
      : '<p class="adm-help">Своих предметов пока нет — создай их во вкладке «Предметы».</p>';
    const keyBox = showKey ? `<div class="pk-key">
        <p class="adm-help"><b>Ключ GitHub для публикации.</b> Создаётся один раз: GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token. Repository access: <b>Only select repositories</b> → ${esc(gs.repo.split('/')[1] || 'sunny-home')}. Permissions → Repository permissions → <b>Contents: Read and write</b>. Скопируй ключ (начинается с github_pat_) и вставь сюда. Ключ хранится только в этом браузере — не выкладывай studio.html в интернет.</p>
        <label class="adm-field">Репозиторий<input type="text" data-gh-repo value="${esc(ghDraft?.repo ?? gs.repo)}"></label>
        <label class="adm-field">Ключ<input type="password" data-gh-token value="${esc(ghDraft?.token ?? gs.token)}" placeholder="github_pat_…" autocomplete="off"></label>
        <div class="adm-buttons"><button data-gh-save class="primary">Проверить и сохранить</button>${gs.token ? '<button data-gh-cancel>Отмена</button>' : ''}</div></div>`
      : `<p class="adm-help">Публикация: ✓ ключ подключён (${esc(gs.repo)}). <button class="link" data-gh-change>Сменить ключ</button></p>`;
    const targets = (storeCat?.packs || []).map((p) => `<option value="${esc(p.id)}"${p.id === target ? ' selected' : ''}>Обновить: ${esc(p.name)}</option>`).join('');
    const shopList = storeCat?.packs?.length ? storeCat.packs.map((p) => `<div class="pk-shop" data-sid="${esc(p.id)}"><img src="${p.cover}" alt=""><div><b>${esc(p.name)}</b><small>${p.priceLabel || 'бесплатно'} · вещей: ${p.items} · версия ${p.version}${p.price ? ` · ID в Google Play: ${esc(p.product)}` : ''}</small></div>
        <button data-sp-load title="Загрузить вещи пака в студию">↓ В студию</button>${hasToken() ? '<button data-sp-del class="danger" title="Убрать из магазина">Убрать</button>' : ''}</div>`).join('')
      : `<p class="adm-help">${storeNote ? esc(storeNote) : storeCat ? 'В магазине пока пусто.' : 'Загружаю…'}</p>`;
    return `<h4>Магазин</h4>${keyBox}
      <h4>Собрать пак</h4>
      <label class="adm-field">Пак<select data-pktarget><option value="">＋ Новый пак</option>${targets}</select></label>
      <label class="adm-field">Название пака<input type="text" data-pkname maxlength="40" value="${esc(packName)}" placeholder="Например: Пляж"></label>
      <label class="adm-field">Цена, zł (0 — бесплатно)<input type="number" data-pkprice min="0" max="500" step="0.01" value="${packPrice}"></label>
      <div class="pk-grid">${items}</div>
      ${ovs ? `<p class="adm-help">Правки встроенных предметов (${ovs}) тоже войдут в пак.</p>` : ''}
      <h4>Обложка пака</h4>
      <div class="pk-cover">
        <img data-cover-preview alt="Обложка">
        <div class="pk-cover-opts">
          <p class="adm-help">Фон: цвет, своя картинка (вещи пака встанут поверх) или своя обложка целиком (картинка от GPT 16:10, например 960×600).</p>
          <div class="swatches">${COVER_COLORS.map((c) => `<button class="swatch${coverStyle.color === c && !coverStyle.bg && !coverStyle.full ? ' on' : ''}" style="--c:${c}" data-cover-color="${c}" aria-label="${c}"></button>`).join('')}</div>
          <div class="adm-buttons">
            <label class="file-btn">🖼 Свой фон<input type="file" accept="image/png,image/webp,image/jpeg" data-cover-bg hidden></label>
            <label class="file-btn">🎨 Обложка целиком<input type="file" accept="image/png,image/webp,image/jpeg" data-cover-full hidden></label>
            ${coverStyle.bg || coverStyle.full || coverStyle.color ? '<button data-cover-reset>Как было (авто)</button>' : ''}
          </div>
        </div>
      </div>
      <h4>Слайды «что внутри» (${slides.length} из 10)</h4>
      <p class="adm-help">Картинки, которые ребёнок листает вправо-влево на странице пака: 1-я — обложка, дальше твои слайды (например, комната с вещами пака). Горизонтальные 16:10.</p>
      <div class="pk-slides">
        <figure class="pk-slide"><img data-cover-preview alt=""><figcaption>1 · обложка</figcaption></figure>
        ${slides.map((src, k) => `<figure class="pk-slide"><img src="${src}" alt=""><figcaption>${k + 2}
          <button data-slide-left="${k}"${k ? '' : ' disabled'} aria-label="Левее">←</button><button data-slide-right="${k}"${k < slides.length - 1 ? '' : ' disabled'} aria-label="Правее">→</button><button data-slide-del="${k}" aria-label="Убрать">×</button></figcaption></figure>`).join('')}
        ${slides.length < 10 ? '<label class="pk-slide add"><span>＋</span><input type="file" accept="image/png,image/webp,image/jpeg" data-slide-add multiple hidden></label>' : ''}
      </div>
      <h4>Фон страницы пака в магазине</h4>
      <div class="pk-cover">
        <div class="pk-page" style="background-color:${pageStyle.color || '#fff6e4'};${pageStyle.image ? `background-image:url(${pageStyle.image})` : ''}"><span>🧸 🦆 🍎</span></div>
        <div class="pk-cover-opts">
          <p class="adm-help">То, что ребёнок видит за вещами, когда открывает пак: цвет или картинка от GPT (горизонтальная, например 1280×800).</p>
          <div class="swatches">${COVER_COLORS.map((c) => `<button class="swatch${pageStyle.color === c ? ' on' : ''}" style="--c:${c}" data-page-color="${c}" aria-label="${c}"></button>`).join('')}</div>
          <div class="adm-buttons"><label class="file-btn">🖼 Картинка-фон<input type="file" accept="image/png,image/webp,image/jpeg" data-page-image hidden></label>${pageStyle.color || pageStyle.image ? '<button data-page-reset>Без фона</button>' : ''}</div>
        </div>
      </div>
      <div class="adm-buttons"><button data-pkall>Отметить все</button>
        <button data-pkpublish class="primary"${(packPick.size || ovs) && hasToken() && !storeBusy ? '' : ' disabled'}>🚀 ${target ? 'Обновить в магазине' : 'Опубликовать в магазин'}</button>
        <button data-pkexport${packPick.size || ovs ? '' : ' disabled'}>↓ Скачать файл</button></div>
      ${storeBusy ? `<p class="adm-help"><b>⏳ ${esc(storeBusy)}</b></p>` : ''}
      <p class="adm-help">После публикации пак появится в магазине у всех игроков через 1–5 минут (GitHub обновляет файлы не сразу). Платный пак: в Google Play Console создать товар с ID <b>pack_&lt;id пака&gt;</b> (видно ниже) — понадобится, когда будет APK. Покупки сейчас тестовые.</p>
      <h4>В магазине сейчас <button class="link" data-sp-refresh>обновить</button></h4>
      <div class="pk-shoplist">${shopList}</div>
      <div class="adm-buttons"><button data-shopreset>Сбросить тестовые покупки</button></div>
      <h4>Паки внутри игры</h4>
      ${built.length ? `<ul class="pk-list">${built.map((p) => `<li><b>${esc(p.name)}</b> · предметов: ${p.count}${p.fixes ? ` · правок: ${p.fixes}` : ''}</li>`).join('')}</ul>` : '<p class="adm-help">Пока нет.</p>'}`;
  }

  // ── «Рецепты»: прибор + продукты → что получится ──
  let rc = null; // черновик рецепта { id, machine, inputs, outputs, time, sound } или null (список)
  const pic = (id) => { const d = itemDef(id); return d ? `<img src="${img(d.art)?.src || ''}" alt="" title="${esc(d.name)}">` : '❓'; };
  function recipeRow(r, mine) {
    return `<div class="rc-row">
      <span class="rc-in">${r.inputs.map(pic).join('<i>+</i>')}</span><i>→</i><span class="rc-m">${pic(r.machine)}</span><i>→</i><span class="rc-out">${r.outputs.map(pic).join('')}</span>
      <small>${r.time} с · ${esc(SOUNDS[r.sound] || '')}</small>
      ${mine ? `<button data-rc-edit="${esc(r.id)}">✎</button><button data-rc-del="${esc(r.id)}" class="danger">×</button>` : '<small class="rc-b">встроенный</small>'}
    </div>`;
  }
  function recipesTab() {
    if (rc) return recipeForm();
    const mine = listOwnRecipes(), mineIds = new Set(mine.map((r) => r.id));
    const active = allRecipes();
    return `<p class="adm-help">Рецепт: положи продукты на прибор (в блендер, на плиту, в тостер — туда, где у прибора «полка»), нажми на прибор — он поработает и выдаст результат. Свои рецепты входят в пак (вкладка «Паки»).</p>
      <div class="adm-buttons"><button data-rc-new class="primary">＋ Новый рецепт</button></div>
      <h4>Свои рецепты (${mine.length})</h4>
      ${mine.length ? mine.map((r) => recipeRow(r, true)).join('') : '<p class="adm-help">Пока нет.</p>'}
      <h4>Встроенные</h4>
      ${BUILTIN_RECIPES.map((r) => recipeRow(r, false)).join('')}
      <p class="adm-help">Работает сейчас рецептов: ${active.length}. Свой рецепт с тем же прибором и продуктами заменяет встроенный.</p>`;
  }
  function recipeForm() {
    const defs = allItemDefs();
    const machines = defs.filter((d) => d.surfaces?.length || d.group === 'appliances').sort((a, b) => (b.group === 'appliances') - (a.group === 'appliances'));
    const smalls = defs.filter((d) => isSmall(d)).sort((a, b) => (b.group === 'food') - (a.group === 'food')); // мелочь, еда — первой
    const m = itemDef(rc.machine);
    const chips = (list, kind) => list.map((id, k) => `<span class="rc-chip">${pic(id)}<button data-rc-x="${kind}:${k}" aria-label="Убрать">×</button></span>`).join('');
    const picker = (kind) => `<div class="rc-pick">${smalls.map((d) => `<button data-rc-add="${kind}:${esc(d.id)}" title="${esc(d.name)}"><img src="${img(d.art)?.src || ''}" alt=""></button>`).join('')}</div>`;
    return `<div class="adm-buttons"><button data-rc-back>← Все рецепты</button></div>
      <label class="adm-field">Прибор<select data-rc-machine>${machines.map((d) => `<option value="${esc(d.id)}"${d.id === rc.machine ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      ${m && !m.surfaces?.length ? '<p class="adm-help warn">У этого прибора нет «полки» для продуктов — результат появится рядом на полу. Полку можно нарисовать: «Предметы» → прибор → «Оживить» → «✏️ Полка».</p>' : ''}
      <h4>Продукты (${rc.inputs.length} из 4)</h4>
      <div class="rc-chips">${chips(rc.inputs, 'in') || '<small>нажми на продукты ниже</small>'}</div>
      ${rc.inputs.length < 4 ? picker('in') : ''}
      <h4>Что получится (${rc.outputs.length} из 3)</h4>
      <div class="rc-chips">${chips(rc.outputs, 'out') || '<small>нажми на вещи ниже</small>'}</div>
      ${rc.outputs.length < 3 ? picker('out') : ''}
      <div class="lv-row">
        <label class="adm-field">Сколько работает · <b>${rc.time} с</b><input type="range" data-rc-time min="1" max="8" step="0.5" value="${rc.time}"></label>
        <label class="adm-field">Звук<select data-rc-sound>${Object.entries(SOUNDS).map(([k, n]) => `<option value="${k}"${k === rc.sound ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="rc-row big"><span class="rc-in">${rc.inputs.map(pic).join('<i>+</i>') || '…'}</span><i>→</i><span class="rc-m">${pic(rc.machine)}</span><i>→</i><span class="rc-out">${rc.outputs.map(pic).join('') || '…'}</span></div>
      <div class="adm-buttons"><button data-rc-save class="primary">Сохранить рецепт</button></div>`;
  }

  function dataTab() {
    const c = actions.counts();
    return `<p class="adm-help">${esc(storageNote || 'Дом сохраняется на этом устройстве автоматически.')}</p>
      <p class="adm-help"><b>Вещей всего: ${c.total}</b> · в доме ${c.placed} · в шкафчике ${c.inventory}${c.missing ? ` · спрятано (нет предмета в библиотеке): ${c.missing}` : ''}</p>
      <div class="adm-buttons">
        <button data-export class="primary">↓ Скачать резервную копию (JSON)</button>
        <button data-import>↑ Загрузить из файла</button>
        <button data-reset class="danger">Начать дом заново</button>
      </div>
      <input type="file" accept="application/json,.json" data-file hidden>`;
  }

  // «📤 В игру»: правки встроенных, свои рецепты и животные — всем игрокам (через магазин на GitHub).
  let sending = false;
  async function sendUpdate() {
    sending = true; render();
    try {
      const n = await sendGameUpdate();
      toast(`Отправлено игрокам: правок ${n.overrides}, рецептов ${n.recipes}, животных ${n.items}, районов карты ${n.zones}. В игре появится через 1–5 минут (после перезапуска игры)`);
    } catch (e) { toast(e.message, true); }
    sending = false; render();
  }
  // Вкладки: на компьютере прокрутка колесом и перетаскиванием мышью (полосы прокрутки нет).
  let navDrag = null;
  el.addEventListener('wheel', (e) => {
    const nav = e.target.closest?.('header nav'); if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX; e.preventDefault();
  }, { passive: false });
  el.addEventListener('pointerdown', (e) => { const nav = e.target.closest?.('header nav'); if (nav && e.pointerType === 'mouse') navDrag = { nav, x: e.clientX, s: nav.scrollLeft, moved: false }; });
  window.addEventListener('pointermove', (e) => { if (!navDrag) return; const dx = e.clientX - navDrag.x; if (Math.abs(dx) > 5) navDrag.moved = true; navDrag.nav.scrollLeft = navDrag.s - dx; });
  window.addEventListener('pointerup', () => { if (navDrag?.moved) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; el.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 50); } navDrag = null; });

  function render() {
    if (!isOpen) return;
    const tabs = { rooms: 'Комнаты', markup: 'Разметка', items: 'Предметы', animals: 'Животные', recipes: 'Рецепты', map: 'Карта', packs: 'Паки', data: 'Данные' };
    const navX = el.querySelector('header nav')?.scrollLeft || 0; // перерисовка не должна сбрасывать прокрутку вкладок
    el.innerHTML = `<header><b>Админка</b>
        <nav>${Object.entries(tabs).map(([k, n]) => `<button class="tab${tab === k ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('')}</nav>
        <button class="adm-send" data-send${hasToken() && !sending ? '' : ' disabled'} title="${hasToken() ? 'Отправить правки, рецепты и животных всем игрокам' : 'Нужен ключ GitHub (Паки → публикация)'}">${sending ? '⏳' : '📤 В игру'}</button>
        <button class="close" data-x aria-label="Закрыть">×</button></header>
      <div class="adm-body">${tab === 'rooms' ? roomsTab() : tab === 'markup' ? markupTab() : tab === 'items' ? '<div class="items-tab"></div>' : tab === 'animals' ? '<div class="animals-tab"></div>' : tab === 'map' ? '<div class="map-tab"></div>' : tab === 'packs' ? packsTab() : tab === 'recipes' ? recipesTab() : dataTab()}</div>`;
    const nav = el.querySelector('header nav'); if (nav) nav.scrollLeft = navX;
    if (tab === 'items') items.mount(el.querySelector('.items-tab'));
    if (tab === 'animals') animals.mount(el.querySelector('.animals-tab'));
    if (tab === 'map') mapEd.mount(el.querySelector('.map-tab'));
    if (tab === 'packs') drawCoverPreview();
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.closest('.items-tab') || b.closest('.animals-tab') || b.closest('.map-tab')) return; // «Предметы» обрабатывает свой модуль
    const id = b.closest('.adm-row')?.dataset.id;
    if (b.dataset.x !== undefined) { if (items.dirty && tab === 'items') toast('Черновик предмета сохранится до следующего открытия админки'); return close(); }
    if (b.dataset.send !== undefined) { sendUpdate(); return; }
    if (b.dataset.tab) { tab = b.dataset.tab; render(); onChange(); return; }
    if (b.dataset.up !== undefined) actions.moveRoom(id, -1);
    else if (b.dataset.down !== undefined) actions.moveRoom(id, 1);
    else if (b.dataset.show !== undefined) { const r = store.layout.byId.get(id); camera.flyTo(r.x0 + r.room.width / 2 - camera.viewW / 2); }
    else if (b.dataset.del !== undefined) {
      const room = store.state.rooms.find((r) => r.id === id);
      if (!confirm(`Убрать комнату «${room.name}»? Вещи из неё уйдут в шкафчик.`)) return;
      const res = actions.removeRoom(id);
      toast(res.ok ? 'Комната убрана' + (res.moved ? `, вещи (${res.moved}) ушли в шкафчик` : '') : res.reason, !res.ok);
    } else if (b.dataset.addroom !== undefined) {
      const res = actions.addRoom(el.querySelector('.adm-type-new').value);
      if (!res.ok) toast(res.reason, true);
      else { const r = store.layout.byId.get(res.id); camera.flyTo(r.x0); toast('Комната добавлена в конец дома'); }
    } else if (b.dataset.pkall !== undefined) { const all = listRecords().map((r) => r.id); packPick = packPick.size === all.length ? new Set() : new Set(all); }
    else if (b.dataset.ghSave !== undefined) {
      saveSettings({ repo: el.querySelector('[data-gh-repo]').value, token: el.querySelector('[data-gh-token]').value }); ghDraft = null;
      try { const name = await testToken(); showKey = false; toast('Ключ подходит: ' + name); storeCat = null; }
      catch (err) { toast(err.message, true); }
    }
    else if (b.dataset.coverColor) coverStyle = { color: b.dataset.coverColor };
    else if (b.dataset.coverReset !== undefined) coverStyle = {};
    else if (b.dataset.pageColor) pageStyle = { ...pageStyle, color: b.dataset.pageColor };
    else if (b.dataset.pageReset !== undefined) pageStyle = {};
    else if (b.dataset.slideDel !== undefined) slides.splice(Number(b.dataset.slideDel), 1);
    else if (b.dataset.slideLeft !== undefined || b.dataset.slideRight !== undefined) {
      const k = Number(b.dataset.slideLeft ?? b.dataset.slideRight), j = b.dataset.slideLeft !== undefined ? k - 1 : k + 1;
      if (j >= 0 && j < slides.length) [slides[k], slides[j]] = [slides[j], slides[k]];
    }
    else if (b.dataset.rcNew !== undefined) rc = { id: 'r' + Date.now().toString(36), machine: 'blender', inputs: [], outputs: [], time: 2, sound: 'buzz' };
    else if (b.dataset.rcBack !== undefined) rc = null;
    else if (b.dataset.rcEdit) rc = JSON.parse(JSON.stringify(listOwnRecipes().find((x) => x.id === b.dataset.rcEdit)));
    else if (b.dataset.rcDel) { if (!confirm('Удалить рецепт?')) return; await deleteOwnRecipe(b.dataset.rcDel); toast('Рецепт удалён'); }
    else if (b.dataset.rcAdd) { const [k, id] = b.dataset.rcAdd.split(':'); (k === 'in' ? rc.inputs : rc.outputs).push(id); }
    else if (b.dataset.rcX) { const [k, n] = b.dataset.rcX.split(':'); (k === 'in' ? rc.inputs : rc.outputs).splice(Number(n), 1); }
    else if (b.dataset.rcSave !== undefined) {
      try { await saveOwnRecipe(rc); toast('Рецепт сохранён — положи продукты на прибор и нажми на него'); rc = null; }
      catch (err) { toast(err.message, true); }
    }
    else if (b.dataset.ghCancel !== undefined) showKey = false;
    else if (b.dataset.ghChange !== undefined) showKey = true;
    else if (b.dataset.spRefresh !== undefined) { storeCat = null; storeNote = ''; }
    else if (b.dataset.pkpublish !== undefined) {
      try {
        const pack = makePack(packName, [...packPick], true, packPrice, target, coverStyle, pageStyle, slides);
        storeBusy = 'Публикую…'; render();
        const entry = await publishPack(pack, (step) => { storeBusy = step; render(); });
        storeBusy = ''; target = entry.id; storeCat = null;
        toast(`«${entry.name}» в магазине (версия ${entry.version}). У игроков — через 1–5 минут.`);
      } catch (err) { storeBusy = ''; toast(err.message, true); }
    }
    else if (b.dataset.spLoad !== undefined) {
      const id = b.closest('[data-sid]').dataset.sid;
      try {
        const raw = hasToken() ? await fetchStorePack(id) : await (await fetch(STORE_RAW + 'packs/' + id + '.json?t=' + Date.now())).json();
        const n = await importPack(raw);
        actions.restoreMissing();
        const entry = storeCat?.packs.find((p) => p.id === id);
        target = id; packName = entry?.name || ''; packPrice = entry?.price || 0;
        packPick = new Set([...(raw.items || []).map((i) => i.id), ...(raw.unlock || [])]);
        coverStyle = raw.coverStyle || {}; pageStyle = raw.pageStyle || {}; slides = raw.slides || [];
        toast(`Вещи пака загружены в студию: ${n}. Поправь и нажми «Обновить в магазине».`);
      } catch (err) { toast('Не удалось: ' + err.message, true); }
    }
    else if (b.dataset.spDel !== undefined) {
      const id = b.closest('[data-sid]').dataset.sid, entry = storeCat?.packs.find((p) => p.id === id);
      if (!confirm(`Убрать «${entry?.name || id}» из магазина? У тех, кто уже скачал, пак останется.`)) return;
      try { await removePack(id); storeCat = null; if (target === id) target = ''; toast('Пак убран из магазина'); }
      catch (err) { toast(err.message, true); }
    }
    else if (b.dataset.shopreset !== undefined) { await resetShop(); toast('Тестовые покупки сброшены — перезапусти игру'); }
    else if (b.dataset.pkexport !== undefined) {
      try {
        const pack = makePack(packName, [...packPick], true, packPrice, target, coverStyle, pageStyle, slides);
        download(JSON.stringify(pack), `pack_${pack.id}.json`);
        toast(`Пак «${pack.name}» скачан: ${pack.items.length} предм.` + (pack.overrides.length ? `, правок: ${pack.overrides.length}` : ''));
      } catch (err) { toast(err.message, true); }
    } else if (b.dataset.export !== undefined) exportJson();
    else if (b.dataset.import !== undefined) el.querySelector('[data-file]').click();
    else if (b.dataset.reset !== undefined) {
      if (!confirm('Начать дом заново? Это можно отменить кнопкой ↶.')) return;
      const s = validate(defaultState()); normalize(s); store.replace(s); camera.flyTo(0);
    }
    render(); onChange();
  });

  el.addEventListener('change', (e) => {
    const id = e.target.closest('.adm-row')?.dataset.id;
    if (e.target.matches('.adm-name')) actions.renameRoom(id, e.target.value);
    else if (e.target.matches('.adm-width')) actions.setWidth(id, Number(e.target.value));
    else if (e.target.matches('[data-file]')) return importJson(e.target);
    else if (e.target.matches('[data-pk]')) { if (e.target.checked) packPick.add(e.target.dataset.pk); else packPick.delete(e.target.dataset.pk); }
    else if (e.target.matches('[data-pkname]')) { packName = e.target.value; return; }
    else if (e.target.matches('[data-pkprice]')) { packPrice = Number(e.target.value) || 0; return; }
    else if (e.target.matches('[data-gh-token],[data-gh-repo]')) return;
    else if (e.target.matches('[data-rc-machine]')) rc.machine = e.target.value;
    else if (e.target.matches('[data-rc-sound]')) { rc.sound = e.target.value; return; }
    else if (e.target.matches('[data-rc-time]')) rc.time = Number(e.target.value); // не перерисовывать — иначе набранный ключ пропадёт до нажатия «Проверить»
    else if (e.target.matches('[data-slide-add]')) {
      const files = [...(e.target.files || [])].slice(0, 10 - slides.length); e.target.value = '';
      Promise.all(files.map((f) => bgImage(f, [960, 600]))).then((list) => { slides.push(...list); render(); }).catch((err) => toast(err.message, true));
      return;
    }
    else if (e.target.matches('[data-page-image]')) {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      bgImage(file, [1280, 800]).then((src) => { pageStyle = { ...pageStyle, image: src }; render(); }).catch((err) => toast(err.message, true));
      return;
    }
    else if (e.target.matches('[data-cover-bg],[data-cover-full]')) {
      const file = e.target.files?.[0], full = e.target.matches('[data-cover-full]'); e.target.value = '';
      if (!file) return;
      bgImage(file).then((src) => { coverStyle = full ? { full: src } : { ...(coverStyle.color ? { color: coverStyle.color } : {}), bg: src }; render(); })
        .catch((err) => toast(err.message, true));
      return;
    }
    else if (e.target.matches('[data-pktarget]')) {
      target = e.target.value;
      const entry = storeCat?.packs.find((p) => p.id === target);
      if (entry) { packName = entry.name; packPrice = entry.price || 0; }
    }
    else if (e.target.matches('[data-split],[data-walk]')) { render(); return; }
    else return;
    render(); onChange();
  });

  // Ползунки: живое изменение, один шаг отмены на всё движение.
  let sliding = false;
  el.addEventListener('pointerdown', (e) => { if (e.target.matches('[data-split],[data-walk]')) { store.checkpoint(); sliding = true; } });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('[data-split],[data-walk]')) return;
    const r = actions.roomInView()?.room; if (!r) return;
    const split = Number(el.querySelector('[data-split]').value) / 100, walk = Number(el.querySelector('[data-walk]').value) / 100;
    if (!sliding) store.checkpoint();
    sliding = true;
    actions.setMarkup(r.id, split, walk, { undo: false });
    const labels = el.querySelectorAll('.adm-field b');
    labels[0].textContent = Math.round(r.split * 100) + '%';
    labels[1].textContent = Math.round(r.walkTop * 100) + '%';
    onChange();
  });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-split],[data-walk]')) sliding = false; });
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-gh-token],[data-gh-repo]')) ghDraft = { repo: el.querySelector('[data-gh-repo]').value, token: el.querySelector('[data-gh-token]').value };
    else if (e.target.matches('[data-pkname]')) packName = e.target.value; // название тоже не теряется при перерисовке
  });

  function download(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  function exportJson() {
    const text = JSON.stringify({ format: 'sunny-home', ...store.state }, null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'Sunny_Home_House.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('Резервная копия скачана');
  }

  async function importJson(input) {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Файл слишком большой');
      const data = JSON.parse(await file.text());
      if (data.format !== 'sunny-home') throw new Error('Это не файл «Солнечного дома»');
      const s = validate(data); normalize(s);
      if (!confirm('Заменить текущий дом домом из файла? Это можно отменить кнопкой ↶.')) return;
      store.replace(s);
      toast('Дом загружен из файла');
    } catch (err) { toast('Не удалось загрузить: ' + (err instanceof SyntaxError ? 'файл повреждён' : err.message), true); }
    render();
  }

  return {
    open, close,
    sync() { if (isOpen && tab === 'markup' && !sliding) { const r = actions.roomInView()?.room?.id; if (r !== el.dataset.room) { el.dataset.room = r; render(); } } },
    setStorageNote(t) { storageNote = t; if (tab === 'data') render(); },
    get guides() { return isOpen && tab === 'markup' ? actions.roomInView()?.room.id : null; },
  };
}
