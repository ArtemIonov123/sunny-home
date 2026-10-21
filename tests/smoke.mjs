// Автопроверка: открывает собранную игру на нескольких экранах с касаниями.
// Запуск: npm run build && npm test   (нужен Playwright с Chromium)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'file://' + join(root, 'dist/sunny-home.html');
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

  // 3. Перенос стола из кухни в детскую с прокруткой у края
  const table = await p.evaluate(() => window.__sunny.store.state.items.find((i) => i.def === 'table' && i.room === 'kitchen').id);
  let t = await item(table);
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
  await tap('[data-act=finish]');
  await tap('.swatch[data-wall="#cfe0ef"]');
  const color = await p.evaluate(() => window.__sunny.store.state.rooms.find((r) => r.id === 'living').wall.color);
  check(color === '#cfe0ef', 'цвет стены гостиной изменился');
  await p.screenshot({ path: `${SHOTS}/${name}_2_finish.png` });
  await tap('[data-panel=finish] [data-close]');

  // 7. Отмена
  await tap('[data-act=undo]');
  const color2 = await p.evaluate(() => window.__sunny.store.state.rooms.find((r) => r.id === 'living').wall.color);
  check(color2 !== '#cfe0ef', 'отмена вернула прежний цвет');

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

  // 11. Шкафчик: нажать на вещь — она встаёт в комнату
  await tap('[data-act=things]');
  await tap('[data-ttab=mine]');
  const c1a = await counts();
  await tap('.stack');
  const c1b = await counts();
  check(c1b.placed === c1a.placed + 1 && c1b.inventory === c1a.inventory - 1 && c1b.total === c1a.total, `из шкафчика в дом по нажатию (${c1a.inventory}→${c1b.inventory} в шкафчике)`);

  // 12. Шкафчик: вытянуть вещь пальцем в комнату
  await tap('[data-act=things]').catch(() => {});
  if (await p.locator('[data-panel=things]').isHidden()) await tap('[data-act=things]');
  await tap('[data-ttab=mine]');
  const stackBox = await p.locator('.stack').first().boundingBox();
  if (stackBox) {
    const c2a = await counts();
    const sx = stackBox.x + stackBox.width / 2, sy = stackBox.y + stackBox.height / 2;
    const target = await p.evaluate(() => { const { camera } = window.__sunny; return { wx: camera.x + camera.viewW * 0.3, wy: 300 }; });
    const tc = await toClient(target.wx, target.wy);
    // «влево» в системе координат игры: на повёрнутом экране это вверх
    await drag({ x: sx, y: sy }, tc, { steps: 14 });
    const c2b = await counts();
    check(c2b.placed === c2a.placed + 1 && c2b.total === c2a.total, 'вещь вытянута из шкафчика в комнату');
  }
  if (!(await p.locator('[data-panel=things]').isHidden())) await tap('[data-panel=things] [data-close]');

  // 13. Каталог: получить новую вещь → +1 в шкафчике
  await tap('[data-act=things]'); await tap('[data-ttab=shop]');
  const c3a = await counts();
  await tap('[data-get=picture]');
  const c3b = await counts();
  check(c3b.inventory === c3a.inventory + 1 && c3b.total === c3a.total + 1, 'из каталога — ровно одна новая вещь в шкафчик');
  await tap('[data-panel=things] [data-close]');

  // 14. Свой предмет: загрузить картинку с розовым фоном, сохранить в шкафчик, пережить перезагрузку
  await tap('[data-act=admin]'); await tap('[data-tab=items]'); await tap('[data-ie-new]');
  await p.setInputFiles('[data-ie-file]', join(root, 'tests/fixtures/test_chair.png'));
  await p.waitForSelector('.ie-upload img', { timeout: 5000 });
  await p.fill('[data-ie-name]', 'Тестовое кресло');
  await p.selectOption('[data-ie-group]', 'furniture');
  await tap('[data-ie-save-put]'); await p.waitForTimeout(600);
  const custom = await p.evaluate(() => { const s = window.__sunny.store.state; const it = s.items.find((i) => i.def.startsWith('custom_')); return it ? { def: it.def, inv: it.inv } : null; });
  check(!!custom && custom.inv === true, 'свой предмет сохранён и лежит в шкафчике');
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
      const fruit = s.items.find((i) => i.def === 'banana' && i.inv) || s.items.find((i) => i.def === 'apple' && i.inv);
      if (!sofa || !fruit) return null;
      const sf = S.physics.surfacesOf(sofa)[0], x0 = S.store.layout.byId.get('living').x0;
      S.camera.holdAt(x0 + sofa.x - S.camera.viewW / 2); S.camera.mode = 'idle'; S.store.touch();
      return { sofa: sofa.id, fruit: fruit.id, fruitDef: fruit.def, wx: x0 + (sf.x0 + sf.x1) / 2, wy: sf.y - 40, sofaX: x0 + sofa.x, sofaY: sofa.y };
    });
    if (info) {
      await p.waitForTimeout(300);
      await tap('[data-act=things]'); await tap('[data-ttab=mine]');
      await p.locator(`.stack[data-stack=${info.fruitDef}]`).scrollIntoViewIfNeeded();
      const card = await p.locator(`.stack[data-stack=${info.fruitDef}]`).boundingBox();
      await drag({ x: card.x + card.width / 2, y: card.y + card.height / 2 }, await toClient(info.wx, info.wy), { steps: 14 });
      await p.waitForTimeout(500);
      let f = await p.evaluate((id) => window.__sunny.store.state.items.find((i) => i.id === id), info.fruit);
      check(f?.on?.id === info.sofa, 'вещь, брошенная над диваном, легла на диван');
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
    }
  }

  await p.screenshot({ path: `${SHOTS}/${name}_4_end.png` });
  check(errors.length === 0, 'нет ошибок за всё время ' + errors.join(' | '));
  await ctx.close();
}

await device('desktop', 1600, 900, false);
await device('phone_land', 844, 390, true);
await device('phone_port', 390, 844, true);
await device('android_small', 640, 360, true);
await browser.close();
console.log(failures ? `\nПровалено проверок: ${failures}` : '\nВсе проверки пройдены');
process.exit(failures ? 1 : 0);
