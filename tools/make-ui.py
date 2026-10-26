"""对话框的边框（9 宫格 PNG）。

素材那份 Frame.png 只是一条 144x8 的切片带：里面有「纯黑内心」「左/右边」
和两个「斜切角」的上半截，但**没有完整的一圈边框**（角要 24x24，那条只有 8 高）。
所以这里不拼贴图，而是按它的**配色和角形**重新画：

  · 边框厚 8 DS 像素
  · 角是 45° 斜切（不是圆角！），切掉 16 DS 像素
  · 7 圈颜色，全部取自 Frame.png 的调色板（外白 → 蓝 → 深蓝）
  · 内心 (32,32,32)

画出 9 宫格后按 2x / 3x 最近邻放大，网页里用 border-image 贴。

用法：python tools/make-ui.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "assets", "ui")
OUT = os.path.join(ROOT, "tools", "out")

# Frame.png 里按亮度排下来的 7 圈颜色（外 -> 内）
RINGS = [
    (224, 248, 248),
    (192, 232, 248),
    (160, 208, 248),
    (120, 176, 248),
    (80, 104, 248),
    (48, 48, 248),
    (40, 40, 192),
]
INNER = (32, 32, 32)
BORDER = len(RINGS)          # 8
CHAMFER = 16                 # 45° 斜切 16 像素

SIDE = CHAMFER            # 角块就是斜切本身，16x16


def depth(x, y, w, h):
    """这个点离外轮廓有多少像素深（用来决定填第几圈颜色）。

    直角边直接取到四条边的最小距离；四个角换成到斜切线的距离
    —— 斜切 45°，走两格才深一格，所以除以 2。"""
    d = min(x, y, w - 1 - x, h - 1 - y)
    # 四个角的斜切线：x+y=C / w-1-x+y=C / x+h-1-y=C / w-1-x+h-1-y=C
    for cx, cy, flip in ((0, 0, 1), (w - 1, 0, -1), (0, h - 1, -1), (w - 1, h - 1, 1)):
        pass
    tl = (x + y - CHAMFER) // 2
    tr = ((w - 1 - x) + y - CHAMFER) // 2
    bl = (x + (h - 1 - y) - CHAMFER) // 2
    br = ((w - 1 - x) + (h - 1 - y) - CHAMFER) // 2
    d = min(d, max(tl, tr, bl, br))
    return d


def draw_frame(w, h):
    im = Image.new("RGB", (w, h), INNER)
    px = im.load()
    for y in range(h):
        for x in range(w):
            d = depth(x, y, w, h)
            if d < len(RINGS):
                px[x, y] = RINGS[d]
            else:
                px[x, y] = INNER
    return im


def nine_slice():
    """画一张大图，切出「24 像素的角 + 1 像素的边」的 9 宫格。

    为什么边只留 1 像素：边框本体只有 8 像素，而斜切角要占 24x24，
    两者对不上同一个 slice 值；用 slice=24 的话，边那一格会带进 16 像素的
    纯黑（正好是内心的颜色，接上去无缝），拉伸出去看不出来。"""
    w = h = SIDE * 4
    full = draw_frame(w, h)
    mid = SIDE           # 中间那一列/行的取样位置
    out = Image.new("RGB", (SIDE * 2 + 1, SIDE * 2 + 1), INNER)
    o = out.load()
    f = full.load()
    for y in range(SIDE):
        for x in range(SIDE):
            o[x, y] = f[x, y]                                   # 左上
            o[SIDE + 1 + x, y] = f[w - SIDE + x, y]             # 右上
            o[x, SIDE + 1 + y] = f[x, h - SIDE + y]             # 左下
            o[SIDE + 1 + x, SIDE + 1 + y] = f[w - SIDE + x, h - SIDE + y]  # 右下
    for y in range(SIDE):
        o[SIDE, y] = f[mid, y]                                  # 上边（1 像素宽）
        o[SIDE, SIDE + 1 + y] = f[mid, h - SIDE + y]            # 下边
    for x in range(SIDE):
        o[x, SIDE] = f[x, mid]                                  # 左边
        o[SIDE + 1 + x, SIDE] = f[w - SIDE + x, mid]            # 右边
    o[SIDE, SIDE] = INNER
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    base = nine_slice()
    base.save(os.path.join(OUT, "frame9-1x.png"))
    for k in (2, 3):
        big = base.resize((base.width * k, base.height * k), Image.NEAREST)
        p = os.path.join(UI, "frame9@%dx.png" % k)
        big.save(p)
        print("写出", os.path.relpath(p, ROOT), big.size)

    # 拉伸预览：看角和边接起来顺不顺
    w, h = 400, 200
    k = 3
    t = base.resize((SIDE * 3 * k, SIDE * 3 * k), Image.NEAREST)
    unit = SIDE * k
    prev = Image.new("RGB", (w, h), INNER)
    # 四角
    prev.paste(t.crop((0, 0, unit, unit)), (0, 0))
    prev.paste(t.crop((unit * 2, 0, unit * 3, unit)), (w - unit, 0))
    prev.paste(t.crop((0, unit * 2, unit, unit * 3)), (0, h - unit))
    prev.paste(t.crop((unit * 2, unit * 2, unit * 3, unit * 3)), (w - unit, h - unit))
    # 边：取边缘 1 像素拉长（和 border-image 的 stretch 一样）
    top = t.crop((unit, 0, unit + k, k)).resize((w - unit * 2, k))
    bot = t.crop((unit, unit * 3 - k, unit + k, unit * 3)).resize((w - unit * 2, k))
    left = t.crop((0, unit, k, unit + k)).resize((k, h - unit * 2))
    right = t.crop((unit * 3 - k, unit, unit * 3, unit + k)).resize((k, h - unit * 2))
    prev.paste(top, (unit, 0))
    prev.paste(bot, (unit, h - k))
    prev.paste(left, (0, unit))
    prev.paste(right, (w - k, unit))
    p = os.path.join(OUT, "frame-preview.png")
    prev.save(p)
    print("写出", os.path.relpath(p, ROOT), prev.size)


if __name__ == "__main__":
    main()
