// Каталог: ОПРЕДЕЛЕНИЯ предметов и героев (что это такое).
// Конкретные вещи в доме — это ЭКЗЕМПЛЯРЫ в state.items, они ссылаются сюда по полю def.
//
// place  — где можно ставить:
//   'floor'   — точка привязки (низ по центру) должна быть на полу;
//   'wall'    — вся картинка целиком должна быть на стене;
//   'doorway' — стоит низом на линии пола (дверные проёмы), двигается только по горизонтали.
// anchor — точка привязки: 'bottom' (низ по центру) или 'center'.
// w / h  — размер в игровых единицах (задаётся одно, второе считается по картинке).
// layer  — 'under': лежит на полу под всем остальным (ковры).
// seats — куда можно посадить героя: [x0, x1, y, 1?] (y — где таз; 1 — кровать: x0 — где шея, голова левее, на подушке);
// cover — одеяло: [x0, y0, x1, y1] в долях (coverPoly — точнее, по краю одеяла). Лежащий герой виден только левее x0 (голова на подушке), остальное — под одеялом.
// surfaces — куда можно ставить мелкие вещи: [x0, x1, y] в долях картинки (столешница, сиденье, полка);
//            четвёртое число 1 — поверхность ВНУТРИ: работает и видна, только когда вещь открыта.
// openArt  — картинка открытого состояния; такая вещь открывается и закрывается нажатием.
//            openBox [x,y,w,h] — где «открытая» картинка относительно закрытой (свои предметы; у встроенных — та же рамка).
// drink    — напиток (пьют, а не кусают); wear — одежда, которая надевается на героя (tshirt/pants/dress).
// power    — вещь включается нажатием (item.lit): screen [x0,y0,x1,y1] — экран с мультиком,
//            glow [x,y,радиус] — тёплый свет вокруг точки (абажур),
//            water [x,y,yКонец,ширина, направление°, напор] — льётся вода по дуге (render/water.js). x,y,yКонец,ширина — в долях картинки.
// sounds   — свои звуки: { open, close } (унитаз: крышка и смыв).
// tap      — особый отклик на нажатие: 'ring' (будильник звенит и трясётся), 'squeak' (игрушка пищит).

// Ключи картинок частей встроенного животного: animals/<имя>_<часть> (как файлы animal_<имя>_<часть>.png от GPT).
const PART_FILES = { body: 'body', head: 'head', headSleep: 'head_sleep', tail: 'tail', legFN: 'leg_front_near', legFF: 'leg_front_far', legBN: 'leg_back_near', legBF: 'leg_back_far' };
const animalParts = (name) => Object.fromEntries(Object.entries(PART_FILES).map(([k, f]) => [k, `animals/${name}_${f}`]));

export const ITEMS = {
  table:   { name: 'Столик',        art: 'items/table',      w: 370, anchor: 'bottom', place: 'floor',   group: 'furniture', surfaces: [[0.08, 0.92, 0.21]] },
  picture: { name: 'Картина',       art: 'items/picture',    w: 160, anchor: 'center', place: 'wall',    group: 'decor' },
  window:  { name: 'Окно',          art: 'items/window',     w: 470, anchor: 'center', place: 'wall',    group: 'build', indoorOnly: true },
  door:    { name: 'Дверной проём', art: 'items/door_frame', h: 430, anchor: 'bottom', place: 'doorway', group: 'build', indoorOnly: true },
  tree:      { name: 'Дерево', art: 'items/tree',      h: 640, anchor: 'bottom', place: 'floor', group: 'garden' },
  bush:      { name: 'Куст',   art: 'items/bush',      w: 260, anchor: 'bottom', place: 'floor', group: 'garden' },
  flowerbed: { name: 'Грядка', art: 'items/flowerbed', w: 330, anchor: 'bottom', place: 'floor', group: 'garden' },
  sofa:       { name: 'Диван',     art: 'items/sofa',       w: 620, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.13, 0.87, 0.60]], seats: [[0.14, 0.86, 0.6]] },
  armchair:   { name: 'Кресло',    art: 'items/armchair',   w: 300, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.22, 0.78, 0.575]], seats: [[0.3, 0.7, 0.6]] },
  rug:        { name: 'Ковёр',     art: 'items/rug',        w: 560, anchor: 'bottom', place: 'floor', group: 'decor', layer: 'under' },
  floor_lamp: { name: 'Торшер',    art: 'items/floor_lamp', h: 470, power: { glow: [0.5, 0.2, 1.1] }, anchor: 'bottom', place: 'floor', group: 'decor' },
  tv_stand:   { name: 'Тумба с телевизором', art: 'items/tv_stand', w: 420, power: { screen: [0.135, 0.04, 0.865, 0.525] }, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.05, 0.27, 0.60], [0.73, 0.95, 0.60]] },
  plant_big:  { name: 'Монстера',  art: 'items/plant_big',  h: 380, anchor: 'bottom', place: 'floor', group: 'decor' },
  bookshelf:  { name: 'Стеллаж',   art: 'items/bookshelf',  h: 440, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.12, 0.88, 0.335], [0.12, 0.88, 0.605], [0.12, 0.88, 0.875]] },
  blender:         { name: 'Блендер',           art: 'items/blender',         h: 190, anchor: 'bottom', place: 'floor', group: 'appliances', surfaces: [[0.15, 0.7, 0.58]] },
  washing_machine: { name: 'Стиральная машина', art: 'items/washing_machine', h: 250, anchor: 'bottom', place: 'floor', group: 'appliances', surfaces: [[0.08, 0.92, 0.03]] },
  laundry_basket:  { name: 'Корзина для белья', art: 'items/laundry_basket',  w: 190, anchor: 'bottom', place: 'floor', group: 'furniture' },
  fridge:          { name: 'Холодильник', art: 'items/fridge', openArt: 'items/fridge_open', h: 420, anchor: 'bottom', place: 'floor', group: 'appliances',
                     surfaces: [[0.05, 0.6, 0.01], [0.08, 0.5, 0.255, 1], [0.08, 0.5, 0.455, 1], [0.08, 0.5, 0.575, 1], [0.08, 0.5, 0.70, 1], [0.08, 0.5, 0.885, 1]] },
  stove:           { name: 'Плита',        art: 'items/stove',           h: 260, anchor: 'bottom', place: 'floor', group: 'appliances', surfaces: [[0.06, 0.94, 0.13]] },
  sink_counter:    { name: 'Мойка',        art: 'items/sink_counter',    w: 380, power: { water: [0.565, 0.1, 0.31, 0.025, 0, 0.05] }, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.03, 0.97, 0.22]] },
  kitchen_counter: { name: 'Кухонная тумба', art: 'items/kitchen_counter', w: 380, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.03, 0.97, 0.04]] },
  kitchen_shelf:   { name: 'Полка',        art: 'items/kitchen_shelf',   w: 420, anchor: 'center', place: 'wall', group: 'furniture', indoorOnly: true, surfaces: [[0.03, 0.97, 0.08]] },
  toaster:         { name: 'Тостер',       art: 'items/toaster',         w: 110, anchor: 'bottom', place: 'floor', group: 'appliances', surfaces: [[0.2, 0.78, 0.07]] },
  tshirt:  { name: 'Футболка', art: 'items/tshirt', wear: 'tshirt', w: 140, anchor: 'bottom', place: 'floor', group: 'clothes' },
  pants:   { name: 'Штанишки', art: 'items/pants',  wear: 'pants', h: 160, anchor: 'bottom', place: 'floor', group: 'clothes' },
  dress:   { name: 'Платье',   art: 'items/dress',  wear: 'dress', h: 160, anchor: 'bottom', place: 'floor', group: 'clothes' },
  bathtub:     { name: 'Ванна с душем', art: 'items/bathtub',     w: 540, anchor: 'bottom', place: 'floor', group: 'furniture', power: { water: [0.775, 0.185, 0.5, 0.13, -18, 0.18] }, surfaces: [[0.06, 0.74, 0.5]] },
  bath_sink:   { name: 'Раковина',      art: 'items/bath_sink',   h: 280, anchor: 'bottom', place: 'floor', group: 'furniture', power: { water: [0.53, 0.095, 0.27, 0.02, 0, 0.05] }, surfaces: [[0.06, 0.94, 0.205]] },
  toilet:      { name: 'Унитаз',        art: 'items/toilet', openArt: 'items/toilet_open', h: 240, anchor: 'bottom', place: 'floor', group: 'furniture', sounds: { open: 'lid', close: 'flush' }, seats: [[0.3, 0.7, 0.5]] },
  wardrobe:     { name: 'Шкаф',        art: 'items/wardrobe', openArt: 'items/wardrobe_open', h: 440, anchor: 'bottom', place: 'floor', group: 'furniture',
                  surfaces: [[0.2, 0.8, 0.0], [0.27, 0.7, 0.5, 1], [0.27, 0.7, 0.715, 1], [0.27, 0.7, 0.87, 1]] },
  bed:          { name: 'Кровать',     art: 'items/bed',          w: 560, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.3, 0.95, 0.42]], seats: [[0.24, 0.93, 0.46, 1]], cover: [0.212, 0.25, 0.97, 0.8],
                  coverPoly: [[0.212, 0.8], [0.212, 0.58], [0.222, 0.52], [0.235, 0.48], [0.25, 0.44], [0.27, 0.41], [0.3, 0.392], [0.35, 0.388], [0.4, 0.42], [0.5, 0.41], [0.7, 0.425], [0.85, 0.44], [0.9, 0.485], [0.93, 0.555], [0.97, 0.6], [0.97, 0.8]] },
  nightstand:   { name: 'Тумбочка',    art: 'items/nightstand',   w: 150, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.08, 0.92, 0.04]] },
  dresser:      { name: 'Комод',       art: 'items/dresser',      w: 330, anchor: 'bottom', place: 'floor', group: 'furniture', surfaces: [[0.05, 0.95, 0.04]] },
  bedside_lamp: { name: 'Лампа',       art: 'items/bedside_lamp', h: 140, anchor: 'bottom', place: 'floor', group: 'decor', power: { glow: [0.5, 0.33, 1.6] } },
  wall_shelf_small: { name: 'Полочка', art: 'items/wall_shelf_small', w: 240, anchor: 'center', place: 'wall', group: 'furniture', indoorOnly: true, surfaces: [[0.04, 0.96, 0.06]] },
  // Животные — на общем скелете (render/animal.js): части лежат в assets/animals/, картинка целиком собирается из них.
  dog: { name: 'Щенок', art: 'animals/dog', w: 200, anchor: 'bottom', place: 'floor', group: 'animals', small: true,
         animal: { parts: animalParts('dog'), joints: {}, voice: 'woof' } },
  teddy_bear:   { name: 'Мишка',     art: 'items/teddy_bear',  w: 100, anchor: 'bottom', place: 'floor', group: 'toys', tap: 'squeak' },
  alarm_clock:  { name: 'Будильник', art: 'items/alarm_clock', w: 62,  anchor: 'bottom', place: 'floor', group: 'decor', tap: 'ring' },
  book:         { name: 'Книжка',    art: 'items/book',        h: 70,  anchor: 'bottom', place: 'floor', group: 'toys' },
  bath_mirror: { name: 'Зеркало',       art: 'items/bath_mirror', w: 170, anchor: 'center', place: 'wall',  group: 'decor' },
  towel_rack:  { name: 'Полотенце',     art: 'items/towel_rack',  w: 230, anchor: 'center', place: 'wall',  group: 'decor' },
  wall_clock:  { name: 'Часы',          art: 'items/wall_clock',  w: 130, anchor: 'center', place: 'wall',  group: 'decor' },
  soap:        { name: 'Мыло',          art: 'items/soap',        w: 62,  anchor: 'bottom', place: 'floor', group: 'toys' },
  rubber_duck: { name: 'Уточка',        art: 'items/rubber_duck', w: 64,  anchor: 'bottom', place: 'floor', group: 'toys' },
  smoothie_banana: { name: 'Банановый фреш', art: 'items/smoothie_banana', drink: true, h: 105, anchor: 'bottom', place: 'floor', group: 'food' },
  banana:   { name: 'Банан',    art: 'items/banana',   w: 75, anchor: 'bottom', place: 'floor', group: 'food' },
  apple:    { name: 'Яблоко',   art: 'items/apple',    w: 57, anchor: 'bottom', place: 'floor', group: 'food' },
  milk:     { name: 'Молоко',   art: 'items/milk', drink: true,     w: 54, anchor: 'bottom', place: 'floor', group: 'food' },
  juice:    { name: 'Сок',      art: 'items/juice', drink: true,    w: 47, anchor: 'bottom', place: 'floor', group: 'food' },
  cake:     { name: 'Кекс',     art: 'items/cake',     w: 65, anchor: 'bottom', place: 'floor', group: 'food' },
  sandwich: { name: 'Бутерброд', art: 'items/sandwich', w: 90, anchor: 'bottom', place: 'floor', group: 'food' },
  tomato:   { name: 'Помидор',  art: 'items/tomato',   w: 55, anchor: 'bottom', place: 'floor', group: 'food' },
};

// ── Свои предметы из админки (каталог хранится отдельно от сохранения дома) ──
export const GROUPS = { furniture: 'Мебель', appliances: 'Техника', decor: 'Декор', build: 'Окна и двери', garden: 'Сад', clothes: 'Одежда', food: 'Еда', toys: 'Игрушки', animals: 'Животные' };
export const PLACES = { floor: 'На пол', wall: 'На стену', doorway: 'Проём (стоит на линии пола)' };
export const CUSTOM_PREFIX = 'custom_';

const custom = new Map();

// Определение предмета по id — встроенного или своего. null, если такого нет.
export function itemDef(id) { return ITEMS[id] || custom.get(id) || null; }

export function allItemDefs() {
  return [
    ...Object.entries(ITEMS).map(([id, d]) => ({ id, ...d, builtin: true })),
    ...[...custom.values()].map((d) => ({ ...d, builtin: false })),
  ];
}

export function customDefs() { return [...custom.values()]; }

// Из сохранённой записи делаем определение, понятное движку.
export function toDef(rec) {
  const place = PLACES[rec.place] ? rec.place : 'floor';
  return {
    id: rec.id, name: rec.name, group: GROUPS[rec.group] ? rec.group : 'decor', place,
    w: rec.w, anchor: place === 'wall' ? 'center' : 'bottom', indoorOnly: place !== 'floor',
    art: 'custom/' + rec.id, image: rec.image,
    // «Живые» свойства (задаются в студии): полки, открывание, включение, отклик, еда/одежда.
    ...(rec.surfaces?.length ? { surfaces: rec.surfaces } : {}),
    ...(rec.seats?.length ? { seats: rec.seats, ...(rec.cover ? { cover: rec.cover } : {}) } : {}),
    ...(rec.open ? { openArt: 'custom/' + rec.id + '_open', openBox: rec.open.box } : {}),
    ...(rec.power ? { power: rec.power } : {}),
    ...(rec.tap ? { tap: rec.tap } : {}),
    ...(rec.drink ? { drink: true } : {}),
    ...(rec.wear ? { wear: rec.wear } : {}),
    // Животное: части на скелете (render/animal.js), картинки — custom/<id>_a_<часть>.
    ...(rec.animal ? { small: true, animal: { parts: Object.fromEntries(Object.keys(rec.animal.parts).map((k) => [k, 'custom/' + rec.id + '_a_' + k])), joints: rec.animal.joints || {}, voice: rec.animal.voice || '' } } : {}),
  };
}

export function putCustomDef(def) { custom.set(def.id, def); }

// ── Правки встроенных предметов (из студии или из пака) ──
// Правка: { id, name?, group?, size?, art? } — size заменяет h или w (то, чем задан размер предмета).
const original = new Map(); // id → копия исходного определения
export function sizeKey(id) { return ITEMS[id]?.h !== undefined || original.get(id)?.h !== undefined ? 'h' : 'w'; }
export function applyOverride(o) {
  const d = ITEMS[o.id]; if (!d) return false;
  if (!original.has(o.id)) original.set(o.id, { ...d });
  const base = original.get(o.id);
  Object.assign(d, base); // сначала вернуть исходное, потом наложить правку
  if (o.name) d.name = o.name;
  if (o.group && GROUPS[o.group]) d.group = o.group;
  if (o.size) d[sizeKey(o.id)] = o.size;
  if (o.art) d.art = o.art;
  if (o.surfaces) d.surfaces = o.surfaces.length ? o.surfaces : undefined;
  if (o.seats) { d.seats = o.seats.length ? o.seats : undefined; d.cover = o.cover || undefined; d.coverPoly = undefined; }
  if (o.power) d.power = o.power;
  if (o.tap) d.tap = o.tap;
  return true;
}
export function clearOverride(id) { const base = original.get(id); if (base && ITEMS[id]) { for (const k of Object.keys(ITEMS[id])) delete ITEMS[id][k]; Object.assign(ITEMS[id], base); } }
export const originalDef = (id) => original.get(id) || ITEMS[id] || null;
export const isBuiltin = (id) => !!ITEMS[id];
export function removeCustomDef(id) { custom.delete(id); }

export const CHARS = {
  // Мила и Тим собираются из частей (render/hero.js), их картинка — 'hero/<id>'.
  girl: { name: 'Мила',   art: 'hero/girl', h: 330 },
  boy:  { name: 'Тим',    art: 'hero/boy',  h: 330 },
  cat:  { name: 'Персик', art: 'chars/cat',  h: 160 },
};

export const ROOM_TYPES = {
  lawn:    { name: 'Лужайка',  outdoor: true },
  living:  { name: 'Гостиная' },
  kitchen: { name: 'Кухня' },
  kids:    { name: 'Детская' },
  bath:    { name: 'Душевая' },
  bedroom: { name: 'Спальня' },
};

export const WALL_PATTERNS = { plain: 'Однотонные', stripes: 'Полоски', dots: 'Горошек', flowers: 'Ромашки', tile: 'Кафель' };
export const FLOOR_MATERIALS = { wood: 'Деревянный пол', tile: 'Плитка' };

// Палитры для быстрого выбора в «Отделке».
export const WALL_SWATCHES = ['#f6e3c4', '#f4ead9', '#dfe8d0', '#f6cfc8', '#cfe0ef', '#e7dcf0', '#fbe7a8', '#d7e7e3'];
export const FLOOR_SWATCHES = ['#e2b27c', '#cf9a63', '#ecc99b', '#b98a5e', '#e9e4dc', '#c9d8de', '#d8c3a5', '#a9b58f'];
