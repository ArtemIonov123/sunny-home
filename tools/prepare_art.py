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
from PIL import Image, ImageOps

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
    for n in ('banana', 'apple', 'milk', 'juice', 'cake', 'sandwich', 'tomato'):
        copy_webp(f'legacy/{n}.webp', f'items/{n}.webp')
    # Кухня.
    sprite_pair('kitchen/fridge_closed.png', 'kitchen/fridge_open.png', 'items/fridge.webp', 'items/fridge_open.webp', 760)
    for n, mw, mh in [('stove', None, 600), ('sink_counter', 760, None), ('kitchen_counter', 760, None), ('kitchen_shelf', 760, None), ('toaster', 320, None)]:
        sprite(f'kitchen/{n}.png', f'items/{n}.webp', max_w=mw, max_h=mh)
    # Из прототипа 0.4.1
    copy_webp('legacy/room_table.webp', 'items/table.webp')
    copy_webp('legacy/room_picture.webp', 'items/picture.webp')
    for c in ('girl', 'boy', 'cat'):
        copy_webp(f'legacy/{c}.webp', f'chars/{c}.webp')
