/* 作者工具：章节 / 段落 / 角色 / 台词（含强调色）/ 图鉴拉头像。
 *
 * 数据模型（data/chapters.json）：
 *   story.characters = [{ id, name:{jp,en}, species, color, portrait }]
 *   story.meta.colors = { name: [...], emph: { "1": {label,color}, ... } }
 *   block = { bg, speaker:{char:id}|null, portrait:{src,side}, text:{jp:[[行…]…], en:[…]} }
 *   正文里 [1]…[/] 之类的标记 = 强调色（1 正面 / 2 普通 / 3 种族和地名 / 4 组织名）
 *
 * 改完自动存盘（防抖 1.2s），预览用同一份数据跑真正的阅读器。
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var story = null;
  var dexList = [];
  var fontSet = new Set();
  var images = [];
  var ci = 0;              // 当前章节
  var bi = 0;              // 当前段落
  var view = 'block';      // 'block' | 'character'
  var charIdx = 0;         // 正在编辑的角色
  var dirty = false;
  var saveTimer = null;
  var dexTarget = null;    // 图鉴弹窗选完之后写给谁
  var dexQuery = '';
  var lastFocus = null;    // 记住最后聚焦的 textarea（插入强调色用）

  var EMPH_FALLBACK = {
    '1': { label: '正面强调', color: '#f4f824' },
    '2': { label: '普通强调', color: '#00cdd0' },
    '3': { label: '种族和地名强调', color: '#00c400' },
    '4': { label: '组织名强调', color: '#efa9ec' },
  };
  var NAME_COLORS = ['#f2f221', '#11f3ef', '#00c400', '#efa9ec'];

  /* ---------------- 基础 ---------------- */
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 1400);
  }
  function status(msg) { $('#status').textContent = msg || ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
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
  function chars() { return story.characters || (story.characters = []); }
  function emphMap() {
    story.meta = story.meta || {};
    story.meta.colors = story.meta.colors || {};
    story.meta.colors.emph = story.meta.colors.emph || EMPH_FALLBACK;
    story.meta.colors.name = story.meta.colors.name || NAME_COLORS;
    return story.meta.colors.emph;
  }
  function emphColor(n) {
    var m = emphMap()[String(n)];
    return (m && m.color) || (EMPH_FALLBACK[String(n)] || {}).color || '#ffffff';
  }
  function charById(id) {
    var l = chars();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  /* 字体里没有的字（先去掉 [n] [/] 这些标记） */
  function missingChars(text) {
    var clean = String(text).replace(/\[(\/?)([1-4])?\]/g, '');
    var out = [], seen = {};
    for (var i = 0; i < clean.length; i++) {
      var ch = clean[i];
      var cp = clean.codePointAt(i);
      if (cp > 0xffff) i++;
      if (cp === 10 || cp === 13 || cp === 32) continue;
      if (fontSet.has(cp) || seen[cp]) continue;
      seen[cp] = 1;
      out.push(ch);
    }
    return out;
  }
  /* 头像路径补前导斜杠（编辑页在 /tools/ 下） */
  function rootSrc(src) {
    if (!src) return '';
    return /^(https?:|\/)/.test(src) ? src : '/' + src;
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
    }).then(function () {
      dirty = false;
      status('已保存 ' + new Date().toLocaleTimeString());
      if ($('#autoPreview').checked) refreshPreview();
    }).catch(function (e) {
      status('保存失败：' + e.message);
      toast('保存失败：' + e.message);
    });
  }
  function refreshPreview() {
    var done = dirty ? save() : Promise.resolve();
    done.then(function () {
      $('#preview').src = '/preview?ch=' + ci + '&blk=' + bi + '&t=' + Date.now();
    });
  }

  /* ---------------- 左侧 ---------------- */
  function renderChapters() {
    var ul = $('#chapterList');
    ul.innerHTML = '';
    story.chapters.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = i === ci ? 'on' : '';
      li.innerHTML = '<span class="idx">' + (i + 1) + '</span><span class="txt">' +
        esc((c.title && c.title.jp) || c.id || '(无标题)') + '</span>';
      li.onclick = function () { ci = i; bi = 0; view = 'block'; renderAll(); };
      ul.appendChild(li);
    });
  }

  function blockLabel(b, i) {
    var sp = b.speaker && b.speaker.char ? charById(b.speaker.char) : null;
    var first = '';
    try { first = (b.text.jp[0] || [])[0] || ''; } catch (e) {}
    first = first.replace(/\[(\/?)([1-4])?\]/g, '') || '(空)';
    return '<span class="idx">' + (i + 1) + '</span><span class="txt">' + esc(first) + '</span>' +
      '<span class="tag">' + esc(sp ? (sp.name.jp || sp.id) : '旁白') + '</span>';
  }

  function renderBlocks() {
    var ul = $('#blockList');
    ul.innerHTML = '';
    var c = chapter();
    if (!c) return;
    c.blocks.forEach(function (b, i) {
      var li = document.createElement('li');
      li.className = (i === bi && view === 'block') ? 'on' : '';
      li.innerHTML = blockLabel(b, i);
      li.onclick = function () { bi = i; view = 'block'; renderAll(); };
      ul.appendChild(li);
    });
  }

  function renderChars() {
    var ul = $('#charList');
    ul.innerHTML = '';
    chars().forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = (view === 'character' && i === charIdx) ? 'on' : '';
      var dot = '<span class="dot" style="background:' + esc(c.color || '#888') + '"></span>';
      li.innerHTML = dot + '<span class="txt">' + esc((c.name && c.name.jp) || c.id) + '</span>' +
        '<span class="tag">' + (c.species ? '#' + String(c.species).padStart(4, '0') : '—') + '</span>';
      li.onclick = function () { charIdx = i; view = 'character'; renderAll(); };
      ul.appendChild(li);
    });
  }

  /* ---------------- 段落表单 ---------------- */
  function renderForm() {
    if (view === 'character') return renderCharForm();
    var b = block();
    var host = $('#form');
    if (!b) { host.innerHTML = '<p class="hint">这个章节还没有段落。</p>'; return; }

    host.innerHTML =
      '<h2>第 ' + (bi + 1) + ' 段　/　共 ' + chapter().blocks.length + ' 段</h2>' +
      '<div class="row"><button id="btnUp">↑ 上移</button><button id="btnDown">↓ 下移</button>' +
      '<button id="btnDup">复制一段</button><button id="btnDel" class="danger">删掉这一段</button></div>' +
      fieldsetSpeaker(b) + fieldsetPortrait(b) + fieldsetBg(b) + fieldsetText(b);

    bindBlocksNav();
    bindSpeaker(b);
    bindPortrait(b);
    bindBg(b);
    bindText(b);
  }

  function fieldsetSpeaker(b) {
    var cur = (b.speaker && b.speaker.char) || '';
    var opts = ['<option value="">（旁白，不显示名字）</option>'].concat(chars().map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === cur ? ' selected' : '') + '>' +
        esc((c.name && c.name.jp) || c.id) + '（' + esc(c.id) + '）</option>';
    })).join('');
    return '<fieldset><legend>说话人</legend>' +
      '<div class="row"><label>角色</label><select id="spChar">' + opts + '</select>' +
      '<button class="mini" id="btnNewChar">＋ 新角色</button></div>' +
      '<p class="hint">名字、颜色、头像都跟着角色走 —— 改角色，所有用到它的段落一起变。</p>' +
      '</fieldset>';
  }

  function fieldsetPortrait(b) {
    var p = b.portrait || {};
    var sp = b.speaker && b.speaker.char ? charById(b.speaker.char) : null;
    var auto = sp && sp.portrait;
    return '<fieldset><legend>头像</legend>' +
      '<div class="row">' +
        '<img class="portrait-preview" id="porImg" src="' + esc(rootSrc(p.src || auto || '')) + '" alt="">' +
        '<button id="btnDex">选宝可梦…</button>' +
        '<button id="btnPorAuto">用角色默认头像</button>' +
        '<button id="btnPorClear">不用头像</button>' +
        '<label style="flex:0 0 auto">位置</label>' +
        '<select id="porSide"><option value="left"' + (p.side !== 'right' ? ' selected' : '') + '>左边</option>' +
        '<option value="right"' + (p.side === 'right' ? ' selected' : '') + '>右边</option></select>' +
      '</div>' +
      '<p class="hint">素材来自 PMD Sprite Collab，选完自动下载到 assets/img/portrait/。' +
      '留空就用角色自己的头像。</p></fieldset>';
  }

  function fieldsetBg(b) {
    var opts = ['<option value="">（不设背景）</option>'].concat(images.map(function (f) {
      return '<option value="' + esc(f) + '"' + (b.bg === f ? ' selected' : '') + '>' + esc(f) + '</option>';
    })).join('');
    return '<fieldset><legend>场景背景</legend><div class="row"><label>图片</label>' +
      '<select id="bgSel">' + opts + '</select>' +
      '<input type="text" id="bgText" value="' + esc(b.bg || '') + '" placeholder="也可以直接填路径"></div></fieldset>';
  }

  function fieldsetText(b) {
    b.text = b.text || { jp: [[]], en: [[]] };
    return '<fieldset><legend>台词</legend>' +
      emphasisBar() +
      langBox('jp', '日文（只能用假名 / 英文）', b) +
      langBox('en', 'English', b) +
      '</fieldset>';
  }

  /* 强调色按钮条：选中文字后点按钮，会包成 [n]…[/] */
  function emphasisBar() {
    var m = emphMap();
    var btns = [1, 2, 3, 4].map(function (n) {
      return '<button class="emph" data-emph="' + n + '" style="color:' + esc(emphColor(n)) + '" ' +
        'title="把选中文字包成 [' + n + ']…[/]">' + esc((m[String(n)] || {}).label || ('强调 ' + n)) + '</button>';
    }).join('');
    return '<div class="row emphbar"><label>强调</label>' + btns +
      '<button class="mini" data-emph="0">清除标记</button>' +
      '<span class="hint">先选中文字再点；没选中就插一对空标记</span></div>';
  }

  function langBox(lang, title, b) {
    var pages = b.text[lang] || (b.text[lang] = []);
    var inner = pages.map(function (lines, pi) {
      var val = lines.join('\n');
      var miss = missingChars(val);
      return '<div class="pagebox" data-pi="' + pi + '">' +
        '<textarea data-lang="' + lang + '" data-pi="' + pi + '" rows="' + Math.max(2, lines.length) + '"' +
        (miss.length ? ' class="bad"' : '') + '>' + esc(val) + '</textarea>' +
        '<div class="side"><button class="mini" data-delpage="' + pi + '" data-lang="' + lang + '">删页</button>' +
        '<button class="mini" data-addpage="' + pi + '" data-lang="' + lang + '">↓加页</button></div>' +
        (miss.length ? '<p class="warn">字体里没有：' + esc(miss.join(' ')) + '</p>' : '') + '</div>';
    }).join('');
    return '<div style="margin-bottom:10px"><b style="font-size:12px">' + title + '</b>' +
      '<p class="hint">一个文本框 = 一页；一页打完出现 ▼，按键继续。换行 = 框里换行。</p>' +
      '<div class="pages" data-box="' + lang + '">' + inner + '</div></div>';
  }

  /* ---------------- 角色表单 ---------------- */
  function renderCharForm() {
    var c = chars()[charIdx];
    var host = $('#form');
    if (!c) {
      host.innerHTML = '<p class="hint">还没有角色。</p>';
      return;
    }
    c.name = c.name || { jp: '', en: '' };
    var swatches = (story.meta.colors.name || NAME_COLORS).map(function (col) {
      return '<button class="swatch" data-col="' + esc(col) + '" style="background:' + esc(col) + '" ' +
        'title="' + esc(col) + '"></button>';
    }).join('');
    host.innerHTML =
      '<h2>角色：' + esc(c.name.jp || c.id) + '</h2>' +
      '<div class="row"><button id="btnCharDel" class="danger">删掉这个角色</button>' +
      '<span class="hint">用它说话的段落会变成旁白（不会删段落）</span></div>' +
      '<fieldset><legend>基本</legend>' +
        '<div class="row"><label>名字（日）</label><input type="text" id="cJa" value="' + esc(c.name.jp) + '"></div>' +
        '<div class="row"><label>名字（英）</label><input type="text" id="cEn" value="' + esc(c.name.en) + '"></div>' +
        '<div class="row"><label>id</label><input type="text" id="cId" value="' + esc(c.id) + '">' +
          '<span class="hint">段落里存的是这个 id，别乱改（改也行，会同步）</span></div>' +
      '</fieldset>' +
      '<fieldset><legend>颜色</legend><div class="row">' + swatches +
        '<input type="color" id="cColor" value="' + esc(c.color || '#f2f221') + '"></div>' +
        '<p class="hint">这几个是名字常用的颜色（黄 / 青 / 绿 / 粉），也可以自己调。</p></fieldset>' +
      '<fieldset><legend>种族</legend><div class="row">' +
        '<img class="portrait-preview" id="cPor" src="' + esc(rootSrc(c.portrait || '')) + '" alt="">' +
        '<b id="cSpecies">' + (c.species ? '#' + String(c.species).padStart(4, '0') : '（未选）') + '</b>' +
        '<button id="btnCharDex">选宝可梦…</button>' +
      '</div><p class="hint">选好种族会自动带上默认头像；段落里没单独指定头像时就用它。</p></fieldset>';

    $('#cJa').oninput = function () { c.name.jp = this.value; markDirty(); renderChars(); };
    $('#cEn').oninput = function () { c.name.en = this.value; markDirty(); };
    $('#cId').onchange = function () { renameChar(c, this.value.trim()); };
    $('#cColor').oninput = function () { c.color = this.value; markDirty(); renderChars(); };
    host.querySelectorAll('.swatch').forEach(function (b) {
      b.onclick = function () { c.color = b.dataset.col; markDirty(); renderForm(); renderChars(); };
    });
    $('#btnCharDex').onclick = function () { openDex({ type: 'character', char: c }); };
    $('#btnCharDel').onclick = function () {
      if (!confirm('删掉角色「' + (c.name.jp || c.id) + '」？')) return;
      var id = c.id;
      story.chapters.forEach(function (ch) {
        ch.blocks.forEach(function (b2) {
          if (b2.speaker && b2.speaker.char === id) delete b2.speaker;
        });
      });
      chars().splice(charIdx, 1);
      charIdx = Math.max(0, charIdx - 1);
      markDirty(); renderAll();
    };
  }

  function newChar() {
    var n = chars().length + 1;
    chars().push({
      id: 'c' + n,
      name: { jp: 'あたらしい やつ', en: 'New' },
      color: (story.meta.colors.name || NAME_COLORS)[n % 4],
    });
    charIdx = chars().length - 1;
    view = 'character';
    markDirty(); renderAll();
  }

  function renameChar(c, id) {
    if (!id || id === c.id) return;
    var old = c.id;
    if (charById(id)) { toast('id 重复了'); renderForm(); return; }
    c.id = id;
    story.chapters.forEach(function (ch) {
      ch.blocks.forEach(function (b) {
        if (b.speaker && b.speaker.char === old) b.speaker.char = id;
      });
    });
    markDirty(); renderAll();
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
    $('#spChar').onchange = function () {
      if (this.value) b.speaker = { char: this.value };
      else delete b.speaker;
      markDirty(); renderForm(); renderBlocks();
    };
    $('#btnNewChar').onclick = newChar;
  }
  function bindPortrait(b) {
    $('#porSide').onchange = function () {
      b.portrait = b.portrait || {};
      b.portrait.side = this.value; markDirty();
    };
    $('#btnPorClear').onclick = function () { delete b.portrait; markDirty(); renderForm(); renderBlocks(); };
    $('#btnPorAuto').onclick = function () { delete b.portrait; markDirty(); renderForm(); };
    $('#btnDex').onclick = function () { openDex({ type: 'block', block: b }); };
  }
  function bindBg(b) {
    $('#bgSel').onchange = function () { b.bg = this.value; $('#bgText').value = this.value; markDirty(); };
    $('#bgText').oninput = function () {
      b.bg = this.value.trim();
      $('#bgSel').value = images.indexOf(b.bg) >= 0 ? b.bg : '';
      markDirty();
    };
  }
  function bindText(b) {
    var host = $('#form');
    host.querySelectorAll('textarea[data-lang]').forEach(function (ta) {
      ta.onfocus = function () { lastFocus = ta; };
      ta.oninput = function () {
        var lang = ta.dataset.lang, pi = +ta.dataset.pi;
        b.text[lang][pi] = ta.value.split('\n');
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
        if (b.text[lang].length <= 1) { toast('至少留一页'); return; }
        b.text[lang].splice(pi, 1);
        markDirty(); renderForm();
      };
    });
    host.querySelectorAll('[data-addpage]').forEach(function (btn) {
      btn.onclick = function () {
        b.text[btn.dataset.lang].splice(+btn.dataset.addpage + 1, 0, ['']);
        markDirty(); renderForm();
      };
    });
    host.querySelectorAll('[data-emph]').forEach(function (btn) {
      btn.onclick = function () { applyEmphasis(btn.dataset.emph); };
    });
  }

  /* 把选中的文字包成 [n]…[/]，n=0 表示去掉标记 */
  function applyEmphasis(n) {
    var ta = lastFocus && document.body.contains(lastFocus) ? lastFocus : $('#form textarea');
    if (!ta) return;
    var v = ta.value;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = v.slice(s, e);
    var out;
    if (String(n) === '0') {
      out = v.replace(/\[(\/?)([1-4])?\]/g, '');
    } else {
      out = v.slice(0, s) + '[' + n + ']' + (sel || '') + '[/]' + v.slice(e);
    }
    ta.value = out;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }

  /* ---------------- 图鉴 ---------------- */
  function openDex(t) {
    dexTarget = t;
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
    list.querySelectorAll('li').forEach(function (li) { li.onclick = function () { pickDex(+li.dataset.dex); }; });
  }
  function pickDex(id) {
    var host = $('#dexEmotions');
    host.innerHTML = '<p class="hint">查表情…</p>';
    api('/api/portraits?dex=' + id).then(function (r) {
      if (!r.emotions || !r.emotions.length) { host.innerHTML = '<p class="hint">这一只还没有头像素材。</p>'; return; }
      var ja = (dexList.filter(function (d) { return d.id === id; })[0] || {}).ja || '';
      host.innerHTML = '<p class="hint">#' + id + ' ' + esc(ja) + '：选一个表情</p>' +
        r.emotions.map(function (e) { return '<button data-emotion="' + esc(e) + '">' + esc(e) + '</button>'; }).join('');
      host.querySelectorAll('[data-emotion]').forEach(function (btn) {
        btn.onclick = function () { pullPortrait(id, btn.dataset.emotion); };
      });
    }).catch(function (e) { host.innerHTML = '<p class="warn">查不到：' + esc(e.message) + '</p>'; });
  }
  function pullPortrait(id, emotion) {
    var host = $('#dexEmotions');
    host.innerHTML = '<p class="hint">下载 ' + emotion + '…</p>';
    api('/api/portrait?dex=' + id + '&emotion=' + encodeURIComponent(emotion)).then(function (r) {
      if (dexTarget && dexTarget.type === 'character') {
        var c = dexTarget.char;
        c.species = id;
        c.portrait = r.file;
        var d = dexList.filter(function (x) { return x.id === id; })[0];
        if (d && !c.name.jp) c.name.jp = d.ja;
        if (d && !c.name.en) c.name.en = d.en;
      } else if (dexTarget && dexTarget.block) {
        dexTarget.block.portrait = {
          src: r.file,
          side: (dexTarget.block.portrait && dexTarget.block.portrait.side) || 'right',
        };
      }
      markDirty();
      $('#dexModal').hidden = true;
      renderAll();
      toast('已下载 ' + r.file + (r.cached ? '（本机已有）' : ''));
    }).catch(function (e) { host.innerHTML = '<p class="warn">下载失败：' + esc(e.message) + '</p>'; });
  }

  /* ---------------- 章节 ---------------- */
  function addChapter() {
    var n = story.chapters.length + 1;
    story.chapters.push({
      id: 'ch' + String(n).padStart(2, '0'),
      title: { jp: 'あたらしい しょう', en: 'New chapter' },
      blocks: [newBlock()],
    });
    ci = story.chapters.length - 1; bi = 0; view = 'block';
    markDirty(); renderAll();
  }
  function newBlock() {
    var prev = block();
    return { bg: (prev && prev.bg) || images[0] || '', text: { jp: [['']], en: [['']] } };
  }
  function addBlock() {
    chapter().blocks.splice(bi + 1, 0, newBlock());
    bi++; view = 'block'; markDirty(); renderAll();
  }

  function renderAll() {
    renderChapters(); renderBlocks(); renderChars(); renderForm();
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    Promise.all([
      api('/api/story').then(function (t) { return typeof t === 'string' ? JSON.parse(t) : t; }),
      api('/api/dex'), api('/api/font'), api('/api/images'),
    ]).then(function (r) {
      story = r[0];
      dexList = r[1];
      fontSet = new Set(r[2]);
      images = r[3].images || [];
      story.meta = story.meta || {};
      story.chapters = story.chapters || [];
      story.characters = story.characters || [];
      emphMap();
      if (!story.chapters.length) {
        story.chapters = [{ id: 'ch01', title: { jp: '', en: '' }, blocks: [newBlock()] }];
      }
      ci = 0; bi = 0; view = 'block';
      renderAll();

      $('#btnSave').onclick = save;
      $('#btnAddChapter').onclick = addChapter;
      $('#btnAddBlock').onclick = addBlock;
      $('#btnAddChar').onclick = newChar;
      $('#btnPreview').onclick = refreshPreview;
      $('#autoPreview').onchange = function () { if (this.checked) refreshPreview(); };
      $('#dexSearch').oninput = renderDexList;
      $('#dexClose').onclick = function () { $('#dexModal').hidden = true; };
      $('#dexModal').onclick = function (e) { if (e.target.id === 'dexModal') $('#dexModal').hidden = true; };
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        if (e.key === 'Escape') $('#dexModal').hidden = true;
      });
      window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
      status('已载入 ' + story.chapters.length + ' 章 / ' + chapter().blocks.length + ' 段 / ' + chars().length + ' 个角色');
    }).catch(function (e) {
      status('载入失败：' + e.message);
      document.body.insertAdjacentHTML('beforeend',
        '<p style="color:#b3261e;padding:12px">载入失败：' + esc(e.message) + '</p>');
    });
  }

  boot();
})();
