"""把 NDS12.ttf 转成网页用的 woff2。

先用 --subset 决定要不要裁剪：目前留全量（802 字形，假名 + ASCII + 符号，
本来就没有汉字），等正文写出来再按实际用字裁剪。

用法：
  python tools/make-font.py            # 全量 -> assets/fonts/nds12.woff2
  python tools/make-font.py --subset   # 按 data/chapters.json 里出现的字裁剪
"""
import os
import sys
import json

from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "fonts", "NDS12.ttf")
OUT = os.path.join(ROOT, "assets", "fonts", "nds12.woff2")
DATA = os.path.join(ROOT, "data", "chapters.json")


def charset_from_data():
    with open(DATA, encoding="utf-8") as f:
        raw = f.read()
    return set(raw)


def main():
    font = TTFont(SRC)
    if "--subset" in sys.argv and os.path.exists(DATA):
        # 只保留数据里真正用到的字 + 常用 ASCII
        chars = charset_from_data() | set(map(chr, range(0x20, 0x7F)))
        cmap = font.getBestCmap()
        keep = sorted(c for c in chars if ord(c) in cmap)
        print("裁剪：保留 %d 个字符（原 %d）" % (len(keep), len(cmap)))
        from fontTools import subset as ftsub
        opts = ftsub.Options()
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        sub = ftsub.Subsetter(options=opts)
        sub.populate(text="".join(keep))
        sub.subset(font)

    font.flavor = "woff2"
    font.save(OUT)
    size = os.path.getsize(OUT)
    print("写出 %s（%.1f KB）" % (os.path.relpath(OUT, ROOT), size / 1024))


if __name__ == "__main__":
    main()
