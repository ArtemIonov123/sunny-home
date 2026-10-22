// Животные: один «скелет» для всех четвероногих (вид сбоку, смотрит вправо).
// Части — отдельные картинки одного размера, каждая нарисована на своём месте (как у целого животного):
// туловище, голова (и голова «спит»), хвост, четыре лапы — ближние и дальние.
// Суставы — точки на этом общем холсте (в долях), их можно поправить в студии.
// Любое животное двигается одинаково: дышит, виляет хвостом, ходит, болтает лапами, спит.
import { img, registerImage } from '../assets.js';

// Части скелета: имя → подпись (для студии) и суффикс файла от GPT (animal_dog_<суффикс>.png).
export const ANIMAL_PARTS = {
  body:      { name: 'Туловище',              file: 'body', need: true },
  head:      { name: 'Голова',                file: 'head', need: true },
  headSleep: { name: 'Голова спит',           file: 'head_sleep' },
  tail:      { name: 'Хвост',                 file: 'tail' },
  legFN:     { name: 'Передняя лапа ближняя', file: 'leg_front_near', need: true },
  legFF:     { name: 'Передняя лапа дальняя', file: 'leg_front_far', need: true },
  legBN:     { name: 'Задняя лапа ближняя',   file: 'leg_back_near', need: true },
  legBF:     { name: 'Задняя лапа дальняя',   file: 'leg_back_far', need: true },
};
// Суставы: к чему крепится часть (всё — к туловищу).
export const JOINT_PARTS = ['head', 'tail', 'legFN', 'legFF', 'legBN', 'legBF'];
// Голоса животных (звуки — в audio.js).
export const VOICES = { woof: 'Гав', meow: 'Мяу', squeak: 'Пи-пи', chirp: 'Чирик', moo: 'Му', '': 'Без звука' };

// Сзади вперёд: дальние лапы и хвост — за туловищем, ближние лапы и голова — перед ним.
const ORDER = ['legBF', 'legFF', 'tail', 'body', 'legBN', 'legFN', 'head'];

// Где на картинке есть рисунок (рамка непрозрачных пикселей) и сами пиксели (для суставов).
const alphaCache = new WeakMap();
function alphaOf(im) {
  if (alphaCache.has(im)) return alphaCache.get(im);
  const W = im.width, H = im.height, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(im, 0, 0);
  const d = c.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = d[(y * W + x) * 4 + 3]; a[y * W + x] = v;
    if (v > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const out = { W, H, a, box: x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1] };
  alphaCache.set(im, out);
  return out;
}

// Сустав «сам»: середина места, где часть заходит на туловище; нет нахлёста — верх части (у хвоста — край к туловищу).
export function autoJoint(partIm, bodyIm, part) {
  const A = alphaOf(partIm), B = alphaOf(bodyIm);
  if (!A.box) return [0.5, 0.5];
  const sx = B.W / A.W, sy = B.H / A.H;
  let n = 0, mx = 0, my = 0;
  const [x0, y0, x1, y1] = A.box;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    if (A.a[y * A.W + x] < 128) continue;
    if (B.a[Math.floor(y * sy) * B.W + Math.floor(x * sx)] < 128) continue;
    n++; mx += x; my += y;
  }
  if (n > 20) return [mx / n / A.W, my / n / A.H];
  if (part === 'tail') return [x1 / A.W, (y0 + y1) / 2 / A.H]; // хвост слева от туловища — крепится правым краем
  if (part === 'head') return [x0 / A.W, y1 / A.H];
  return [(x0 + x1) / 2 / A.W, y0 / A.H];
}

// Собрать скелет. a = def.animal: { parts: {часть: ключ картинки}, joints: {часть: [fx, fy]} }.
// Возвращает null, если картинок ещё нет.
export function buildAnimal(a) {
  const ims = {};
  for (const [k, key] of Object.entries(a.parts || {})) { const im = img(key); if (im) ims[k] = im; }
  if (!ims.body || !ims.head) return null;
  const W = ims.body.width, H = ims.body.height;
  const parts = {};
  let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity;
  for (const [k, im] of Object.entries(ims)) {
    const A = alphaOf(im); if (!A.box) continue;
    const s = W / im.width; // все части — в масштабе туловища
    const [x0, y0, x1, y1] = A.box.map((v) => v * s);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(x1 - x0)); cv.height = Math.max(1, Math.ceil(y1 - y0));
    cv.getContext('2d').drawImage(im, -x0, -y0, im.width * s, im.height * s);
    parts[k] = { cv, x: x0, y: y0 };
    if (k !== 'headSleep') { ux0 = Math.min(ux0, x0); uy0 = Math.min(uy0, y0); ux1 = Math.max(ux1, x1); uy1 = Math.max(uy1, y1); }
  }
  const joints = {};
  for (const k of JOINT_PARTS) {
    if (!parts[k]) continue;
    const j = a.joints?.[k] || autoJoint(ims[k], ims.body, k);
    joints[k] = [j[0] * W, j[1] * H];
  }
  if (parts.headSleep) joints.headSleep = joints.head;
  // Длина лап — чтобы лечь (туловище опускается) и не провалиться в пол.
  const legLen = parts.legFN ? parts.legFN.y + parts.legFN.cv.height - (joints.legFN?.[1] ?? parts.legFN.y) : 0;
  const bc = parts.body ? [parts.body.x + parts.body.cv.width / 2, parts.body.y + parts.body.cv.height / 2] : [W / 2, H / 2];
  return { parts, joints, box: [ux0, uy0, ux1, uy1], W, H, legLen, bc };
}

// Картинка целиком (для шкафчика, магазина, руки героя, «попадания» пальцем) — из частей, обрезана по рамке.
export function composeAnimal(rig, pose = {}) {
  const [x0, y0, x1, y1] = rig.box;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(x1 - x0)); cv.height = Math.max(1, Math.round(y1 - y0));
  const c = cv.getContext('2d');
  c.translate(-x0, -y0);
  drawParts(c, rig, pose);
  return cv;
}

function drawParts(ctx, rig, pose) {
  const [bx, by] = rig.bc;
  ctx.save();
  // Туловище: покачивание (bob) и наклон вокруг середины.
  ctx.translate(0, pose.bob || 0);
  if (pose.rot) { ctx.translate(bx, by); ctx.rotate(pose.rot); ctx.translate(-bx, -by); }
  for (const name of ORDER) {
    const key = name === 'head' && pose.sleep && rig.parts.headSleep ? 'headSleep' : name;
    const p = rig.parts[key]; if (!p) continue;
    ctx.save();
    const j = rig.joints[name], a = pose[name] || 0;
    if (j && a) { ctx.translate(j[0], j[1]); ctx.rotate(a); ctx.translate(-j[0], -j[1]); }
    ctx.drawImage(p.cv, p.x, p.y);
    ctx.restore();
  }
  ctx.restore();
}

// Нарисовать животное в рамке b (мир): рамка = рамка картинки целиком. flip — смотрит влево.
export function drawAnimal(ctx, rig, b, pose = {}, flip = false) {
  const [x0, y0, x1, y1] = rig.box, k = b.w / (x1 - x0);
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y);
  if (flip) ctx.scale(-1, 1);
  ctx.translate(-b.w / 2, 0);
  ctx.scale(k, k);
  ctx.translate(-x0, -y0 + (pose.dy || 0));
  drawParts(ctx, rig, pose);
  ctx.restore();
}

// ── Скелеты животных (по id определения) ──
const rigs = new Map();
export const getAnimal = (defId) => rigs.get(defId) || null;
// Собрать скелет и картинку целиком (def.art). Вызывать, когда картинки частей загружены.
export function setupAnimal(def) {
  const rig = buildAnimal(def.animal);
  if (!rig) return null;
  rigs.set(def.id, rig);
  if (!img(def.art)) { // своё животное уже с картинкой целиком (из студии); встроенному — собираем
    const cv = composeAnimal(rig);
    cv.src = cv.toDataURL('image/webp', 0.9); // для шкафчика и списков (<img src>)
    registerImage(def.art, cv);
  }
  return rig;
}
export const forgetAnimal = (defId) => rigs.delete(defId);

// ── Движения ──
const now = () => performance.now() / 1000;
const motions = new Map(); // id вещи → { type, t0, dur }
export const animalAnims = {
  happy(id) { motions.set(id, { type: 'happy', t0: now(), dur: 1.3 }); },
  active() { const t = now(); for (const [k, m] of motions) if (t - m.t0 > m.dur) motions.delete(k); return motions.size > 0; },
};

// Поза: id — вещь (своя фаза дыхания), walk — { phase, amp } (идёт), carried — в руке, sleep — ночь.
export function animalPose(id, { walk = null, carried = false, tilt = 0, sleep = false, rig = null } = {}) {
  const t = now(), ph = (Number(id) || 0) * 1.7;
  const breathe = Math.sin(t * 2.4 + ph);
  const pose = { bob: breathe * 2, head: Math.sin(t * 0.9 + ph) * 0.05, tail: Math.sin(t * 3 + ph) * 0.18 };
  if (walk) {
    const s = Math.sin(walk.phase), a = walk.amp ?? 1;
    pose.legFN = s * 0.5 * a; pose.legBF = s * 0.5 * a;      // лапы — по диагонали, как у настоящих
    pose.legFF = -s * 0.5 * a; pose.legBN = -s * 0.5 * a;
    pose.bob = -Math.abs(s) * 8 * a;
    pose.head = Math.sin(walk.phase * 2) * 0.05 * a;
    pose.tail = Math.sin(t * 10) * 0.3;
  } else if (carried) {
    // В руке: лапы болтаются, хвост машет, тело чуть отстаёт.
    const sw = Math.sin(t * 9 + ph);
    pose.legFN = sw * 0.3 - tilt; pose.legFF = -sw * 0.25 - tilt; pose.legBN = -sw * 0.3 - tilt; pose.legBF = sw * 0.25 - tilt;
    pose.tail = Math.sin(t * 12) * 0.4;
    pose.head = -tilt * 0.5 - 0.08;
  } else if (sleep) {
    // Спит: лёг (лапы поджаты, туловище ниже), закрыл глаза, медленно дышит.
    const slow = Math.sin(t * 1.2 + ph);
    pose.sleep = true;
    pose.dy = (rig?.legLen || 0) * 0.72;                              // туловище опустилось на пол
    pose.legFN = -1.4; pose.legFF = -1.3; pose.legBN = -1.45; pose.legBF = -1.35; // все лапы поджаты вперёд, под себя
    pose.head = 0.18; pose.bob = slow * 1.5; pose.tail = 0.35;
  }
  const m = motions.get(id);
  if (m && !sleep) {
    const p = Math.min(1, (t - m.t0) / m.dur), env = Math.sin(Math.PI * p);
    if (m.type === 'happy') { pose.tail = Math.sin(t * 24) * 0.5 * env + pose.tail * (1 - env); pose.head = -0.15 * env; }
  }
  return pose;
}
