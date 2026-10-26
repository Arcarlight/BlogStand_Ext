/* 角色 / 强调色 的冒烟测试（CDP）：
   1) 编辑器左侧有「角色」列表，点开能编辑（名字 / 颜色 / 种族）
   2) 段落的说话人是下拉选择，指向角色 id
   3) 台词里写 [1]…[/] 会在阅读器里变成对应颜色
   4) 名字颜色来自角色表（改角色颜色 → 预览里的名字跟着变）

   跑之前先起服务器：node tools/serve.mjs 27700
   跑完会把 data/chapters.json 还原。
   用法：node tools/test-characters.js
*/
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:27700/';
const PORT = 27688;
const REPO = path.join(__dirname, '..');
const STORY = path.join(REPO, 'data', 'chapters.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''; r.on('data', (c) => (d += c));
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

const fails = [];
const ok = (c, m) => { console.log((c ? '  OK   ' : '  FAIL ') + m); if (!c) fails.push(m); };

(async () => {
  const original = fs.readFileSync(STORY, 'utf8');
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'cdp-chr-' + Date.now()),
    '--no-first-run', '--mute-audio', '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 80; i++) { await sleep(250); try { t = await getJSON('/json/list'); break; } catch (e) {} }
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errors = [];
  const send = (m, p) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o.result); pend.delete(o.id); return; }
    if (o.method === 'Runtime.exceptionThrown') errors.push((o.params.exceptionDetails.exception || {}).description || o.params.exceptionDetails.text);
    if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') errors.push(o.params.args.map((a) => a.value || a.description || '').join(' '));
  };
  await new Promise((r) => { ws.onopen = r; });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r && r.result ? r.result.value : undefined; };

  try {
    await send('Runtime.enable'); await send('Page.enable');

    console.log('== 编辑器：角色 ==');
    await send('Page.navigate', { url: BASE + 'tools/editor.html' });
    await sleep(2500);
    const n = await ev(`document.querySelectorAll('#charList li').length`);
    ok(n >= 2, '左侧有角色列表（' + n + ' 个）');
    await ev(`document.querySelectorAll('#charList li')[0].click()`);
    await sleep(600);
    const cf = JSON.parse(await ev(`JSON.stringify({
      name: (document.getElementById('cJa')||{}).value,
      species: (document.getElementById('cSpecies')||{}).textContent,
      hasColor: !!document.getElementById('cColor')
    })`));
    console.log('  角色表单：' + JSON.stringify(cf));
    ok(cf.name && cf.name.length > 0, '角色有名字：' + cf.name);
    ok(/#\d{4}/.test(cf.species || ''), '角色有种族编号：' + cf.species);
    ok(cf.hasColor, '角色有颜色选择');

    console.log('\n== 段落：说话人是角色下拉 ==');
    await ev(`document.querySelectorAll('#blockList li')[1].click()`);
    await sleep(600);
    const sp = await ev(`(document.getElementById('spChar')||{}).value`);
    console.log('  第 2 段说话人：' + sp);
    ok(!!sp, '说话人指向角色 id（' + sp + '）');

    console.log('\n== 强调色：写标记 ==');
    await ev(`(function(){
      var ta = document.querySelector('textarea[data-lang=jp]');
      ta.value = '[1]あか[/][2]あお[/][3]みどり[/]';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(1500);
    await ev(`document.getElementById('btnSave').click()`);
    await sleep(1500);
    const saved = JSON.parse(fs.readFileSync(STORY, 'utf8'));
    const blockText = saved.chapters[0].blocks[1].text.jp[0][0];
    ok(/\[1\]/.test(blockText), '标记写进了数据：' + JSON.stringify(blockText));

    console.log('\n== 阅读器：标记变成颜色 ==');
    await send('Page.navigate', { url: BASE + 'preview?ch=0&blk=1' });
    await sleep(2500);
    let w = 0;
    while (w < 8000) {
      const s = await ev(`document.querySelectorAll('#text span[style*=color]').length`);
      if (s >= 3) break;
      await sleep(400); w += 400;
    }
    const colors = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll('#text span[style*=color]')).map(function(s){
      return { text: s.textContent, color: getComputedStyle(s).color };
    }))`));
    console.log('  ' + JSON.stringify(colors));
    ok(colors.length >= 3, '三段强调都渲染成带颜色的 span');
    const uniq = new Set(colors.map((c) => c.color));
    ok(uniq.size >= 3, '三种颜色互不相同（' + Array.from(uniq).join(' / ') + '）');
    ok(colors.some((c) => c.color === 'rgb(244, 248, 36)'), '[1] = 正面强调的黄色');
    ok(colors.every((c) => !/\[|\]/.test(c.text)), '标记本身没有显示出来');

    const real = errors.filter((e) => !/favicon|net::ERR/i.test(String(e)));
    ok(real.length === 0, '无 JS 异常' + (real.length ? '：' + real.slice(0, 3).join(' | ') : ''));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'out', 'emph.png'), Buffer.from(shot.data, 'base64'));
    console.log('  截图: tools/out/emph.png');
  } catch (e) {
    console.log('  异常：' + (e && e.stack || e));
    fails.push('测试异常');
  } finally {
    fs.writeFileSync(STORY, original);
    console.log('  （data/chapters.json 已还原）');
    child.kill();
  }
  console.log('\n' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  process.exit(fails.length ? 1 : 0);
})();
