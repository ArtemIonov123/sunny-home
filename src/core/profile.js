// Профиль игрока на этом устройстве: аватарка (лицо своего героя на цветном круге) и имя.
// Имя: сначала Player + 9 цифр; своё можно ввести (за родительским замком) — короткое, только буквы, цифры, пробел.
// Профиль уходит на сервер друзей (имя, аватарка, внешность героя): в гостях игрок — этот герой.
const KEY = 'sunny-home-profile';
export const AVATAR_BG = ['#ffd68c', '#bae2ff', '#ffc4d6', '#c8ecbe', '#e1cdff', '#ffb38a', '#9fe3d6', '#fff1a8'];
export const randomNick = () => 'Player' + String(Math.floor(1e8 + Math.random() * 9e8)); // Player141234541
const OLD_NICK = /^(Солнечный|Весёлый|Пушистый|Звёздный|Смелый|Радужный|Добрый|Шустрый|Сонный|Мятный|Лунный|Ягодный) \S+$/; // имена из 0.26–0.27
// Своё имя: 2–16 знаков, буквы (рус/лат/пол), цифры, пробел, _ и -. Возвращает чистое имя или null.
export function cleanNick(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 16) return null;
  if (!/^[A-Za-zА-Яа-яЁёĄąĆćĘęŁłŃńÓóŚśŹźŻż0-9 _-]+$/.test(s)) return null;
  if (/^Player\d{9}$/.test(s)) return s; // имя по умолчанию
  if (/\d{6,}/.test(s)) return null; // не номер телефона
  return s;
}

let profile = null;
export function getProfile() {
  if (profile) return profile;
  try { profile = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { profile = null; }
  if (!profile || typeof profile !== 'object') profile = {};
  profile = { face: profile.face === 'boy' ? 'boy' : 'girl', bg: AVATAR_BG.includes(profile.bg) ? profile.bg : AVATAR_BG[0], nick: typeof profile.nick === 'string' && profile.nick.length <= 16 && !OLD_NICK.test(profile.nick) ? profile.nick : randomNick() };
  saveProfile();
  return profile;
}
export function setProfile(patch) { profile = { ...getProfile(), ...patch }; saveProfile(); return profile; }
function saveProfile() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* без хранилища — до перезапуска */ } }
