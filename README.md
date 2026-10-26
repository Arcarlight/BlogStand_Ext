# BlogStand_Ext —— 虹星的不可思议小说

一个**独立**的视觉小说阅读器，和主站（Hugo 博客）完全分开：
删掉这个仓库，博客照常运行。

界面模仿《宝可梦 不可思议的迷宫》的对话框：点一下往下走、逐字显示、
打完后出现 ▼、可以回上一句、可以存档。

## 目录

```
index.html            阅读页（GitHub Pages 的根）
css/story.css         全部样式（尺寸单位是「DS 像素」，--ds 决定放大倍数）
js/story.js           阅读器：逐字、翻页、存档、日英切换
data/chapters.json    剧情数据（章节 / 段落 / 页 / 行）
assets/ui/            窗口素材（Frame.png 原件 + 生成的九宫格）
assets/fonts/         NDS12 字体（ttf 原件 + 网页用的 woff2）
assets/img/           场景背景 / 头像（现在是占位图）
tools/                开发工具：本地服务器、素材生成、冒烟测试
```

## 本地看效果

```bash
node tools/serve.mjs 27700
# 打开 http://127.0.0.1:27700/
```

冒烟测试（需要本机有 Chrome，跑完会把截图丢到 `tools/out/`）：

```bash
node tools/test-reader.js
```

## 改剧情

只改 `data/chapters.json`，格式见文件开头的 `_note`：

- `chapters[].blocks[]` 是「一段话」
- 一段话里 `text.jp` / `text.en` 是**页数组**，一页是**行数组**
  —— 一页打完停住等按键，下一页接着往对话框里追加（超过 3 行清屏）
- `speaker.name` 是对话框开头的名字（`color` 决定颜色）
- `portrait.side` 可以 `left` / `right`
- `bg` 是场景图（相对路径）

## 素材来源

- 对话框九宫格：按 `assets/ui/Frame.png`（DS 原始 UI 切片）的配色与斜切角
  重画，`python tools/make-ui.py` 生成 `frame9@2x/@3x.png`
- 字体 `NDS12.ttf`：© 2016 Caveras / Cliff Modes，**CC BY-NC-SA 3.0**
  （署名 + 非商业 + 相同方式共享）。网页用的 `nds12.woff2` 是它的转换版，
  同样受这个许可约束；署名见 `assets/fonts/LICENSE-NDS12.txt`
- 宝可梦头像/场景：后续从 <https://sprites.pmdcollab.org/>
  （PMD Sprite Collab）取，取用时遵守其授权
