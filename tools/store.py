#!/usr/bin/env python3
"""Магазин паков: store/catalog.json (список паков для игры) + store/packs/<id>.json (сами паки).

  python3 tools/store.py add pack_xxx.json [--price 14.99]   — добавить/обновить пак в магазине
  python3 tools/store.py remove <id>                          — убрать пак из магазина
  python3 tools/store.py list

Игра читает каталог с GitHub (raw.githubusercontent.com/.../store/catalog.json), а при отсутствии
сети — копию, встроенную в сборку. Обложка и маленькие картинки вещей лежат прямо в каталоге,
чтобы магазин показывался сразу, а сам пак скачивался только при покупке/загрузке.
"""
import base64, io, json, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(ROOT, 'store')
CAT = os.path.join(STORE, 'catalog.json')
COLORS = [(255, 214, 140), (186, 226, 255), (255, 196, 214), (200, 236, 190), (225, 205, 255)]


def load_cat():
    if os.path.exists(CAT):
        return json.load(open(CAT, encoding='utf8'))
    return {'format': 'sunny-home-store', 'version': 1, 'packs': []}


def save_cat(cat):
    os.makedirs(STORE, exist_ok=True)
    json.dump(cat, open(CAT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)


def data_im(url):
    return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')


def to_url(im, q=82):
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=q, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def thumb(im, size):
    im = im.copy(); im.thumbnail((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size)); out.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return out


def make_cover(items, k):
    """Обложка 480×300: цветной фон с кругами и 3–4 вещи пака."""
    W, H = 480, 300
    bg = COLORS[k % len(COLORS)]
    im = Image.new('RGBA', (W, H), bg + (255,))
    d = ImageDraw.Draw(im)
    for i, (x, y, r) in enumerate([(60, 50, 70), (420, 260, 110), (400, 40, 40), (90, 270, 50)]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(min(255, c + 22) for c in bg) + (255,))
    pics = [data_im(it['image']) for it in items[:4]]
    n = len(pics)
    for i, p in enumerate(pics):
        t = thumb(p, 170 if n <= 2 else 140)
        x = int(W * (i + 1) / (n + 1) - t.width / 2)
        y = H - t.height - 30 - (18 if i % 2 else 0)
        im.alpha_composite(t, (x, y))
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1), 36, fill=255)
    im.putalpha(mask)
    return im


def add(path, price):
    pack = json.load(open(path, encoding='utf8'))
    assert pack.get('format') == 'sunny-home-pack', 'это не пак «Солнечного дома»'
    pid = pack['id']
    if price is None:
        price = float(pack.get('price') or 0)
    pack['price'] = price
    os.makedirs(os.path.join(STORE, 'packs'), exist_ok=True)
    json.dump(pack, open(os.path.join(STORE, 'packs', pid + '.json'), 'w', encoding='utf8'), ensure_ascii=False)
    cat = load_cat()
    old = next((p for p in cat['packs'] if p['id'] == pid), None)
    k = cat['packs'].index(old) if old else len(cat['packs'])
    cover = pack.get('cover') or to_url(make_cover(pack['items'], k), 85)
    entry = {
        'id': pid, 'name': pack.get('name', pid), 'version': (old or {}).get('version', 0) + 1,
        'price': price, 'currency': 'PLN', 'priceLabel': (f'{price:.2f}'.replace('.', ',') + ' zł') if price else '',
        'product': 'pack_' + pid, 'file': 'packs/' + pid + '.json', 'items': len(pack['items']),
        'cover': cover, 'preview': [to_url(thumb(data_im(it['image']), 96), 80) for it in pack['items'][:8]],
    }
    if old: cat['packs'][k] = entry
    else: cat['packs'].append(entry)
    save_cat(cat)
    print(f"в магазине: {entry['name']} ({pid}) — {entry['priceLabel'] or 'бесплатно'}, вещей: {entry['items']}, версия {entry['version']}")


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['add']:
        price = float(a[a.index('--price') + 1]) if '--price' in a else None
        add(a[1], price)
    elif a[:1] == ['remove']:
        cat = load_cat(); cat['packs'] = [p for p in cat['packs'] if p['id'] != a[1]]; save_cat(cat)
        f = os.path.join(STORE, 'packs', a[1] + '.json')
        if os.path.exists(f): os.remove(f)
    else:
        for p in load_cat()['packs']:
            print(p['id'], p['name'], p['priceLabel'] or 'бесплатно', p['items'])
