// Загрузка картинок. В собранном файле они лежат внутри HTML (window.EMBEDDED_ASSETS),
// при разработке — в папке assets/.
const images = new Map();
const masks = new Map();

import { HERO_LAYERS } from './render/heroLayout.js';

export const ASSET_KEYS = [
  ...Object.keys(HERO_LAYERS), // части героя-конструктора
  'rooms/living/wall', 'rooms/living/floor_wood', 'rooms/living/baseboard',
  'items/table', 'items/picture', 'items/window', 'items/door_frame',
  'rooms/lawn/sky', 'rooms/lawn/ground', 'rooms/lawn/fence',
  'items/tree', 'items/bush', 'items/flowerbed',
  'items/sofa', 'items/armchair', 'items/rug', 'items/floor_lamp', 'items/tv_stand', 'items/plant_big', 'items/bookshelf',
  'items/blender', 'items/washing_machine', 'items/laundry_basket', 'items/smoothie_banana', 'items/tshirt', 'items/pants', 'items/dress',
  'items/banana', 'items/apple', 'items/milk', 'items/juice', 'items/cake', 'items/sandwich', 'items/tomato',
  ...['tree', 'bush', 'cloud', 'iso_home', 'iso_shop', 'iso_disco', 'iso_cafe', 'iso_salon'].map((n) => 'map/' + n), // карта-планета
  'items/pet_bowl_empty', 'items/pet_bowl_full', 'items/pet_food_bag', 'items/pet_bone', 'items/pet_ball', 'items/pet_toy_mouse', 'items/pet_bed',
  'items/bread', 'items/toast', 'items/egg', 'items/fried_egg', 'items/cheese', 'items/pizza', 'items/carrot', 'items/potato', 'items/soup',
  'items/fridge', 'items/fridge_open', 'items/stove', 'items/sink_counter', 'items/kitchen_counter', 'items/kitchen_shelf', 'items/toaster',
  'rooms/shop/wall', 'rooms/shop/floor_tile', 'items/shop_shelf', 'items/shop_fridge', 'items/shop_counter', 'items/shop_crate', 'items/shop_cart', 'items/shop_basket',
  'rooms/bath/wall_tile', 'items/bathtub', 'items/bath_sink', 'items/bath_mirror', 'items/toilet', 'items/toilet_open',
  'items/towel_rack', 'items/soap', 'items/rubber_duck', 'items/wall_clock',
  'items/wardrobe', 'items/wardrobe_open', 'items/bed', 'items/nightstand', 'items/bedside_lamp', 'items/dresser',
  ...['body', 'head', 'head_sleep', 'tail', 'leg_front_near', 'leg_front_far', 'leg_back_near', 'leg_back_far'].map((p) => 'animals/dog_' + p), // щенок по частям
  'items/teddy_bear', 'items/alarm_clock', 'items/book', 'items/wall_shelf_small',
];

function source(key) {
  return window.EMBEDDED_ASSETS?.[key] || `assets/${key}.webp`;
}

export async function loadAssets(onProgress) {
  let done = 0;
  await Promise.all(ASSET_KEYS.map((key) => new Promise((resolve, reject) => {
    const im = new Image();
    // decode() — распаковать картинку заранее, а не в момент первого показа (иначе рывок).
    im.onload = () => { images.set(key, im); onProgress?.(++done, ASSET_KEYS.length); (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(resolve); };
    im.onerror = () => reject(new Error('Не загрузилась картинка: ' + key));
    im.src = source(key);
  })));
}

export const img = (key) => images.get(key);

// Картинка своего предмета из админки (data:URL).
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Не удалось прочитать картинку'));
    im.src = src;
  });
}
export function registerImage(key, im) { images.set(key, im); masks.delete(key); }
export function forgetImage(key) { images.delete(key); masks.delete(key); }

// Размер предмета в игровых единицах по его определению (w или h) и пропорциям картинки.
export function sizeOf(def) {
  const im = images.get(def.art);
  const ratio = im ? im.height / im.width : 1;
  if (def.h) return { w: def.h / ratio, h: def.h };
  return { w: def.w, h: def.w * ratio };
}

// Маска прозрачности в уменьшенном виде: чтобы палец хватал вещь,
// а не пустое место рядом с ней. Если браузер не даёт прочитать пиксели — null.
export function maskOf(key) {
  if (masks.has(key)) return masks.get(key);
  const im = images.get(key);
  let mask = null;
  try {
    const w = Math.max(1, Math.round(im.width / 4)), h = Math.max(1, Math.round(im.height / 4));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(im, 0, 0, w, h);
    const data = c.getImageData(0, 0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3];
    mask = { w, h, a };
  } catch (e) { mask = null; }
  masks.set(key, mask);
  return mask;
}
