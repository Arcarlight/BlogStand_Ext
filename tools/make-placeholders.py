"""生成两张占位图：场景底图 + 两个头像。

正式素材还没来，先用程序画的占位，保证页面不是一片黑。
换成真图时直接覆盖 assets/img/ 里的同名文件即可（尺寸不限，
场景按 cover 铺满、头像按 28x28 DS 像素裁切）。
"""
import os
import math
import random

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "img")


def dither(img, box, color, step=2, density=0.35):
    """在 box 里撒点，制造 DS 那种棋盘/网点过渡"""
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    rnd = random.Random(7)
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            if ((x // step + y // step) % 2 == 0) and rnd.random() < density:
                d.point((x, y), fill=color)


def beach(w=320, h=240):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    # 天 : 海 : 沙 = 0.0-0.30 : 0.30-0.55 : 0.55-1.0
    sky_h = int(h * 0.30)
    sea_h = int(h * 0.25)
    d.rectangle([0, 0, w, sky_h], fill=(96, 152, 232))
    d.rectangle([0, sky_h, w, sky_h + sea_h], fill=(64, 120, 208))
    d.rectangle([0, sky_h + sea_h, w, h], fill=(224, 192, 112))
    # 天到海、海到沙 的网点过渡
    dither(im, (0, sky_h - 10, w, sky_h + 4), (120, 176, 240), 2, .5)
    dither(im, (0, sky_h + sea_h - 6, w, sky_h + sea_h + 6), (240, 232, 176), 2, .45)
    # 浪花
    for i in range(0, w, 16):
        y = sky_h + sea_h - 4 + int(3 * math.sin(i / 22.0))
        d.line([i, y, i + 10, y], fill=(224, 240, 255))
    # 云
    for cx, cy, s in ((46, 34, 16), (210, 26, 12), (270, 52, 10)):
        d.ellipse([cx - s, cy - s // 2, cx + s, cy + s // 2], fill=(248, 252, 255))
    # 沙滩上的小石头
    for cx, cy, r in ((36, 196, 7), (90, 208, 5), (250, 190, 6)):
        d.ellipse([cx - r, cy - r // 2, cx + r, cy + r // 2], fill=(176, 140, 80))
    dither(im, (0, int(h * .78), w, h), (200, 168, 96), 3, .3)
    im.save(os.path.join(OUT, "scene-beach.png"))
    print("scene-beach.png", im.size)


def portrait(name, body, accent):
    """32x32 的占位头像：一个圆脑袋 + 两只眼睛"""
    s = 32
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, s - 1, s - 1], fill=accent)
    d.ellipse([6, 8, s - 7, s - 2], fill=body)          # 头
    d.polygon([(11, 10), (6, 15), (12, 15)], fill=body)  # 左耳
    d.polygon([(s - 12, 10), (s - 7, 15), (s - 13, 15)], fill=body)
    d.rectangle([11, 17, 13, 20], fill=(20, 20, 24))     # 眼
    d.rectangle([s - 14, 17, s - 12, 20], fill=(20, 20, 24))
    d.rectangle([15, 23, 17, 24], fill=(20, 20, 24))     # 嘴
    im.save(os.path.join(OUT, name))
    print(name, im.size)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    beach()
    portrait("portrait-shinx.png", (128, 200, 248), (248, 152, 200))
    portrait("portrait-hero.png", (248, 216, 120), (120, 200, 248))
