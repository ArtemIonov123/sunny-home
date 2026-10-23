// Своя одежда (студия → «Одежда», паки): одна картинка вещи «на герое» и её рамка на холсте героя
// [x, y, w, h]. Картинка делится на серое (перекрашивается) и цветное с контуром — как у встроенной
// одежды (tools/prepare_art.py, split_tint) — и становится слоями hero/wear_<id>_t / _f. Дальше её
// рисуют те же render/hero.js и render/rig.js: вещь режется по костям по своему типу (core/looks.js).
import { HERO_LAYERS, HERO_SIZE } from './heroLayout.js';
import { img, registerImage, forgetImage } from '../assets.js';
import { WEAR_TYPES, registerWear, unregisterWear } from '../core/looks.js';
import { heroArtChanged, drawPart } from './hero.js';

// Образцы для GPT → холст героя: hero = s · точка образца + (x, y).
// Тело (body_stand.png 1024×1536): HERO_OUT 0.5, сверху запас HERO_TOP 330.
// Голова (head.png 1355×1161): в масштабе тела 0.5, подбородок (676, 1110) → шея (512, 250).
export const TEMPLATES = {
  body: { w: 1024, h: 1536, s: 0.5, x: 0, y: 165 },
  head: { w: 1355, h: 1161, s: 0.25, x: 87, y: 12.5 },
};
export const templateOf = (type) => (WEAR_TYPES[type]?.cut === 'head' ? 'head' : 'body');
// Встроенная вещь того же типа — образец места на теле.
export const SAMPLE = { top: 'tshirt', dress: 'dress', pants: 'pants', skirt: 'skirt', shoes: 'sneakers', hat: 'cap', glasses: 'glasses' };

// Рамка слоя на холсте героя (оба его слоя вместе).
export function layerRect(name) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const suf of ['t', 'f']) {
    const k = `hero/${name}_${suf}`, at = HERO_LAYERS[k], im = img(k);
    if (!at || !im) continue;
    x0 = Math.min(x0, at[0]); y0 = Math.min(y0, at[1]); x1 = Math.max(x1, at[0] + im.width); y1 = Math.max(y1, at[1] + im.height);
  }
  return x1 > x0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}
export const sampleBox = (type) => layerRect('wear_' + SAMPLE[type]) || [150, 270, 210, 330];

const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h)); return cv; };

// Серое (почти без цвета и не тёмное) — отдельно: его перекрашивают. Светлое серое тянем к белому.
const isGray = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 75 && (mx - mn) / mx < 0.16; };
export function splitTint(src) {
  const w = src.width, h = src.height;
  const c0 = canvas(w, h).getContext('2d', { willReadFrequently: true });
  c0.drawImage(src, 0, 0);
  const d = c0.getImageData(0, 0, w, h), px = d.data;
  const t = new ImageData(w, h), f = new ImageData(w, h), vals = [];
  for (let k = 0; k < px.length; k += 4) {
    const a = px[k + 3]; if (!a) continue;
    const r = px[k], g = px[k + 1], b = px[k + 2];
    if (isGray(r, g, b)) { const m = Math.max(r, g, b); t.data[k] = t.data[k + 1] = t.data[k + 2] = m; t.data[k + 3] = a; vals.push(m); }
    else { f.data[k] = r; f.data[k + 1] = g; f.data[k + 2] = b; f.data[k + 3] = a; }
  }
  let tc = null;
  if (vals.length) {
    vals.sort((a, b) => a - b);
    const wp = Math.max(1, vals[Math.floor(vals.length * 0.9)]);
    for (let k = 0; k < t.data.length; k += 4) if (t.data[k + 3]) { const v = Math.min(255, Math.round(t.data[k] * 250 / wp)); t.data[k] = t.data[k + 1] = t.data[k + 2] = v; }
    tc = canvas(w, h); tc.getContext('2d').putImageData(t, 0, 0);
  }
  const fc = canvas(w, h); fc.getContext('2d').putImageData(f, 0, 0);
  return { t: tc, f: fc };
}
// Сколько в картинке серого (0…1) — чтобы сразу предложить «перекрашивать».
export function grayShare(src) {
  const cv = canvas(Math.min(200, src.width), Math.min(200, src.height)), c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(src, 0, 0, cv.width, cv.height);
  const px = c.getImageData(0, 0, cv.width, cv.height).data;
  let all = 0, gray = 0;
  for (let k = 0; k < px.length; k += 4) if (px[k + 3] > 100) { all++; if (isGray(px[k], px[k + 1], px[k + 2])) gray++; }
  return all ? gray / all : 0;
}

// Вещь цветом color, как в игре: серое умножается на цвет, цветное и контур — поверх.
export function colored(src, tint, color, w = src.width, h = src.height) {
  const cv = canvas(w, h), c = cv.getContext('2d');
  if (!tint) { c.drawImage(src, 0, 0, cv.width, cv.height); return cv; }
  const base = canvas(w, h); base.getContext('2d').drawImage(src, 0, 0, base.width, base.height);
  const { t, f } = splitTint(base);
  if (t) {
    c.drawImage(t, 0, 0);
    c.globalCompositeOperation = 'multiply'; c.fillStyle = color; c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(t, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }
  c.drawImage(f, 0, 0);
  return cv;
}

// Деление своей вещи по костям (как отдельные части от GPT у встроенной одежды): что лежит на туловище —
// туловищу, что торчит на руке (рукав) — руке, штанины ниже таза — ногам. Маски — по частям тела героя.
const BONE_SUBS = ['torso', 'armUpL', 'armLoL', 'armUpR', 'armLoR', 'legL', 'legR'];
const HIP = 585, LAP = 596, SHOULDER = 188, ARMPIT = 400; // ниже HIP у штанов — штанины; ниже LAP у верха и платья — подол (на туловище)
let masks = null;
function bodyMasks() {
  if (masks) return masks;
  if (!img('hero/body_torso_f') && !img('hero/body_torso_t')) return null; // нет отдельных частей тела — режем по контурам (rig.js)
  const [Wc, Hc] = HERO_SIZE;
  const mk = (names, r) => {
    const cv = canvas(Wc, Hc), c = cv.getContext('2d', { willReadFrequently: true });
    const offs = r ? [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]] : [[0, 0]];
    for (const n of names) for (const suf of ['t', 'f']) {
      const k = `hero/${n}_${suf}`, at = HERO_LAYERS[k], im = img(k);
      if (at && im) for (const [dx, dy] of offs) c.drawImage(im, at[0] + dx, at[1] + dy);
    }
    const px = c.getImageData(0, 0, Wc, Hc).data, a = new Uint8Array(Wc * Hc);
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3] > 60 ? 1 : 0;
    return a;
  };
  masks = { W: Wc, H: Hc, torso: mk(['body_torso'], 0), armUpL: mk(['arm_upper_left'], 10), armLoL: mk(['arm_lower_left', 'hand_grip_left'], 10), armUpR: mk(['arm_upper_right'], 10), armLoR: mk(['arm_lower_right', 'hand_grip_right'], 10) };
  return masks;
}
function boneAt(M, type, X, Y) {
  if (X < 0 || Y < 0 || X >= M.W || Y >= M.H) return 'torso';
  const i = Y * M.W + X;
  if (type === 'pants') return Y > HIP ? (X < M.W / 2 ? 'legL' : 'legR') : 'torso';
  if (Y > LAP) return 'torso';
  // Рукав — всё, что дальше плечевого сустава (JOINTS.shoulder в rig.js) и выше подмышки, на руке.
  const left = X < M.W / 2;
  if (Y < ARMPIT && (left ? X < SHOULDER : X > M.W - SHOULDER) && M[left ? 'armUpL' : 'armUpR'][i]) return left ? 'armUpL' : 'armUpR';
  if (M.torso[i]) return 'torso';
  for (const b of ['armLoL', 'armUpL', 'armLoR', 'armUpR']) if (M[b][i]) return b;
  return 'torso';
}
// parts — { t, f } на рамке box; вернуть { кость: { t, f, at } } (пустые кости пропускаем).
function splitBones(parts, box, type) {
  const M = bodyMasks(); if (!M) return null;
  const x = Math.round(box[0]), y = Math.round(box[1]);
  const src = {}, w = parts.f.width, h = parts.f.height;
  for (const suf of ['t', 'f']) if (parts[suf]) src[suf] = parts[suf].getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const owner = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) owner[j * w + i] = BONE_SUBS.indexOf(boneAt(M, type, x + i, y + j));
  const out = {};
  BONE_SUBS.forEach((bone, bi) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (owner[k] !== bi) continue;
      if (!((src.t && src.t[k * 4 + 3]) || src.f[k * 4 + 3])) continue;
      if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
    }
    if (x1 < 0) return;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, res = { at: [x + x0, y + y0] };
    for (const suf of ['t', 'f']) {
      if (!src[suf]) continue;
      const d = new ImageData(bw, bh);
      let any = false;
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        const k = (y0 + j) * w + x0 + i; if (owner[k] !== bi) continue;
        const a = src[suf][k * 4 + 3]; if (!a) continue;
        const o = (j * bw + i) * 4; d.data[o] = src[suf][k * 4]; d.data[o + 1] = src[suf][k * 4 + 1]; d.data[o + 2] = src[suf][k * 4 + 2]; d.data[o + 3] = a; any = true;
      }
      if (any) { const cv = canvas(bw, bh); cv.getContext('2d').putImageData(d, 0, 0); res[suf] = cv; }
    }
    out[bone] = res;
  });
  return out;
}
// Какие кости у своей вещи есть отдельными слоями (rig.js берёт их вместо вырезания по контурам).
const boneLayers = new Map(); // id → ['torso', 'armUpL', …]
export const garmentBones = (id) => boneLayers.get(id) || null;

const keys = (id) => ['t', 'f'].map((s) => `hero/wear_${id}_${s}`);
function forgetBones(id) {
  for (const bone of boneLayers.get(id) || []) for (const s of ['t', 'f']) { const k = `hero/wear_${id}__${bone}_${s}`; forgetImage(k); delete HERO_LAYERS[k]; }
  boneLayers.delete(id);
}
// Поставить вещь на героя: слои + место в списке одежды. im — загруженная картинка cloth.image.
export function registerGarment(id, cloth, im) {
  const [x, y, w, h] = cloth.box;
  const cv = canvas(w, h); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
  const parts = cloth.tint ? splitTint(cv) : { t: null, f: cv };
  const [kt, kf] = keys(id);
  for (const [k, layer] of [[kt, parts.t], [kf, parts.f]]) {
    if (layer) { registerImage(k, layer); HERO_LAYERS[k] = [Math.round(x), Math.round(y)]; }
    else { forgetImage(k); delete HERO_LAYERS[k]; }
  }
  forgetBones(id);
  if (['top', 'dress', 'pants'].includes(cloth.type)) {
    const bones = splitBones(parts, cloth.box, cloth.type);
    if (bones) {
      for (const [bone, r] of Object.entries(bones)) for (const s of ['t', 'f']) if (r[s]) { const k = `hero/wear_${id}__${bone}_${s}`; registerImage(k, r[s]); HERO_LAYERS[k] = r.at.slice(); }
      boneLayers.set(id, Object.keys(bones));
    }
  }
  registerWear(id, cloth.type, cloth.color);
  heroArtChanged();
}
export function unregisterGarment(id) {
  for (const k of keys(id)) { forgetImage(k); delete HERO_LAYERS[k]; }
  forgetBones(id);
  unregisterWear(id);
  heroArtChanged();
}

// Картинка от GPT → вещь на холсте героя. Нарисована на образце (тот же размер) — встаёт на своё место;
// иначе — вписывается по ширине в место встроенной вещи того же типа. Возвращает { image (обрезано), box }.
export function fitUpload(im, type) {
  const MAXS = 900;
  const src = canvas(im.width, im.height), c = src.getContext('2d', { willReadFrequently: true });
  c.drawImage(im, 0, 0);
  const d = c.getImageData(0, 0, src.width, src.height), px = d.data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0, k = 0; y < src.height; y++) for (let x = 0; x < src.width; x++, k += 4) {
    if (px[k] > 200 && px[k + 2] > 200 && px[k + 1] < 90) px[k + 3] = 0; // фон #FF00FF → прозрачный
    if (px[k + 3] < 40) { px[k + 3] = 0; continue; }
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('Картинка пустая (или фон не прозрачный)');
  c.putImageData(d, 0, 0);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.min(1, MAXS / Math.max(bw, bh));
  const out = canvas(bw * s, bh * s); out.getContext('2d').drawImage(src, x0, y0, bw, bh, 0, 0, out.width, out.height);
  const T = TEMPLATES[templateOf(type)];
  // На образце? Тогда — как нарисовано, если GPT не промахнулся (ширина и середина — близко к встроенной вещи).
  let drawn = null;
  if (Math.abs(im.width / im.height - T.w / T.h) < 0.02) { const k = T.s * T.w / im.width; drawn = [T.x + x0 * k, T.y + y0 * k, bw * k, bh * k]; }
  const sb = sampleBox(type), near = drawn && drawn[2] / sb[2] > 0.7 && drawn[2] / sb[2] < 1.4 && Math.abs(drawn[0] + drawn[2] / 2 - sb[0] - sb[2] / 2) < sb[2] * 0.15;
  const box = near ? drawn : fitToSample(bw / bh, type);
  const r = (b) => b && b.map((v) => Math.round(v * 10) / 10);
  const corner = (x, y) => px[(y * src.width + x) * 4 + 3];
  const opaque = [corner(0, 0), corner(src.width - 1, 0), corner(0, src.height - 1), corner(src.width - 1, src.height - 1)].every((v) => v > 0); // фон не прозрачный
  return { image: out.toDataURL('image/webp', 0.92), box: r(box), drawn: r(drawn), opaque };
}
// Вписать вещь (отношение сторон aspect) по ширине в место встроенной вещи того же типа.
export function fitToSample(aspect, type) {
  const [x, y, w, h] = sampleBox(type), nh = w / aspect;
  const ny = type === 'shoes' || type === 'hat' ? y + h - nh : type === 'glasses' ? y + (h - nh) / 2 : y;
  return [x, ny, w, nh];
}

// Образец для GPT: серое тело (или голова) и голубая встроенная вещь того же типа — «рисуй тут».
export function templateCanvas(type) {
  const kind = templateOf(type), T = TEMPLATES[kind], cv = canvas(T.w, T.h), c = cv.getContext('2d');
  c.scale(1 / T.s, 1 / T.s); c.translate(-T.x, -T.y);
  c.filter = 'grayscale(1)'; // всё тело — серым (у тела есть цветное бельё), вещь-пример — голубая
  if (kind === 'head') drawPart(c, 'head', '#e2e2e2');
  else drawPart(c, 'body_stand', '#e2e2e2');
  c.filter = 'none';
  drawPart(c, 'wear_' + SAMPLE[type], '#9cc8f2');
  return cv;
}
