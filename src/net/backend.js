// Сервер друзей — Firebase (анонимный вход + Realtime Database).
// Наружу — простой набор действий с путями базы, чтобы логику друзей можно было проверить без сети
// (в тестах вместо Firebase подставляется window.__NET_FAKE__ с теми же действиями).
// apiKey — не секрет (это адрес проекта); данные защищают правила базы (docs/firebase-rules.json).
import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, serverTimestamp, runTransaction } from 'firebase/database';

export const FIREBASE = {
  apiKey: 'AIzaSyD5Ly897l1Nm9yji-23iGX8oKIBHmo8sdU',
  authDomain: 'sunny-home-e900a.firebaseapp.com',
  databaseURL: 'https://sunny-home-e900a-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'sunny-home-e900a',
  storageBucket: 'sunny-home-e900a.firebasestorage.app',
  messagingSenderId: '1036034456227',
  appId: '1:1036034456227:web:ac67d915c80306310add16',
};

// Шаг с ожиданием не дольше 15 секунд — чтобы «Подключаюсь…» не висело вечно, а было видно, что не так.
function step(what, promise, ms = 15000) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ': сервер не ответил')), ms); })])
    .catch((e) => { throw new Error(e?.code ? what + ': ' + e.code : e?.message || String(e)); })
    .finally(() => clearTimeout(t));
}

function firebaseBackend() {
  let app, auth, db;
  const r = (path) => ref(db, path);
  return {
    // Войти (без почты и пароля; тот же аккаунт при следующем запуске). Возвращает uid.
    async init() {
      // Только анонимный вход: без окна входа Google (getAuth тянет его и на телефоне/из файла может зависнуть).
      app ||= initializeApp(FIREBASE);
      auth ||= initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence] });
      db ||= getDatabase(app);
      await step('вход', auth.authStateReady());
      const user = auth.currentUser || (await step('вход', signInAnonymously(auth))).user;
      return user.uid;
    },
    async get(path) { const s = await step('база', get(r(path))); return s.exists() ? s.val() : null; },
    set: (path, val) => step('база', set(r(path), val)),
    update: (map) => step('база', update(ref(db), map)),
    remove: (path) => step('база', remove(r(path))),
    on(path, cb) { return onValue(r(path), (s) => cb(s.exists() ? s.val() : null), () => cb(null)); },
    // Записать, только если там пусто (код дружбы — один на игрока). true — получилось.
    async claim(path, val) { const res = await step('база', runTransaction(r(path), (cur) => (cur === null ? val : undefined))); return res.committed; },
    // «В сети»: пока приложение открыто — on: true; закрылось или пропала связь — сервер сам поставит on: false.
    async online(path) {
      await step('в сети', onDisconnect(r(path)).set({ on: false, at: serverTimestamp() }));
      await step('в сети', set(r(path), { on: true, at: serverTimestamp() }));
    },
    offline: (path) => set(r(path), { on: false, at: serverTimestamp() }),
    // Добавить в список (новый ключ по времени) — действия гостя в доме хозяина.
    push: (path, val) => step('база', push(r(path), val)),
    // Запись, которая сама пропадёт, когда приложение закроется или пропадёт связь (гость в доме).
    async presence(path, val) { await step('в гостях', onDisconnect(r(path)).remove()); await step('в гостях', set(r(path), val)); },
    cancelPresence: (path) => onDisconnect(r(path)).cancel(),
  };
}

export const createBackend = () => window.__NET_FAKE__ || firebaseBackend();
