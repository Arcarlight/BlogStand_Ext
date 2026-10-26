"""检查用字是否都在 NDS12 字体的范围内。

NDS12 只有 **假名 + ASCII**（802 个字形，没有汉字）。写了汉字不会报错，
浏览器会静默掉到系统字体上 —— 一行字里混两种字体，很显眼。
这个脚本把项目里会显示的文本都扫一遍，列出字体里没有的字。

用法：python tools/check-chars.py
"""
import io
import json
import os
import re
import sys

from fontTools.ttLib import TTFont

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "assets", "fonts", "NDS12.ttf")
DATA = os.path.join(ROOT, "data", "chapters.json")
INDEX = os.path.join(ROOT, "index.html")


def collect_from_data():
    """剧情数据里所有会显示出来的字"""
    with io.open(DATA, encoding="utf-8") as f:
        d = json.load(f)
    out = []

    def walk(v, path):
        if isinstance(v, str):
            parts = [x for x in path.split("/") if x]
            if any(x.startswith("_") for x in parts) or "/bg/" in path or "/src/" in path:
                return
            out.append((path, v))
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, path + "/%d" % i)
        elif isinstance(v, dict):
            for k, x in v.items():
                walk(x, path + "/" + k)

    walk(d, "")
    return out


def collect_from_html():
    """按钮/提示这类写死在 HTML 里的字（粗略去标签）"""
    with io.open(INDEX, encoding="utf-8") as f:
        html = f.read()
    text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.S)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return [("index.html", text)]


def main():
    font = TTFont(FONT)
    cmap = font.getBestCmap()
    items = collect_from_data() + collect_from_html()

    missing = {}
    total = 0
    for path, text in items:
        for ch in text:
            if ch in "\n\r\t":
                continue
            total += 1
            if ord(ch) not in cmap:
                missing.setdefault(ch, path)

    print("扫描字符 %d 个，字体覆盖 %d 个字形" % (total, len(cmap)))
    if not missing:
        print("全部在字体里 OK")
        return 0

    print("字体里没有这些字（会掉到系统字体，字形不一致）：")
    for ch, path in sorted(missing.items()):
        print("   %r U+%04X  首次出现：%s" % (ch, ord(ch), path))
    return 1


if __name__ == "__main__":
    sys.exit(main())
