// Сборка героя из слоёв: (длинные волосы сзади) → тело → одежда → голова → лицо → причёска → очки, кепка.
// Серые слои (*_t) перекрашиваются умножением на цвет, цветные и контур (*_f) — как есть.
// Готовый герой — обычная картинка 'hero/<id>' (registerImage), поэтому рисование, «хватание пальцем»
// и размеры работают так же, как у предметов.
import { HERO_SIZE, HERO_LAYERS } from './heroLayout.js';
import { img, registerImage } from '../assets.js';
import { bodyWear, headWear } from '../core/looks.js';
import { buildRig, setRig, handsOverWear } from './rig.js';
import { garmentBones } from './garment.js';

const tints = new Map(); // 'ключ|цвет' → холст
function tinted(key, color) {
  const id = key + '|' + color;
  let cv = tints.get(id);
  if (cv) return cv;
  const im = img(key);
  cv = document.createElement('canvas');
  cv.width = im.width; cv.height = im.height;
  const c = cv.getContext('2d');
  c.drawImage(im, 0, 0);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = color; c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'destination-in'; // вернуть прозрачность исходника
  c.drawImage(im, 0, 0);
  if (tints.size > 300) tints.clear();
  tints.set(id, cv);
  return cv;
}

// Нарисовать часть (оба её слоя) на холсте героя; sc — масштаб холста.
function part(c, name, color, sc = 1) {
  for (const suf of ['t', 'f']) {
    const key = `hero/${name}_${suf}`, at = HERO_LAYERS[key], im = img(key);
    if (!at || !im) continue;
    const src = suf === 't' && color ? tinted(key, color) : im;
    c.drawImage(src, at[0] * sc, at[1] * sc, im.width * sc, im.height * sc);
  }
}

// Низ ступней на холсте героя: ниже — пусто, обрезаем (ноги стоят на полу).
const feet = () => HERO_LAYERS['hero/body_stand_f'][1] + (img('hero/body_stand_f')?.height || 600);

export function drawHero(c, look, { face = null, sc = 1 } = {}) {
  const hair = look.hair === 'long' ? 'long_front' : look.hair;
  if (look.hair === 'long') part(c, 'hair_long_back', look.hairColor, sc);
  part(c, 'body_stand', look.skin, sc);
  for (const w of bodyWear(look.wear)) part(c, 'wear_' + w, look.wear[w], sc);
  // Своя одежда с подолом: руки от локтя — поверх неё (как в движении, rig.js ORDER_HANDS), с длинными рукавами.
  if (handsOverWear(look) && HERO_LAYERS['hero/arm_lower_left_t']) {
    for (const s of ['L', 'R']) {
      part(c, s === 'L' ? 'arm_lower_left' : 'arm_lower_right', look.skin, sc);
      for (const w of bodyWear(look.wear)) if (garmentBones(w)?.includes('armLo' + s)) part(c, `wear_${w}__armLo${s}`, look.wear[w], sc);
    }
  }
  part(c, 'head', look.skin, sc);
  part(c, 'face_' + (face || look.face), null, sc);
  if (hair !== 'none') { part(c, 'hair_cap', look.hairColor, sc); part(c, 'hair_' + hair, look.hairColor, sc); } // шапочка закрывает макушку
  for (const w of headWear(look.wear)) part(c, 'wear_' + w, look.wear[w], sc);
}

const built = new Map(); // id → подпись внешности (чтобы не пересобирать без нужды)
// Картинки одежды поменялись (своя вещь сохранена в студии) — героев собрать заново.
export function heroArtChanged() { built.clear(); tints.clear(); }
export function composeHero(look, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = HERO_SIZE[0]; cv.height = feet();
  drawHero(cv.getContext('2d'), look, opts);
  return cv;
}

// Обновить картинку героя в игре, если внешность изменилась. Возвращает true, если пересобрали.
export function refreshHero(charId, look, face = null, grip = {}) {
  if (!look) return false;
  const sig = JSON.stringify([look, face, grip]);
  if (built.get(charId) === sig) return false;
  built.set(charId, sig);
  registerImage('hero/' + charId, composeHero(look, { face })); // целиком: размеры и «хватание пальцем»
  setRig(charId, buildRig(look, face, grip)); // по частям: для движений
  return true;
}

// Маленькая картинка части (для кнопок редактора): вырезка из холста героя.
// box — [x, y, w, h] на холсте героя; draw(c) рисует нужные части.
export function partThumb(box, draw, size = 96) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const s = size / Math.max(box[2], box[3]);
  c.translate((size - box[2] * s) / 2 - box[0] * s, (size - box[3] * s) / 2 - box[1] * s);
  c.scale(s, s);
  draw(c);
  return cv;
}
export { part as drawPart };
export const HERO_BOX = { head: [90, 20, 330, 280], body: [60, 260, 400, 615], get full() { return [0, 0, HERO_SIZE[0], feet()]; } };
