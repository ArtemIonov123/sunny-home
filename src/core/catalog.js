// Каталог: ОПРЕДЕЛЕНИЯ предметов и героев (что это такое).
// Конкретные вещи в доме — это ЭКЗЕМПЛЯРЫ в state.items, они ссылаются сюда по полю def.
//
// place  — где можно ставить:
//   'floor'   — точка привязки (низ по центру) должна быть на полу;
//   'wall'    — вся картинка целиком должна быть на стене;
//   'doorway' — стоит низом на линии пола (дверные проёмы), двигается только по горизонтали.
// anchor — точка привязки: 'bottom' (низ по центру) или 'center'.
// w / h  — размер в игровых единицах (задаётся одно, второе считается по картинке).

export const ITEMS = {
  table:   { name: 'Столик',        art: 'items/table',      w: 370, anchor: 'bottom', place: 'floor',   group: 'furniture' },
  picture: { name: 'Картина',       art: 'items/picture',    w: 160, anchor: 'center', place: 'wall',    group: 'decor' },
  window:  { name: 'Окно',          art: 'items/window',     w: 470, anchor: 'center', place: 'wall',    group: 'build', indoorOnly: true },
  door:    { name: 'Дверной проём', art: 'items/door_frame', h: 430, anchor: 'bottom', place: 'doorway', group: 'build', indoorOnly: true },
};

export const CHARS = {
  girl: { name: 'Мила',   art: 'chars/girl', h: 300 },
  boy:  { name: 'Тим',    art: 'chars/boy',  h: 300 },
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

export const WALL_PATTERNS = { plain: 'Однотонные', stripes: 'Полоски', dots: 'Горошек', flowers: 'Ромашки' };
export const FLOOR_MATERIALS = { wood: 'Деревянный пол', tile: 'Плитка' };

// Палитры для быстрого выбора в «Отделке».
export const WALL_SWATCHES = ['#f6e3c4', '#f4ead9', '#dfe8d0', '#f6cfc8', '#cfe0ef', '#e7dcf0', '#fbe7a8', '#d7e7e3'];
export const FLOOR_SWATCHES = ['#e2b27c', '#cf9a63', '#ecc99b', '#b98a5e', '#e9e4dc', '#c9d8de', '#d8c3a5', '#a9b58f'];
