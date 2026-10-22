// «Скелет» героя: тело разбито на кости (туловище, голова, плечи, предплечья, ноги),
// каждая кость — своя картинка и точка поворота (сустав). Анимация — это только углы костей,
// поэтому одна и та же анимация работает для всех героев и любой одежды.
//
// Сейчас части вырезаются из цельного тела по контурам (CLIP). Когда придут отдельные части
// от GPT (arm_upper_left и т. д.), кость будет собираться из них целиком — без вырезания
// (см. PART_LAYERS: если такие картинки есть, используются они).
import { HERO_SIZE, HERO_LAYERS } from './heroLayout.js';
import { img } from '../assets.js';
import { WEAR_ORDER, WEAR_TOP } from '../core/looks.js';
import { drawPart } from './hero.js';

const W = HERO_SIZE[0];
const mx = (p) => [W - p[0], p[1]]; // зеркально: правая сторона = левая, отражённая по середине
const mxPoly = (poly) => poly.map(mx);

// Суставы (на холсте героя). «Левая» — слева на картинке.
export const JOINTS = {
  neck: [256, 300], hipL: [212, 584], hipR: [300, 584],
  shoulderL: [176, 336], elbowL: [140, 458], shoulderR: mx([176, 336]), elbowR: mx([140, 458]),
};
// Кость: сустав, родитель, область на холсте (чтобы не держать лишние пиксели).
export const BONES = {
  torso:   { at: [256, 584], parent: null, box: [0, 0, W, 900] },
  hairBack:{ at: JOINTS.neck, parent: 'torso', box: [0, 0, W, 340] },
  head:    { at: JOINTS.neck, parent: 'torso', box: [0, 0, W, 340] },
  legL:    { at: JOINTS.hipL, parent: 'torso', box: [120, 560, 140, 320] },
  legR:    { at: JOINTS.hipR, parent: 'torso', box: [252, 560, 140, 320] },
  armUpL:  { at: JOINTS.shoulderL, parent: 'torso', box: [40, 270, 180, 210] },
  armLoL:  { at: JOINTS.elbowL, parent: 'armUpL', box: [40, 440, 140, 200] },
  armUpR:  { at: JOINTS.shoulderR, parent: 'torso', box: [W - 220, 270, 180, 210] },
  armLoR:  { at: JOINTS.elbowR, parent: 'armUpR', box: [W - 180, 440, 140, 200] },
};
// Порядок рисования: сзади вперёд. Руки — за туловищем: так в покое герой выглядит точно как цельная
// картинка (платье и футболка поверх рук), а при подъёме руки плечо прячется под одеждой.
export const ORDER = ['hairBack', 'legL', 'legR', 'armUpL', 'armLoL', 'armUpR', 'armLoR', 'torso', 'head'];
// Части пока вырезаны из цельного тела — большие повороты показали бы срезы, поэтому размах меньше.
// Когда придут отдельные части от GPT (arm_upper_left…), размах станет полным.
const FULL_PARTS = !!HERO_LAYERS['hero/arm_upper_left_t'] || !!HERO_LAYERS['hero/arm_upper_left_f'];
const AMP = FULL_PARTS ? 1 : 0.32;

// Контуры для вырезания из цельного тела (временный способ, пока нет отдельных частей).
const ARM_L = [[0, 262], [216, 262], [190, 405], [181, 506], [150, 506], [150, 680], [0, 680]];
const CLIP = {
  armUpL: { poly: ARM_L, y1: 466 }, armLoL: { poly: ARM_L, y0: 448 },
  armUpR: { poly: mxPoly(ARM_L), y1: 466 }, armLoR: { poly: mxPoly(ARM_L), y0: 448 },
  legL: { rect: [150, 588, 106, 400] }, legR: { rect: [256, 588, 106, 400] }, // не заходят на кисти рук
};
const SLEEVE_Y = 402; // у платья в руки уходят только рукава (подол платья остаётся на туловище)

function path(c, poly) { c.moveTo(poly[0][0], poly[0][1]); for (const p of poly.slice(1)) c.lineTo(p[0], p[1]); c.closePath(); }

// Обрезать по кости bone (или по «туловищу»: всё, кроме рук и ног; noLimbs — для юбки/платья).
function clipFor(c, bone, kind) {
  c.beginPath();
  if (bone === 'torso') {
    c.rect(0, 0, W, 2000);
    if (kind === 'free') return; // юбка — целиком на туловище
    for (const k of ['armUpL', 'armUpR']) {
      const poly = CLIP[k].poly;
      if (kind === 'sleeves') { const minY = Math.min(...poly.map((p) => p[1])); path(c, [[poly[0][0], minY], [poly[1][0], minY], [poly[2][0], SLEEVE_Y], [poly[0][0], SLEEVE_Y]]); }
      else path(c, poly);
    }
    if (kind !== 'sleeves') { c.rect(...CLIP.legL.rect); c.rect(...CLIP.legR.rect); }
    c.clip('evenodd');
    return;
  }
  const cl = CLIP[bone];
  if (!cl) return;
  if (cl.rect) c.rect(...cl.rect);
  else {
    path(c, cl.poly); c.clip();
    c.beginPath();
    const y0 = cl.y0 ?? 0, y1 = kind === 'sleeves' ? Math.min(cl.y1 ?? 2000, SLEEVE_Y) : (cl.y1 ?? 2000);
    c.rect(0, y0, W, Math.max(0, y1 - y0));
  }
  c.clip();
}

// Отдельные части от GPT: слой → кость целиком (без вырезания).
const PART_BONES = {
  body_torso: 'torso', arm_upper_left: 'armUpL', arm_upper_right: 'armUpR', arm_lower_left: 'armLoL', arm_lower_right: 'armLoR',
  leg_left: 'legL', leg_right: 'legR',
  wear_tshirt_body: 'torso', wear_tshirt_sleeve_left: 'armUpL', wear_tshirt_sleeve_right: 'armUpR',
  wear_dress_body: 'torso', wear_dress_sleeve_left: 'armUpL', wear_dress_sleeve_right: 'armUpR',
  wear_pants_hips: 'torso', wear_pants_leg_left: 'legL', wear_pants_leg_right: 'legR',
};
const has = (layer) => !!(HERO_LAYERS[`hero/${layer}_t`] || HERO_LAYERS[`hero/${layer}_f`]);

// Какие слои в какую кость: [слой, цвет, способ].
//  'all'     — режется по костям (тело, футболка, штаны, кеды);
//  'sleeves' — в руки только рукава (платье);
//  'free'    — только на туловище (юбка).
function sources(look, grip = {}) {
  if (FULL_PARTS) return partSources(look, grip);
  const out = [['body_stand', look.skin, 'all']];
  for (const w of WEAR_ORDER) {
    if (!look.wear[w]) continue;
    out.push(['wear_' + w, look.wear[w], w === 'dress' ? 'sleeves' : w === 'skirt' ? 'free' : 'all']);
  }
  return out;
}

// Режим отдельных частей: каждая часть — в свою кость. Кулачок вместо ладошки, если рука что-то держит.
function partSources(look, grip) {
  const out = [];
  const add = (layer, color) => { if (has(layer)) out.push([layer, color, 'bone:' + PART_BONES[layer]]); };
  for (const n of ['leg_left', 'leg_right', 'arm_upper_left', 'arm_upper_right', 'body_torso']) add(n, look.skin);
  for (const [side, bone] of [['left', 'armLoL'], ['right', 'armLoR']]) {
    const n = grip[side] && has('hand_grip_' + side) ? 'hand_grip_' + side : 'arm_lower_' + side;
    if (has(n)) out.push([n, look.skin, 'bone:' + bone]);
  }
  for (const w of WEAR_ORDER) {
    const c = look.wear[w]; if (!c) continue;
    if (w === 'tshirt' || w === 'dress') { add(`wear_${w}_body`, c); add(`wear_${w}_sleeve_left`, c); add(`wear_${w}_sleeve_right`, c); }
    else if (w === 'pants') { add('wear_pants_hips', c); add('wear_pants_leg_left', c); add('wear_pants_leg_right', c); }
    else if (w === 'sneakers') out.push(['wear_sneakers', c, 'legs']); // кеды делим пополам: левый и правый
    else out.push(['wear_' + w, c, 'free']);
  }
  return out;
}

const KIND_BONES = { all: ['torso', 'legL', 'legR', 'armUpL', 'armLoL', 'armUpR', 'armLoR'], sleeves: ['torso', 'armUpL', 'armUpR'], free: ['torso'], legs: ['legL', 'legR'] };
const bonesOf = (kind) => (kind.startsWith('bone:') ? [kind.slice(5)] : KIND_BONES[kind]);

// Собрать кости для внешности. face — временное лицо (смех и т. п.).
export function buildRig(look, face = null, grip = {}) {
  // Что в какую кость: [слой, цвет, способ обрезки].
  const plan = Object.fromEntries(ORDER.map((n) => [n, []]));
  for (const [layer, color, kind] of sources(look, grip)) for (const bone of bonesOf(kind)) plan[bone].push([layer, color, kind]);
  if (look.hair === 'long') plan.hairBack.push(['hair_long_back', look.hairColor, 'bone:hairBack']);
  const hair = look.hair === 'long' ? 'long_front' : look.hair;
  plan.head.push(['head', look.skin, 'bone:head'], ['face_' + (face || look.face), null, 'bone:head']);
  if (hair !== 'none') plan.head.push(['hair_' + hair, look.hairColor, 'bone:head']);
  for (const w of WEAR_TOP) if (look.wear[w]) plan.head.push(['wear_' + w, look.wear[w], 'bone:head']);

  // Холст кости — по размеру того, что в ней нарисовано (части от GPT могут быть больше вырезанных).
  const bones = {};
  for (const name of ORDER) {
    const list = plan[name];
    if (!list.length) { bones[name] = { used: false }; continue; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [layer] of list) for (const suf of ['t', 'f']) {
      const key = `hero/${layer}_${suf}`, at = HERO_LAYERS[key], im = img(key);
      if (!at || !im) continue;
      x0 = Math.min(x0, at[0]); y0 = Math.min(y0, at[1]); x1 = Math.max(x1, at[0] + im.width); y1 = Math.max(y1, at[1] + im.height);
    }
    const box = BONES[name].box; // не шире области кости (вырезанные части)
    if (!list.every(([, , k]) => k.startsWith('bone:'))) { x0 = Math.max(x0, box[0]); y0 = Math.max(y0, box[1]); x1 = Math.min(x1, box[0] + box[2]); y1 = Math.min(y1, box[1] + box[3]); }
    if (!(x1 > x0 && y1 > y0)) { bones[name] = { used: false }; continue; }
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(x1 - x0); cv.height = Math.ceil(y1 - y0);
    const c = cv.getContext('2d');
    c.translate(-x0, -y0);
    for (const [layer, color, kind] of list) { c.save(); if (!kind.startsWith('bone:')) clipFor(c, name, kind); drawPart(c, layer, color); c.restore(); }
    bones[name] = { cv, x: x0, y: y0, used: true };
  }
  return { bones, h: HERO_LAYERS['hero/body_stand_f'][1] + (img('hero/body_stand_f')?.height || 600) };
}

// Нарисовать героя по позе. b — рамка героя в мире (как у картинки), pose — углы костей.
export function drawRig(ctx, rig, b, pose = {}) {
  const k = b.h / rig.h;
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h);
  ctx.scale(k, k);
  ctx.translate(-W / 2, -rig.h);
  const apply = (name) => {
    const bone = BONES[name];
    if (bone.parent) apply(bone.parent);
    const a = pose[name] || 0;
    const [px, py] = bone.at;
    if (name === 'torso' && pose.bob) ctx.translate(0, pose.bob);
    if (a) { ctx.translate(px, py); ctx.rotate(a); ctx.translate(-px, -py); }
  };
  for (const name of ORDER) {
    const bn = rig.bones[name];
    if (!bn.used) continue;
    ctx.save(); apply(name); ctx.drawImage(bn.cv, bn.x, bn.y); ctx.restore();
  }
  ctx.restore();
}

// Готовые скелеты героев (собираются вместе с картинкой героя в refreshHero).
const rigs = new Map();
export const setRig = (id, rig) => rigs.set(id, rig);
export const getRig = (id) => rigs.get(id);

// ── Движения ──
// Углы: плюс — по часовой. Для левой руки «наружу» = плюс, для правой = минус.
const now = () => performance.now() / 1000;
const motions = new Map(); // id → { type, t0, dur }
export const rigAnims = {
  play(id, type, dur) { motions.set(id, { type, t0: now(), dur }); },
  wave(id) { this.play(id, 'wave', 1.4); },
  cheer(id) { this.play(id, 'cheer', 0.8); },
  active() { const t = now(); for (const [k, m] of motions) if (t - m.t0 > m.dur) motions.delete(k); return motions.size > 0; },
};

// Поза героя сейчас. carried — герой в руке (скорость для болтания ногами).
export function heroPose(id, { carried = false, tilt = 0 } = {}) {
  const t = now(), ph = (id.charCodeAt(0) % 7) * 0.9; // у каждого героя своя фаза — не дышат хором
  const breathe = Math.sin(t * 2.2 + ph);
  const pose = {
    bob: breathe * 1.6,
    head: Math.sin(t * 1.1 + ph) * 0.025,
    armUpL: 0.03 + breathe * 0.02, armUpR: -0.03 - breathe * 0.02,
    armLoL: 0.02, armLoR: -0.02,
  };
  if (carried) {
    // Ноги болтаются, руки чуть разведены, тело отстаёт от движения пальца.
    const sw = Math.sin(t * 9 + ph);
    const lag = Math.max(-0.25, Math.min(0.25, -tilt * 1.5)); // ноги отстают от движения
    pose.legL = sw * 0.16 * AMP + lag; pose.legR = -sw * 0.16 * AMP + lag;
    pose.armUpL = (0.45 + Math.sin(t * 7) * 0.12) * AMP; pose.armUpR = (-0.45 - Math.sin(t * 7 + 1) * 0.12) * AMP;
    pose.armLoL = 0.25; pose.armLoR = -0.25;
    pose.head = -tilt * 0.6;
  }
  const m = motions.get(id);
  if (m) {
    const p = Math.min(1, (t - m.t0) / m.dur), env = Math.sin(Math.PI * Math.min(1, p * 1.2)); // плавно вверх и обратно
    if (m.type === 'wave') {
      pose.armUpR = -0.03 - 2.3 * AMP * env;
      pose.armLoR = (-0.6 * env + Math.sin(t * 14) * 0.45 * env) * AMP;
      pose.head = 0.08 * env;
    } else if (m.type === 'cheer') {
      pose.armUpL = 0.03 + 2.2 * AMP * env; pose.armUpR = -0.03 - 2.2 * AMP * env;
      pose.armLoL = 0.5 * AMP * env; pose.armLoR = -0.5 * AMP * env;
      pose.legL = 0.12 * AMP * env; pose.legR = -0.12 * AMP * env;
    }
  }
  return pose;
}
