"""把 NDS12 的字符表导出来，给编辑器做「缺字高亮」用。

字体里只有假名 + ASCII（799 个字形）。编辑器要在打字时标出「这个字字体没有」，
所以先把 cmap 导成 JSON（code point 数组），前端直接查。

用法：python tools/build-font-chars.py
"""
import io
import json
import os

from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "assets", "fonts", "NDS12.ttf")
OUT = os.path.join(ROOT, "tools", "data", "font-chars.json")


def main():
    font = TTFont(FONT)
    cps = sorted(font.getBestCmap().keys())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(cps, f, separators=(",", ":"))
    print("写出 %s：%d 个码位" % (os.path.relpath(OUT, ROOT), len(cps)))
    print("范围：U+%04X .. U+%04X" % (cps[0], cps[-1]))


if __name__ == "__main__":
    main()
