/* 作者工具冒烟测试（CDP）：
   1) 编辑器能载入、章节/段落列表出来
   2) 加一段、写台词、存盘 → data/chapters.json 里真的有
   3) 图鉴搜「コリンク」→ 选表情 → 头像自动下载到 assets/img/portrait/
   4) 输入汉字会立刻标出「字体里没有」
   5) 预览页能渲染出刚写的台词

   跑之前先起服务器： node tools/serve.mjs 27700
   跑完会把 data/chapters.json 还原成跑之前的样子。

   用法：node tools/test-editor.js
*/
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:27700/tools/editor.html';
const PORT = 27666;
const REPO = path.join(__dirname, '..');
const STORY = path.join(REPO, 'data', 'chapters.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJSON = (p) =>
  new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });

const fails = [];
const ok = (c, m) => {
  console.log((c ? '  OK   ' : '  FAIL ') + m);
  if (!c) fails.push(m);
};

(async () => {
  const original = fs.readFileSync(STORY, 'utf8');
  const before = JSON.parse(original);
  const nBlocks = before.chapters[0].blocks.length;

  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-ed-' + Date.now()),
    '--no-first-run', '--mute-audio', '--window-size=1500,950', 'about:blank',
  ], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { t = await getJSON('/json/list'); break; } catch (e) {}
  }
  if (!t) { console.log('chrome 起不来'); process.exit(1); }
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const errors = [];
  const send = (m, p) => new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o.result); pend.delete(o.id); return; }
    if (o.method === 'Runtime.exceptionThrown') {
      errors.push((o.params.exceptionDetails.exception || {}).description || o.params.exceptionDetails.text);
    }
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
      errors.push(o.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };

  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: BASE });
    await sleep(2500);

    console.log('== 载入 ==');
    const st = JSON.parse(await ev(`JSON.stringify({
      chapters: document.querySelectorAll('#chapterList li').length,
      blocks: document.querySelectorAll('#blockList li').length,
      status: (document.getElementById('status')||{}).textContent
    })`));
    console.log('  ' + JSON.stringify(st));
    ok(st.chapters >= 1, '章节列表出来了（' + st.chapters + '）');
    ok(st.blocks === nBlocks, '段落列表和 data 一致（' + st.blocks + '/' + nBlocks + '）');

    console.log('\n== 加一段 + 写台词 ==');
    await ev(`document.getElementById('btnAddBlock').click()`);
    await sleep(500);
    await ev(`(function(){
      var ta = document.querySelector('textarea[data-lang=jp]');
      ta.value = 'あたらしい せりふ。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);

    console.log('\n== 汉字高亮 ==');
    await ev(`(function(){
      var ta = document.querySelector('textarea[data-lang=jp]');
      ta.value = '漢字テスト';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);
    const warn = await ev(`(document.querySelector('.warn')||{}).textContent || ''`);
    console.log('  提示：' + JSON.stringify(warn));
    ok(/字体里没有/.test(warn) && /漢/.test(warn), '输入汉字立刻提示「字体里没有：漢 字」');

    await ev(`(function(){
      var ta = document.querySelector('textarea[data-lang=jp]');
      ta.value = 'あたらしい せりふ。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);

    console.log('\n== 图鉴拉头像 ==');
    await ev(`document.getElementById('btnDex').click()`);
    await sleep(500);
    await ev(`(function(){
      var s = document.getElementById('dexSearch');
      s.value = 'コリンク';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(500);
    const hits = await ev(`document.querySelectorAll('#dexList li').length`);
    ok(hits >= 1, '搜「コリンク」有结果（' + hits + '）');
    await ev(`document.querySelector('#dexList li').click()`);
    await sleep(2500);   // 查表情要走网络
    const emo = await ev(`Array.from(document.querySelectorAll('#dexEmotions [data-emotion]')).map(function(b){return b.dataset.emotion;}).join(',')`);
    console.log('  可用表情：' + emo);
    ok(/Normal/.test(String(emo)), '拿到表情列表');
    await ev(`document.querySelector('#dexEmotions [data-emotion=Normal]').click()`);
    await sleep(3000);   // 下载
    const modalHidden = await ev(`document.getElementById('dexModal').hidden`);
    ok(modalHidden === true, '选完表情自动关掉弹窗');
    const porSrc = await ev(`(document.getElementById('porImg')||{}).getAttribute('src') || ''`);
    console.log('  头像：' + porSrc);
    ok(/assets\/img\/portrait\/0403-normal\.png/.test(porSrc), '头像指向 0403-normal.png');
    ok(fs.existsSync(path.join(REPO, porSrc)), '文件真的下载到了本地');
    /* 编辑器页在 /tools/ 下，头像路径必须补前导斜杠，否则会裂图（踩过） */
    let imgWait = 0;
    while (imgWait < 6000) {
      const loadedImg = await ev(`(function(){ var im = document.getElementById('porImg'); return !!im && im.complete; })()`);
      if (loadedImg) break;
      await sleep(300);
      imgWait += 300;
    }
    const imgInfo = JSON.parse(await ev(`JSON.stringify((function(){
      var im = document.getElementById('porImg');
      return { src: im ? im.getAttribute('src') : '', w: im ? im.naturalWidth : 0 };
    })())`));
    console.log('  编辑器里的头像：' + JSON.stringify(imgInfo));
    ok(imgInfo.w > 0, '编辑器里头像真的渲染出来了（' + imgInfo.w + 'px 宽）');
    ok(String(imgInfo.src).charAt(0) === '/', '头像是从站点根开始的绝对路径');

    console.log('\n== 存盘 ==');
    await ev(`document.getElementById('btnSave').click()`);
    await sleep(2000);
    const after = JSON.parse(fs.readFileSync(STORY, 'utf8'));
    // 新段是插在「当前选中段」后面的（选中第 1 段 → 新段落在下标 1）
    const last = after.chapters[0].blocks[1];
    console.log('  最后一段：' + JSON.stringify({ jp: last.text.jp, portrait: last.portrait }));
    ok(after.chapters[0].blocks.length === nBlocks + 1, '段数 +1');
    ok(last.text.jp[0][0] === 'あたらしい せりふ。', '台词写进去了');
    ok(last.portrait && /0403-normal/.test(last.portrait.src), '头像路径写进去了');

    console.log('\n== 预览 ==');
    await ev(`document.getElementById('btnPreview').click()`);
    await sleep(2500);
    const frameText = await ev(`(function(){
      var f = document.getElementById('preview');
      try { return f.contentDocument.getElementById('text').innerText; } catch(e) { return 'ERR:' + e.message; }
    })()`);
    console.log('  预览里的字：' + JSON.stringify(String(frameText).slice(0, 40)));
    ok(String(frameText).length > 0 && !/^ERR/.test(String(frameText)), '预览页渲染出了内容');

    const real = errors.filter((e) => !/favicon|net::ERR/i.test(String(e)));
    ok(real.length === 0, '无 JS 异常' + (real.length ? '：' + real.slice(0, 3).join(' | ') : ''));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'out', 'editor.png'), Buffer.from(shot.data, 'base64'));
    console.log('  截图: tools/out/editor.png');
  } catch (e) {
    console.log('  测试抛异常：' + (e && e.stack || e));
    fails.push('测试异常');
  } finally {
    fs.writeFileSync(STORY, original);   // 还原
    console.log('  （data/chapters.json 已还原）');
    child.kill();
  }

  console.log('\n' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  process.exit(fails.length ? 1 : 0);
})();
