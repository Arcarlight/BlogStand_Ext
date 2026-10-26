/**
 * 虹星的不可思议小说 —— 阅读器
 * ------------------------------------------------------------
 * 数据在 data/chapters.json，结构见文件里第一段注释。
 *
 * 一句话（block）可以分几「页」（page）：一页打出来 -> 出现 ▼ ->
 * 按键继续，下一页接着往对话框里追加（超过 3 行就清屏重来）。
 * 这和 PMD 里「一句话中间停下来等你按键」是同一回事。
 *
 * 进度存在 localStorage（zz.save），刷新/关掉再打开都能接上。
 */
(function () {
  'use strict';

  /* 界面上的字：只用假名 / 英文 —— 字体 NDS12 没有汉字，
     写汉字会掉到系统字体上，和旁边的点阵字完全不是一套。 */
  var T = {
    jp: {
      prev: 'まえへ', next: 'つぎへ', save: 'セーブ', load: 'ロード', restart: 'さいしょから',
      hint: 'わくを クリック／ → で つぎへ ← で まえへ S で セーブ',
      saved: 'セーブしました', saveFail: 'セーブできませんでした',
      loaded: 'ロードしました', noSave: 'セーブが ありません',
      resumed: 'つづきから', start: 'クリックで すすむ', ended: 'ここまで', reset: 'さいしょから'
    },
    en: {
      prev: 'Prev', next: 'Next', save: 'Save', load: 'Load', restart: 'Restart',
      hint: 'Click / → next ← back S save',
      saved: 'Saved', saveFail: 'Could not save',
      loaded: 'Loaded', noSave: 'No save yet',
      resumed: 'Resumed', start: 'Click to start', ended: 'The end', reset: 'From the start'
    }
  };

  var LANG_KEY = 'zz.lang';
  var SAVE_KEY = 'zz.save';
  var MAX_LINES = 3;          // 对话框能同时显示几行
  var TYPE_MS = 28;           // 每个字的间隔

  var el = {};                // 缓存的 DOM
  var data = null;            // chapters.json
  var lang = 'jp';            // 当前语言
  var ch = 0;                 // 章节下标
  var blk = 0;                // 段落下标
  var page = 0;               // 页下标（段内）
  var typing = null;          // 打字机定时器
  var boxLines = [];          // 对话框里已经排出来的行（字符串）
  var history = [];           // 走过的位置，用来「上一句」
  var waiting = false;        // 正在等按键

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }

  function t(key) {
    var m = T[lang] || T.jp;
    return m[key] != null ? m[key] : key;
  }

  function toLines(v) {
    if (v == null) return [];
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.map(function (x) { return String(x); });
    return [];
  }

  function pick(langObj, fallbackKey) {
    if (langObj == null) return '';
    if (typeof langObj === 'string') return langObj;
    return langObj[lang] != null ? langObj[lang] : (langObj[fallbackKey] || '');
  }

  function toast(msg) {
    var t = el.toast;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 1100);
  }

  function save(quiet) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ch: ch, blk: blk, page: page, t: Date.now() }));
      if (!quiet) toast(t('saved'));
    } catch (e) { if (!quiet) toast(t('saveFail')); }
  }

  function readSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (typeof o.ch !== 'number' || typeof o.blk !== 'number') return null;
      return o;
    } catch (e) { return null; }
  }

  /* ---------------- 渲染 ---------------- */
  function chapter() { return data.chapters[ch]; }
  function block() { return chapter().blocks[blk]; }
  function pages() {
    var t = block().text;
    if (t == null) return [[]];
    var arr = t[lang] != null ? t[lang] : (t.en || t.jp || []);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.length ? arr : [[]];
  }

  function setScene(b) {
    var bg = b.bg;
    if (bg) {
      el.scene.style.backgroundImage = 'url(' + bg + ')';
      el.scene.classList.add('has-bg');
    } else {
      el.scene.style.backgroundImage = '';
      el.scene.classList.remove('has-bg');
    }
  }

  function setPortrait(b) {
    var p = b.portrait;
    if (!p || !p.src) {
      el.portrait.className = 'vn-portrait';
      el.portrait.innerHTML = '';
      return;
    }
    el.portrait.className = 'vn-portrait on' + (p.side === 'right' ? ' side-right' : '');
    el.portrait.innerHTML = '<img src="' + p.src + '" alt="">';
    // 头像底色的规则：说话人有 color 就用它，否则透明（露出头像本身的底色）
    var img = el.portrait.querySelector('img');
    if (img) img.style.background = (b.speaker && b.speaker.color) || 'transparent';
  }

  function clearBox() { boxLines = []; el.text.innerHTML = ''; }

  function paintBox() {
    // 把已定下的行画出来（不含正在打的那一行）
    // boxLines 里每一项是 { name, text }：name 有值就说明这行开头是说话人，
    // 重画时必须把它包成 .nm，否则翻到下一页时名字会变回白字（踩过）。
    el.text.innerHTML = '';
    boxLines.forEach(function (entry, i) {
      if (i) el.text.appendChild(document.createElement('br'));
      if (entry.name) {
        var nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = entry.name;
        el.text.appendChild(nm);
      }
      el.text.appendChild(document.createTextNode(entry.text));
    });
  }

  /* 不逐字、直接铺一页（用来补出「本段前面那几页」的上下文：
     读档、回上一句、翻到段中间时，框里应该有前文，而不是只剩当前这一句） */
  function appendInstant(b, pg, pageIdx) {
    var lines = toLines(pg);
    var sp = b.speaker;
    var name = sp ? pick(sp.name || sp, 'jp') : '';
    var total = pages().length;

    if (boxLines.length + lines.length > MAX_LINES) clearBox();

    lines.forEach(function (line, li) {
      if (boxLines.length || li) el.text.appendChild(document.createElement('br'));
      var useName = (pageIdx === 0 && li === 0 && name) ? name : null;
      var suffix = (pageIdx === total - 1 && li === lines.length - 1 && name) ? '」' : '';
      if (useName) {
        var nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = useName;         // 只染名字
        el.text.appendChild(nm);
        el.text.appendChild(document.createTextNode('「' + line + suffix));
      } else {
        el.text.appendChild(document.createTextNode(line + suffix));
      }
      boxLines.push({ name: useName, text: (useName ? '「' : '') + line + suffix });
    });
  }

  /* 打一页：把这一页的每一行追加进去，逐字显示。
     名字和「只在整段的第一页出现一次；」在整段的最后一页收尾
     —— 这样段内分页时不会每页都重复一遍名字。 */
  function typePage(blkData, pg) {
    var lines = toLines(pg);
    var sp = blkData.speaker;
    var nameJp = sp ? pick(sp.name || sp, 'jp') : '';
    var total = pages().length;
    var firstPage = page === 0;
    var lastPage = page === total - 1;

    if (boxLines.length + lines.length > MAX_LINES) clearBox();
    paintBox();

    var out = el.text;
    var chars = [];      // 逐字节点

    lines.forEach(function (line, li) {
      if (boxLines.length || li) out.appendChild(document.createElement('br'));

      var prefix = '';
      if (firstPage && li === 0 && nameJp) {
        var nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = nameJp;          // 只染名字
        out.appendChild(nm);
        out.appendChild(document.createTextNode('「'));   // 引号是普通文字色
        prefix = nameJp + '「';
      }

      Array.prototype.forEach.call(line, function (c) {
        var s = document.createElement('span');
        s.className = 'ch';
        s.textContent = c;
        out.appendChild(s);
        chars.push(s);
      });

      var suffix = '';
      if (lastPage && li === lines.length - 1 && nameJp) {
        var cl = document.createElement('span');
        cl.className = 'ch';
        cl.textContent = '」';
        out.appendChild(cl);
        chars.push(cl);
        suffix = '」';
      }
      boxLines.push({ name: (firstPage && li === 0 && nameJp) ? nameJp : null,
                      text: (prefix ? '「' : '') + line + suffix });
    });

    var i = 0;
    waiting = false;
    el.arrow.hidden = true;
    clearInterval(typing);
    typing = setInterval(function () {
      if (i >= chars.length) {
        clearInterval(typing);
        typing = null;
        finishTyping();
        return;
      }
      chars[i].classList.add('on');
      i++;
    }, TYPE_MS);

    function revealAll() {
      chars.forEach(function (n) { n.classList.add('on'); });
    }

    function finishTyping() {
      revealAll();
      waiting = true;
      if (data.meta && data.meta.prompt === 'center') {
        el.arrow.hidden = false;
      } else {
        // 行内箭头：直接跟在最后
        var a = document.createElement('span');
        a.className = 'vn-arrow-inline';
        out.appendChild(a);
      }
      save(true);
      updateBar();
    }

    // 打字途中再点一下 = 立刻显示完整这一页
    el.text._finish = function () {
      if (!typing) return;
      clearInterval(typing);
      typing = null;
      finishTyping();
    };
  }

  function render() {
    var b = block();
    setScene(b);
    setPortrait(b);
    el.chTitle.textContent = pick(chapter().title, 'jp') || '';
    clearBox();
    // 先把本段前面的页补出来（读档/回看时上下文才完整），再逐字打当前页
    var pgs = pages();
    for (var i = 0; i < page && i < pgs.length; i++) appendInstant(b, pgs[i], i);
    typePage(b, pgs[page]);
    updateBar();
  }

  function updateBar() {
    var total = pages().length;
    el.pos.textContent = (ch + 1) + '-' + (blk + 1) + '  ' + (page + 1) + '/' + total;
    el.prev.disabled = history.length === 0;
  }

  /* ---------------- 前进 / 后退 ---------------- */
  function advance() {
    if (typing && el.text._finish) { el.text._finish(); return; }
    if (!waiting) return;
    // 段内还有页 -> 下一页
    if (page + 1 < pages().length) {
      history.push({ ch: ch, blk: blk, page: page });
      page++;
      typePage(block(), pages()[page]);
      updateBar();
      return;
    }
    // 下一段
    if (blk + 1 < chapter().blocks.length) {
      history.push({ ch: ch, blk: blk, page: page });
      blk++;
      page = 0;
      render();
      return;
    }
    // 下一章
    if (ch + 1 < data.chapters.length) {
      history.push({ ch: ch, blk: blk, page: page });
      ch++;
      blk = 0;
      page = 0;
      render();
      return;
    }
    toast(t('ended'));
  }

  function back() {
    if (!history.length) return;
    var pos = history.pop();
    ch = pos.ch; blk = pos.blk; page = pos.page;
    render();
    var last = el.text.lastChild;
    if (last) el.text._finish && el.text._finish();
  }

  function restart() {
    history = [];
    ch = 0; blk = 0; page = 0;
    render();
    toast(t('reset'));
  }

  function loadSave() {
    var s = readSave();
    if (!s) { toast(t('noSave')); return; }
    history = [];
    ch = Math.min(s.ch, data.chapters.length - 1);
    blk = Math.min(s.blk, chapter().blocks.length - 1);
    page = Math.min(s.page || 0, Math.max(pages().length - 1, 0));
    render();
    toast(t('loaded'));
  }

  /* 把按钮/提示的字换成当前语言（都只有假名和英文） */
  function applyUi() {
    el.prev.textContent = t('prev');
    el.next.textContent = t('next');
    el.saveBtn.textContent = t('save');
    el.loadBtn.textContent = t('load');
    el.restartBtn.textContent = t('restart');
    el.hint.textContent = t('hint');
  }

  function toggleLang() {
    lang = lang === 'jp' ? 'en' : 'jp';
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    el.lang.textContent = lang === 'jp' ? 'JP' : 'EN';
    applyUi();
    history = [];
    render();
    toast(lang === 'jp' ? '日本語' : 'English');
  }

  /* ---------------- 启动 ---------------- */
  function boot(cfg) {
    data = cfg;
    try { lang = localStorage.getItem(LANG_KEY) || data.meta.defaultLang || 'jp'; } catch (e) {}
    el.scene = $('scene');
    el.box = $('box');
    el.text = $('text');
    el.arrow = $('arrow');
    el.portrait = $('portrait');
    el.toast = $('toast');
    el.pos = $('pos');
    el.prev = $('prev');
    el.next = $('next');
    el.saveBtn = $('save');
    el.loadBtn = $('load');
    el.restartBtn = $('restart');
    el.hint = $('hint');
    el.chTitle = $('chapterTitle');
    el.lang = $('lang');

    el.lang.textContent = lang === 'jp' ? 'JP' : 'EN';
    applyUi();

    el.box.addEventListener('click', advance);
    $('next').addEventListener('click', advance);
    el.prev.addEventListener('click', back);
    $('save').addEventListener('click', function () { save(false); });
    $('load').addEventListener('click', loadSave);
    $('restart').addEventListener('click', restart);
    el.lang.addEventListener('click', toggleLang);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { save(false); }
    });

    // 预览时由编辑器指定「从哪一段开始」，优先于存档
    if (window.__START__ && typeof window.__START__.blk === 'number') {
      ch = Math.min(window.__START__.ch || 0, data.chapters.length - 1);
      blk = Math.min(Math.max(window.__START__.blk, 0), data.chapters[ch].blocks.length - 1);
      page = 0;
      render();
      return;
    }

    // 有存档就接上
    var s = readSave();
    if (s) {
      ch = Math.min(s.ch, data.chapters.length - 1);
      blk = Math.min(s.blk, data.chapters[ch].blocks.length - 1);
      page = Math.min(s.page || 0, Math.max(pages().length - 1, 0));
    }
    render();
    if (s) toast(t('resumed'));
    else toast(t('start'));
  }

  // 数据可能直接内联（作者工具预览时用），否则去 fetch
  if (window.__STORY__) boot(window.__STORY__);
  else {
    fetch('data/chapters.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(boot)
      .catch(function (e) {
        document.body.innerHTML = '<pre style="color:#f88;font:12px monospace;padding:16px">读不到 data/chapters.json：' + e.message + '</pre>';
      });
  }
})();
