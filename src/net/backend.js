// Сервер друзей — Firebase (анонимный вход + Realtime Database).
// Наружу — простой набор действий с путями базы, чтобы логику друзей можно было проверить без сети
// (в тестах вместо Firebase подставляется window.__NET_FAKE__ с теми же действиями).
// apiKey — не секрет (это адрес проекта); данные защищают правила базы (docs/firebase-rules.json).
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getDatabase, ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp, runTransaction } from 'firebase/database';

export const FIREBASE = {
  apiKey: 'AIzaSyD5Ly897l1Nm9yji-23iGX8oKIBHmo8sdU',
  authDomain: 'sunny-home-e900a.firebaseapp.com',
  databaseURL: 'https://sunny-home-e900a-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'sunny-home-e900a',
  storageBucket: 'sunny-home-e900a.firebasestorage.app',
  messagingSenderId: '1036034456227',
  appId: '1:1036034456227:web:ac67d915c80306310add16',
};

function firebaseBackend() {
  let app, auth, db;
  const r = (path) => ref(db, path);
  return {
    // Войти (без почты и пароля; тот же аккаунт при следующем запуске). Возвращает uid.
    async init() {
      app = initializeApp(FIREBASE);
      auth = getAuth(app); db = getDatabase(app);
      const user = await new Promise((res) => { const off = onAuthStateChanged(auth, (u) => { off(); res(u); }); });
      return (user || (await signInAnonymously(auth)).user).uid;
    },
    async get(path) { const s = await get(r(path)); return s.exists() ? s.val() : null; },
    set: (path, val) => set(r(path), val),
    update: (map) => update(ref(db), map),
    remove: (path) => remove(r(path)),
    on(path, cb) { return onValue(r(path), (s) => cb(s.exists() ? s.val() : null), () => cb(null)); },
    // Записать, только если там пусто (код дружбы — один на игрока). true — получилось.
    async claim(path, val) { const res = await runTransaction(r(path), (cur) => (cur === null ? val : undefined)); return res.committed; },
    // «В сети»: пока приложение открыто — on: true; закрылось или пропала связь — сервер сам поставит on: false.
    async online(path) {
      await onDisconnect(r(path)).set({ on: false, at: serverTimestamp() });
      await set(r(path), { on: true, at: serverTimestamp() });
    },
    offline: (path) => set(r(path), { on: false, at: serverTimestamp() }),
  };
}

export const createBackend = () => window.__NET_FAKE__ || firebaseBackend();
