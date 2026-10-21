// Загрузка картинок. В собранном файле они лежат внутри HTML (window.EMBEDDED_ASSETS),
// при разработке — в папке assets/.
const images = new Map();
const masks = new Map();

export const ASSET_KEYS = [
  'rooms/living/wall', 'rooms/living/floor_wood', 'rooms/living/baseboard',
  'items/table', 'items/picture', 'items/window', 'items/door_frame',
  'chars/girl', 'chars/boy', 'chars/cat',
];

function source(key) {
  return window.EMBEDDED_ASSETS?.[key] || `assets/${key}.webp`;
}

export async function loadAssets(onProgress) {
  let done = 0;
  await Promise.all(ASSET_KEYS.map((key) => new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => { images.set(key, im); onProgress?.(++done, ASSET_KEYS.length); resolve(); };
    im.onerror = () => reject(new Error('Не загрузилась картинка: ' + key));
    im.src = source(key);
  })));
}

export const img = (key) => images.get(key);

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
