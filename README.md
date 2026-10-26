# BlogStand_Ext —— 虹星的不可思议小说

一个**独立**的视觉小说阅读器，和主站（Hugo 博客）完全分开：
删掉这个仓库，博客照常运行。

界面模仿《宝可梦 不可思议的迷宫》的对话框：点一下往下走、逐字显示、
打完后出现 ▼、可以回上一句、可以存档。

## 目录

```
index.html            阅读页（GitHub Pages 的根）
css/story.css         全部样式（尺寸单位是「DS 像素」，--u 随窗口流式缩放）
js/story.js           阅读器：逐字、翻页、存档、日英切换
data/chapters.json    剧情数据（章节 / 段落 / 页 / 行）
assets/ui/            窗口素材（Frame.png 原件 + 切好的九宫格）
assets/fonts/         NDS12 字体（ttf 原件 + 网页用的 woff2）
assets/img/           场景背景；portrait/ 是宝可梦头像（从 PMD 素材库拉的）
tools/                开发工具：作者工具、素材生成、检查脚本、冒烟测试
```

## 本地看效果

```bash
node tools/serve.mjs 27700
#  阅读器：http://127.0.0.1:27700/
#  作者工具：http://127.0.0.1:27700/tools/editor.html
```

## 作者工具

左边是章节 / 段落列表，中间是这一段的内容（说话人、头像、背景、日/英台词），
右边是**真正的阅读器**在跑预览，点哪一段就预览哪一段。

- **台词**：一个文本框 = 一页。一页打完出现 ▼，按键继续下一页；换行 = 框里换行。
- **头像**：点「选宝可梦…」，搜日文假名 / 英文 / 编号，选表情，
  素材会**自动下载**到 `assets/img/portrait/`。
- **缺字提示**：NDS12 只有假名 + 英文。输入汉字（或全角空格）会立刻标红并列出缺的字。
- 改动自动存盘（防抖 1.2 秒，Ctrl+S 立即存），旧版备份在 `tools/backup/`。

## 数据格式

`data/chapters.json`：

```jsonc
{
  "chapters": [{
    "id": "ch01",
    "title": { "jp": "いっしょう すなのうえの あしあと", "en": "1 — Footprints" },
    "blocks": [{
      "bg": "assets/img/scene-beach.png",
      "speaker": { "name": { "jp": "コリンク", "en": "Shinx" }, "color": "#ffe14d" },
      "portrait": { "src": "assets/img/portrait/0403-normal.png", "side": "left" },
      "text": { "jp": [["わっ!"], ["こんなところで なにしてるの?"]], "en": [[...]] }
    }]
  }]
}
```

`text.jp` / `text.en` 是**页数组**，一页是**行数组**；`speaker.name` 留空 = 旁白；
`portrait.side` 可以是 `left` / `right`。

## 工具脚本

| 脚本 | 干什么 | 什么时候跑 |
|---|---|---|
| `node tools/serve.mjs` | 本地服务器（阅读器 + 作者工具 + 图鉴接口） | 每次开发 |
| `node tools/test-reader.js` | 阅读器冒烟测试（CDP）+ 截图 | 改完阅读器 |
| `node tools/test-editor.js` | 作者工具冒烟测试（会临时改 chapters.json，跑完还原） | 改完编辑器 |
| `python tools/check-chars.py` | 扫全部用字，和字体 cmap 比对，列出缺字 | 改文案 / 换字体后 |
| `python tools/make-ui.py` | 从 `Frame.png` 切九宫格（对话框 + 头像框） | 素材更新时 |
| `python tools/make-font.py` | NDS12 → woff2（`--subset` 可按剧情用字裁剪） | 换字体时 |
| `python tools/build-font-chars.py` | 导出字体支持的码位（编辑器缺字提示用） | 换字体时 |

`tools/data/dex.json` 是全国图鉴表（编号 + 日文假名 + 英文），
由 PokéAPI 的 `pokemon_species_names.csv` 生成，1025 只。

## 素材来源

- 对话框 / 头像框九宫格：`assets/ui/Frame.png`（DS 原始 UI 精灵图，144×8，
  18 格 8×8），映射见 `tools/make-ui.py` 顶部注释，**不重画**
- 字体 `NDS12.ttf`：© 2016 Caveras / Cliff Modes，**CC BY-NC-SA 3.0**
  （署名 + 非商业 + 相同方式共享）。`nds12.woff2` 是它的转换版，同样受此约束，
  署名见 `assets/fonts/LICENSE-NDS12.txt`
- 宝可梦头像：<https://sprites.pmdcollab.org/>（PMD Sprite Collab），
  取用时遵守其授权；图鉴名字来自 PokéAPI
