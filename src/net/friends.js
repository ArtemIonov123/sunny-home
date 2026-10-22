// Друзья: код дружбы, запросы, список друзей и кто «в сети».
// База (Realtime Database):
//   users/<uid>     — { code, nick, face, bg, look } — профиль (виден друзьям: имя и аватарка)
//   codes/<КОД>     — uid (код дружбы вида ABCD-2345, один на игрока)
//   requests/<кому>/<от кого> — { at } — запрос в друзья
//   friends/<uid>/<uid друга> — true (у обоих)
//   status/<uid>    — { on, at } — в сети ли
// Правила базы — docs/firebase-rules.json.
import { createBackend } from './backend.js';

const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих 0/O, 1/I/L
const newCode = () => { let s = ''; for (let i = 0; i < 8; i++) s += ABC[Math.floor(Math.random() * ABC.length)]; return s.slice(0, 4) + '-' + s.slice(4); };
export const normCode = (raw) => { const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : null; };

export function createFriends({ getMe, onUpdate }) {
  const net = createBackend();
  const state = { status: 'off', uid: null, code: null, friends: [], requests: [], error: '' }; // status: off | connecting | on | error
  const profiles = new Map(), online = new Map(), subs = new Map();
  let friendIds = [], requestIds = [];
  const emit = () => {
    state.friends = friendIds.map((id) => ({ id, ...(profiles.get(id) || {}), online: !!online.get(id) })).sort((a, b) => b.online - a.online);
    state.requests = requestIds.map((id) => ({ id, ...(profiles.get(id) || {}) }));
    onUpdate?.(state);
  };
  // Профиль и «в сети» друга — подписка (обновляется сам).
  function watchPerson(id) {
    if (subs.has(id)) return;
    const offU = net.on('users/' + id, (v) => { if (v) profiles.set(id, { nick: v.nick, face: v.face, bg: v.bg, look: v.look }); emit(); });
    const offS = net.on('status/' + id, (v) => { online.set(id, !!v?.on); emit(); });
    subs.set(id, () => { offU(); offS(); });
  }
  function unwatchUnused() {
    for (const [id, off] of subs) if (!friendIds.includes(id) && !requestIds.includes(id)) { off(); subs.delete(id); profiles.delete(id); online.delete(id); }
  }
  const myProfile = () => { const m = getMe(); return { code: state.code, nick: m.nick, face: m.face, bg: m.bg, look: m.look || null }; };

  async function start() {
    if (state.status === 'connecting' || state.status === 'on') return;
    state.status = 'connecting'; emit();
    try {
      state.uid = await net.init();
      const me = state.uid;
      state.code = (await net.get('users/' + me + '/code')) || null;
      for (let k = 0; !state.code && k < 6; k++) { const c = newCode(); if (await net.claim('codes/' + c, me)) state.code = c; }
      if (!state.code) throw new Error('Не получилось выдать код дружбы');
      await net.set('users/' + me, myProfile());
      await net.online('status/' + me);
      net.on('friends/' + me, (v) => { friendIds = Object.keys(v || {}); friendIds.forEach(watchPerson); unwatchUnused(); emit(); });
      net.on('requests/' + me, (v) => {
        const before = new Set(requestIds);
        requestIds = Object.keys(v || {}).filter((id) => !friendIds.includes(id));
        requestIds.forEach(watchPerson); unwatchUnused();
        if (requestIds.some((id) => !before.has(id))) state.newRequest = Date.now(); // для звука «динь» и значка
        emit();
      });
      state.status = 'on'; state.error = ''; emit();
    } catch (e) {
      state.status = 'error'; state.error = e?.message || String(e); emit();
    }
  }

  return {
    state, start,
    // Своё имя/аватарка поменялись — обновить у друзей.
    async updateProfile() { if (state.status === 'on') try { await net.set('users/' + state.uid, myProfile()); } catch (e) { /* в другой раз */ } },
    // Добавить по коду. Ответ: 'sent' | 'friends' (он уже звал нас — сразу дружим) | 'already' | 'self' | 'nocode' | 'bad'.
    async add(raw) {
      const code = normCode(raw); if (!code) return 'bad';
      const id = await net.get('codes/' + code);
      if (!id) return 'nocode';
      if (id === state.uid) return 'self';
      if (friendIds.includes(id)) return 'already';
      if (requestIds.includes(id)) { await this.accept(id); return 'friends'; }
      await net.set('requests/' + id + '/' + state.uid, { at: Date.now() });
      return 'sent';
    },
    async accept(id) {
      const me = state.uid;
      await net.update({ ['friends/' + me + '/' + id]: true, ['friends/' + id + '/' + me]: true, ['requests/' + me + '/' + id]: null });
    },
    decline: (id) => net.remove('requests/' + state.uid + '/' + id),
    remove: (id) => net.update({ ['friends/' + state.uid + '/' + id]: null, ['friends/' + id + '/' + state.uid]: null }),
  };
}
