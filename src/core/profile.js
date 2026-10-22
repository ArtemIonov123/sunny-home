// Профиль игрока на этом устройстве: аватарка (лицо своего героя на цветном круге) и имя.
// Имя — только из готовых слов (без ввода текста: игра детская, настоящих имён не храним).
// Позже, с друзьями, профиль уйдёт на сервер вместе с кодом дружбы.
const KEY = 'sunny-home-profile';
export const AVATAR_BG = ['#ffd68c', '#bae2ff', '#ffc4d6', '#c8ecbe', '#e1cdff', '#ffb38a', '#9fe3d6', '#fff1a8'];
const ADJ = ['Солнечный', 'Весёлый', 'Пушистый', 'Звёздный', 'Смелый', 'Радужный', 'Добрый', 'Шустрый', 'Сонный', 'Мятный', 'Лунный', 'Ягодный'];
const NOUN = ['Котик', 'Щенок', 'Ёжик', 'Зайчик', 'Мишка', 'Лисёнок', 'Пингвин', 'Дракончик', 'Совёнок', 'Енот', 'Барашек', 'Кит'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const randomNick = () => pick(ADJ) + ' ' + pick(NOUN);

let profile = null;
export function getProfile() {
  if (profile) return profile;
  try { profile = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { profile = null; }
  if (!profile || typeof profile !== 'object') profile = {};
  profile = { face: profile.face === 'boy' ? 'boy' : 'girl', bg: AVATAR_BG.includes(profile.bg) ? profile.bg : AVATAR_BG[0], nick: typeof profile.nick === 'string' && profile.nick.length < 40 ? profile.nick : randomNick() };
  saveProfile();
  return profile;
}
export function setProfile(patch) { profile = { ...getProfile(), ...patch }; saveProfile(); return profile; }
function saveProfile() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* без хранилища — до перезапуска */ } }
