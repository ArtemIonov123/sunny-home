// «Скелет» героя: тело разбито на кости (туловище, голова, плечи, предплечья, ноги),
// каждая кость — своя картинка и точка поворота (сустав). Анимация — это только углы костей,
// поэтому одна и та же анимация работает для всех героев и любой одежды.
//
// Сейчас части вырезаются из цельного тела по контурам (CLIP). Когда придут отдельные части
// от GPT (arm_upper_left и т. д.), кость будет собираться из них целиком — без вырезания
// (см. PART_LAYERS: если такие картинки есть, используются они).
import { HERO_SIZE, HERO_LAYERS } from './heroLayout.js';
import { img } from '../assets.js';
import { WEAR, WEAR_TYPES, bodyWear, headWear, stiffOf } from '../core/looks.js';
import { garmentBones } from './garment.js';
import { drawPart } from './hero.js';

const W = HERO_SIZE[0];
const mx = (p) => [W - p[0], p[1]]; // зеркально: правая сторона = левая, отражённая по середине
const mxPoly = (poly) => poly.map(mx);

// Суставы (на холсте героя). «Левая» — слева на картинке.
// Отдельные части от GPT есть? Тогда суставы — по ним (посчитаны по перекрытию частей), иначе — по вырезанному телу.
const HAS_PARTS = !!HERO_LAYERS['hero/arm_upper_left_t'] || !!HERO_LAYERS['hero/arm_upper_left_f'];
const SH = HAS_PARTS ? [185, 336] : [176, 336], EL = HAS_PARTS ? [148, 442] : [140, 458];
export const JOINTS = {
  neck: [256, 300], hipL: HAS_PARTS ? [211, 580] : [212, 584], hipR: HAS_PARTS ? [301, 580] : [300, 584],
  shoulderL: SH, elbowL: EL, shoulderR: mx(SH), elbowR: mx(EL),
  kneeL: [207, 700], kneeR: [305, 700],
};
const KNEE_Y = 700, KNEE_LAP = 8, LAP_Y = 596; // LAP_Y — низ голого туловища: ниже — только подол // ногу делим на бедро и голень по колену (с небольшим нахлёстом — без щели)
export const HIP_Y = 580;          // таз на холсте героя: сидя он — на сиденье, лёжа — вокруг него поворот
// Кость: сустав, родитель, область на холсте (чтобы не держать лишние пиксели).
export const BONES = {
  torso:   { at: [256, 584], parent: null, box: [0, 0, W, 900] },
  hairBack:{ at: JOINTS.neck, parent: 'torso', box: [0, 0, W, 340] },
  head:    { at: JOINTS.neck, parent: 'torso', box: [0, 0, W, 340] },
  legL:    { at: JOINTS.hipL, parent: 'torso', box: [120, 560, 140, 320] },
  legR:    { at: JOINTS.hipR, parent: 'torso', box: [252, 560, 140, 320] },
  lap:     { at: [256, 580], parent: 'torso', box: [0, 560, W, 340] }, // подол ниже таза: сидя ложится на колени
  shinL:   { at: JOINTS.kneeL, parent: 'legL', box: [120, 560, 140, 320] },
  shinR:   { at: JOINTS.kneeR, parent: 'legR', box: [252, 560, 140, 320] },
  armUpL:  { at: JOINTS.shoulderL, parent: 'torso', box: [40, 270, 180, 210] },
  armLoL:  { at: JOINTS.elbowL, parent: 'armUpL', box: [40, 440, 140, 200] },
  armUpR:  { at: JOINTS.shoulderR, parent: 'torso', box: [W - 220, 270, 180, 210] },
  armLoR:  { at: JOINTS.elbowR, parent: 'armUpR', box: [W - 180, 440, 140, 200] },
};
// Порядок рисования: сзади вперёд. Руки — за туловищем: так в покое герой выглядит точно как цельная
// картинка (платье и футболка поверх рук), а при подъёме руки плечо прячется под одеждой.
export const ORDER = ['hairBack', 'shinL', 'shinR', 'legL', 'legR', 'armUpL', 'armLoL', 'armUpR', 'armLoR', 'torso', 'lap', 'head'];
// В своей одежде (студия) руки от локтя — поверх неё: пышная юбка или подол от GPT не закрывают ладошки.
const ORDER_HANDS = ['hairBack', 'shinL', 'shinR', 'legL', 'legR', 'armUpL', 'armUpR', 'torso', 'lap', 'armLoL', 'armLoR', 'head'];
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
// Как вещь режется по костям — по её типу (core/looks.js).
// Надета своя или заменённая вещь с подолом (верх, платье, юбка) — руки от локтя рисуем поверх одежды.
export const handsOverWear = (look) => bodyWear(look.wear).some((w) => (WEAR[w].custom || replacedWear.has(w)) && ['top', 'outer', 'dress', 'skirt'].includes(WEAR[w].type));
// Встроенные вещи, которым заменили картинку (студия → «Герои»): старые части от GPT им уже не подходят.
export const replacedWear = new Set();
const cutOf = (w) => WEAR_TYPES[WEAR[w]?.type]?.cut || 'free';
const has = (layer) => !!(HERO_LAYERS[`hero/${layer}_t`] || HERO_LAYERS[`hero/${layer}_f`]);

// Какие слои в какую кость: [слой, цвет, способ].
//  'all'     — режется по костям (тело, футболка, штаны, кеды);
//  'sleeves' — в руки только рукава (платье);
//  'free'    — только на туловище (юбка).
function sources(look, grip = {}) {
  if (FULL_PARTS) return partSources(look, grip);
  const out = [['body_stand', look.skin, 'all']];
  for (const w of bodyWear(look.wear)) out.push(['wear_' + w, look.wear[w], cutOf(w)]);
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
  for (const w of bodyWear(look.wear)) {
    const c = look.wear[w];
    // Своя вещь или заменённая встроенная: поделена по костям заранее (render/garment.js) или режется по контурам.
    const bones = garmentBones(w);
    if (bones) { for (const bone of bones) out.push([`wear_${w}__${bone}`, c, 'bone:' + bone]); continue; }
    if (WEAR[w].custom || replacedWear.has(w)) { out.push(['wear_' + w, c, cutOf(w)]); continue; }
    if (w === 'tshirt' || w === 'dress') { add(`wear_${w}_body`, c); add(`wear_${w}_sleeve_left`, c); add(`wear_${w}_sleeve_right`, c); }
    else if (w === 'pants') { add('wear_pants_hips', c); add('wear_pants_leg_left', c); add('wear_pants_leg_right', c); }
    else if (w === 'sneakers') out.push(['wear_sneakers', c, 'legs']); // кеды делим пополам: левый и правый
    else out.push(['wear_' + w, c, 'free']);
  }
  return out;
}

const KIND_BONES = { all: ['torso', 'legL', 'legR', 'armUpL', 'armLoL', 'armUpR', 'armLoR'], sleeves: ['torso', 'armUpL', 'armUpR'], free: ['torso'], legs: ['shinL', 'shinR'] };
const bonesOf = (kind) => (kind.startsWith('bone:') ? [kind.slice(5)] : KIND_BONES[kind]);

// Собрать кости для внешности. face — временное лицо (смех и т. п.).
export function buildRig(look, face = null, grip = {}) {
  // Что в какую кость: [слой, цвет, способ обрезки].
  const plan = Object.fromEntries(ORDER.map((n) => [n, []]));
  for (const [layer, color, kind] of sources(look, grip)) for (const bone of bonesOf(kind)) plan[bone].push([layer, color, kind]);
  // Нога → бедро (legL) и голень (shinL): та же картинка, разрезанная по колену. Так герой может сесть.
  for (const [leg, shin] of [['legL', 'shinL'], ['legR', 'shinR']]) plan[shin].unshift(...plan[leg]);
  plan.lap = plan.torso.slice(); // туловище ниже таза (юбка, подол платья) — отдельной костью
  if (look.hair === 'long') plan.hairBack.push(['hair_long_back', look.hairColor, 'bone:hairBack']);
  const hair = look.hair === 'long' ? 'long_front' : look.hair;
  plan.head.push(['head', look.skin, 'bone:head'], ['face_' + (face || look.face), null, 'bone:head']);
  if (hair !== 'none') { if (HERO_LAYERS[`hero/hair_${hair}_t`]) plan.head.push(['hair_cap', look.hairColor, 'bone:head']); plan.head.push(['hair_' + hair, look.hairColor, 'bone:head']); } // шапочка — только под перекрашиваемой причёской
  for (const w of headWear(look.wear)) plan.head.push(['wear_' + w, look.wear[w], 'bone:head']);

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
    const knee = KNEE_CUT[name];
    if (knee) { y0 = Math.max(y0, knee[0]); y1 = Math.min(y1, knee[1]); }
    if (!(x1 > x0 && y1 > y0)) { bones[name] = { used: false }; continue; }
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(x1 - x0); cv.height = Math.ceil(y1 - y0);
    const c = cv.getContext('2d');
    c.translate(-x0, -y0);
    for (const [layer, color, kind] of list) {
      c.save();
      const ck = kind.startsWith('bone:') ? null : kind === 'legs' ? (name === 'shinL' ? 'legL' : 'legR') : name.startsWith('shin') ? (name === 'shinL' ? 'legL' : 'legR') : name === 'lap' ? 'torso' : name;
      if (ck) clipFor(c, ck, kind);
      if (knee) { c.beginPath(); c.rect(0, knee[0], W, knee[1] - knee[0]); c.clip(); }
      drawPart(c, layer, color); c.restore();
    }
    bones[name] = { cv, x: x0, y: y0, used: true };
  }
  const stiff = bodyWear(look.wear).some((w) => (WEAR[w].custom || replacedWear.has(w)) && ['top', 'outer', 'dress'].includes(WEAR[w].type) && stiffOf(w));
  const handsFront = FULL_PARTS && handsOverWear(look);
  return { bones, stiff, handsFront, h: HERO_LAYERS['hero/body_stand_f'][1] + (img('hero/body_stand_f')?.height || 600) };
}

// Где режется нога: бедро — выше колена, голень — ниже.
const KNEE_CUT = { torso: [0, LAP_Y + 2], lap: [LAP_Y - 2, 2000], legL: [0, KNEE_Y + KNEE_LAP], legR: [0, KNEE_Y + KNEE_LAP], shinL: [KNEE_Y - KNEE_LAP, 2000], shinR: [KNEE_Y - KNEE_LAP, 2000] };

// Голова спящего на подушке: наклон (рад, минус — макушкой к изголовью) и размер.
export const LIE = { tilt: -1.2, scale: 0.8, arm: -0.4, fore: -1.2 }; // arm, fore — руки сложены на одеяле

// Нарисовать героя по позе. b — рамка героя в мире (как у картинки), pose — углы костей.
const HAND = [412, 578], MOUTH = [256, 236]; // правая ладошка и рот на холсте героя

// Углы плеча и предплечья, чтобы ладошка оказалась у рта (две кости, локоть — внутрь, через грудь).
let reachCache = null;
function reachMouth() {
  if (reachCache) return reachCache;
  const S = JOINTS.shoulderR, E = JOINTS.elbowR, T = [MOUTH[0] + 18, MOUTH[1] + 12];
  const L1 = Math.hypot(E[0] - S[0], E[1] - S[1]), L2 = Math.hypot(HAND[0] - E[0], HAND[1] - E[1]);
  const d = Math.min(Math.hypot(T[0] - S[0], T[1] - S[1]), L1 + L2 - 1);
  const a0 = Math.atan2(E[1] - S[1], E[0] - S[0]), b0 = Math.atan2(HAND[1] - E[1], HAND[0] - E[0]);
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  const elbowDir = Math.atan2(T[1] - S[1], T[0] - S[0]) - al;
  const E2 = [S[0] + L1 * Math.cos(elbowDir), S[1] + L1 * Math.sin(elbowDir)];
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const up = norm(elbowDir - a0), lo = norm(Math.atan2(T[1] - E2[1], T[0] - E2[0]) - b0 - up);
  return (reachCache = [up, lo]);
}
let biteCv = null;

// held — вещи в руке: [{ im, w, h (в мире), bites, drink }].
// В своей одежде с рукавами (студия) плечо почти не двигается — машет рука от локтя: так рукав,
// нарисованный одной картинкой, не отрывается от платья или кофты.
const STIFF_KEEP = 0.12;
function stiffen(pose) {
  const p = { ...pose };
  for (const s of ['L', 'R']) { const up = p['armUp' + s] || 0; p['armUp' + s] = up * STIFF_KEEP; p['armLo' + s] = (p['armLo' + s] || 0) + up * (1 - STIFF_KEEP); }
  return p;
}
export function drawRig(ctx, rig, b, pose = {}, held = []) {
  if (rig.stiff) pose = stiffen(pose);
  const k = b.h / rig.h;
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h);
  ctx.scale(k, k);
  ctx.translate(-W / 2, -rig.h);
  // Лёжа — весь герой повёрнут вокруг таза (головой влево, на подушку).
  if (pose.lieHead) {
    // Под одеялом: только голова на подушке — шея у края одеяла, голова чуть наклонена и чуть меньше.
    ctx.translate(W / 2, HIP_Y); ctx.rotate(LIE.tilt); ctx.scale(LIE.scale, LIE.scale); ctx.translate(-W / 2, -JOINTS.neck[1]);
  } else if (pose.lie) { ctx.translate(W / 2, HIP_Y); ctx.rotate(-Math.PI / 2); ctx.translate(-W / 2, -JOINTS.neck[1]); } // шея — в точке сиденья, тело — вправо
  // squash — кость «сплющена» вдоль себя (бедро, направленное на нас, когда герой сидит).
  // Сама кость рисуется сплющенной, а дочерняя (голень) просто переезжает к новому колену.
  const sq = pose.squash || {};
  const apply = (name, self = true) => {
    const bone = BONES[name];
    if (bone.parent) {
      apply(bone.parent, false);
      const s = sq[bone.parent];
      if (s) ctx.translate(0, (bone.at[1] - BONES[bone.parent].at[1]) * (s - 1));
    }
    const a = pose[name] || 0;
    const [px, py] = bone.at;
    if (name === 'torso' && pose.bob) ctx.translate(0, pose.bob);
    if (a) { ctx.translate(px, py); ctx.rotate(a); ctx.translate(-px, -py); }
    if (self && sq[name]) { ctx.translate(px, py); ctx.scale(1, sq[name]); ctx.translate(-px, -py); }
  };
  let mHand = null, mHead = null;
  // Кости из pose.front рисуются сразу после туловища (перед ним), остальные — по порядку.
  const front = pose.front || [];
  const base = rig.handsFront ? ORDER_HANDS : ORDER;
  const order = front.length ? base.filter((n) => !front.includes(n)).flatMap((n) => (n === 'torso' ? ['torso', ...front] : [n])) : base;
  for (const name of pose.only ? order.filter((n) => pose.only.includes(n)) : order) {
    const bn = rig.bones[name];
    if (name === 'armLoR' && held.length) { ctx.save(); apply(name); mHand = ctx.getTransform(); ctx.restore(); }
    if (name === 'head' && held.length) { ctx.save(); apply(name); mHead = ctx.getTransform(); ctx.restore(); }
    if (!bn.used) continue;
    ctx.save(); apply(name); ctx.drawImage(bn.cv, bn.x, bn.y); ctx.restore();
  }
  ctx.restore();
  if (mHand && mHead) for (const it of held) drawHeld(ctx, it, mHand, mHead, pose.toMouth || 0, k);
}

// Вещь в руке: у ладошки; во время еды — едет ко рту. Откусанные места вырезаны кружками.
function drawHeld(ctx, it, mHand, mHead, toMouth, k) {
  if (!it.im) return;
  const ph = mHand.transformPoint(new DOMPoint(HAND[0], HAND[1])), pm = mHead.transformPoint(new DOMPoint(MOUTH[0], MOUTH[1]));
  const x = ph.x + (pm.x - ph.x) * toMouth, y = ph.y + (pm.y - ph.y) * toMouth;
  const w = it.w / k, h = it.h / k; // размер вещи в единицах холста героя
  ctx.save();
  ctx.setTransform(mHand.a, mHand.b, mHand.c, mHand.d, x, y);
  if (it.drink) ctx.rotate(-0.7 * toMouth); // пьёт — наклоняет
  let src = it.im;
  if (it.bites && !it.drink) {
    biteCv ||= document.createElement('canvas');
    const bw = Math.max(1, Math.round(it.im.width)), bh = Math.max(1, Math.round(it.im.height));
    biteCv.width = bw; biteCv.height = bh;
    const c = biteCv.getContext('2d');
    c.drawImage(it.im, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    const R = bw * 0.26;
    for (const [fx, fy] of [[0.86, 0.12], [0.5, -0.02], [0.14, 0.14]].slice(0, it.bites)) { c.beginPath(); c.arc(bw * fx, bh * fy, R, 0, Math.PI * 2); c.fill(); }
    src = biteCv;
  }
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
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
  eat(id) { this.play(id, 'eat', 0.9); },
  active() { const t = now(); for (const [k, m] of motions) if (t - m.t0 > m.dur) motions.delete(k); return motions.size > 0; },
};

// Поза героя сейчас. carried — герой в руке (скорость для болтания ногами).
export function heroPose(id, { carried = false, tilt = 0, holding = false, reach = false, seat = null, covered = false, arms = false, walk = null } = {}) {
  const t = now(), ph = (id.charCodeAt(0) % 7) * 0.9; // у каждого героя своя фаза — не дышат хором
  const breathe = Math.sin(t * 2.2 + ph);
  const pose = {
    bob: breathe * 1.6,
    head: Math.sin(t * 1.1 + ph) * 0.025,
    armUpL: 0.03 + breathe * 0.02, armUpR: -0.03 - breathe * 0.02,
    armLoL: 0.02, armLoR: -0.02,
  };
  if (seat === 'sit' && FULL_PARTS) {
    // Сидит: бёдра смотрят на нас (сплющены), голени свисают и болтаются, руки на коленях.
    const sw = Math.sin(t * 2.6 + ph);
    pose.squash = { legL: 0.22, legR: 0.22, lap: 0.3 };
    pose.legL = 0.22; pose.legR = -0.22;                          // колени врозь
    pose.shinL = -0.24 + sw * 0.16; pose.shinR = 0.24 + sw * 0.16; // а голени — вниз и болтаются
    pose.armUpL = 0.1 + breathe * 0.015; pose.armUpR = -0.1 - breathe * 0.015;
    pose.armLoL = -0.3; pose.armLoR = 0.3;
    if (covered) pose.only = ORDER.filter((n) => n !== 'shinL' && n !== 'shinR'); // сидит в ванне: голени — внутри, за бортиком
  } else if (seat === 'lie') {
    // Лежит и спит: дышит медленно, руки вдоль тела.
    const slow = Math.sin(t * 1.3 + ph);
    pose.lie = true; pose.bob = slow * 1.2; pose.head = 0.05;
    pose.armUpL = 0.04; pose.armUpR = -0.04; pose.armLoL = 0; pose.armLoR = 0;
    if (covered) {
      pose.only = arms ? ['armUpL', 'armLoL', 'armUpR', 'armLoR'] : ['hairBack', 'torso', 'head']; pose.lieHead = true; pose.head = Math.sin(t * 0.7 + ph) * 0.03;
      pose.armUpL = LIE.arm + slow * 0.02; pose.armUpR = -LIE.arm - slow * 0.02; pose.armLoL = LIE.fore; pose.armLoR = -LIE.fore; // руки на одеяле
    } // под одеялом: голова на подушке, плечи уходят под одеяло, руки — поверх одеяла (ноги не рисуем)
  }
  if (walk) {
    // Идёт (вид спереди): ноги по очереди поднимаются — бедро «к нам» (сплющено), колено сгибается;
    // тело покачивается и чуть наклоняется туда, куда идёт; руки машут в такт.
    const sn = Math.sin(walk.phase), a = walk.amp ?? 1, upL = Math.max(0, sn) * a, upR = Math.max(0, -sn) * a;
    pose.squash = { legL: 1 - 0.6 * upL, legR: 1 - 0.6 * upR };
    pose.shinL = -0.12 * upL; pose.shinR = 0.12 * upR;
    pose.legL = 0.05 * upL; pose.legR = -0.05 * upR;
    pose.bob = -Math.abs(sn) * 9 * a;
    pose.torso = (walk.dir || 1) * 0.05 * a + sn * 0.03 * a;
    pose.armUpL = 0.03 + sn * 0.14 * a; pose.armUpR = -0.03 + sn * 0.14 * a;
    pose.armLoL = -0.05 - upL * 0.25; pose.armLoR = 0.05 + upR * 0.25;
    pose.head = -sn * 0.04 * a;
  }
  if (holding && seat !== 'lie') { pose.armUpR = -0.1; pose.armLoR = -0.45; } // держит вещь чуть перед собой
  if (reach) { // к герою поднесли вещь — тянется навстречу
    const w = Math.sin(t * 6) * 0.05;
    pose.armUpL = 0.9 * AMP + w; pose.armUpR = -0.9 * AMP - w; pose.armLoL = 0.3 * AMP; pose.armLoR = -0.3 * AMP;
  }
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
      pose.armUpR = -0.03 - (FULL_PARTS ? 1.95 : 2.3) * AMP * env; // рука сбоку от головы, а не за ней
      pose.armLoR = (-0.6 * env + Math.sin(t * 14) * 0.45 * env) * AMP;
      pose.head = 0.08 * env;
    } else if (m.type === 'eat') {
      if (FULL_PARTS) {
        // Настоящие руки: рука сама подносит еду ко рту (через грудь), еда — в кулачке.
        const [up, lo] = reachMouth(), u0 = pose.armUpR, l0 = pose.armLoR;
        pose.armUpR = u0 + (up - u0) * env; pose.armLoR = l0 + (lo - l0) * env;
        pose.front = ['armUpR', 'armLoR'];
      } else {
        pose.toMouth = env; // вырезанные руки далеко не поднимаются — еда «подлетает» ко рту сама
        pose.front = ['armLoR'];
        pose.armUpR = -0.1 - 0.5 * AMP * env; pose.armLoR = -0.45 + 0.9 * env;
      }
      pose.head = -0.06 * env;
    } else if (m.type === 'cheer') {
      pose.armUpL = 0.03 + 2.2 * AMP * env; pose.armUpR = -0.03 - 2.2 * AMP * env;
      pose.armLoL = 0.5 * AMP * env; pose.armLoR = -0.5 * AMP * env;
      pose.legL = 0.12 * AMP * env; pose.legR = -0.12 * AMP * env;
    }
  }
  return pose;
}
