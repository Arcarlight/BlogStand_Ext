/* 作者工具：章节 / 段落 / 对话框内容 / 图鉴拉头像。
 *
 * 数据模型（和 data/chapters.json 一致）：
 *   story.chapters[i] = { id, title:{jp,en}, blocks:[…] }
 *   block = { bg, speaker:{name:{jp,en},color}, portrait:{src,side}, text:{jp:[[行…]…], en:[[行…]…]} }
 *
 * 编辑之后自动存盘（防抖 1.2 秒），预览用同一份数据在 iframe 里跑真正的阅读器。
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var story = null;
  var dexList = [];
  var fontSet = new Set();     // NDS12 支持的所有码位
  var images = [];
  var ci = 0;                  // 当前章节
  var bi = 0;                  // 当前段落
  var dirty = false;
  var saveTimer = null;

  /* ---------------- 基础 ---------------- */
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 1400);
  }

  function status(msg) {
    $('#status').textContent = msg || '';
  }

  function api(p, opt) {
    return fetch(p, Object.assign({ cache: 'no-store' }, opt || {})).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      return (ct.indexOf('json') >= 0 ? r.json() : r.text()).then(function (v) {
        if (!r.ok) throw new Error((v && v.error) || ('HTTP ' + r.status));
        return v;
      });
    });
  }

  function chapter() { return story.chapters[ci]; }
  function block() { return chapter() && chapter().blocks[bi]; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* 字体里没有的字（NDS12 只有假名 + ASCII） */
  function missingChars(text) {
    var out = [];
    var seen = {};
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var cp = text.codePointAt(i);
      if (cp > 0xffff) i++;
      if (cp === 10 || cp === 13 || cp === 32) continue;
      if (fontSet.has(cp) || seen[cp]) continue;
      seen[cp] = 1;
      out.push(ch);
    }
    return out;
  }

  /* ---------------- 存盘 ---------------- */
  function markDirty() {
    dirty = true;
    status('改动未保存…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }

  function save() {
    clearTimeout(saveTimer);
    if (!dirty) return Promise.resolve();
    return api('/api/story', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(story),
    }).then(function (r) {
      dirty = false;
      status('已保存 ' + new Date().toLocaleTimeString() + (r.backup ? '（旧版备份：' + r.backup + '）' : ''));
      if ($('#autoPreview').checked) refreshPreview();
    }).catch(function (e) {
      status('保存失败：' + e.message);
      toast('保存失败：' + e.message, true);
    });
  }

  function refreshPreview() {
    // 预览页读的是磁盘上的 data/chapters.json，所以先存再刷
    var done = dirty ? save() : Promise.resolve();
    done.then(function () {
      $('#preview').src = '/preview?ch=' + ci + '&blk=' + bi + '&t=' + Date.now();
    });
  }

  /* ---------------- 左侧：章节 / 段落 ---------------- */
  function renderChapters() {
    var ul = $('#chapterList');
    ul.innerHTML = '';
    story.chapters.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = i === ci ? 'on' : '';
      li.innerHTML = '<span class="idx">' + (i + 1) + '</span><span class="txt">' +
        esc(c.title && c.title.jp || c.id || '(无标题)') + '</span>';
      li.onclick = function () { ci = i; bi = 0; renderAll(); };
      ul.appendChild(li);
    });
  }

  function blockLabel(b, i) {
    var sp = b.speaker && b.speaker.name && b.speaker.name.jp;
    var first = '';
    try { first = (b.text.jp[0] || [])[0] || ''; } catch (e) {}
    if (!first) first = '(空)';
    return '<span class="idx">' + (i + 1) + '</span><span class="txt">' + esc(first) + '</span>' +
      '<span class="tag">' + esc(sp || '旁白') + '</span>';
  }

  function renderBlocks() {
    var ul = $('#blockList');
    ul.innerHTML = '';
    var c = chapter();
    if (!c) return;
    c.blocks.forEach(function (b, i) {
      var li = document.createElement('li');
      li.className = i === bi ? 'on' : '';
      li.innerHTML = blockLabel(b, i);
      li.onclick = function () { bi = i; renderAll(); };
      ul.appendChild(li);
    });
  }

  /* ---------------- 中间：段落表单 ---------------- */
  function renderForm() {
    var host = $('#form');
    var b = block();
    if (!b) { host.innerHTML = '<p class="hint">这个章节还没有段落，左上角点「＋」加一段。</p>'; return; }

    host.innerHTML =
      '<h2>第 ' + (bi + 1) + ' 段　/　共 ' + chapter().blocks.length + ' 段</h2>' +
      '<div class="row">' +
        '<button id="btnUp">↑ 上移</button><button id="btnDown">↓ 下移</button>' +
        '<button id="btnDup">复制一段</button><button id="btnDel" class="danger">删掉这一段</button>' +
      '</div>' +
      fieldsetSpeaker(b) +
      fieldsetPortrait(b) +
      fieldsetBg(b) +
      fieldsetText(b);

    bindBlocksNav();
    bindSpeaker(b);
    bindPortrait(b);
    bindBg(b);
    bindText(b);
  }

  function fieldsetSpeaker(b) {
    var sp = b.speaker || (b.speaker = { name: { jp: '', en: '' }, color: '#ffe14d' });
    sp.name = sp.name || { jp: '', en: '' };
    return '<fieldset><legend>说话人</legend>' +
      '<div class="row"><label>名字（日）</label>' +
        '<input type="text" id="spJa" value="' + esc(sp.name.jp) + '" placeholder="コリンク（留空＝旁白）">' +
        '<label style="flex:0 0 34px">颜色</label>' +
        '<input type="color" id="spColor" value="' + esc(sp.color || '#ffe14d') + '">' +
      '</div>' +
      '<div class="row"><label>名字（英）</label>' +
        '<input type="text" id="spEn" value="' + esc(sp.name.en) + '" placeholder="Shinx">' +
      '</div>' +
      '<p class="hint">名字留空 = 这一句是旁白（对话框里不出现名字）。</p>' +
      '</fieldset>';
  }

  function fieldsetPortrait(b) {
    var p = b.portrait || {};
    /* 编辑页在 /tools/ 下，数据里的路径是相对站点根的（assets/…），
       不补斜杠会解析成 /tools/assets/… → 404（头像裂图就是这么来的） */
    var src = p.src || '';
    if (src && !/^(https?:|\/)/.test(src)) src = '/' + src;
    return '<fieldset><legend>头像</legend>' +
      '<div class="row">' +
        '<img class="portrait-preview" id="porImg" src="' + esc(src) + '" alt="">' +
        '<button id="btnDex">选宝可梦…</button>' +
        '<button id="btnPorClear">不用头像</button>' +
        '<label style="flex:0 0 auto">位置</label>' +
        '<select id="porSide">' +
          '<option value="left"' + (p.side !== 'right' ? ' selected' : '') + '>左边</option>' +
          '<option value="right"' + (p.side === 'right' ? ' selected' : '') + '>右边</option>' +
        '</select>' +
      '</div>' +
      '<p class="hint">素材来自 PMD Sprite Collab，选完会自动下载到 assets/img/portrait/。</p>' +
      '</fieldset>';
  }

  function fieldsetBg(b) {
    var opts = ['<option value="">（不设背景）</option>'].concat(images.map(function (f) {
      return '<option value="' + esc(f) + '"' + (b.bg === f ? ' selected' : '') + '>' + esc(f) + '</option>';
    })).join('');
    return '<fieldset><legend>场景背景</legend>' +
      '<div class="row"><label>图片</label><select id="bgSel">' + opts + '</select>' +
      '<input type="text" id="bgText" value="' + esc(b.bg || '') + '" placeholder="也可以直接填路径">' +
      '</div></fieldset>';
  }

  function fieldsetText(b) {
    b.text = b.text || { jp: [[]], en: [[]] };
    return '<fieldset><legend>台词</legend>' +
      langBox('jp', '日文（只能用假名 / 英文 —— 字体没有汉字）', b) +
      langBox('en', 'English', b) +
      '</fieldset>';
  }

  function langBox(lang, title, b) {
    var pages = b.text[lang] || (b.text[lang] = []);
    var inner = pages.map(function (lines, pi) {
      var val = lines.join('\n');
      var miss = missingChars(val);
      return '<div class="pagebox" data-pi="' + pi + '">' +
        '<textarea data-lang="' + lang + '" data-pi="' + pi + '" rows="' + Math.max(2, lines.length) + '"' +
        (miss.length ? ' class="bad"' : '') + '>' + esc(val) + '</textarea>' +
        '<div class="side">' +
          '<button class="mini" data-delpage="' + pi + '" data-lang="' + lang + '">删页</button>' +
          '<button class="mini" data-addpage="' + pi + '" data-lang="' + lang + '">↓加页</button>' +
        '</div>' +
        (miss.length ? '<p class="warn">字体里没有：' + esc(miss.join(' ')) + '</p>' : '') +
        '</div>';
    }).join('');
    return '<div style="margin-bottom:10px"><b style="font-size:12px">' + title + '</b>' +
      '<p class="hint">一个文本框 = 一页；一页打完出现 ▼，按键继续下一页。换行 = 框里换行。</p>' +
      '<div class="pages" data-box="' + lang + '">' + inner + '</div></div>';
  }

  /* ---------------- 绑定 ---------------- */
  function bindBlocksNav() {
    $('#btnUp').onclick = function () { move(-1); };
    $('#btnDown').onclick = function () { move(1); };
    $('#btnDup').onclick = function () {
      chapter().blocks.splice(bi + 1, 0, JSON.parse(JSON.stringify(block())));
      bi++; markDirty(); renderAll();
    };
    $('#btnDel').onclick = function () {
      if (!confirm('删掉第 ' + (bi + 1) + ' 段？')) return;
      chapter().blocks.splice(bi, 1);
      bi = Math.max(0, bi - 1);
      markDirty(); renderAll();
    };
  }

  function move(d) {
    var arr = chapter().blocks;
    var j = bi + d;
    if (j < 0 || j >= arr.length) return;
    var t = arr[bi]; arr[bi] = arr[j]; arr[j] = t;
    bi = j; markDirty(); renderAll();
  }

  function bindSpeaker(b) {
    var sp = b.speaker;
    $('#spJa').oninput = function () { sp.name.jp = this.value; markDirty(); renderBlocks(); };
    $('#spEn').oninput = function () { sp.name.en = this.value; markDirty(); };
    $('#spColor').oninput = function () { sp.color = this.value; markDirty(); };
  }

  function bindPortrait(b) {
    $('#porSide').onchange = function () {
      b.portrait = b.portrait || {};
      b.portrait.side = this.value; markDirty();
    };
    $('#btnPorClear').onclick = function () {
      delete b.portrait; markDirty(); renderForm(); renderBlocks();
    };
    $('#btnDex').onclick = function () { openDex(b); };
  }

  function bindBg(b) {
    $('#bgSel').onchange = function () {
      b.bg = this.value; $('#bgText').value = this.value; markDirty();
    };
    $('#bgText').oninput = function () {
      b.bg = this.value.trim();
      if (images.indexOf(b.bg) >= 0) $('#bgSel').value = b.bg; else $('#bgSel').value = '';
      markDirty();
    };
  }

  function bindText(b) {
    var host = $('#form');
    host.querySelectorAll('textarea[data-lang]').forEach(function (ta) {
      ta.oninput = function () {
        var lang = ta.dataset.lang, pi = +ta.dataset.pi;
        var lines = ta.value.split('\n');
        b.text[lang][pi] = lines;
        var miss = missingChars(ta.value);
        var warn = ta.parentElement.querySelector('.warn');
        if (miss.length) {
          ta.classList.add('bad');
          if (!warn) {
            warn = document.createElement('p');
            warn.className = 'warn';
            ta.parentElement.appendChild(warn);
          }
          warn.textContent = '字体里没有：' + miss.join(' ');
        } else {
          ta.classList.remove('bad');
          if (warn) warn.remove();
        }
        markDirty();
        renderBlocks();
      };
    });
    host.querySelectorAll('[data-delpage]').forEach(function (btn) {
      btn.onclick = function () {
        var lang = btn.dataset.lang, pi = +btn.dataset.delpage;
        if (b.text[lang].length <= 1) { toast('至少留一页', true); return; }
        b.text[lang].splice(pi, 1);
        markDirty(); renderForm();
      };
    });
    host.querySelectorAll('[data-addpage]').forEach(function (btn) {
      btn.onclick = function () {
        var lang = btn.dataset.lang, pi = +btn.dataset.addpage;
        b.text[lang].splice(pi + 1, 0, ['']);
        markDirty(); renderForm();
      };
    });
  }

  /* ---------------- 图鉴 ---------------- */
  var dexTarget = null;
  var dexQuery = '';

  function openDex(b) {
    dexTarget = b;
    $('#dexModal').hidden = false;
    $('#dexSearch').value = dexQuery;
    $('#dexSearch').focus();
    renderDexList();
  }

  function renderDexList() {
    var q = $('#dexSearch').value.trim().toLowerCase();
    dexQuery = $('#dexSearch').value;
    var list = $('#dexList');
    var hits = dexList.filter(function (d) {
      if (!q) return true;
      return String(d.id) === q || String(d.id).padStart(4, '0') === q ||
        (d.en || '').toLowerCase().indexOf(q) >= 0 || (d.ja || '').indexOf(q) >= 0;
    }).slice(0, 300);
    list.innerHTML = hits.map(function (d) {
      return '<li data-dex="' + d.id + '"><span class="no">#' + String(d.id).padStart(4, '0') +
        '</span><span class="ja">' + esc(d.ja) + '</span><span>' + esc(d.en) + '</span></li>';
    }).join('');
    list.querySelectorAll('li').forEach(function (li) {
      li.onclick = function () { pickDex(+li.dataset.dex); };
    });
  }

  function pickDex(id) {
    var host = $('#dexEmotions');
    host.innerHTML = '<p class="hint">查表情…</p>';
    api('/api/portraits?dex=' + id).then(function (r) {
      if (!r.emotions || !r.emotions.length) {
        host.innerHTML = '<p class="hint">这一只还没有头像素材。</p>';
        return;
      }
      host.innerHTML = '<p class="hint">第 ' + id + ' 号：选一个表情</p>' +
        r.emotions.map(function (e) {
          return '<button data-emotion="' + esc(e) + '">' + esc(e) + '</button>';
        }).join('');
      host.querySelectorAll('[data-emotion]').forEach(function (btn) {
        btn.onclick = function () { pullPortrait(id, btn.dataset.emotion); };
      });
    }).catch(function (e) {
      host.innerHTML = '<p class="warn">查不到：' + esc(e.message) + '</p>';
    });
  }

  function pullPortrait(id, emotion) {
    var host = $('#dexEmotions');
    host.innerHTML = '<p class="hint">下载 ' + emotion + '…</p>';
    api('/api/portrait?dex=' + id + '&emotion=' + encodeURIComponent(emotion)).then(function (r) {
      dexTarget.portrait = { src: r.file, side: (dexTarget.portrait && dexTarget.portrait.side) || 'right' };
      markDirty();
      $('#dexModal').hidden = true;
      renderAll();
      toast('已下载 ' + r.file + (r.cached ? '（本机已有）' : ''));
    }).catch(function (e) {
      host.innerHTML = '<p class="warn">下载失败：' + esc(e.message) + '</p>';
    });
  }

  /* ---------------- 章节操作 ---------------- */
  function addChapter() {
    var n = story.chapters.length + 1;
    story.chapters.push({
      id: 'ch' + String(n).padStart(2, '0'),
      title: { jp: 'あたらしい しょう', en: 'New chapter' },
      blocks: [newBlock()],
    });
    ci = story.chapters.length - 1; bi = 0;
    markDirty(); renderAll();
  }

  function newBlock() {
    var prev = block();
    return {
      bg: (prev && prev.bg) || images[0] || '',
      speaker: { name: { jp: '', en: '' }, color: '#ffe14d' },
      text: { jp: [['']], en: [['']] },
    };
  }

  function addBlock() {
    chapter().blocks.splice(bi + 1, 0, newBlock());
    bi++; markDirty(); renderAll();
  }

  /* ---------------- 组装 ---------------- */
  function renderAll() {
    renderChapters();
    renderBlocks();
    renderForm();
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    Promise.all([
      api('/api/story').then(function (t) { return typeof t === 'string' ? JSON.parse(t) : t; }),
      api('/api/dex'),
      api('/api/font'),
      api('/api/images'),
    ]).then(function (r) {
      story = r[0];
      dexList = r[1];
      fontSet = new Set(r[2]);
      images = r[3].images || [];
      if (!story.chapters || !story.chapters.length) {
        story.chapters = [{ id: 'ch01', title: { jp: '', en: '' }, blocks: [newBlock()] }];
      }
      ci = 0; bi = 0;
      renderAll();

      $('#btnSave').onclick = save;
      $('#btnAddChapter').onclick = addChapter;
      $('#btnAddBlock').onclick = addBlock;
      $('#btnPreview').onclick = refreshPreview;
      $('#autoPreview').onchange = function () { if (this.checked) refreshPreview(); };
      $('#dexSearch').oninput = renderDexList;
      $('#dexClose').onclick = function () { $('#dexModal').hidden = true; };
      $('#dexModal').onclick = function (e) { if (e.target.id === 'dexModal') $('#dexModal').hidden = true; };

      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        if (e.key === 'Escape') $('#dexModal').hidden = true;
      });

      window.addEventListener('beforeunload', function (e) {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
      });

      status('已载入 ' + story.chapters.length + ' 章 / ' + chapter().blocks.length + ' 段');
    }).catch(function (e) {
      status('载入失败：' + e.message);
      document.body.insertAdjacentHTML('beforeend',
        '<p style="color:#b3261e;padding:12px">载入失败：' + esc(e.message) + '</p>');
    });
  }

  boot();
})();
