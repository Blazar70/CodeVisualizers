# Claude Grimm icon: a fedora and cigar in silhouette on lit frosted glass. Writes claude-grimm.ico next to this file.
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
AMBER_TOP, AMBER_LOW = (236, 196, 124), (150, 92, 36)
INK = (16, 12, 9, 255)
BAND = (193, 83, 47, 255)
EMBER = (255, 120, 30, 255)


def ground():
    tile = Image.new('RGBA', (S, S))
    px = tile.load()
    for y in range(S):
        for x in range(S):
            d = min(1, math.hypot(x - S * .5, y - S * .4) / (S * .72))
            px[x, y] = tuple(int(a + (b - a) * d) for a, b in zip(AMBER_TOP, AMBER_LOW)) + (255,)
    return tile


def hat(d, band=True):
    # crown, with the pinch at the top
    d.polygon([(300, 470), (332, 230), (420, 190), (512, 236), (610, 190), (690, 230), (724, 470)], fill=INK)
    if band:
        d.polygon([(298, 412), (726, 412), (736, 480), (288, 480)], fill=BAND)
    # brim, dipping toward the front
    d.ellipse((120, 438, 904, 570), fill=INK)


def full():
    im = ground()
    d = ImageDraw.Draw(im)
    # smoke, drawn soft on its own layer
    smoke = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(smoke)
    pts = [(838 + math.sin(t * .021) * 46 + t * .12, 640 - t) for t in range(0, 540, 6)]
    sd.line(pts, fill=(250, 244, 230, 190), width=30, joint='curve')
    im.alpha_composite(smoke.filter(ImageFilter.GaussianBlur(11)))
    hat(d)
    # face under the brim, a jaw and a collar only
    d.polygon([(358, 560), (666, 560), (644, 760), (560, 846), (462, 846), (380, 760)], fill=INK)
    d.polygon([(250, 1024), (340, 816), (462, 846), (560, 846), (684, 816), (774, 1024)], fill=INK)
    d.polygon([(512, 1024), (462, 860), (562, 860)], fill=BAND)
    # cigar and ember
    d.line([(590, 758), (820, 688)], fill=(92, 58, 32, 255), width=42)
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((766, 626, 890, 750), fill=(255, 150, 40, 235))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(26)))
    ImageDraw.Draw(im).ellipse((798, 662, 846, 710), fill=(255, 226, 150, 255))
    return im


def small():
    # at taskbar size only the hat and the ember survive
    im = ground()
    d = ImageDraw.Draw(im)
    d.polygon([(250, 560), (290, 170), (512, 240), (734, 170), (774, 560)], fill=INK)
    d.polygon([(248, 450), (776, 450), (786, 570), (238, 570)], fill=BAND)
    d.ellipse((30, 520, 994, 720), fill=INK)
    d.ellipse((690, 760, 930, 1000), fill=EMBER)
    d.rectangle((130, 840, 700, 920), fill=(46, 28, 16, 255))
    return im


def rounded(im):
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=170, fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


big, tiny = rounded(full()), rounded(small())
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [(tiny if s <= 32 else big).resize((s, s), Image.LANCZOS) for s in sizes]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'claude-grimm.ico')
frames[-1].save(out, format='ICO', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
assert Image.open(out).size == (256, 256)
print('wrote', out)
