// В гостях у друга. Главный — хозяин: его игра хранит дом.
//   live/<хозяин>/state           — { json, at } — дом хозяина (пишет хозяин, пока у него гости)
//   live/<хозяин>/guests/<гость>  — { nick, face, bg, look, room, x, y } — гость и где его герой (пропадает сам, если гость ушёл)
//   live/<хозяин>/ops/<ключ>      — { by, p } — что гость поменял в доме (p — JSON: { items: {id: вещь|null}, chars: {...} })
//   live/<хозяин>/drags/<игрок>   — { kind, id, x, y } — что игрок сейчас тянет пальцем (видно всем, плавно)
//   live/<хозяин>/pets/<id>       — путь, по которому пошло животное у хозяина (у гостей оно идёт само)
//   live/<хозяин>/emotes/<игрок>  — { e, who, t } — смайлик над героем (👋 ❤️ 😂 …)
// Гость играет на копии дома: переносит вещи, героев, животных, включает свет и воду, кормит героев.
// Его изменения уходят хозяину, хозяин применяет их у себя и рассылает дом всем. Без «Вещей» и редактора.
import { CHARS } from '../core/catalog.js';
import { validate } from '../save/migrate.js';
import { syncChildren } from '../core/physics.js';
import { refreshHero } from '../render/hero.js';
import { copy } from '../util.js';
import { roomAtX } from '../core/house.js';

const VID = (uid) => 'v_' + uid; // id героя-гостя (как у Милы и Тима, только временный)

export function createVisit({ friends, store, getMe, isDragging, camera, pets, onMode, onArrive, onEmote, toast }) {
  const net = friends.net;
  let me = null;
  let mode = 'home';          // 'home' | 'guest'
  let hostId = null, homeState = null, baseline = null, applying = false, firstState = true;
  let guestSubs = [];
  let pending = null;
  let sentDrag = null, lastDragSend = 0;         // дом от хозяина пришёл во время перетаскивания — применим после
  const visitors = new Map(); // uid → { nick, face, bg, look, room, x, y }
  let hostSubs = [], publishTimer = 0;
  const drags = new Map();    // uid → { kind, id, tx, ty, x, y } — что тянут другие (x, y — плавно догоняют tx, ty)
  const emotes = new Map();   // кто (id героя) → { e, t0 }
  const seenEmote = new Map(); // uid → t последнего показанного
  let lastPets = {};
  const hostOf = () => (mode === 'guest' ? hostId : me);
  const inSession = () => !!me && (mode === 'guest' || visitors.size > 0);

  // Чужие перетаскивания (видно, как друг несёт вещь).
  function setDrags(v) {
    const seen = new Set();
    for (const [uid, d] of Object.entries(v || {})) {
      if (uid === me || !d || !Number.isFinite(d.x)) continue;
      seen.add(uid);
      const prev = drags.get(uid);
      if (prev && prev.kind === d.kind && prev.id === d.id) { prev.tx = d.x; prev.ty = d.y; }
      else drags.set(uid, { kind: d.kind, id: d.id, tx: d.x, ty: d.y, x: d.x, y: d.y });
    }
    for (const uid of [...drags.keys()]) if (!seen.has(uid)) drags.delete(uid);
  }
  // Смайлики.
  function setEmotes(v) {
    for (const [uid, m] of Object.entries(v || {})) {
      if (!m?.e || !m.who || (seenEmote.get(uid) || 0) >= m.t) continue;
      seenEmote.set(uid, m.t);
      if (uid === me || Date.now() - m.t > 8000) continue; // свой уже показан; старый — не показываем
      emotes.set(m.who, { e: m.e, t0: performance.now() });
      onEmote?.(m.who, m.e);
    }
  }
  // Пути животных от хозяина.
  function setPets(v) {
    const cur = v || {};
    for (const id of new Set([...Object.keys(lastPets), ...Object.keys(cur)])) {
      const a = JSON.stringify(lastPets[id] ?? null), b = JSON.stringify(cur[id] ?? null);
      if (a !== b) pets?.remoteWalk(Number(id), cur[id] || null);
    }
    lastPets = cur;
  }
  // Подписки, общие для хозяина и гостя (на дом хозяина).
  function socialSubs(host) {
    return [
      net.on('live/' + host + '/drags', setDrags),
      net.on('live/' + host + '/emotes', setEmotes),
    ];
  }

  // ── Герои-гости на экране ──
  function setVisitors(v) {
    const seen = new Set();
    for (const [uid, g] of Object.entries(v || {})) {
      if (!g || typeof g !== 'object') continue;
      seen.add(uid);
      const id = VID(uid), prev = visitors.get(uid);
      if (!CHARS[id]) CHARS[id] = { name: g.nick || '', art: 'hero/' + id, h: 330 };
      CHARS[id].name = g.nick || '';
      if (g.look) refreshHero(id, g.look);
      // своего героя двигаю сам — с сервера беру только при первом появлении
      if (uid === me && prev) visitors.set(uid, { ...g, room: prev.room, x: prev.x, y: prev.y });
      else visitors.set(uid, g);
      if (!prev && uid !== me) onArrive?.(uid, g);
    }
    for (const uid of [...visitors.keys()]) if (!seen.has(uid)) visitors.delete(uid);
  }
  const visitorList = () => [...visitors.entries()].filter(([, g]) => g.room && Number.isFinite(g.x)).map(([uid, g]) => ({ id: VID(uid), uid, room: g.room, x: g.x, y: g.y, look: g.look, nick: g.nick, visitor: true, own: uid === me }));

  // ── Хозяин: у меня гости ──
  function startHosting(uid) {
    hostSubs.forEach((f) => f()); hostSubs = [];
    hostSubs.push(...socialSubs(uid));
    hostSubs.push(net.on('live/' + uid + '/guests', (v) => {
      if (mode !== 'home') return;
      const had = visitors.size;
      setVisitors(v);
      if (visitors.size && !had) { publish(true); net.remove('live/' + uid + '/pets').catch(() => {}); }
      if (!visitors.size) net.remove('live/' + uid + '/state').catch(() => {});
    }));
    hostSubs.push(net.on('live/' + uid + '/ops', (v) => {
      if (mode !== 'home' || !v) return;
      for (const [key, op] of Object.entries(v)) {
        if (op?.by && visitors.has(op.by)) applyPatch(op.p);
        net.remove('live/' + uid + '/ops/' + key).catch(() => {});
      }
    }));
  }
  // Дом — гостям (не чаще 6 раз в секунду).
  function publish(now = false) {
    if (mode !== 'home' || !visitors.size || !me) return;
    clearTimeout(publishTimer);
    const go = () => { const s = { ...store.state }; delete s.missing; net.set('live/' + me + '/state', { json: JSON.stringify(s), at: Date.now() }).catch(() => {}); };
    if (now) go(); else publishTimer = setTimeout(go, 160);
  }
  // Изменения от гостя → в мой дом.
  function applyPatch(raw) {
    let p; try { p = JSON.parse(raw); } catch (e) { return; }
    store.change((s) => {
      for (const [id, it] of Object.entries(p.items || {})) {
        const k = s.items.findIndex((i) => String(i.id) === id);
        if (it === null) { if (k >= 0) s.items.splice(k, 1); continue; }
        if (!it || typeof it !== 'object' || String(it.id) !== id || typeof it.def !== 'string') continue;
        if (!it.inv && !s.rooms.some((r) => r.id === it.room)) continue;
        if (k >= 0) s.items[k] = it; else s.items.push(it);
      }
      for (const [id, c] of Object.entries(p.chars || {})) {
        const k = s.chars.findIndex((x) => x.id === id);
        if (k >= 0 && c && s.rooms.some((r) => r.id === c.room)) s.chars[k] = { ...c, id, look: s.chars[k].look }; // внешность героев хозяина не трогаем
      }
      syncChildren(s);
    }, { undo: false });
  }

  // ── Гость ──
  const snap = (state) => ({ items: new Map(state.items.map((i) => [String(i.id), JSON.stringify(i)])), chars: new Map(state.chars.map((c) => [c.id, JSON.stringify(c)])) });
  function receive(v) {
    if (mode !== 'guest' || !v?.json) return;
    if (isDragging()) { pending = v; return; }
    let st; try { st = validate(JSON.parse(v.json)); } catch (e) { return; }
    applying = true;
    baseline = snap(st);
    store.swap(st);
    applying = false;
    if (firstState) {
      firstState = false;
      // Появляемся на лужайке (или в первой комнате).
      const lawn = store.layout.list.find((r) => r.room.type === 'lawn') || store.layout.list[0];
      const mine = { ...getMe(), room: lawn.room.id, x: Math.min(700, lawn.room.width / 2), y: 820 };
      visitors.set(me, mine);
      camera.holdAt(lawn.x0 + mine.x - camera.viewW / 2); camera.mode = 'idle';
      sendSelf();
      onMode?.('guest');
    }
  }
  function sendSelf() {
    const g = visitors.get(me); if (!g || !hostId) return;
    const p = getMe();
    net.set('live/' + hostId + '/guests/' + me, { nick: p.nick, face: p.face, bg: p.bg, look: p.look || null, room: g.room, x: Math.round(g.x), y: Math.round(g.y), at: Date.now() }).catch(() => {});
  }
  // Мои изменения в доме друга → хозяину (только то, что поменялось).
  function sendChanges() {
    if (mode !== 'guest' || applying || !baseline) return;
    const now = snap(store.state), p = { items: {}, chars: {} };
    let n = 0;
    for (const [id, j] of now.items) if (baseline.items.get(id) !== j) { p.items[id] = JSON.parse(j); n++; }
    for (const id of baseline.items.keys()) if (!now.items.has(id)) { p.items[id] = null; n++; }
    for (const [id, j] of now.chars) if (baseline.chars.get(id) !== j) { p.chars[id] = JSON.parse(j); n++; }
    baseline = now;
    if (n) net.push('live/' + hostId + '/ops', { by: me, p: JSON.stringify(p), at: Date.now() }).catch(() => {});
  }

  store.on('change', ({ save, remote }) => {
    if (remote) return;
    if (mode === 'home') { if (save !== false) publish(); }
    else if (save !== false) sendChanges();
  });

  friends.ready((uid) => { me = uid; startHosting(uid); });

  return {
    get mode() { return mode; },
    get hostId() { return hostId; },
    visitors: visitorList,
    myId: () => (me ? VID(me) : null),
    // Пойти в гости к другу (он должен быть в сети).
    async join(id) {
      if (!me || mode === 'guest') return false;
      hostSubs.forEach((f) => f()); hostSubs = []; visitors.clear(); clearTimeout(publishTimer);
      mode = 'guest'; hostId = id; homeState = copy(store.state); baseline = null; firstState = true; pending = null;
      const p = getMe();
      try {
        await net.presence('live/' + id + '/guests/' + me, { nick: p.nick, face: p.face, bg: p.bg, look: p.look || null, at: Date.now() });
      } catch (e) { this.leave(); throw e; }
      guestSubs.push(net.on('live/' + id + '/state', receive));
      guestSubs.push(net.on('live/' + id + '/guests', setVisitors));
      guestSubs.push(...socialSubs(id));
      guestSubs.push(net.on('live/' + id + '/pets', setPets));
      guestSubs.push(net.on('status/' + id, (v) => { if (mode === 'guest' && v && !v.on) { this.leave(); toast?.('Друг ушёл — ты дома'); } }));
      // Хозяин не ответил домом за 12 секунд — домой.
      setTimeout(() => { if (mode === 'guest' && hostId === id && firstState) { this.leave(); toast?.('Друг не открыл дверь — попробуй позже', true); } }, 12000);
      return true;
    },
    // Домой.
    leave() {
      if (mode !== 'guest') return;
      guestSubs.forEach((f) => f()); guestSubs = [];
      const id = hostId;
      net.cancelPresence?.('live/' + id + '/guests/' + me);
      net.remove('live/' + id + '/guests/' + me).catch(() => {});
      net.remove('live/' + id + '/drags/' + me).catch(() => {});
      for (const pid of Object.keys(lastPets)) pets?.remoteWalk(Number(pid), null);
      lastPets = {}; drags.clear(); emotes.clear();
      mode = 'home'; hostId = null; visitors.clear(); baseline = null;
      applying = true; store.swap(homeState); applying = false; homeState = null;
      onMode?.('home');
      if (me) startHosting(me);
    },
    // Свой герой-гость переехал (перетащили пальцем).
    moveSelf(room, x, y) { const g = visitors.get(me); if (!g) return; g.room = room; g.x = x; g.y = y; sendSelf(); },
    // Перетаскивание кончилось — применить дом, пришедший во время него; друзьям — «отпустил».
    dragEnded() {
      if (pending) { const v = pending; pending = null; receive(v); }
      if (sentDrag) { sentDrag = null; net.remove('live/' + hostOf() + '/drags/' + me).catch(() => {}); }
    },
    inSession,
    // Я тяну вещь или героя — друзьям, не чаще 8 раз в секунду.
    sendDrag(g) {
      if (!inSession() || !g || (g.kind !== 'item' && g.kind !== 'char')) return;
      const t = performance.now(); if (t - lastDragSend < 120) return;
      lastDragSend = t;
      sentDrag = { kind: g.kind, id: g.id, x: Math.round(g.ax), y: Math.round(g.ay) };
      net.set('live/' + hostOf() + '/drags/' + me, sentDrag).catch(() => {});
    },
    // Где сейчас то, что тянет друг (плавно), — для отрисовки. null — никто не тянет.
    dragOverride(kind, id) {
      for (const d of drags.values()) if (d.kind === kind && d.id === id) { const r = roomAtX(store.layout, d.x); return { room: r.room.id, x: d.x - r.x0, y: d.y, on: undefined, seat: undefined }; }
      return null;
    },
    // Каждый кадр: чужие перетаскивания догоняют присланное место. true — нужны кадры.
    tick(dt) {
      let busy = false;
      for (const d of drags.values()) { const k = Math.min(1, dt * 12); d.x += (d.tx - d.x) * k; d.y += (d.ty - d.y) * k; busy = true; }
      const now = performance.now();
      for (const [who, m] of emotes) { if (now - m.t0 > 2600) emotes.delete(who); else busy = true; }
      return busy;
    },
    // Смайлик над своим героем (у друга — над моим гостем, дома — над моим героем из профиля).
    emote(e) {
      if (!inSession()) return false;
      const who = mode === 'guest' ? VID(me) : getMe().face;
      emotes.set(who, { e, t0: performance.now() });
      net.set('live/' + hostOf() + '/emotes/' + me, { e, who, t: Date.now() }).catch(() => {});
      return true;
    },
    emotesNow: () => [...emotes.entries()].map(([who, m]) => ({ who, e: m.e, age: (performance.now() - m.t0) / 1000 })),
    // Хозяин: животное пошло/пришло — гостям.
    petWalk(id, w) { if (mode === 'home' && me && visitors.size) net.set('live/' + me + '/pets/' + id, w).catch(() => {}); },
  };
}
