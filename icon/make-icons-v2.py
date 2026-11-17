# v2 icons for Claude Ironworks (claude-orbit.ico + public/favicon.ico) and Claude Grimm (claude-grimm.ico + public/grimm.ico).
# 16-48 px: a glyph laid out on the target pixel grid (every edge lands on a whole pixel), drawn 8x and box-filtered down.
# 64-256 px: the full illustration drawn at 1024 and resampled. Also writes preview-v2.png. Run: python make-icons-v2.py
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
SMALL_MAX = 48
K = 8  # supersample factor for the pixel-grid glyphs

CYAN, GREEN, ORANGE, PINK = (56, 232, 255), (124, 255, 107), (255, 138, 92), (255, 95, 162)
RED = (200, 48, 44)


def rgba(c, a=255):
    return tuple(c[:3]) + (a,)


def vgrad(w, h, top, bottom):
    g = Image.new('RGBA', (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
    return g.resize((w, h))


def radial(w, h, cx, cy, r, inner, outer, power=1.0):
    im = Image.new('RGBA', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            t = min(1.0, math.hypot(x - cx, y - cy) / r) ** power
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(inner, outer)) + (255,)
    return im


def mask_round(w, radius, inset=0):
    m = Image.new('L', (w, w), 0)
    ImageDraw.Draw(m).rounded_rectangle((inset, inset, w - 1 - inset, w - 1 - inset), radius=max(0, radius - inset), fill=255)
    return m


def clip(im, m):
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


def glow(base, shape_fn, blur, color, alpha):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    shape_fn(ImageDraw.Draw(layer), rgba(color, alpha))
    base.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def tile(w, radius, fill, rim_top, rim_bottom, rim):
    """Rounded tile: fill image clipped, with a rim that fades top to bottom (the shared 'maker's frame')."""
    outer = mask_round(w, radius)
    inner = mask_round(w, radius, rim)
    rimimg = vgrad(w, w, rim_top, rim_bottom)
    im = clip(rimimg, outer)
    im.paste(fill, (0, 0), inner)
    return im, inner


# ------------------------------------------------------------------ Ironworks

def iron_small(n):
    """Robot bust on the pixel grid: steel head, full-width cyan visor, orange core on the chest."""
    S = n * K
    u = lambda v: int(round(v * K))
    r = max(3, round(n * .22))
    rim = 1 if n < 40 else 2
    fill = vgrad(S, S, (16, 24, 40), (5, 7, 12))
    im, inner = tile(S, u(r), fill, CYAN, PINK, u(rim))
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    # hand-tuned rows per size: head x0,x1,y0,y1 / visor y0,y1 / chest y0 / core size
    T = {16: (3, 13, 3, 10, 5, 7, 11, 2),
         20: (4, 16, 3, 12, 6, 9, 13, 2),
         24: (5, 19, 4, 14, 7, 10, 16, 4),
         32: (7, 25, 5, 19, 9, 13, 21, 4),
         40: (9, 31, 6, 24, 11, 16, 26, 6),
         48: (11, 37, 7, 28, 13, 19, 31, 6)}[n]
    hx0, hx1, hy0, hy1, vy0, vy1, cy0, cs = T
    hr = 1 if n < 24 else 2 if n < 40 else 3
    # shoulders, cut by the tile edge like a bust
    sx0, sx1 = max(rim + 1, hx0 - (2 if n < 24 else 4)), min(n - rim - 1, hx1 + (2 if n < 24 else 4))
    d.rounded_rectangle((u(sx0), u(cy0), u(sx1) - 1, S + u(4)), radius=u(hr + 1), fill=(44, 54, 76, 255))
    if n >= 24:  # pink edge light along the shoulder top
        d.rectangle((u(sx0 + hr), u(cy0), u(sx1 - hr) - 1, u(cy0) + K - 1), fill=rgba(PINK))
    if n >= 24:  # antenna with a pink tip, so the head reads as a robot and not a screen
        a = n // 2 - 1
        d.rectangle((u(a), u(hy0 - 2), u(a + 2) - 1, u(hy0) - 1), fill=(60, 72, 98, 255))
        d.rectangle((u(a), u(hy0 - 3), u(a + 2) - 1, u(hy0 - 1) - 1 - (K if n < 40 else 0)), fill=rgba(PINK))
    # head
    d.rounded_rectangle((u(hx0), u(hy0), u(hx1) - 1, u(hy1) - 1), radius=u(hr), fill=(78, 92, 122, 255))
    d.rectangle((u(hx0 + hr), u(hy0), u(hx1 - hr) - 1, u(hy0) + K - 1), fill=(150, 166, 196, 255))  # top light
    # visor, edge to edge minus one pixel
    vx0, vx1 = hx0 + 1, hx1 - 1
    d.rectangle((u(vx0), u(vy0), u(vx1) - 1, u(vy1) - 1), fill=(8, 12, 20, 255))
    d.rectangle((u(vx0) + (K if n >= 32 else 0), u(vy0) + (K if n >= 40 else 0),
                 u(vx1) - 1 - (K if n >= 32 else 0), u(vy1) - 1 - (K if n >= 40 else 0)), fill=rgba(CYAN))
    if n >= 32:  # bright eye-line in the visor
        ey = (vy0 + vy1) // 2
        d.rectangle((u(vx0 + 2), u(ey), u(vx1 - 2) - 1, u(ey) + K - 1), fill=(210, 250, 255, 255))
    # core: orange square-ish dot, centred on the chest
    cx0 = (n - cs) // 2
    ccy = cy0 + (2 if n < 24 else 3 if n < 40 else 4)
    if n >= 32:
        glow(lay, lambda g, c: g.ellipse((u(cx0 - 2), u(ccy - 2), u(cx0 + cs + 2), u(ccy + cs + 2)), fill=c), K * 1.6, ORANGE, 200)
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle((u(cx0), u(ccy), u(cx0 + cs) - 1, u(ccy + cs) - 1), radius=u(cs / 2) - 1 if n >= 24 else 0, fill=rgba(ORANGE))
    if n >= 24:
        c = cx0 + cs // 2 - 1
        d.rectangle((u(c), u(ccy + cs // 2 - 1), u(c + 2) - 1, u(ccy + cs // 2 + 1) - 1), fill=(255, 226, 196, 255))
    if n >= 40:  # green status led
        d.rectangle((u(sx1 - 4), u(cy0 + 3), u(sx1 - 2) - 1, u(cy0 + 5) - 1), fill=rgba(GREEN))
    im.alpha_composite(clip(lay, inner))
    return im.resize((n, n), Image.BOX)


def iron_big():
    S = 1024
    bg = radial(S, S, S * .5, S * .38, S * .78, (22, 46, 70), (4, 5, 10), 1.1)
    d = ImageDraw.Draw(bg)
    # city skyline at the foot, with window lights
    import random
    rnd = random.Random(7)
    x = 0
    while x < S:
        w = rnd.randint(50, 110)
        h = rnd.randint(140, 330)
        d.rectangle((x, S - h, x + w, S), fill=(10, 14, 24, 255))
        for wy in range(S - h + 20, S - 10, 26):
            for wx in range(x + 10, x + w - 10, 20):
                if rnd.random() < .22:
                    d.rectangle((wx, wy, wx + 8, wy + 10), fill=rgba(rnd.choice([CYAN, PINK, CYAN, (255, 200, 120)]), 150))
        x += w + rnd.randint(4, 14)
    # halo behind the head
    glow(bg, lambda g, c: g.ellipse((210, 130, 814, 700), fill=c), 90, CYAN, 70)
    im = bg
    # shoulders / chest plate
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle((150, 700, 874, 1180), radius=150, fill=(40, 50, 72, 255))
    d.rounded_rectangle((170, 720, 854, 1180), radius=135, fill=(30, 38, 56, 255))
    # neck
    d.rectangle((420, 610, 604, 720), fill=(22, 28, 40, 255))
    for yy in range(628, 712, 22):
        d.rectangle((430, yy, 594, yy + 8), fill=(52, 62, 86, 255))
    im.alpha_composite(lay)
    # pink edge lights on the shoulders
    def shoulder(g, c):
        g.arc((150, 700, 450, 1000), 180, 270, fill=c, width=16)
        g.arc((574, 700, 874, 1000), 270, 360, fill=c, width=16)
        g.line((300, 708, 724, 708), fill=c, width=16)
    glow(im, shoulder, 18, PINK, 230)
    d = ImageDraw.Draw(im)
    d.arc((150, 700, 450, 1000), 180, 270, fill=(255, 170, 205, 255), width=6)
    d.arc((574, 700, 874, 1000), 270, 360, fill=(255, 170, 205, 255), width=6)
    d.line((300, 704, 724, 704), fill=(255, 170, 205, 255), width=6)
    # orange core with glow
    glow(im, lambda g, c: g.ellipse((392, 742, 632, 982), fill=c), 46, ORANGE, 255)
    d = ImageDraw.Draw(im)
    d.ellipse((432, 782, 592, 942), fill=(60, 30, 20, 255))
    d.ellipse((446, 796, 578, 928), fill=rgba(ORANGE))
    glow(im, lambda g, c: g.ellipse((470, 820, 554, 904), fill=c), 14, (255, 230, 200), 255)
    d = ImageDraw.Draw(im)
    # green status leds
    for i in range(3):
        d.rounded_rectangle((700 + i * 34, 800, 722 + i * 34, 822), radius=6, fill=rgba(GREEN if i < 2 else (40, 70, 50)))
    # head: gunmetal helmet with a lit top
    head = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hm = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hm).rounded_rectangle((250, 170, 774, 640), radius=120, fill=255)
    metal = vgrad(S, S, (132, 148, 180), (34, 42, 60))
    head.paste(metal, (0, 0), hm)
    # cyan rim light on the left, pink on the right
    edge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle((250, 170, 774, 640), radius=120, outline=rgba(CYAN, 255), width=10)
    edge_m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(edge_m).rectangle((0, 0, 512, S), fill=255)
    head.alpha_composite(clip(edge, edge_m))
    ed2 = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(ed2).rounded_rectangle((250, 170, 774, 640), radius=120, outline=rgba(PINK, 255), width=10)
    head.alpha_composite(clip(ed2, ImageChops.invert(edge_m)))
    hd = ImageDraw.Draw(head)
    # ear modules
    hd.rounded_rectangle((218, 330, 262, 480), radius=14, fill=(28, 34, 50, 255))
    hd.rounded_rectangle((762, 330, 806, 480), radius=14, fill=(28, 34, 50, 255))
    # antenna with a pink tip
    hd.rectangle((500, 80, 524, 172), fill=(40, 48, 68, 255))
    im.alpha_composite(head)
    glow(im, lambda g, c: g.ellipse((474, 44, 550, 120), fill=c), 22, PINK, 255)
    d = ImageDraw.Draw(im)
    d.ellipse((488, 58, 536, 106), fill=(255, 190, 220, 255))
    # visor recess + glowing visor
    d.rounded_rectangle((292, 318, 732, 476), radius=60, fill=(6, 9, 16, 255))
    glow(im, lambda g, c: g.rounded_rectangle((300, 330, 724, 464), radius=54, fill=c), 30, CYAN, 230)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((316, 342, 708, 452), radius=46, fill=(18, 180, 220, 255))
    d.rounded_rectangle((330, 352, 694, 400), radius=24, fill=(120, 240, 255, 255))  # top sheen
    # eyes in the visor
    for ex in (420, 604):
        glow(im, lambda g, c, ex=ex: g.ellipse((ex - 46, 360, ex + 46, 436), fill=c), 14, (230, 255, 255), 255)
    d = ImageDraw.Draw(im)
    for ex in (420, 604):
        d.rounded_rectangle((ex - 34, 384, ex + 34, 412), radius=14, fill=(255, 255, 255, 255))
    # scan lines on the visor
    for yy in range(346, 452, 12):
        d.line((320, yy, 704, yy), fill=(0, 60, 90, 60), width=3)
    # helmet top highlight
    d.rounded_rectangle((330, 196, 694, 220), radius=12, fill=(210, 222, 245, 200))
    return im


# ------------------------------------------------------------------ Grimm

def grimm_small(n):
    """Black fedora with a red band on a pale spotlit tile."""
    S = n * K
    u = lambda v: int(round(v * K))
    r = max(3, round(n * .22))
    rim = 1 if n < 40 else 2
    fill = radial(S, S, S * .5, S * .35, S * .85, (246, 244, 238), (150, 150, 150), 1.4)
    im, inner = tile(S, u(r), fill, (60, 60, 60), (12, 12, 12), u(rim))
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    INK = (14, 14, 16, 255)
    # crown x0,x1,y0 / band y0,y1 / brim x0,x1,y0,y1
    T = {16: (4, 12, 4, 8, 10, 1, 15, 9, 13),
         20: (5, 15, 4, 10, 12, 1, 19, 11, 16),
         24: (6, 18, 5, 12, 14, 1, 23, 13, 19),
         32: (8, 24, 6, 16, 19, 2, 30, 17, 25),
         40: (10, 30, 8, 20, 24, 2, 38, 22, 31),
         48: (12, 36, 9, 24, 29, 3, 45, 27, 37)}[n]
    cx0, cx1, cy0, by0, by1, bx0, bx1, br0, br1 = T
    if n >= 40:  # venetian-blind light falling across the tile
        for i, yy in enumerate(range(rim + 2, n, 4 if n < 48 else 5)):
            d.rectangle((0, u(yy), S, u(yy) + K * (1 if n < 48 else 2) - 1), fill=(0, 0, 0, 34))
    # crown: slight taper and a centre pinch
    tap = 1 if n < 32 else 2 if n < 48 else 3
    pinch = 1 if n < 32 else 2
    mid = n / 2
    d.polygon([(u(cx0), u(by1)), (u(cx0 + tap), u(cy0)), (u(mid - pinch), u(cy0)), (u(mid), u(cy0 + pinch)),
               (u(mid + pinch), u(cy0)), (u(cx1 - tap), u(cy0)), (u(cx1), u(by1))], fill=INK)
    d.rectangle((u(cx0), u(by0), u(cx1) - 1, u(by1) - 1), fill=rgba(RED))
    # brim: a flat oval that dips at the front
    d.ellipse((u(bx0), u(br0), u(bx1) - 1, u(br1) - 1), fill=INK)
    if n >= 32:  # sheen on the crown edge so it isn't a flat blob
        d.rectangle((u(cx0 + tap + 1), u(cy0 + 1), u(cx0 + tap + 2) - 1, u(by0) - 1), fill=(70, 70, 74, 255))
    im.alpha_composite(clip(lay, inner))
    return im.resize((n, n), Image.BOX)


def grimm_big():
    S = 1024
    bg = radial(S, S, S * .42, S * .30, S * .95, (250, 248, 242), (70, 70, 72), 1.25)
    # venetian-blind shadows slanting across, soft-edged
    blinds = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blinds)
    for i in range(-6, 22):
        y = i * 64
        bd.polygon([(0, y), (S, y - 260), (S, y - 260 + 30), (0, y + 30)], fill=(0, 0, 0, 120))
    bg.alpha_composite(blinds.filter(ImageFilter.GaussianBlur(5)))
    im = bg
    INK = (12, 12, 14, 255)
    fig = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(fig)
    # trench-coat collar and shoulders
    d.polygon([(90, 1024), (180, 820), (380, 730), (512, 800), (644, 730), (844, 820), (934, 1024)], fill=INK)
    # face in shadow: jaw only
    d.polygon([(372, 520), (652, 520), (634, 700), (560, 780), (464, 780), (390, 700)], fill=(22, 22, 24, 255))
    # turned-up collar lapels, catching some light
    d.polygon([(300, 760), (420, 640), (470, 820), (430, 1024), (330, 1024)], fill=(46, 46, 50, 255))
    d.polygon([(724, 760), (604, 640), (554, 820), (594, 1024), (694, 1024)], fill=(36, 36, 40, 255))
    d.polygon([(512, 800), (470, 820), (512, 1024), (554, 820)], fill=(20, 20, 22, 255))
    # fedora
    d.polygon([(286, 470), (318, 220), (410, 176), (512, 228), (614, 176), (706, 220), (738, 470)], fill=INK)
    d.polygon([(284, 402), (740, 402), (748, 478), (276, 478)], fill=rgba(RED))
    d.ellipse((96, 432, 928, 580), fill=INK)
    fig_m = fig.split()[3]
    # the blind light also crosses the figure, faintly
    stripes = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripes)
    for i in range(-6, 22):
        y = i * 64 + 32
        sd.polygon([(0, y), (S, y - 260), (S, y - 260 + 30), (0, y + 30)], fill=(255, 255, 255, 22))
    fig.alpha_composite(clip(stripes.filter(ImageFilter.GaussianBlur(4)), fig_m))
    # brim edge highlight
    ImageDraw.Draw(fig).arc((96, 432, 928, 580), 200, 340, fill=(90, 90, 96, 255), width=6)
    im.alpha_composite(fig)
    # smoke from the ember, drawn soft
    smoke = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    pts = [(792 + math.sin(t * .022) * 44 + t * .10, 680 - t) for t in range(0, 560, 5)]
    ImageDraw.Draw(smoke).line(pts, fill=(255, 255, 255, 170), width=26, joint='curve')
    im.alpha_composite(smoke.filter(ImageFilter.GaussianBlur(12)))
    # cigarette and ember
    d = ImageDraw.Draw(im)
    d.line([(580, 712), (790, 676)], fill=(236, 232, 222, 255), width=26)
    glow(im, lambda g, c: g.ellipse((740, 616, 860, 736), fill=c), 30, RED, 255)
    d = ImageDraw.Draw(im)
    d.ellipse((774, 658, 812, 696), fill=(255, 120, 90, 255))
    return im


# ------------------------------------------------------------------ Kitchen

TOQUE, TOQUE_SH = (255, 253, 247), (206, 192, 176)
CLAY_LT, CLAY_DK = (238, 176, 128), (168, 96, 62)
KORANGE, EYE = (217, 119, 87), (44, 24, 18)
K_RIM = ((240, 160, 118), (176, 86, 56))  # warm orange rim, light to dark
K_TILE = ((170, 66, 44), (40, 20, 14))  # brick red to espresso


def kitchen_small(n):
    """16-32: a big white toque with an orange band. 40-64: smaller toque over a clay face and orange neckerchief."""
    S = n * K
    u = lambda v: int(round(v * K))
    r = max(3, round(n * .22))
    rim = 1 if n < 40 else 2
    fill = radial(S, S, S * .45, S * .3, S * .95, *K_TILE, 1.0)
    im, inner = tile(S, u(r), fill, *K_RIM, u(rim))
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # band x0,x1,y0,y1, puff radius, orange stripe height (toque only) | head x0,x1,y0 (face sizes)
    T = {16: (4, 12, 9, 14, 3, 2), 20: (5, 15, 11, 18, 3.5, 2), 24: (6, 18, 13, 21, 4.5, 3), 32: (8, 24, 17, 28, 6, 4),
         40: (12, 28, 13, 17, 4, 10, 30, 16), 48: (14, 34, 15, 20, 5, 12, 36, 19), 64: (19, 45, 20, 26, 6.5, 16, 48, 25)}[n]
    bx0, bx1, by0, by1, pr = T[:5]
    face = n >= 40
    mid = n / 2

    def toque(g, c):
        g.ellipse((u(bx0 - 1.5), u(by0 - 2 * pr + 1), u(bx0 - 1.5 + 2 * pr), u(by0 + 1)), fill=c)
        g.ellipse((u(bx1 + 1.5 - 2 * pr), u(by0 - 2 * pr + 1), u(bx1 + 1.5), u(by0 + 1)), fill=c)
        g.ellipse((u(mid - pr - .5), u(by0 - 2 * pr - 1.5), u(mid + pr + .5), u(by0 - .5)), fill=c)
        g.rectangle((u(bx0), u(by0 - pr), u(bx1) - 1, u(by1) - 1), fill=c)

    if face:
        hx0, hx1, hy0 = T[5:]
        hy1 = hy0 + hx1 - hx0
        d = ImageDraw.Draw(lay)
        # neckerchief: orange knot under the chin
        sy = hy1 - 3
        d.polygon([(u(hx0 + 1), u(sy)), (u(hx1 - 1), u(sy)), (u(mid + 2), u(n - rim)), (u(mid - 2), u(n - rim))], fill=rgba(KORANGE))
        # clay head, lit from the top left
        hm = Image.new('L', (S, S), 0)
        ImageDraw.Draw(hm).ellipse((u(hx0), u(hy0), u(hx1) - 1, u(hy1) - 1), fill=255)
        hs = hx1 - hx0
        lay.alpha_composite(clip(radial(S, S, u(hx0 + hs * .35), u(hy0 + hs * .3), u(hs * .85), CLAY_LT, CLAY_DK, 1.2), hm))
        d = ImageDraw.Draw(lay)
        es = 2 if n < 64 else 3
        ey = hy0 + hs * 45 // 100
        gap = hs * 22 // 100
        for ex in (int(mid) - gap - es + 1, int(mid) + gap - 1):
            d.rectangle((u(ex), u(ey), u(ex + es) - 1, u(ey + es) - 1), fill=rgba(EYE))
            if n >= 64:
                d.rectangle((u(ex), u(ey), u(ex + 1) - 1, u(ey + 1) - 1), fill=(255, 255, 255, 255))
            d.rectangle((u(ex - 1), u(ey + es + 2), u(ex + es - 1) - 1, u(ey + es + 3) - 1), fill=(236, 120, 100, 255))  # cheek
        sy2 = ey + es + 2
        w = 2 if n < 64 else 3
        d.rectangle((u(mid - w + 1), u(sy2 + 1), u(mid + w - 1) - 1, u(sy2 + 2) - 1), fill=rgba(EYE))
        d.rectangle((u(mid - w), u(sy2), u(mid - w + 1) - 1, u(sy2 + 1) - 1), fill=rgba(EYE))
        d.rectangle((u(mid + w - 1), u(sy2), u(mid + w) - 1, u(sy2 + 1) - 1), fill=rgba(EYE))
    # 1-px dark outline under the toque so its edge reads on the tile
    sil = Image.new('L', (S, S), 0)
    toque(ImageDraw.Draw(sil), 255)
    ring = sil.filter(ImageFilter.MaxFilter(2 * K + 1))
    lay.alpha_composite(clip(Image.new('RGBA', (S, S), (30, 12, 8, 230)), ring))
    d = ImageDraw.Draw(lay)
    toque(d, rgba(TOQUE))
    # soft shade on the lower half of the puffs, then the band
    d.rectangle((u(bx0), u(by0), u(bx1) - 1, u(by1) - 1), fill=(234, 224, 210, 255))
    step = 2 if n < 48 else 3
    if n >= 24:
        for px in range(bx0 + step, bx1 - 1, step):
            d.rectangle((u(px), u(by0), u(px) + K - 1, u(by1) - 1), fill=rgba(TOQUE_SH))
    if not face:
        d.rectangle((u(bx0), u(by1 - T[5]), u(bx1) - 1, u(by1) - 1), fill=rgba(KORANGE))
    im.alpha_composite(clip(lay, inner))
    return im.resize((n, n), Image.BOX)


def shaded(mask, light, dark, cx, cy, r):
    """Clay shading: a soft radial light inside a shape, computed at 1/4 size (smooth anyway)."""
    q = radial(256, 256, cx / 4, cy / 4, r / 4, light, dark, 1.3).resize((1024, 1024), Image.BICUBIC)
    return clip(q, mask)


def kitchen_big():
    import random
    S = 1024
    im = radial(256, 256, 110, 80, 270, *K_TILE, 1.0).resize((S, S), Image.BICUBIC)
    glow(im, lambda g, c: g.ellipse((220, 120, 804, 760), fill=c), 110, (255, 170, 110), 60)  # studio light behind

    def shape(fn):
        m = Image.new('L', (S, S), 0)
        fn(ImageDraw.Draw(m))
        return m

    def drop(m, off=16, blur=24, a=170):
        s = Image.new('RGBA', (S, S), (16, 6, 2, a))
        layer = clip(s, m.transform(m.size, Image.AFFINE, (1, 0, -off * .6, 0, 1, -off)))
        im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))

    # jacket: rounded clay bust that ends inside the frame
    jm = shape(lambda g: g.rounded_rectangle((200, 730, 824, 965), radius=150, fill=255))
    drop(jm)
    im.alpha_composite(shaded(jm, (255, 253, 247), (176, 160, 142), 380, 720, 640))
    d = ImageDraw.Draw(im)
    d.line((512, 800, 512, 950), fill=(200, 186, 168, 255), width=6)
    for bx, by in ((440, 850), (584, 850), (440, 930), (584, 930)):
        d.ellipse((bx - 17, by - 17, bx + 17, by + 17), fill=(178, 100, 56, 255))
        d.ellipse((bx - 9, by - 11, bx + 1, by - 1), fill=(240, 180, 130, 255))
    # neckerchief: triangle and knot
    km = shape(lambda g: (g.polygon([(390, 720), (634, 720), (512, 860)], fill=255), g.ellipse((470, 720, 554, 790), fill=255)))
    drop(km, 10, 12, 140)
    im.alpha_composite(shaded(km, (246, 150, 112), (168, 76, 48), 470, 720, 220))
    # head
    hm = shape(lambda g: g.ellipse((357, 420, 667, 740), fill=255))
    drop(hm, 18, 22, 170)
    im.alpha_composite(shaded(hm, (246, 196, 152), (150, 82, 50), 450, 500, 400))
    d = ImageDraw.Draw(im)
    for ex in (452, 572):
        d.ellipse((ex - 21, 560, ex + 21, 610), fill=rgba(EYE))
        d.ellipse((ex - 11, 568, ex + 1, 582), fill=(255, 255, 255, 255))
        d.arc((ex - 34, 516, ex + 34, 560), 205, 335, fill=(92, 50, 32, 255), width=12)  # brow
    d.arc((466, 610, 558, 676), 25, 155, fill=rgba(EYE), width=13)
    blush = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blush)
    for cx in (408, 616):
        bd.ellipse((cx - 36, 620, cx + 36, 664), fill=(236, 104, 92, 150))
    im.alpha_composite(blush.filter(ImageFilter.GaussianBlur(10)))

    # toque: puffs over a pleated band, top at y=110
    def toque(g):
        g.rounded_rectangle((352, 360, 672, 470), radius=26, fill=255)
        for cx, cy, r in ((404, 280, 104), (620, 280, 104), (512, 236, 126), (458, 352, 84), (566, 352, 84)):
            g.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    tm = shape(toque)
    drop(tm, 16, 24, 170)
    im.alpha_composite(shaded(tm, (255, 254, 250), (186, 170, 152), 430, 160, 440))
    d = ImageDraw.Draw(im)
    for px in range(392, 650, 40):
        d.line((px, 388, px, 464), fill=(206, 192, 174, 255), width=8)
    d.rounded_rectangle((352, 446, 672, 470), radius=12, fill=rgba(KORANGE))  # orange band ties to the small sizes
    # three small steam curls, upper right
    steam = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(steam)
    for x0, ph, top in ((760, 0, 420), (820, 1.8, 380), (880, 3.2, 440)):
        pts = [(x0 + math.sin(t * .045 + ph) * 18, 640 - t) for t in range(0, 640 - top, 5)]
        sd.line(pts, fill=(255, 240, 225, 120), width=14, joint='curve')
    im.alpha_composite(steam.filter(ImageFilter.GaussianBlur(5)))
    # fine clay grain over the figure
    rnd = random.Random(3)
    tex = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    td = ImageDraw.Draw(tex)
    for _ in range(7000):
        td.point((rnd.randrange(S), rnd.randrange(S)), fill=(255, 255, 255, 36) if rnd.random() < .5 else (80, 40, 20, 30))
    fig = ImageChops.lighter(ImageChops.lighter(jm, hm), tm)
    im.alpha_composite(clip(tex, fig))
    return im


def big_frame(art, n, rim_top, rim_bottom):
    S = 1024
    radius = int(S * .22)
    rim = int(S * (6 / 256))
    im, inner = tile(S, radius, Image.new('RGBA', (S, S)), rim_top, rim_bottom, rim)
    im.alpha_composite(clip(art, inner))
    return im.resize((n, n), Image.LANCZOS)


def build(small_fn, big_art, rim_top, rim_bottom, small_max=SMALL_MAX):
    return {n: small_fn(n) if n <= small_max else big_frame(big_art, n, rim_top, rim_bottom) for n in SIZES}


def save_ico(frames, path):
    big = frames[256]
    big.save(path, format='ICO', sizes=[(s, s) for s in SIZES], append_images=[frames[s] for s in SIZES[:-1]])


def preview(sets, path):
    pad, blocks = 16, []
    W = pad + sum(n * 4 + pad for n in SIZES if n <= 64)
    for name, frames in sets:
        for bgc in ((243, 243, 243), (32, 32, 32)):
            one = Image.new('RGB', (W, 256 + 2 * pad), bgc)  # every size 1:1
            x = pad
            for n in SIZES:
                one.paste(frames[n], (x, pad + 256 - n), frames[n])
                x += n + pad
            four = Image.new('RGB', (W, 4 * 64 + 2 * pad), bgc)  # 16..64 at 4x
            x = pad
            for n in SIZES:
                if n > 64:
                    continue
                f = frames[n].resize((n * 4, n * 4), Image.NEAREST)
                four.paste(f, (x, pad + 256 - n * 4), f)
                x += n * 4 + pad
            blocks += [one, four]
    Wt = max(b.width for b in blocks)
    sheet = Image.new('RGB', (Wt, sum(b.height for b in blocks)), (128, 128, 128))
    y = 0
    for b in blocks:
        sheet.paste(b, (0, y))
        y += b.height
    sheet.save(path)


if __name__ == '__main__':
    # python make-icons-v2.py [orbit] [grimm] [kitchen]  -- no args writes all three; the preview always shows all three
    import sys
    only = set(sys.argv[1:]) or {'orbit', 'grimm', 'kitchen'}
    iron = build(iron_small, iron_big(), CYAN, PINK)
    grimm = build(grimm_small, grimm_big(), (60, 60, 60), (12, 12, 12))
    kitchen = build(kitchen_small, kitchen_big(), *K_RIM, small_max=64)  # kitchen keeps the pixel glyph up to 64
    root = os.path.dirname(HERE)
    for key, frames, ico, tab in (('orbit', iron, 'claude-orbit.ico', 'favicon.ico'), ('grimm', grimm, 'claude-grimm.ico', 'grimm.ico'),
                                  ('kitchen', kitchen, 'claude-kitchen.ico', 'kitchen.ico')):
        if key not in only:
            continue
        p = os.path.join(HERE, ico)
        save_ico(frames, p)
        shutil.copyfile(p, os.path.join(root, 'public', tab))
        got = sorted(Image.open(p).info['sizes'])
        assert got == [(s, s) for s in SIZES], got
        print(ico, got)
    preview([('iron', iron), ('grimm', grimm), ('kitchen', kitchen)], os.path.join(HERE, 'preview-v3.png'))
