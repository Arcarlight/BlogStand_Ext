/* 阅读器冒烟测试（无第三方依赖，用 Chrome 的 CDP）。
   1) 页面能加载、无控制台报错
   2) 打字机确实在逐字出现
   3) 点对话框能翻到下一句
   4) ← 「前へ」能回上一句
   5) 存档 / 读档
   6) 截图（宽屏 + 窄屏）落到 tools/out/

   用法：
     node tools/serve.mjs 27700      # 另开一个窗口
     node tools/test-reader.js
*/
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:27700/';
const PORT = 27644;
const OUT = path.join(__dirname, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJSON = (p) =>
  new Promise((res, rej) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          try { res(JSON.parse(d)); } catch (e) { rej(e); }
        });
      })
      .on('error', rej);
  });

const fails = [];
const ok = (c, m) => {
  console.log((c ? '  OK   ' : '  FAIL ') + m);
  if (!c) fails.push(m);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-story-' + Date.now()),
      '--no-first-run',
      '--mute-audio',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

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
  const send = (m, p) =>
    new Promise((res) => {
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

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await sleep(1500);

  console.log('== 加载 ==');
  const st = await ev(`JSON.stringify({
    text: (document.getElementById('text')||{}).innerText || '',
    chapter: (document.getElementById('chapterTitle')||{}).textContent || '',
    pos: (document.getElementById('pos')||{}).textContent || '',
    font: getComputedStyle(document.getElementById('text')).fontFamily,
    size: getComputedStyle(document.getElementById('text')).fontSize,
    portrait: (document.getElementById('portrait')||{}).className
  })`);
  const s0 = JSON.parse(st);
  console.log('  ' + st);
  ok(s0.chapter.length > 0, '章节标题渲染出来了：' + s0.chapter);
  ok(/NDS12/.test(s0.font), '用的是 NDS12 字体');
  ok(s0.pos.length > 0, '进度条有内容：' + s0.pos);

  console.log('\n== 打字机 ==');
  /* 刚进页面时已经打完了，所以点一下翻页，然后在打字过程中数「已经显示的字」 */
  await ev(`document.getElementById('box').click()`);
  const shown = [];
  for (let i = 0; i < 8; i++) {
    shown.push(await ev(`document.querySelectorAll('#text .ch.on').length`));
    await sleep(90);
  }
  console.log('  已显示字数：' + shown.join(' → '));
  ok(new Set(shown).size > 1 && shown[shown.length - 1] > shown[0], '文字是逐字出现的（.ch.on 在增加）');

  await sleep(1500);
  const d1 = JSON.parse(await ev(`JSON.stringify({
    text: (document.getElementById('text')||{}).innerText || '',
    arrow: !!document.querySelector('.vn-arrow-inline'),
    portrait: (document.getElementById('portrait')||{}).className
  })`));
  console.log('  第 2 句（コリンク，右头像）：' + JSON.stringify(d1.text));
  ok(d1.arrow, '打完后出现行内 ▼ 箭头');
  ok(/コリンク/.test(d1.text), '带上了说话人名字（黄色）');
  ok(d1.portrait.includes('side-right'), '头像在右边');

  console.log('\n== 段内分页（一句话中间停下来等按键）==');
  await ev(`document.getElementById('box').click()`);
  await sleep(1500);
  const d2 = JSON.parse(await ev(`JSON.stringify({
    text: (document.getElementById('text')||{}).innerText || ''
  })`));
  console.log('  第二页：' + JSON.stringify(d2.text));
  ok(d2.text.length > d1.text.length, '第二页往下追加了，没清屏');
  ok(d2.text.startsWith(d1.text), '第一页的原样保留在前面');
  ok(d2.text.endsWith('」'), '整段最后一句补上了收尾的」');
  ok(!/コリンク「[^]*コリンク/.test(d2.text), '段内分页没有重复一遍名字');

  console.log('\n== 进入下一段 ==');
  await ev(`document.getElementById('box').click()`);
  await sleep(1500);
  const d3 = (await ev(`(document.getElementById('text')||{}).innerText || ''`)) || '';
  console.log('  第三段：' + JSON.stringify(d3));
  ok(d3 !== d2.text, '翻到了下一段');
  ok(d3.indexOf(d1.text) < 0, '上一段的内容没留在框里（清屏了）');

  console.log('\n== 上一句 ==');
  await ev(`document.getElementById('prev').click()`);
  await sleep(1500);
  const backText = (await ev(`(document.getElementById('text')||{}).innerText || ''`)) || '';
  ok(backText.length > 0 && backText !== d3, '「前へ」回到了上一句：' + JSON.stringify(backText.slice(0, 20)));

  console.log('\n== 存档 / 读档 ==');
  await ev(`document.getElementById('save').click()`);
  await sleep(300);
  const saved = await ev(`localStorage.getItem('zz.save')`);
  ok(!!saved, '写出 localStorage 存档：' + saved);
  await send('Page.reload');
  await sleep(2000);
  const reloaded = (await ev(`(document.getElementById('text')||{}).innerText || ''`)) || '';
  ok(reloaded.length > 0, '刷新后还能读回内容：' + JSON.stringify(reloaded.slice(0, 20)));

  console.log('\n== 截图 ==');
  await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
    fs.writeFileSync(path.join(OUT, 'reader-1440.png'), Buffer.from(r.data, 'base64'))
  );
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
    fs.writeFileSync(path.join(OUT, 'reader-390.png'), Buffer.from(r.data, 'base64'))
  );
  console.log('  tools/out/reader-1440.png / reader-390.png');

  const real = errors.filter((e) => !/favicon|net::ERR/i.test(String(e)));
  ok(real.length === 0, '无控制台报错' + (real.length ? '：\n     ' + real.slice(0, 5).join('\n     ') : ''));

  console.log('\n' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  child.kill();
  process.exit(fails.length ? 1 : 0);
})();
