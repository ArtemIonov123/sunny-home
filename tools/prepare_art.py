"""Готовит картинки от GPT к игре.

Запуск:  python3 tools/prepare_art.py
Берёт исходники из art-src/ и пишет готовые WebP в assets/.

- Серые фактуры (стена, пол) нормализуются: основной тон становится почти белым,
  чтобы при перекраске получался именно выбранный цвет, а тени оставались тенями.
  Остаточный цветовой оттенок убирается. Края сводятся в бесшовный повтор.
- Предметы с прозрачностью обрезаются по содержимому. Розовый фон #FF00FF
  (если GPT не смог сделать прозрачность) превращается в прозрачный.
"""
import os
from PIL import Image, ImageChops, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-src')
OUT = os.path.join(ROOT, 'assets')


def save(im, rel, quality=88):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=quality, method=6)
    print(f'{rel:38s} {im.size[0]}x{im.size[1]}  {os.path.getsize(path)//1024} KB')


def seamless(im, blend):
    """Сводит левый и правый края: последние `blend` пикселей плавно
    переходят в первые, ширина уменьшается на blend."""
    w, h = im.size
    out = im.crop((0, 0, w - blend, h))
    left = im.crop((0, 0, blend, h))
    right = im.crop((w - blend, 0, w, h))
    # маска: 255 у левого края (берём продолжение правого края) → 0 (исходный левый)
    mask = ImageOps.invert(Image.linear_gradient('L').rotate(90, expand=True)).resize((blend, h))
    mixed = Image.composite(right, left, mask)
    out.paste(mixed, (0, 0))
    return out


def gray_texture(name, rel, height, white_point_pct, blend):
    im = ImageOps.grayscale(Image.open(os.path.join(SRC, name)))
    hist = im.histogram()
    total = sum(hist)
    acc, wp = 0, 255
    for v, n in enumerate(hist):
        acc += n
        if acc >= total * white_point_pct:
            wp = v
            break
    im = im.point(lambda v: min(255, round(v * 255 / max(wp, 1))))
    im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    im = seamless(im, blend)
    save(im.convert('RGB'), rel)


def color_texture(name, rel, height, blend):
    """Фон в настоящих цветах (небо, трава): масштаб по высоте и бесшовный повтор."""
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    save(seamless(im, blend), rel)


def keyed(name):
    im = Image.open(os.path.join(SRC, name)).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and r > 225 and b > 225 and g < 60:
                px[x, y] = (0, 0, 0, 0)
    solid = im.getchannel('A').point(lambda a: 255 if a > 40 else 0)
    return im.crop(solid.getbbox())


def sprite(name, rel, max_w=None, max_h=None):
    im = keyed(name)
    s = 1.0
    if max_w:
        s = min(s, max_w / im.width)
    if max_h:
        s = min(s, max_h / im.height)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    save(im, rel)


def sprite_pair(name_a, name_b, rel_a, rel_b, max_h):
    """Два состояния одной вещи (закрыто/открыто): общая рамка обрезки и общий масштаб,
    чтобы корпус не сдвигался при переключении."""
    a, b = keyed_full(name_a), keyed_full(name_b)
    box = union(solid_bbox(a), solid_bbox(b))
    s = min(1.0, max_h / (box[3] - box[1]))
    for im, rel in ((a, rel_a), (b, rel_b)):
        im = im.crop(box)
        if s < 1:
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        save(im, rel)


def keyed_full(name):
    im = Image.open(os.path.join(SRC, name)).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, al = px[x, y]
            if al and r > 225 and b > 225 and g < 60:
                px[x, y] = (0, 0, 0, 0)
    return im


def solid_bbox(im):
    return im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()


def union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def grid_texture(name, rel, height):
    """Кафель: серая сетка повторяется сама (целое число плиток), края не смешиваем."""
    im = ImageOps.grayscale(Image.open(os.path.join(SRC, name)))
    im = ImageOps.autocontrast(im, cutoff=1)
    im = im.point(lambda v: min(255, round(v * 1.08)))
    im = im.resize((height, height), Image.LANCZOS)
    save(im.convert('RGB'), rel)


# ── Герой-конструктор ──
# Все слои кладём в ОБЩУЮ систему координат «холста героя» (как body_stand.png 1024×1536,
# сверху добавлено место под голову), режем по содержимому и запоминаем смещение.
# Серые (перекрашиваемые) пиксели → слой *_t, цветные и контур → слой *_f.
HERO_TOP = 330            # запас сверху под голову и причёски (в единицах body_stand)
HERO_OUT = 0.5            # итоговый масштаб картинок
HEAD_S = 0.5              # голова в масштабе тела
HEAD_AT = (512, 250)      # куда приходится подбородок (центр низа головы) на теле
HEAD_CHIN = (676, 1110)   # подбородок на head.png
FACE_BOX = (204, 272, 1050, 1014)    # лицо на face_*.png
FACE_TO = (380, 440, 972, 960)       # куда лицо ложится на head.png
# Подгонка одежды: рамка вещи → рамка на теле (body_stand / голова), если GPT нарисовал не в том месте.
WEAR_FIT = {
    'wear_tshirt': ('body', (262, 262, 762, 724)),
    'wear_pants': ('body', (310, 668, 714, 1338)),
    'wear_skirt': ('body', (184, 656, 840, 1068)),
    'wear_sneakers': ('body', (332, 1318, 692, 1436)),
    'wear_cap': ('head', (40, 0, 1290, 600)),
    'wear_glasses': ('head', (330, 500, 1020, 760)),
}


def hero_canvas_size():
    return (round(1024 * HERO_OUT), round((1536 + HERO_TOP) * HERO_OUT))


def place(im, scale, ox, oy):
    """Картинку (её 0,0) — в координаты холста героя: масштаб и смещение (в единицах тела)."""
    W, H = hero_canvas_size()
    s = scale * HERO_OUT
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H))
    canvas.alpha_composite(im, (round(ox * HERO_OUT), round((oy + HERO_TOP) * HERO_OUT))) if ox >= 0 and oy + HERO_TOP >= 0 else canvas.paste(im, (round(ox * HERO_OUT), round((oy + HERO_TOP) * HERO_OUT)), im)
    return canvas


def head_to_body(im):
    """Слой в координатах head.png → холст героя."""
    ox = HEAD_AT[0] - HEAD_CHIN[0] * HEAD_S
    oy = HEAD_AT[1] - HEAD_CHIN[1] * HEAD_S
    return place(im, HEAD_S, ox, oy)


def fit_box(im, box_to, canvas_size):
    """Растянуть содержимое картинки в рамку box_to на холсте размера canvas_size."""
    bb = solid_bbox(im)
    part = im.crop(bb)
    w, h = box_to[2] - box_to[0], box_to[3] - box_to[1]
    part = part.resize((max(1, w), max(1, h)), Image.LANCZOS)
    out = Image.new('RGBA', canvas_size)
    out.alpha_composite(part, (box_to[0], box_to[1]))
    return out


def split_tint(im):
    """Серое (перекрашивается) отдельно от цветного и контура. Серое нормализуем: светлое → почти белое."""
    px = im.load()
    t = Image.new('RGBA', im.size); f = Image.new('RGBA', im.size)
    tp, fp = t.load(), f.load()
    vals = []
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            sat = (mx - mn) / mx if mx else 0
            if sat < 0.16 and mx > 75:
                tp[x, y] = (mx, mx, mx, a); vals.append(mx)
            else:
                fp[x, y] = (r, g, b, a)
    if vals:
        vals.sort(); wp = vals[int(len(vals) * 0.9)]
        lut = [min(255, round(v * 250 / max(wp, 1))) for v in range(256)]
        r, g, b, a = t.split()
        t = Image.merge('RGBA', (r.point(lut), g.point(lut), b.point(lut), a))
    return t, f


def hero_layer(name, canvas, layout, tint=True):
    """Сохранить слой: обрезать по содержимому, записать смещение."""
    parts = split_tint(canvas) if tint else (None, canvas)
    for suffix, im in zip(('t', 'f'), parts):
        if im is None:
            continue
        bb = im.getchannel('A').getbbox()
        if not bb:
            continue
        key = f'hero/{name}_{suffix}'
        save(im.crop(bb), key + '.webp', quality=90)
        layout[key] = bb[:2]


def hair_cap(head):
    """Верх головы (выше линии роста волос) — серый, с контуром по краю головы. Координаты head.png."""
    from PIL import ImageFilter, ImageDraw
    a = head.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    x0, y0, x1, y1 = a.getbbox()
    W, H = head.size
    # Линия роста волос: дуга — у лба выше, к ушам ниже.
    line = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(line)
    cx, top, hh = (x0 + x1) / 2, y0, y1 - y0
    pts = []
    for k in range(0, 101):
        t = k / 100
        x = x0 + (x1 - x0) * t
        u = (x - cx) / ((x1 - x0) / 2)           # -1..1
        y = top + hh * (0.27 + 0.20 * u * u)       # середина лба 27%, бока 47%
        pts.append((x, y))
    d.polygon([(x0 - 5, -5), (x1 + 5, -5)] + pts[::-1], fill=255)
    cap = ImageChops.multiply(a, line)
    inner = a.filter(ImageFilter.MinFilter(17))   # голова без контура
    edge = ImageChops.subtract(cap, inner)         # кромка шапочки по краю головы
    out = Image.new('RGBA', (W, H))
    fill = Image.new('RGBA', (W, H), (172, 172, 172, 255))
    out.paste(fill, (0, 0), cap)
    out.paste(Image.new('RGBA', (W, H), (52, 32, 24, 255)), (0, 0), edge)
    return out.filter(ImageFilter.SMOOTH)


def build_hero():
    L = lambda n: Image.open(os.path.join(SRC, 'hero', n + '.png')).convert('RGBA')
    layout = {}
    W, H = hero_canvas_size()
    hero_layer('body_stand', place(L('body_stand'), 1, 0, 0), layout)
    hero_layer('head', head_to_body(L('head')), layout)
    # Лица: все в одной рамке (GPT нарисовал их одинаково).
    s = (FACE_TO[2] - FACE_TO[0]) / (FACE_BOX[2] - FACE_BOX[0])
    for n in ('happy', 'laugh', 'sad', 'surprised', 'sleep', 'yum'):
        f = L('face_' + n)
        on_head = Image.new('RGBA', (1355, 1161))
        fs = f.resize((round(f.width * s), round(f.height * s)), Image.LANCZOS)
        on_head.alpha_composite(fs, (round(FACE_TO[0] - FACE_BOX[0] * s), round(FACE_TO[1] - FACE_BOX[1] * s))) if FACE_TO[0] - FACE_BOX[0] * s >= 0 else on_head.paste(fs, (round(FACE_TO[0] - FACE_BOX[0] * s), round(FACE_TO[1] - FACE_BOX[1] * s)), fs)
        hero_layer('face_' + n, head_to_body(on_head), layout, tint=False)
    # «Шапочка» волос под любой причёской: закрывает лысую макушку, которую причёски GPT
    # не везде покрывают (голова шире нарисованных волос). Форма — верх головы над линией роста волос.
    hero_layer('hair_cap', head_to_body(hair_cap(L('head'))), layout)
    for n in ('braids', 'bob', 'ponytail', 'bun', 'curly', 'spiky', 'bangs', 'long_front', 'long_back'):
        hero_layer('hair_' + n, head_to_body(L('hair_' + n).crop((0, 0, 1355, 1161))), layout)
    for n in ('wear_tshirt', 'wear_dress', 'wear_pants', 'wear_skirt', 'wear_sneakers', 'wear_cap', 'wear_glasses'):
        im = L(n)
        fit = WEAR_FIT.get(n)
        if fit and fit[0] == 'head':
            hero_layer(n, head_to_body(fit_box(im, fit[1], (1355, 1161))), layout)
        else:
            if fit:
                im = fit_box(im, fit[1], (1024, 1536))
            hero_layer(n, place(im, 1, 0, 0), layout)
    # Части для анимации (если GPT уже прислал): на том же холсте, что body_stand, — без подгонки.
    PARTS = ['body_torso', 'arm_upper_left', 'arm_upper_right', 'arm_lower_left', 'arm_lower_right',
             'hand_grip_left', 'hand_grip_right', 'leg_left', 'leg_right',
             'wear_tshirt_body', 'wear_tshirt_sleeve_left', 'wear_tshirt_sleeve_right',
             'wear_dress_body', 'wear_dress_sleeve_left', 'wear_dress_sleeve_right',
             'wear_pants_hips', 'wear_pants_leg_left', 'wear_pants_leg_right']
    for n in PARTS:
        if os.path.exists(os.path.join(SRC, 'hero', n + '.png')):
            hero_layer(n, place(L(n), 1, 0, 0), layout)
    js = ['// Создано tools/prepare_art.py — не править руками. Смещения слоёв героя на общем холсте.',
          f'export const HERO_SIZE = [{W}, {H}];',
          'export const HERO_LAYERS = {']
    js += [f"  '{k}': [{v[0]}, {v[1]}]," for k, v in sorted(layout.items())]
    js.append('};')
    open(os.path.join(ROOT, 'src', 'render', 'heroLayout.js'), 'w').write('\n'.join(js) + '\n')


def build_animals():
    """Животные: art-src/animals/animal_<имя>_<часть>.png → assets/animals/<имя>_<часть>.webp.
    Холст НЕ обрезается (место части на холсте — это и есть сборка), только уменьшается до 512."""
    d = os.path.join(SRC, 'animals')
    if not os.path.isdir(d):
        return
    for f in sorted(os.listdir(d)):
        if not (f.startswith('animal_') and f.endswith('.png')) or f.endswith('_full.png'):
            continue
        im = keyed_full('animals/' + f)
        im.putalpha(im.split()[-1].point(lambda v: 0 if v < 60 else v))  # убрать еле видную «пыль» от GPT
        s = 512 / max(im.size)
        if s < 1:
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        save(im, 'animals/' + f[len('animal_'):-4] + '.webp', quality=90)


def copy_webp(name, rel):
    im = Image.open(os.path.join(SRC, name))
    save(im.convert('RGBA'), rel, quality=90)


if __name__ == '__main__':
    # Гостиная. Стена рисуется высотой до 600 px, пол — до 420 px (зависит от разметки комнаты).
    gray_texture('living/living_wall.png', 'rooms/living/wall.webp', 600, 0.80, 90)
    gray_texture('living/living_floor_wood.png', 'rooms/living/floor_wood.webp', 420, 0.6, 60)
    sprite('living/living_baseboard.png', 'rooms/living/baseboard.webp', max_h=36)
    sprite('living/living_window.png', 'items/window.webp', max_w=760)
    sprite('living/door_frame.png', 'items/door_frame.webp', max_h=640)
    # Лужайка: фон в настоящих цветах + предметы сада.
    color_texture('lawn/lawn_sky.png', 'rooms/lawn/sky.webp', 560, 120)
    color_texture('lawn/lawn_ground.png', 'rooms/lawn/ground.webp', 380, 120)
    sprite('lawn/lawn_fence.png', 'rooms/lawn/fence.webp', max_h=200)
    sprite('lawn/tree.png', 'items/tree.webp', max_h=760)
    sprite('lawn/bush.png', 'items/bush.webp', max_w=520)
    sprite('lawn/flowerbed.png', 'items/flowerbed.webp', max_w=620)
    # Мебель гостиной.
    for n, mw, mh in [('sofa', 900, None), ('armchair', 520, None), ('rug', 800, None), ('floor_lamp', None, 720),
                      ('tv_stand', 640, None), ('plant_big', None, 600), ('bookshelf', None, 680)]:
        sprite(f'furniture/{n}.png', f'items/{n}.webp', max_w=mw, max_h=mh)
    # Кухня, стирка, одежда.
    for n, mw, mh in [('blender', None, 420), ('washing_machine', 520, None), ('laundry_basket', 420, None), ('smoothie_banana', None, 300),
                      ('tshirt', 360, None), ('pants', None, 380), ('dress', None, 380)]:
        sprite(f'home/{n}.png', f'items/{n}.webp', max_w=mw, max_h=mh)
    # Еда для рецептов (тостер, плита).
    for n in ('bread', 'toast', 'egg', 'fried_egg', 'cheese', 'pizza', 'carrot', 'potato', 'soup'):
        sprite(f'food/food_{n}.png', f'items/{n}.webp', max_w=280, max_h=280)
    for n in ('banana', 'apple', 'milk', 'juice', 'cake', 'sandwich', 'tomato'):
        copy_webp(f'legacy/{n}.webp', f'items/{n}.webp')
    # Кухня.
    sprite_pair('kitchen/fridge_closed.png', 'kitchen/fridge_open.png', 'items/fridge.webp', 'items/fridge_open.webp', 760)
    for n, mw, mh in [('stove', None, 600), ('sink_counter', 760, None), ('kitchen_counter', 760, None), ('kitchen_shelf', 760, None), ('toaster', 320, None)]:
        sprite(f'kitchen/{n}.png', f'items/{n}.webp', max_w=mw, max_h=mh)
    # Ванная.
    grid_texture('bath/bath_wall_tile.png', 'rooms/bath/wall_tile.webp', 512)
    sprite_pair('bath/toilet_closed.png', 'bath/toilet_open.png', 'items/toilet.webp', 'items/toilet_open.webp', 520)
    for n, mw, mh in [('bathtub', 900, None), ('bath_sink', None, 560), ('bath_mirror', 360, None), ('towel_rack', 480, None),
                      ('soap', 200, None), ('rubber_duck', 200, None), ('wall_clock', 300, None)]:
        sprite(f'bath/{n}.png', f'items/{n}.webp', max_w=mw, max_h=mh)
    # Спальня.
    sprite_pair('bedroom/wardrobe_closed.png', 'bedroom/wardrobe_open.png', 'items/wardrobe.webp', 'items/wardrobe_open.webp', 760)
    for n, mw, mh in [('bed', 1000, None), ('nightstand', 400, None), ('bedside_lamp', None, 360), ('dresser', 700, None),
                      ('teddy_bear', 260, None), ('alarm_clock', 200, None), ('book', None, 220), ('wall_shelf_small', 500, None)]:
        sprite(f'bedroom/{n}.png', f'items/{n}.webp', max_w=mw, max_h=mh)
    # Герой-конструктор (тело, голова, лица, причёски, одежда — слоями).
    build_hero()
    # Животные — части на скелет (render/animal.js).
    build_animals()
    # Из прототипа 0.4.1
    copy_webp('legacy/room_table.webp', 'items/table.webp')
    copy_webp('legacy/room_picture.webp', 'items/picture.webp')
    for c in ('girl', 'boy'):
        copy_webp(f'legacy/{c}.webp', f'chars/{c}.webp')
