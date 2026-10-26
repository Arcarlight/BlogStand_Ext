"""从 DS 原始精灵图里切出九宫格。

Frame.png：144x8 的横向精灵图，**18 格 8x8**，顺序是（站长亲自试出来的）：

   0  白底        1  黑底
   2  左上        3  上        4  右上
   5  左          6  右
   7  左下        8  下        9  右下
   -----------------------------------
  10  头图框左上  11 头图框上   12 头图框右上
  13  头图框左    14 头图框右
  15  头图框左下  16 头图框下   17 头图框右下

所以「对话框边框」= 2..9 + 黑底 1；「头像框」= 10..17（中间透出图片）。
这里**一个像素都不重画**，只是按上面的顺序把这 8 格摆成 3x3。

输出：
  assets/ui/box9@2x.png / @3x.png        对话框边框（含黑底）
  assets/ui/portrait9@2x.png / @3x.png   头像边框（中心透明）
  tools/out/frame-preview.png            拉伸预览

用法：python tools/make-ui.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "assets", "ui")
OUT = os.path.join(ROOT, "tools", "out")

TILE = 8
TEAL = (0, 120, 144, 255)          # 素材的透明键色（DS 精灵图常见）

# 3x3 里每一格用精灵图的第几格
BOX = [
    [2, 3, 4],
    [5, 1, 6],
    [7, 8, 9],
]
PORTRAIT = [
    [10, 11, 12],
    [13, None, 14],     # 中心留空，头像图片从这里透出来
    [15, 16, 17],
]


def load_strip():
    im = Image.open(os.path.join(UI, "Frame.png")).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y] == TEAL:
                px[x, y] = (0, 0, 0, 0)
    return im


def tile(strip, idx):
    x0 = idx * TILE
    return strip.crop((x0, 0, x0 + TILE, TILE))


def compose(strip, grid):
    out = Image.new("RGBA", (TILE * 3, TILE * 3), (0, 0, 0, 0))
    for row, idxs in enumerate(grid):
        for col, idx in enumerate(idxs):
            if idx is None:
                continue
            out.paste(tile(strip, idx), (col * TILE, row * TILE))
    return out


def stretch_preview(sheet, path, w=400, h=200, k=3):
    """模拟 border-image：角固定、边拉伸、中间填满"""
    t = sheet.resize((sheet.width * k, sheet.height * k), Image.NEAREST)
    unit = TILE * k
    prev = Image.new("RGBA", (w, h), (20, 26, 44, 255))
    prev.paste(t.crop((0, 0, unit, unit)), (0, 0))
    prev.paste(t.crop((unit * 2, 0, unit * 3, unit)), (w - unit, 0))
    prev.paste(t.crop((0, unit * 2, unit, unit * 3)), (0, h - unit))
    prev.paste(t.crop((unit * 2, unit * 2, unit * 3, unit * 3)), (w - unit, h - unit))
    top = t.crop((unit, 0, unit + 1, unit)).resize((w - unit * 2, unit))
    bot = t.crop((unit, unit * 2, unit + 1, unit * 3)).resize((w - unit * 2, unit))
    left = t.crop((0, unit, unit, unit + 1)).resize((unit, h - unit * 2))
    right = t.crop((unit * 2, unit, unit * 3, unit + 1)).resize((unit, h - unit * 2))
    prev.paste(top, (unit, 0))
    prev.paste(bot, (unit, h - unit))
    prev.paste(left, (0, unit))
    prev.paste(right, (w - unit, unit))
    prev.save(path)
    print("写出", os.path.relpath(path, ROOT), prev.size)


def main():
    os.makedirs(OUT, exist_ok=True)
    strip = load_strip()

    box = compose(strip, BOX)
    port = compose(strip, PORTRAIT)
    box.save(os.path.join(OUT, "box9-1x.png"))
    port.save(os.path.join(OUT, "portrait9-1x.png"))

    for k in (2, 3):
        for name, sheet in (("box9", box), ("portrait9", port)):
            big = sheet.resize((sheet.width * k, sheet.height * k), Image.NEAREST)
            p = os.path.join(UI, "%s@%dx.png" % (name, k))
            big.save(p)
            print("写出", os.path.relpath(p, ROOT), big.size)

    stretch_preview(box, os.path.join(OUT, "frame-preview.png"))


if __name__ == "__main__":
    main()
