// Друзья: два игрока и общий «сервер» в памяти вместо Firebase. Запуск: PLAYWRIGHT_PATH=… CHROME_PATH=… node tests/friends.mjs
// Два игрока, общий «сервер» в памяти (вместо Firebase).
const { chromium } = await import(process.env.PLAYWRIGHT_PATH + '/index.mjs');
import { fileURLToPath } from 'node:url';
const SH = (process.env.SHOTS || '/tmp') + '/';
const GAME = 'file://' + fileURLToPath(new URL('../dist/sunny-home.html', import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const db = {}; const listeners = []; let uidN = 0;
const getP = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), db) ?? null;
const setP = (path, val) => { const ks = path.split('/').filter(Boolean); let o = db; for (const k of ks.slice(0, -1)) { o[k] ||= {}; o = o[k]; } if (val === null) delete o[ks.at(-1)]; else o[ks.at(-1)] = JSON.parse(JSON.stringify(val)); };
const notify = () => { for (const l of listeners) { const v = JSON.stringify(getP(l.path)); if (v !== l.last) { l.last = v; l.page.evaluate(([id, v]) => window.__fakeEmit(id, JSON.parse(v)), [l.id, v]).catch(() => {}); } } };
async function player(name) {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 700 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.exposeFunction('__fakeNet', async (op, a, c) => {
    if (op === 'init') return 'uid' + (++uidN) + name;
    if (op === 'get') return getP(a);
    if (op === 'set') { setP(a, c); notify(); return; }
    if (op === 'update') { for (const [k, v] of Object.entries(a)) setP(k, v); notify(); return; }
    if (op === 'remove') { setP(a, null); notify(); return; }
    if (op === 'claim') { if (getP(a) !== null) return false; setP(a, c); notify(); return true; }
    if (op === 'push') { setP(a + '/k' + Date.now() + Math.random().toString(36).slice(2, 6), c); notify(); return; }
    if (op === 'presence') { setP(a, c); notify(); return; }
    if (op === 'online') { setP(a, { on: true, at: Date.now() }); notify(); return; }
    if (op === 'on') { const l = { page: p, path: a, id: c, last: undefined }; listeners.push(l); setTimeout(notify, 10); return; }
    if (op === 'off') { const k = listeners.findIndex((l) => l.id === a && l.page === p); if (k >= 0) listeners.splice(k, 1); return; }
  });
  await p.addInitScript(() => {
    const cbs = {}; let n = 0;
    window.__fakeEmit = (id, v) => cbs[id]?.(v);
    window.__NET_FAKE__ = {
      init: () => window.__fakeNet('init'), get: (x) => window.__fakeNet('get', x), set: (x, v) => window.__fakeNet('set', x, v),
      update: (m) => window.__fakeNet('update', m), remove: (x) => window.__fakeNet('remove', x), claim: (x, v) => window.__fakeNet('claim', x, v),
      online: (x) => window.__fakeNet('online', x), offline: (x) => window.__fakeNet('set', x, { on: false }),
      push: (x, v) => window.__fakeNet('push', x, v), presence: (x, v) => window.__fakeNet('presence', x, v), cancelPresence: () => {},
      on(x, cb) { const id = 'l' + (++n); cbs[id] = cb; window.__fakeNet('on', x, id); return () => { delete cbs[id]; window.__fakeNet('off', id); }; },
    };
  });
  await p.goto(GAME); await p.waitForTimeout(2500);
  return { p, errs, ctx };
}
const A = await player('A'), B = await player('B');
const hold = async (P) => { const bb = await P.p.locator('[data-st-gate]').boundingBox(); await P.p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await P.p.mouse.down(); await P.p.waitForTimeout(3200); await P.p.mouse.up(); await P.p.waitForTimeout(300); };
await A.p.click('.avatar-btn'); await A.p.waitForTimeout(400);
await B.p.click('.avatar-btn'); await B.p.waitForTimeout(400);
const codeB = await B.p.evaluate(() => document.querySelector('.fr-code b')?.textContent);
await A.p.click('[data-fr-add]'); await A.p.waitForTimeout(200); await hold(A);
await A.p.fill('[data-fr-code]', codeB.toLowerCase().replace('-', ' ')); await A.p.click('[data-fr-send]'); await A.p.waitForTimeout(600);
await A.p.screenshot({ path: SH + 'fr_A_sent.png' });
await B.p.waitForTimeout(500);
const badge = await B.p.evaluate(() => document.querySelector('.avatar-btn').dataset.n);
await B.p.screenshot({ path: SH + 'fr_B_req.png' });
await B.p.click('[data-fr-accept]'); await B.p.waitForTimeout(200); await hold(B); await B.p.waitForTimeout(600);
await B.p.screenshot({ path: SH + 'fr_B_friends.png' });
await A.p.waitForTimeout(300); await A.p.screenshot({ path: SH + 'fr_A_friends.png' });
// ── В гости: B идёт к A ──
await A.p.click('[data-st-close]').catch(() => {}); await B.p.waitForTimeout(200);
const homeB = await B.p.evaluate(() => window.__sunny.store.state.items.length);
await A.p.evaluate(() => { const S = window.__sunny; S.store.change((s) => { s.rooms.find((r) => r.id === 'living').wall.color = '#ff9999'; }); }); // примета дома A
await B.p.click('[data-fr-visit]'); await B.p.waitForTimeout(2500);
const bSees = await B.p.evaluate(() => ({ wall: window.__sunny.store.state.rooms.find((r) => r.id === 'living').wall.color, visiting: document.getElementById('app').classList.contains('visiting') }));
await B.p.screenshot({ path: SH + 'visit_B.png' });
await A.p.waitForTimeout(500);
const aSeesGuest = await A.p.evaluate(() => window.__sunny.renderer && document.querySelector('.toast')?.textContent);
// гость переносит банан на кухне (как будто пальцем) → у хозяина тоже
await B.p.evaluate(() => { const S = window.__sunny; S.store.change((s) => { const b = s.items.find((i) => i.def === 'banana'); delete b.on; b.room = 'lawn'; b.x = 500; b.y = 800; }, { undo: false }); });
await A.p.waitForTimeout(800);
const aBanana = await A.p.evaluate(() => { const b = window.__sunny.store.state.items.find((i) => i.def === 'banana' && i.room === 'lawn'); return b && [b.room, b.x]; });
// хозяин переносит щенка → гость видит
await A.p.evaluate(() => { const S = window.__sunny; S.store.change((s) => { const d = s.items.find((i) => i.def === 'dog'); d.room = 'lawn'; d.x = 900; d.y = 820; delete d.on; }, { undo: false }); });
await B.p.waitForTimeout(800);
const bDog = await B.p.evaluate(() => { const d = window.__sunny.store.state.items.find((i) => i.def === 'dog'); return [d.room, d.x]; });
await A.p.evaluate(() => { const S = window.__sunny; const r = S.store.layout.byId.get('lawn'); S.camera.holdAt(r.x0 + 200); S.camera.mode = 'idle'; S.store.touch(); });
await A.p.waitForTimeout(500); await A.p.screenshot({ path: SH + 'visit_A.png' });
// домой
await B.p.click('[data-act=home]'); await B.p.waitForTimeout(800);
const bHome = await B.p.evaluate(() => ({ wall: window.__sunny.store.state.rooms.find((r) => r.id === 'living').wall.color, n: window.__sunny.store.state.items.length, visiting: document.getElementById('app').classList.contains('visiting') }));
console.log(JSON.stringify({ homeB, bSees, aSeesGuest, aBanana, bDog, bHome, guestsLeft: db.live?.[Object.keys(db.live)[0]]?.guests || null }));
const res = { codeB, badge, dbFriends: db.friends, req: db.requests || null, users: Object.values(db.users || {}).map((u) => [u.code, u.nick, !!u.look]) };
console.log(JSON.stringify(res), A.errs, B.errs);
await b.close();
