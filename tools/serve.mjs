/* 本地作者工具服务器。
   静态文件 + 几个小接口，没有第三方依赖。

   它只在本机跑（127.0.0.1），**不发布**：站点（index.html / css / js / data）
   是纯静态的，编辑部写进 data/chapters.json 和 assets/img/ 就行。

   接口：
     GET  /api/story           读 data/chapters.json
     POST /api/story           存（先备份到 tools/backup/）
     GET  /api/dex             全国图鉴（编号 + 日文假名 + 英文）
     GET  /api/font            NDS12 支持的码位（编辑器用来标「缺字」）
     GET  /api/portraits?dex=   这个编号在 PMD 素材库里有哪几种表情
     GET  /api/portrait?dex=&emotion=   下载（没有才下）并返回站内路径
     GET  /api/images          列出 assets/img 下的图片（选背景用）
     GET  /preview             预览页（把当前 data 内联进去，用真正的阅读器渲染）

   用法：node tools/serve.mjs [端口]   默认 27700
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 27700);
const STORY = path.join(ROOT, 'data', 'chapters.json');
const BACKUP_DIR = path.join(ROOT, 'tools', 'backup');
const PORTRAIT_DIR = path.join(ROOT, 'assets', 'img', 'portrait');
const CACHE = path.join(ROOT, 'tools', 'data', 'portrait-cache.json');
const DEX = path.join(ROOT, 'tools', 'data', 'dex.json');
const FONT_CHARS = path.join(ROOT, 'tools', 'data', 'font-chars.json');

const EMOTIONS = [
  'Normal', 'Happy', 'Joyous', 'Inspired', 'Determined', 'Angry', 'Sad', 'Worried',
  'Surprised', 'Stunned', 'Dizzy', 'Pain', 'Sigh', 'Shouting', 'Crying', 'Teary-Eyed',
];
const RAW = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

/* ---------------- 小工具 ---------------- */
const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};
const dex4 = (n) => String(n).padStart(4, '0');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 8 * 1024 * 1024) reject(new Error('太大')); });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

/* 下载走 curl：Node 的 fetch 不认 HTTP_PROXY，这台机器的 GitHub 要靠代理 */
function download(url, out) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFile('curl', ['-sSL', '--fail', '-m', '60', '-o', out, url], (err) => {
      if (err) { try { fs.unlinkSync(out); } catch {} resolve(false); }
      else resolve(true);
    });
  });
}

/* ---------------- 头像素材 ---------------- */
/* 查某个编号有哪些表情：先问 GitHub 的目录接口（一次请求），
   失败（限流 / 断网）再逐个探测。结果缓存到 tools/data/portrait-cache.json。 */
async function probeDex(dex) {
  const cache = readJson(CACHE, {}) || {};
  const key = String(dex);
  if (Array.isArray(cache[key])) return cache[key];

  const dir = await curlText(`https://api.github.com/repos/PMDCollab/SpriteCollab/contents/portrait/${dex4(dex)}`);
  let avail = null;
  if (dir) {
    try {
      const list = JSON.parse(dir);
      if (Array.isArray(list)) {
        avail = list
          .filter((x) => x.type === 'file' && /\.png$/i.test(x.name))
          .map((x) => x.name.replace(/\.png$/i, ''))
          .filter((e) => EMOTIONS.includes(e));
      }
    } catch { /* 不是 JSON（限流了），走下面的逐个探测 */ }
  }
  if (!avail) {
    avail = [];
    for (const e of EMOTIONS) {
      const code = await new Promise((resolve) => {
        execFile('curl', ['-sSL', '--fail', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
          '-m', '20', '-w', '%{http_code}', `${RAW}/${dex4(dex)}/${e}.png`], (err, stdout) => {
          resolve(err ? 0 : Number(stdout) || 200);
        });
      });
      if (code === 200) avail.push(e);
    }
  }
  cache[key] = avail;
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  writeJson(CACHE, cache);
  return avail;
}

function curlText(url) {
  return new Promise((resolve) => {
    execFile('curl', ['-sSL', '--fail', '-m', '30', url], (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

async function ensurePortrait(dex, emotion) {
  const name = `${dex4(dex)}-${String(emotion).toLowerCase().replace(/[^a-z-]/g, '')}.png`;
  const out = path.join(PORTRAIT_DIR, name);
  const rel = `assets/img/portrait/${name}`;
  if (fs.existsSync(out) && fs.statSync(out).size > 100) return { ok: true, file: rel, cached: true };
  const ok = await download(`${RAW}/${dex4(dex)}/${emotion}.png`, out);
  if (!ok) return { ok: false, error: `${dex4(dex)}/${emotion} 没有素材` };
  return { ok: true, file: rel, cached: false };
}

/* ---------------- 预览页 ---------------- */
function previewHtml(story, start) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>预览</title>
<link rel="stylesheet" href="/css/story.css">
<style>html,body{background:#05070f}</style>
</head>
<body>
<main class="vn">
  <div class="vn-screen">
    <div class="vn-scene" id="scene"></div>
    <h2 class="vn-chapter" id="chapterTitle"></h2>
    <div class="vn-box" id="box" role="button" tabindex="0" aria-label="continue">
      <div class="vn-portrait" id="portrait"></div>
      <p class="vn-text" id="text"></p>
      <div class="vn-arrow" id="arrow" hidden></div>
    </div>
  </div>
  <div class="vn-bar">
    <button class="vn-btn" id="prev" type="button">prev</button>
    <button class="vn-btn" id="next" type="button">next</button>
    <button class="vn-btn" id="save" type="button">save</button>
    <button class="vn-btn" id="load" type="button">load</button>
    <button class="vn-btn" id="restart" type="button">restart</button>
    <span class="grow"></span>
    <button class="vn-btn" id="lang" type="button">JP</button>
    <span class="vn-progress" id="pos"></span>
  </div>
  <p class="vn-hint" id="hint"></p>
</main>
<div class="vn-toast" id="toast"></div>
<script>window.__STORY__ = ${JSON.stringify(story)};
window.__START__ = ${JSON.stringify(start || null)};</script>
<script src="/js/story.js"></script>
</body>
</html>`;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const p = decodeURIComponent(u.pathname);

  try {
    if (p === '/api/story' && req.method === 'GET') {
      const text = fs.readFileSync(STORY, 'utf8');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
      return;
    }

    if (p === '/api/story' && req.method === 'POST') {
      const raw = await readBody(req);
      let obj;
      try { obj = JSON.parse(raw); } catch { return json(res, 400, { error: '不是合法 JSON' }); }
      if (!obj || !Array.isArray(obj.chapters)) return json(res, 400, { error: '缺少 chapters 数组' });
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(STORY, path.join(BACKUP_DIR, `chapters-${stamp}.json`));
      writeJson(STORY, obj);
      return json(res, 200, { ok: true, chapters: obj.chapters.length, backup: stamp });
    }

    if (p === '/api/dex') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(fs.readFileSync(DEX, 'utf8'));
      return;
    }

    if (p === '/api/font') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(fs.readFileSync(FONT_CHARS, 'utf8'));
      return;
    }

    if (p === '/api/portraits') {
      const dex = Number(u.searchParams.get('dex'));
      if (!dex) return json(res, 400, { error: 'dex?' });
      return json(res, 200, { dex, emotions: await probeDex(dex) });
    }

    if (p === '/api/portrait') {
      const dex = Number(u.searchParams.get('dex'));
      const emotion = u.searchParams.get('emotion') || 'Normal';
      if (!dex) return json(res, 400, { error: 'dex?' });
      const r = await ensurePortrait(dex, emotion);
      return json(res, r.ok ? 200 : 404, r);
    }

    if (p === '/api/images') {
      const out = [];
      const walk = (dir, base) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full, base + e.name + '/');
          else if (/\.(png|jpe?g|webp)$/i.test(e.name)) out.push(base + e.name);
        }
      };
      walk(path.join(ROOT, 'assets', 'img'), 'assets/img/');
      return json(res, 200, { images: out.sort() });
    }

    if (p === '/preview') {
      const story = readJson(STORY, null);
      if (!story) return json(res, 500, { error: 'data/chapters.json 读不出来' });
      const start = {
        ch: Number(u.searchParams.get('ch') || 0),
        blk: Number(u.searchParams.get('blk') || 0),
      };
      const html = previewHtml(story, start);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }

    /* / 留给站点本身（阅读器）；作者工具在 /editor.html */
    if (p === '/editor') {
      res.writeHead(302, { location: '/tools/editor.html' });
      res.end();
      return;
    }

    /* 静态文件（目录补 index.html） */
    let file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 ' + p);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': fs.statSync(file).size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch (e2) {} return; }
    json(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('阅读器  : http://127.0.0.1:' + PORT + '/');
  console.log('作者工具: http://127.0.0.1:' + PORT + '/tools/editor.html');
  console.log('预览页  : http://127.0.0.1:' + PORT + '/preview');
});
