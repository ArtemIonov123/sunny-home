#!/usr/bin/env python3
"""Магазин паков: store/catalog.json (список паков для игры) + store/packs/<id>.json (сами паки).

  python3 tools/store.py add pack_xxx.json [--price 14.99] [--page-color #hex] [--page-image фон.png]
                                                              [--slides 1.png,2.png] — добавить/обновить пак в магазине
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


def cover_fill(src, W, H):
    im = data_im(src); s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im.crop(((im.width - W) // 2, (im.height - H) // 2, (im.width - W) // 2 + W, (im.height - H) // 2 + H))


def make_cover(items, k, style=None):
    """Обложка 480×300: фон (цвет / своя картинка / своя обложка целиком — style из студии) и 3–4 вещи пака."""
    W, H = 480, 300
    style = style or {}
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, W - 1, H - 1), 36, fill=255)
    if style.get('full'):
        im = cover_fill(style['full'], W, H); im.putalpha(mask); return im
    col = style.get('color')
    bg = tuple(int(col[i:i + 2], 16) for i in (1, 3, 5)) if col else COLORS[k % len(COLORS)]
    im = Image.new('RGBA', (W, H), bg + (255,))
    d = ImageDraw.Draw(im)
    if style.get('bg'):
        im.alpha_composite(cover_fill(style['bg'], W, H))
    else:
        for i, (x, y, r) in enumerate([(60, 50, 70), (420, 260, 110), (400, 40, 40), (90, 270, 50)]):
            d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(min(255, c + 22) for c in bg) + (255,))
    pics = [data_im(it['image']) for it in items[:4]]
    n = len(pics)
    for i, p in enumerate(pics):
        t = thumb(p, 170 if n <= 2 else 140)
        x = int(W * (i + 1) / (n + 1) - t.width / 2)
        y = H - t.height - 30 - (18 if i % 2 else 0)
        im.alpha_composite(t, (x, y))
    im.putalpha(mask)
    return im


def add(path, price, page_color=None, page_image=None, slide_files=None):
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
    cover = pack.get('cover') or to_url(make_cover(pack['items'], k, pack.get('coverStyle')), 85)
    entry = {
        'id': pid, 'name': pack.get('name', pid), 'version': (old or {}).get('version', 0) + 1,
        'price': price, 'currency': 'PLN', 'priceLabel': (f'{price:.2f}'.replace('.', ',') + ' zł') if price else '',
        'product': 'pack_' + pid, 'file': 'packs/' + pid + '.json', 'items': len(pack['items']),
        'cover': cover, 'preview': [to_url(thumb(data_im(it['image']), 112), 78) for it in pack['items'][:24]],
        'page': {'color': page_color or (pack.get('pageStyle') or {}).get('color', '')},
    }
    # Фон страницы пака — отдельной картинкой store/bg/<id>.webp
    bg = None
    if page_image:
        bg = Image.open(page_image).convert('RGB'); bg.thumbnail((1280, 800), Image.LANCZOS)
    elif (pack.get('pageStyle') or {}).get('image'):
        bg = data_im(pack['pageStyle']['image']).convert('RGB')
    if bg is not None:
        os.makedirs(os.path.join(STORE, 'bg'), exist_ok=True)
        bg.save(os.path.join(STORE, 'bg', pid + '.webp'), 'WEBP', quality=82, method=6)
        entry['page']['image'] = f"bg/{pid}.webp?v={entry['version']}"
    # Слайды «что внутри»: store/slides/<id>_<n>.webp (из --slides или из пака студии)
    sl = [Image.open(f).convert('RGB') for f in (slide_files or [])] or [data_im(x).convert('RGB') for x in pack.get('slides', [])]
    d = os.path.join(STORE, 'slides'); os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.startswith(pid + '_'): os.remove(os.path.join(d, f))
    entry['slides'] = []
    for n, im in enumerate(sl[:10], 1):
        im.thumbnail((960, 600), Image.LANCZOS); im.save(os.path.join(d, f'{pid}_{n}.webp'), 'WEBP', quality=82, method=6)
        entry['slides'].append(f"slides/{pid}_{n}.webp?v={entry['version']}")
    if old: cat['packs'][k] = entry
    else: cat['packs'].append(entry)
    save_cat(cat)
    print(f"в магазине: {entry['name']} ({pid}) — {entry['priceLabel'] or 'бесплатно'}, вещей: {entry['items']}, версия {entry['version']}")


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['add']:
        opt = lambda k: a[a.index(k) + 1] if k in a else None
        price = float(opt('--price')) if opt('--price') else None
        add(a[1], price, opt('--page-color'), opt('--page-image'), opt('--slides').split(',') if opt('--slides') else None)
    elif a[:1] == ['remove']:
        cat = load_cat(); cat['packs'] = [p for p in cat['packs'] if p['id'] != a[1]]; save_cat(cat)
        f = os.path.join(STORE, 'packs', a[1] + '.json')
        if os.path.exists(f): os.remove(f)
    else:
        for p in load_cat()['packs']:
            print(p['id'], p['name'], p['priceLabel'] or 'бесплатно', p['items'])
