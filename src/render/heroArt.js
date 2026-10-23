// Замена встроенных картинок героев (студия → «Герои»): тело и его части, голова, лица, причёски,
// встроенная одежда. Замена слоя — { image (data:URL, обрезано по рисунку), box [x, y, w, h] на холсте героя }.
// Свои замены студии (IndexedDB) главнее пришедших в паке (поле heroArt, «📤 Отправить игрокам»).
// Исходные слои запоминаются — «вернуть встроенную» просто восстанавливает их.
import { HERO_LAYERS } from './heroLayout.js';
import { img, loadImage, registerImage, forgetImage } from '../assets.js';
import { splitTint, layerRect, fitUpload, templateCanvas, TEMPLATES, resetBodyMasks, setGarmentBones, forgetGarmentBones } from './garment.js';
import { heroArtChanged, drawPart } from './hero.js';
import { replacedWear } from './rig.js';
import { loadHeroArtStore, saveHeroArtStore } from '../save/storage.js';

// Лица от GPT (face_*.png 1254×1254): рамка лица FACE_BOX ложится в FACE_TO на голове (tools/prepare_art.py).
const FACE_S = (972 - 380) / (1050 - 204);
export const FACE_T = { w: 1254, h: 1254, s: 0.25 * FACE_S, x: 87 + 0.25 * (380 - 204 * FACE_S), y: 12.5 + 0.25 * (440 - 272 * FACE_S) };

export const HERO_GROUPS = {
  body: { icon: '🧍', name: 'Тело', slots: ['body_stand', 'body_torso', 'arm_upper_left', 'arm_upper_right', 'arm_lower_left', 'arm_lower_right', 'hand_grip_left', 'hand_grip_right', 'leg_left', 'leg_right'] },
  head: { icon: '🙂', name: 'Голова', slots: ['head'] },
  face: { icon: '😊', name: 'Лица', slots: ['face_happy', 'face_laugh', 'face_yum', 'face_surprised', 'face_sad', 'face_sleep'] },
  hair: { icon: '💇', name: 'Причёски', slots: ['hair_braids', 'hair_bob', 'hair_ponytail', 'hair_bun', 'hair_curly', 'hair_spiky', 'hair_bangs', 'hair_long_front', 'hair_long_back'] },
  wear: { icon: '👕', name: 'Одежда', slots: ['wear_tshirt', 'wear_dress', 'wear_pants', 'wear_skirt', 'wear_sneakers', 'wear_cap', 'wear_glasses'] },
};
export const SLOT_NAMES = {
  body_stand: 'Тело целиком', body_torso: 'Туловище', arm_upper_left: 'Плечо слева', arm_upper_right: 'Плечо справа',
  arm_lower_left: 'Рука слева', arm_lower_right: 'Рука справа', hand_grip_left: 'Кулачок слева', hand_grip_right: 'Кулачок справа',
  leg_left: 'Нога слева', leg_right: 'Нога справа', head: 'Голова',
  face_happy: 'Улыбается', face_laugh: 'Смеётся', face_yum: 'Ням', face_surprised: 'Удивлён', face_sad: 'Грустит', face_sleep: 'Спит',
  hair_braids: 'Косички', hair_bob: 'Каре', hair_ponytail: 'Хвостик', hair_bun: 'Пучок', hair_curly: 'Кудряшки', hair_spiky: 'Ёжик', hair_bangs: 'Чёлка',
  hair_long_front: 'Длинные (спереди)', hair_long_back: 'Длинные (сзади)',
  wear_tshirt: 'Футболка', wear_dress: 'Платье', wear_pants: 'Штанишки', wear_skirt: 'Юбка', wear_sneakers: 'Кеды', wear_cap: 'Кепка', wear_glasses: 'Очки',
};
const WEAR_TYPE = { wear_tshirt: 'top', wear_dress: 'dress', wear_pants: 'pants', wear_skirt: 'skirt', wear_sneakers: 'shoes', wear_cap: 'hat', wear_glasses: 'glasses' };
export const wearTypeOf = (name) => WEAR_TYPE[name] || null;
export const slotGroup = (name) => Object.keys(HERO_GROUPS).find((g) => HERO_GROUPS[g].slots.includes(name)) || null;
export const ALL_SLOTS = Object.values(HERO_GROUPS).flatMap((g) => g.slots);
// Образец, на котором рисует GPT: тело 1024×1536, голова 1355×1161, лицо 1254×1254.
export const templateOfSlot = (name) => { const g = slotGroup(name); return g === 'body' ? TEMPLATES.body : g === 'face' ? FACE_T : TEMPLATES.head; };
export const templateSizeText = (name) => { if (slotGroup(name) === 'wear') return wearTypeOf(name) === 'hat' || wearTypeOf(name) === 'glasses' ? '1355×1161' : '1024×1536'; const T = templateOfSlot(name); return `${T.w}×${T.h}`; };

const IMG_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
export function cleanHeroArt(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const n of ALL_SLOTS) {
    const e = raw[n], b = e?.box;
    if (!e || typeof e.image !== 'string' || !IMG_RE.test(e.image) || e.image.length > 2_500_000) continue;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[2] < 4 || b[3] < 4 || b[2] > 1200 || b[3] > 1400 || Math.abs(b[0]) > 1500 || Math.abs(b[1]) > 1500) continue;
    out[n] = { image: e.image, box: b.map((v) => Math.round(v * 10) / 10), ...(e.tint === false ? { tint: false } : {}) }; // tint: false — игрок не перекрашивает
  }
  return out;
}

const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h)); return cv; };

// Картинка от GPT → слой на холсте героя. Нарисована на образце (то же отношение сторон) — встаёт как нарисовано;
// иначе — вписывается в место нынешнего слоя. Одежда — как своя одежда (garment.js).
export function fitHeroUpload(im, name) {
  if (slotGroup(name) === 'wear') return fitUpload(im, WEAR_TYPE[name]);
  const src = canvas(im.width, im.height), c = src.getContext('2d', { willReadFrequently: true });
  c.drawImage(im, 0, 0);
  const d = c.getImageData(0, 0, src.width, src.height), px = d.data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0, k = 0; y < src.height; y++) for (let x = 0; x < src.width; x++, k += 4) {
    if (px[k] > 200 && px[k + 2] > 200 && px[k + 1] < 90) px[k + 3] = 0; // фон #FF00FF → прозрачный
    if (px[k + 3] < 30) { px[k + 3] = 0; continue; }
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('Картинка пустая (или фон не прозрачный)');
  const corner = (x, y) => px[(y * src.width + x) * 4 + 3];
  const opaque = [corner(0, 0), corner(src.width - 1, 0), corner(0, src.height - 1), corner(src.width - 1, src.height - 1)].every((v) => v > 0);
  c.putImageData(d, 0, 0);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.min(1, 1000 / Math.max(bw, bh));
  const out = canvas(bw * s, bh * s); out.getContext('2d').drawImage(src, x0, y0, bw, bh, 0, 0, out.width, out.height);
  const T = templateOfSlot(name);
  let box, onTemplate = false;
  if (Math.abs(im.width / im.height - T.w / T.h) < 0.02) { const k = T.s * T.w / im.width; box = [T.x + x0 * k, T.y + y0 * k, bw * k, bh * k]; onTemplate = true; }
  else {
    const r = layerRect(name) || [100, 100, 300, 300], k = Math.min(r[2] / bw, r[3] / bh);
    box = [r[0] + (r[2] - bw * k) / 2, r[1] + r[3] - bh * k, bw * k, bh * k];
  }
  return { image: out.toDataURL('image/webp', 0.92), box: box.map((v) => Math.round(v * 10) / 10), opaque, onTemplate };
}

// Образец для GPT: герой серым, нужная часть — голубым (лицо — как сейчас, цветным).
export function heroTemplate(name) {
  const g = slotGroup(name);
  if (g === 'wear') return templateCanvas(WEAR_TYPE[name]);
  const T = templateOfSlot(name), cv = canvas(T.w, T.h), c = cv.getContext('2d');
  c.scale(1 / T.s, 1 / T.s); c.translate(-T.x, -T.y);
  c.filter = 'grayscale(1)';
  if (g === 'body') { if (name !== 'body_stand') drawPart(c, 'body_stand', '#e2e2e2'); }
  else if (name !== 'head') drawPart(c, 'head', '#e2e2e2');
  c.filter = 'none';
  drawPart(c, name, g === 'face' ? null : '#9cc8f2');
  return cv;
}

// ── Применение ──
const orig = new Map(); // ключ слоя → исходная { im, at }
function backup(k) { if (!orig.has(k)) orig.set(k, { im: img(k) || null, at: HERO_LAYERS[k] ? HERO_LAYERS[k].slice() : null }); }
function setLayer(k, layer, at) {
  backup(k);
  if (layer) { registerImage(k, layer); HERO_LAYERS[k] = at.map(Math.round); } else { forgetImage(k); delete HERO_LAYERS[k]; }
}
function restoreAll() {
  for (const [k, o] of orig) { if (o.im && o.at) { registerImage(k, o.im); HERO_LAYERS[k] = o.at.slice(); } else { forgetImage(k); delete HERO_LAYERS[k]; } }
  for (const w of replacedWear) forgetGarmentBones(w);
  replacedWear.clear();
}
function applyOne(name, e, im) {
  const [x, y, w, h] = e.box, g = slotGroup(name);
  const cv = canvas(w, h); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
  const parts = g === 'face' || e.tint === false ? { t: null, f: cv } : splitTint(cv); // лица и цветные картинки (галочка снята) не перекрашиваются
  setLayer(`hero/${name}_t`, parts.t, [x, y]);
  setLayer(`hero/${name}_f`, parts.f, [x, y]);
  if (g === 'wear') { const wk = name.slice(5); replacedWear.add(wk); setGarmentBones(wk, parts, e.box, WEAR_TYPE[name]); }
}

// «Шапочка» волос (закрывает макушку под причёской) — по форме головы, как hair_cap в prepare_art.py.
function regenCap() {
  const r = layerRect('head'); if (!r) return;
  const [X, Y, w, h] = r.map(Math.round);
  const cv = canvas(w, h), c = cv.getContext('2d', { willReadFrequently: true });
  for (const suf of ['t', 'f']) { const k = `hero/head_${suf}`, at = HERO_LAYERS[k], im = img(k); if (at && im) c.drawImage(im, at[0] - X, at[1] - Y); }
  const px = c.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (px[(j * w + i) * 4 + 3] > 40) { a[j * w + i] = 1; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 < 0) return;
  // Голова без контура: «сжать» маску на R пикселей (по строкам, потом по столбцам).
  const R = 4, tmp = new Uint8Array(w * h), inner = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = 1; for (let d = -R; d <= R && m; d++) { const q = i + d; m = q >= 0 && q < w ? a[j * w + q] : 0; } tmp[j * w + i] = m; }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = 1; for (let d = -R; d <= R && m; d++) { const q = j + d; m = q >= 0 && q < h ? tmp[q * w + i] : 0; } inner[j * w + i] = m; }
  const cx = (x0 + x1) / 2, half = (x1 - x0) / 2, hh = y1 - y0;
  const t = new ImageData(w, h), f = new ImageData(w, h);
  for (let i = 0; i < w; i++) {
    const u = (i - cx) / half, line = y0 + hh * (0.27 + 0.2 * u * u); // линия роста волос: у лба выше, к ушам ниже
    for (let j = 0; j < Math.min(h, line); j++) {
      const k = j * w + i; if (!a[k]) continue;
      const o = k * 4;
      if (inner[k]) { t.data[o] = t.data[o + 1] = t.data[o + 2] = 250; t.data[o + 3] = 255; }
      else { f.data[o] = 52; f.data[o + 1] = 32; f.data[o + 2] = 24; f.data[o + 3] = 255; }
    }
  }
  const tc = canvas(w, h); tc.getContext('2d').putImageData(t, 0, 0);
  const fc = canvas(w, h); fc.getContext('2d').putImageData(f, 0, 0);
  setLayer('hero/hair_cap_t', tc, [X, Y]); setLayer('hero/hair_cap_f', fc, [X, Y]);
}

let queue = Promise.resolve();
// Поставить замены (всё остальное — встроенное). Тело — первым: по нему делится одежда.
export function applyHeroArt(map) {
  queue = queue.then(async () => {
    const ims = {};
    for (const [n, e] of Object.entries(map)) { try { ims[n] = await loadImage(e.image); } catch (err) { /* битая картинка — остаётся встроенная */ } }
    restoreAll();
    const order = Object.keys(ims).sort((a, b) => (slotGroup(a) === 'body' ? 0 : 1) - (slotGroup(b) === 'body' ? 0 : 1));
    let bodyDone = false;
    for (const n of order) {
      if (!bodyDone && slotGroup(n) !== 'body') { resetBodyMasks(); bodyDone = true; }
      applyOne(n, map[n], ims[n]);
    }
    resetBodyMasks();
    if (map.head && ims.head) regenCap();
    heroArtChanged();
  }).catch(() => {});
  return queue;
}

// ── Хранение и паки ──
let own = {}, fromPacks = {};
export const mergedHeroArt = () => ({ ...fromPacks, ...own });
export const ownHeroArt = () => ({ ...own });
export const packHeroArt = () => ({ ...fromPacks });
export async function loadOwnHeroArt() {
  try { own = cleanHeroArt(await loadHeroArtStore()); } catch (e) { own = {}; }
  if (Object.keys(own).length) await applyHeroArt(mergedHeroArt());
}
export async function saveOwnHeroArt(map) {
  const next = cleanHeroArt(map);
  await saveHeroArtStore(next);
  own = next;
  await applyHeroArt(mergedHeroArt());
}
export async function setPackHeroArt(raw) {
  const add = cleanHeroArt(raw);
  if (!Object.keys(add).length) return;
  Object.assign(fromPacks, add);
  await applyHeroArt(mergedHeroArt());
}

// Сколько в картинке ярких цветных мест (0…1): много — значит, нарисовано цветным, перекрашивать не надо.
export function colorShare(src) {
  const cv = canvas(Math.min(200, src.width), Math.min(200, src.height)), c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(src, 0, 0, cv.width, cv.height);
  const px = c.getImageData(0, 0, cv.width, cv.height).data;
  let all = 0, col = 0;
  for (let k = 0; k < px.length; k += 4) if (px[k + 3] > 100) { all++; const mx = Math.max(px[k], px[k + 1], px[k + 2]), mn = Math.min(px[k], px[k + 1], px[k + 2]); if (mx > 90 && (mx - mn) / mx > 0.22) col++; }
  return all ? col / all : 0;
}
