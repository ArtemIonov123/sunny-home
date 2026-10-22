import { readFileSync } from 'node:fs';
// Автопроверка: открывает собранную игру на нескольких экранах с касаниями.
// Запуск: npm run build && npm test   (нужен Playwright с Chromium)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Полный сценарий — на студии (в ней всё, что в игре, плюс админка). Игру проверяем отдельно ниже.
const URL = 'file://' + join(root, 'dist/studio.html');
const GAME_URL = 'file://' + join(root, 'dist/sunny-home.html');
const SHOTS = process.env.SHOTS || join(root, 'tests/shots');
mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROME_PATH;
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) failures++; };

const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function device(name, width, height, touch) {
  console.log(`\n${name} ${width}×${height}${touch ? ' (касания)' : ''}`);
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2.5 : 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(URL); await p.waitForFunction(() => window.__sunny, null, { timeout: 8000 }); await p.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(p);
  const touchEv = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  async function drag(a, b, { steps = 12, hold = 0 } = {}) {
    if (touch) {
      await touchEv('touchStart', a.x, a.y);
      for (let i = 1; i <= steps; i++) await touchEv('touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
      if (hold) { for (let t = 0; t < hold; t += 50) { await touchEv('touchMove', b.x, b.y); await p.waitForTimeout(50); } }
      await touchEv('touchEnd');
    } else {
      await p.mouse.move(a.x, a.y); await p.mouse.down();
      await p.mouse.move(b.x, b.y, { steps });
      if (hold) await p.waitForTimeout(hold);
      await p.mouse.up();
    }
    await p.waitForTimeout(250);
  }
  async function tap(sel) {
    try { await p.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 4000 }); }
    catch (e) { await p.screenshot({ path: `${SHOTS}/${name}_FAIL.png` }); throw new Error('Не найдено на экране: ' + sel); }
    const b = await p.locator(sel).first().boundingBox();
    if (touch) await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(250);
  }
  // мировая точка → экран (учитывая поворот)
  const toClient = (wx, wy) => p.evaluate(([wx, wy]) => {
    const { camera, viewport } = window.__sunny; const app = document.getElementById('app').getBoundingClientRect();
    const k = viewport.cssH / 900, lx = (wx - camera.x) * k, ly = wy * k;
    return viewport.rotated ? { x: app.right - ly, y: app.top + lx } : { x: app.left + lx, y: app.top + ly };
  }, [wx, wy]);
  const item = (id) => p.evaluate((id) => { const s = window.__sunny.store; const i = s.state.items.find((i) => i.id === id); if (!i) return null; const r = s.layout.byId.get(i.room); return { ...i, wx: r.x0 + i.x }; }, id);
  const camX = () => p.evaluate(() => window.__sunny.camera.x);

  await p.screenshot({ path: `${SHOTS}/${name}_1_start.png` });
  check(errors.length === 0, 'нет ошибок при запуске ' + errors.join(' | '));

  // 1. Листание пустого места
  const c0 = await camX();
  const mid = await toClient(0, 0); // не используется напрямую
  const vs = p.viewportSize();
  // пустая точка, где нет ни вещей, ни героев (иначе палец возьмёт вещь, а не листнёт)
  const wallPoint = await p.evaluate(() => {
    const { camera, renderer } = window.__sunny;
    for (const fy of [330, 200, 420, 120]) for (let f = 0.3; f < 0.8; f += 0.03) {
      const wx = camera.x + camera.viewW * f;
      if (!renderer.hit(wx, fy) && !renderer.hit(wx - 600, fy)) return { wx, wy: fy };
    }
    return { wx: camera.x + camera.viewW * 0.45, wy: 330 };
  });
  let a = await toClient(wallPoint.wx, wallPoint.wy), b = await toClient(wallPoint.wx - 600, wallPoint.wy);
  await drag(a, b);
  await p.waitForTimeout(700);
  const c1 = await camX();
  check(c1 > c0 + 300, `листание сдвинуло камеру (${Math.round(c0)} → ${Math.round(c1)})`);

  // 2. Кнопка комнаты «Кухня» — плавный полёт
  await tap('.room-chip[data-room=kitchen]'); await p.waitForTimeout(900);
  const inView = await p.evaluate(() => window.__sunny.actions.roomInView().room.id);
  check(inView === 'kitchen', 'кнопка «Кухня» привела камеру в кухню');

  // 3а. В игре мебель стоит на месте: тянешь стол — листается дом, стол не двигается
  const table = await p.evaluate(() => window.__sunny.store.state.items.find((i) => i.def === 'table' && i.room === 'kitchen').id);
  let t = await item(table);
  await drag(await toClient(t.wx, t.y - 135), await toClient(t.wx - 300, t.y - 135));
  const tPlay = await item(table);
  check(tPlay.x === t.x && tPlay.room === t.room, 'в игре мебель не двигается');
  await tap('.room-chip[data-room=kitchen]'); await p.waitForTimeout(900);
  // дальше — в редакторе комнаты (герои прячутся)
  await tap('[data-act=design]');
  check(await p.evaluate(() => window.__sunny.mode.design && !window.__sunny.renderer.hit(0, 0) !== undefined), 'включён редактор комнаты');
  const heroHidden = await p.evaluate(() => { const S = window.__sunny, c = S.store.state.chars[0], x0 = S.store.layout.byId.get(c.room).x0; return S.renderer.hit(x0 + c.x, c.y - 100)?.kind !== 'char'; });
  check(heroHidden, 'в редакторе герои спрятаны');
  await tap('[data-panel=things] [data-close]');
  t = await item(table);
  // 3. Перенос стола из кухни в детскую с прокруткой у края
  const tableStart = await toClient(t.wx, t.y - 135); // столешница
  const edge = await p.evaluate(() => { const { camera } = window.__sunny; return { wx: camera.x + camera.viewW - 40, wy: 780 }; });
  const edgeClient = await toClient(edge.wx, edge.wy);
  const countBefore = await p.evaluate(() => window.__sunny.store.state.items.length);
  await drag(tableStart, edgeClient, { hold: 1400 });
  t = await item(table);
  const countAfter = await p.evaluate(() => window.__sunny.store.state.items.length);
  check(t && t.room !== 'kitchen', `стол перенесён прокруткой у края в «${t?.room}»`);
  check(countBefore === countAfter, `число вещей не изменилось (${countBefore} → ${countAfter})`);

  // 4. Стол на стену — прижимается к полу, а не пропадает
  t = await item(table);
  await drag(await toClient(t.wx, t.y - 135), await toClient(t.wx + 80, 200));
  const t2 = await item(table);
  const roomSplit = await p.evaluate((rid) => window.__sunny.store.state.rooms.find((r) => r.id === rid).split, t2.room);
  check(t2.y >= roomSplit * 900, `стол, брошенный на стену, остался на полу (y=${Math.round(t2.y)})`);

  // 5. Картина не залезает на пол
  await tap('.room-chip[data-room=living]'); await p.waitForTimeout(900);
  const pic = await p.evaluate(() => window.__sunny.store.state.items.find((i) => i.def === 'picture' && i.room === 'living').id);
  let pc = await item(pic);
  const midX = await p.evaluate(() => window.__sunny.camera.x + window.__sunny.camera.viewW * 0.55);
  await drag(await toClient(pc.wx, pc.y), await toClient(midX, 700)); // не в зону 📦 слева внизу
  const bottomOk = await p.evaluate((id) => { const s = window.__sunny.store.state; const i = s.items.find((i) => i.id === id); const r = s.rooms.find((r) => r.id === i.room); const im = new Image(); return i.y + 187 / 2 <= r.split * 900; }, pic);
  check(bottomOk, 'картина целиком осталась на стене');

  // 6. Отделка: перекрасить стену гостиной
  await tap('[data-dtab=finish]');
  await tap('.swatch[data-wall="#cfe0ef"]');
  const color = await p.evaluate(() => window.__sunny.store.state.rooms.find((r) => r.id === 'living').wall.color);
  check(color === '#cfe0ef', 'цвет стены гостиной изменился');
  await p.screenshot({ path: `${SHOTS}/${name}_2_finish.png` });
  await tap('[data-panel=finish] [data-close]');

  // 7. Отмена
  await tap('[data-act=undo]');
  const color2 = await p.evaluate(() => window.__sunny.store.state.rooms.find((r) => r.id === 'living').wall.color);
  check(color2 !== '#cfe0ef', 'отмена вернула прежний цвет');

  await tap('[data-act=done]'); // выйти из редактора
  // 8. Переставить кухню правее через админку
  await tap('[data-act=admin]');
  const orderBefore = await p.evaluate(() => window.__sunny.store.state.rooms.map((r) => r.id).join(','));
  await tap('.adm-row[data-id=kitchen] [data-down]');
  const orderAfter = await p.evaluate(() => window.__sunny.store.state.rooms.map((r) => r.id).join(','));
  check(orderBefore !== orderAfter && orderAfter.indexOf('kitchen') > orderBefore.indexOf('kitchen'), `кухня переставлена: ${orderAfter}`);
  await p.screenshot({ path: `${SHOTS}/${name}_3_admin.png` });
  await tap('.admin-sheet [data-x]');

  // 9. Сохранение и восстановление
  await p.evaluate(() => window.__sunny.saveNow());
  const snap = await p.evaluate(() => JSON.stringify({ r: window.__sunny.store.state.rooms.map((r) => r.id), i: window.__sunny.store.state.items.map((i) => [i.id, i.room, Math.round(i.x), Math.round(i.y)]) }));
  await p.reload(); await p.waitForFunction(() => window.__sunny); await p.waitForTimeout(300);
  const snap2 = await p.evaluate(() => JSON.stringify({ r: window.__sunny.store.state.rooms.map((r) => r.id), i: window.__sunny.store.state.items.map((i) => [i.id, i.room, Math.round(i.x), Math.round(i.y)]) }));
  check(snap === snap2, 'после перезагрузки дом тот же');

  const counts = () => p.evaluate(() => window.__sunny.actions.counts());
  const total0 = (await counts()).total;

  await tap('[data-act=design]'); await tap('[data-panel=things] [data-close]');
  // 10. Убрать вещь в шкафчик (зона 📦) — вещь не пропадает
  const pic2 = await p.evaluate(() => { const s = window.__sunny.store; const r = window.__sunny.actions.roomInView(); return s.state.items.find((i) => !i.inv && i.room === r.room.id && i.def !== 'door')?.id; });
  if (pic2) {
    const it = await item(pic2);
    const from = await toClient(it.wx, it.def === 'table' ? it.y - 135 : it.y);
    if (touch) { await touchEv('touchStart', from.x, from.y); await touchEv('touchMove', from.x + 20, from.y + 20); }
    else { await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(from.x + 20, from.y + 20, { steps: 3 }); }
    const tb = await p.locator('.stash').boundingBox();
    const to = { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 };
    if (touch) { for (let i = 1; i <= 10; i++) await touchEv('touchMove', from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10); await touchEv('touchEnd'); }
    else { await p.mouse.move(to.x, to.y, { steps: 10 }); await p.mouse.up(); }
    await p.waitForTimeout(300);
    const inv = await p.evaluate((id) => window.__sunny.store.state.items.find((i) => i.id === id)?.inv, pic2);
    check(inv === true, 'вещь убрана в шкафчик, а не удалена');
    check((await counts()).total === total0, 'общее число вещей не изменилось');
  }

  await tap('[data-act=done]');
  // 11. Список вещей: нажать на карточку — вещь встаёт в комнату (ровно одна)
  await tap('[data-act=things]');
  const c1a = await counts();
  await tap('.stack');
  const c1b = await counts();
  check(c1b.placed === c1a.placed + 1 && c1b.total - c1a.total <= 1, `нажатие на карточку ставит одну вещь (${c1a.placed}→${c1b.placed})`);

  // 12. Вытянуть карточку пальцем — вещь сразу в комнате
  if (await p.locator('[data-panel=things]').isHidden()) await tap('[data-act=things]');
  const stackBox = await p.locator('.stack').nth(1).boundingBox();
  if (stackBox) {
    const c2a = await counts();
    const sx = stackBox.x + stackBox.width / 2, sy = stackBox.y + stackBox.height / 2;
    const target = await p.evaluate(() => { const { camera } = window.__sunny; return { wx: camera.x + camera.viewW * 0.3, wy: 300 }; });
    const tc = await toClient(target.wx, target.wy);
    await drag({ x: sx, y: sy }, tc, { steps: 14 });
    const c2b = await counts();
    check(c2b.placed === c2a.placed + 1, 'карточка вытянута пальцем — вещь в комнате');
  }
  if (!(await p.locator('[data-panel=things]').isHidden())) await tap('[data-panel=things] [data-close]');

  // 13. Убрал вещь и взял такую же снова — копия не появляется
  {
    const it = await p.evaluate(() => { const S = window.__sunny, r = S.actions.roomInView().room; return S.store.state.items.find((i) => !i.inv && i.room === r.id && i.def === 'banana') || S.store.state.items.find((i) => !i.inv && i.room === r.id && ['apple','milk','cake','juice','tomato','sandwich'].includes(i.def)); });
    if (it) {
      await p.evaluate((id) => window.__sunny.actions.toInventory(id), it.id);
      const c3a = await counts();
      await tap('[data-act=things]'); await tap(`.stack[data-stack=${it.def}]`);
      const c3b = await counts();
      check(c3b.total === c3a.total && c3b.placed === c3a.placed + 1, 'убранная вещь вернулась, а не появилась копия');
      await tap('[data-panel=things] [data-close]').catch(() => {});
    }
  }

  // 14. Свой предмет: загрузить картинку с розовым фоном, сохранить в шкафчик, пережить перезагрузку
  await tap('[data-act=admin]'); await tap('[data-tab=items]'); await tap('[data-ie-new]');
  await p.setInputFiles('[data-ie-file]', join(root, 'tests/fixtures/test_chair.png'));
  await p.waitForSelector('.ie-upload img', { timeout: 5000 });
  await p.fill('[data-ie-name]', 'Тестовое кресло');
  await p.selectOption('[data-ie-group]', 'furniture');
  await tap('[data-ie-save-put]'); await p.waitForTimeout(600);
  const custom = await p.evaluate(() => { const s = window.__sunny.store.state; const it = s.items.find((i) => i.def.startsWith('custom_')); return it ? { def: it.def, inv: it.inv } : null; });
  check(!!custom && !custom.inv, 'свой предмет сохранён и поставлен в дом');
  const alpha = await p.evaluate(() => { const im = [...document.querySelectorAll('.ie-upload img')][0]; if (!im) return -1; const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(1, 1, 1, 1).data[3]; });
  check(alpha === 0, 'розовый фон убран (угол прозрачный)');
  await p.screenshot({ path: `${SHOTS}/${name}_5_items.png` });
  await tap('.admin-sheet [data-x]');
  await p.evaluate(() => window.__sunny.saveNow());
  await p.reload(); await p.waitForFunction(() => window.__sunny); await p.waitForTimeout(500);
  const after = await p.evaluate((def) => ({ known: !!document && window.__sunny.store.state.items.some((i) => i.def === def), missing: (window.__sunny.store.state.missing || []).length }), custom?.def);
  check(after.known && after.missing === 0, 'после перезагрузки свой предмет на месте');
  // 15. Физика: банан, брошенный над сиденьем дивана, ложится на диван и едет вместе с ним; диван в шкафчик — банан падает на пол
  {
    await tap('.room-chip[data-room=living]'); await p.waitForTimeout(900);
    const info = await p.evaluate(() => {
      const S = window.__sunny, s = S.store.state;
      const sofa = s.items.find((i) => i.def === 'sofa' && !i.inv && i.room === 'living');
      const fruit = { id: null, def: 'banana' };
      if (!sofa) return null;
      const sf = S.physics.surfacesOf(sofa)[0], x0 = S.store.layout.byId.get('living').x0;
      S.camera.holdAt(x0 + sofa.x - S.camera.viewW / 2); S.camera.mode = 'idle'; S.store.touch();
      return { sofa: sofa.id, fruit: fruit.id, fruitDef: fruit.def, wx: x0 + (sf.x0 + sf.x1) / 2, wy: sf.y - 40, sofaX: x0 + sofa.x, sofaY: sofa.y };
    });
    if (info) {
      await p.waitForTimeout(300);
      await tap('[data-act=things]');
      await p.locator(`.stack[data-stack=${info.fruitDef}]`).scrollIntoViewIfNeeded();
      const card = await p.locator(`.stack[data-stack=${info.fruitDef}]`).boundingBox();
      await drag({ x: card.x + card.width / 2, y: card.y + card.height / 2 }, await toClient(info.wx, info.wy), { steps: 14 });
      await p.waitForTimeout(500);
      let f = await p.evaluate((sid) => window.__sunny.store.state.items.find((i) => i.def === 'banana' && i.on?.id === sid), info.sofa);
      info.fruit = f?.id;
      check(f?.on?.id === info.sofa, 'вещь, брошенная над диваном, легла на диван');
      await tap('[data-act=design]'); await tap('[data-panel=things] [data-close]');
      // тащим диван за левый край спинки
      const from = await toClient(info.sofaX - 230, info.sofaY - 60);
      const to = await toClient(info.sofaX - 230 + 260, info.sofaY - 60 + 60);
      await drag(from, to);
      await p.waitForTimeout(500);
      const pair = await p.evaluate(([fid, sid]) => { const s = window.__sunny.store.state; return { f: s.items.find((i) => i.id === fid), s: s.items.find((i) => i.id === sid) }; }, [info.fruit, info.sofa]);
      check(pair.f.on?.id === info.sofa && Math.abs((pair.f.x - pair.s.x) - (f.x - (info.sofaX - (await p.evaluate(() => window.__sunny.store.layout.byId.get('living').x0))))) < 2 && pair.s.x !== info.sofaX, 'вещь на диване переехала вместе с диваном');
      await p.evaluate((sid) => window.__sunny.actions.toInventory(sid), info.sofa);
      await p.waitForTimeout(300);
      f = await p.evaluate((id) => window.__sunny.store.state.items.find((i) => i.id === id), info.fruit);
      check(!f.on && !f.inv && f.room === 'living', 'диван убран — вещь с него упала на пол, а не исчезла');
      // «По местам»: в комнате не остаётся наложенной мебели
      await tap('[data-act=arrange]'); await p.waitForTimeout(300);
      const clash = await p.evaluate(() => { const S = window.__sunny, r = S.actions.roomInView().room; const big = S.store.state.items.filter((i) => !i.inv && !i.on && i.room === r.id && ['table','sofa','armchair','tv_stand','bookshelf','fridge','stove','sink_counter','kitchen_counter','washing_machine','floor_lamp','plant_big'].includes(i.def)); let n = 0; for (const a of big) for (const b of big) if (a.id < b.id && Math.abs(a.y - b.y) < 100 && Math.abs(a.x - b.x) < 60) n++; return n; });
      check(clash === 0, 'после «по местам» мебель не стоит друг на друге');
      await tap('[data-act=done]');
    }
  }

  // 16. Холодильник: нажатие открывает; еда внутри видна только при открытой двери
  {
    const fr = await p.evaluate(() => {
      const S = window.__sunny, s = S.store.state, f = s.items.find((i) => i.def === 'fridge' && !i.inv);
      if (!f) return null;
      const x0 = S.store.layout.byId.get(f.room).x0;
      S.camera.holdAt(x0 + f.x - S.camera.viewW / 2); S.camera.mode = 'idle'; S.store.touch();
      const inside = s.items.filter((i) => i.on?.id === f.id && i.on.s > 0).length;
      return { id: f.id, wx: x0 + f.x - 60, wy: f.y - 200, open: !!f.open, inside };
    });
    if (fr) {
      await p.waitForTimeout(300);
      const pt = await toClient(fr.wx, fr.wy);
      if (touch) await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y);
      await p.waitForTimeout(300);
      const after = await p.evaluate((id) => !!window.__sunny.store.state.items.find((i) => i.id === id).open, fr.id);
      check(after !== fr.open, 'нажатие открывает/закрывает холодильник');
      const visible = await p.evaluate((id) => { const S = window.__sunny; const f = S.store.state.items.find((i) => i.id === id); const x0 = S.store.layout.byId.get(f.room).x0; let n = 0; for (const it of S.store.state.items) if (it.on?.id === id && it.on.s > 0) { if (S.renderer.hit(x0 + it.x, it.y - 10)?.obj?.id === it.id) n++; } return n; }, fr.id);
      check(fr.inside === 0 || (after ? visible > 0 : visible === 0), `еда в холодильнике ${after ? 'видна' : 'спрятана'} (${visible} из ${fr.inside})`);
    }
  }

  // 18. Герои: панель выезжает, причёска и одежда меняются, после перезагрузки — те же
  {
    await tap('[data-act=heroes]'); await p.waitForTimeout(350);
    check(await p.evaluate(() => !document.querySelector('.hero-sheet').hidden), 'панель «Герои» открылась');
    await tap('[data-hs-hero=girl]');
    await tap('[data-hs-tab=hair]'); await tap('[data-hs-hair=bun]'); await tap('[data-hs-haircolor="#d4503a"]');
    await tap('[data-hs-tab=wear]'); await tap('[data-hs-wear=pants]');
    const lk = await p.evaluate(() => window.__sunny.store.state.chars.find((c) => c.id === 'girl').look);
    check(lk.hair === 'bun' && lk.hairColor === '#d4503a' && lk.wear.pants && !lk.wear.dress, `причёска, цвет и штаны (платье снято): ${JSON.stringify(lk)}`);
    await tap('[data-hs-close]'); await p.waitForTimeout(400);
    await p.evaluate(() => window.__sunny.saveNow());
    await p.reload(); await p.waitForFunction(() => window.__sunny); await p.waitForTimeout(500);
    const lk2 = await p.evaluate(() => window.__sunny.store.state.chars.find((c) => c.id === 'girl').look);
    check(lk2.hair === 'bun' && lk2.wear.pants, 'после перезагрузки внешность та же');
  }

  // 19. Еда в руке: герой берёт банан, три нажатия — съеден; футболка на героя — надета
  {
    const info = await p.evaluate(() => {
      const S = window.__sunny, c = S.store.state.chars.find((c) => c.id === 'boy');
      const id = S.actions.take('banana'); S.actions.give(id, 'boy');
      const x0 = S.store.layout.byId.get(c.room).x0;
      S.camera.holdAt(x0 + c.x - S.camera.viewW / 2); S.camera.mode = 'idle'; S.store.touch();
      const it = S.store.state.items.find((i) => i.id === id);
      return { id, held: it.held?.by, wx: x0 + c.x, wy: c.y - 230 };
    });
    check(info.held === 'boy', 'герой взял банан в руку');
    await p.waitForTimeout(300);
    for (let k = 0; k < 3; k++) {
      const pt = await toClient(info.wx, info.wy);
      if (touch) await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y);
      await p.waitForTimeout(1000);
    }
    const gone = await p.evaluate((id) => { const i = window.__sunny.store.state.items.find((i) => i.id === id); return !!i?.inv && !i.held; }, info.id);
    check(gone, 'три нажатия — банан съеден (ушёл в шкафчик, не удалён)');
    const worn = await p.evaluate(() => { const S = window.__sunny, id = S.actions.take('tshirt'); S.actions.give(id, 'boy'); return S.store.state.chars.find((c) => c.id === 'boy').look.wear.tshirt; });
    check(!!worn, 'футболку отдали герою — надета');
  }

  // 17. Телевизор: нажатие включает (идёт мультик), повторное — выключает
  {
    const tv = await p.evaluate(() => {
      const S = window.__sunny, i = S.store.state.items.find((i) => i.def === 'tv_stand' && !i.inv);
      if (!i) return null;
      const x0 = S.store.layout.byId.get(i.room).x0;
      S.camera.holdAt(x0 + i.x - S.camera.viewW / 2); S.camera.mode = 'idle'; S.store.touch();
      return { id: i.id, wx: x0 + i.x, wy: i.y - 200 };
    });
    if (tv) {
      await p.waitForTimeout(300);
      const tapTv = async () => { const pt = await toClient(tv.wx, tv.wy); if (touch) await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(500); };
      await tapTv();
      const on = await p.evaluate((id) => [!!window.__sunny.store.state.items.find((i) => i.id === id).lit, window.__sunny.renderer.animating], tv.id);
      check(on[0] && on[1], 'нажатие включает телевизор, на экране мультик');
      await tapTv();
      const off = await p.evaluate((id) => !!window.__sunny.store.state.items.find((i) => i.id === id).lit, tv.id);
      check(!off, 'повторное нажатие выключает телевизор');
    }
  }

  await p.screenshot({ path: `${SHOTS}/${name}_4_end.png` });
  check(errors.length === 0, 'нет ошибок за всё время ' + errors.join(' | '));
  await ctx.close();
}

// Игра для детей: без админки, но со всем остальным; встроенные паки видны в «Вещах».
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(GAME_URL); await p.waitForFunction(() => window.__sunny); await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ admin: !!document.querySelector('[data-act=admin]'), sheet: !!document.querySelector('.admin-sheet'), things: !!document.querySelector('[data-act=things]'), heroes: !!document.querySelector('[data-act=heroes]'), packs: (window.EMBEDDED_PACKS || []).length }));
  console.log('\nигра (sunny-home.html)');
  check(!r.admin && !r.sheet, 'в игре нет админки');
  check(r.things && r.heroes, 'в игре есть «Вещи» и «Герои»');
  // Магазин (каталог и паки — из папки store/, как на GitHub): бесплатный пак скачивается, вещи появляются
  await ctx.route('https://raw.githubusercontent.com/ArtemIonov123/sunny-home/main/store/**', (route) => {
    const path = route.request().url().split('/store/')[1].split('?')[0];
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(join(root, 'store', path)) });
  });
  await p.click('[data-act=shop]'); await p.waitForTimeout(600);
  const cards = await p.locator('.sh-card').count();
  check(cards >= 2, `в магазине паки (${cards})`);
  await p.click('[data-sh-pack=test_toys]'); await p.click('[data-sh-get]'); await p.waitForTimeout(800);
  check(await p.locator('[data-sh-open]').count() === 1, 'бесплатный пак скачан');
  await p.click('[data-sh-back]'); await p.click('[data-sh-pack=test_fairy]'); await p.click('[data-sh-buy]');
  check(await p.locator('.shop-gate:not([hidden])').count() === 1, 'платный — сначала родительский замок');
  await p.click('[data-gate-cancel]'); await p.click('[data-sh-back]'); await p.click('[data-sh-close]'); await p.waitForTimeout(300);
  await p.click('[data-act=things]'); await p.waitForTimeout(300);
  check(await p.locator('[data-stack=custom_ttoy_duckpink]').count() === 1, 'вещи пака — в «Вещах»');
  check(errs.length === 0, 'игра запускается без ошибок ' + errs.join(' | '));
  await ctx.close();
}

await device('desktop', 1600, 900, false);
await device('phone_land', 844, 390, true);
await device('phone_port', 390, 844, true);
await device('android_small', 640, 360, true);
await browser.close();
console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
process.exit(failures ? 1 : 0);
