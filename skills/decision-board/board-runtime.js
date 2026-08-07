/* board-runtime.js — decision-board v2 のコンポーネント実装。
 *
 * 依存ゼロ・ビルド不要。board は静的文書なので、custom tag（db-*、light DOM）を
 * 読み込み時に一括で enhance する。JS が CSP に止められた場合も light DOM の
 * 本文はそのまま読める（シェル側 #nojs が案内を出す）。
 *
 * 書き手が触るのは db-* タグの並びだけ。ここに実装されている挙動:
 *   - db-board が chrome を生成: topbar / 目次レール / トリアージ / 提出集計 / 自動保存
 *   - 判断ごとの回答（単一・複数・項目別・承認）と部分コピー
 *   - 折りたたみ（三角 = 1 つを開く / チップ = 複数から選ぶ）+ 開閉アニメーション
 *   - 右ペイン（チケット / ノート全文）と db-ref のその場ハイライト
 *   - db-markdown の簡易 markdown 描画（```mermaid フェンス対応）
 *   - base_url など persist="shared" の入力は board 横断で localStorage 共有
 *   - pre.mermaid は window.__renderMermaidSVG があれば SVG に置換（beautiful-mermaid）
 */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  root.classList.add('js');

  /* ── 小道具 ─────────────────────────────────────────── */
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function el(tag, cls, html) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function txt(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function moveChildren(from, to) {
    while (from.firstChild) to.appendChild(from.firstChild);
  }

  /* 既知タグ。ここに無い db-* は「既定の表示」に落として画面にそう書く（黙って捨てない） */
  var KNOWN = ['db-board', 'db-lede', 'db-deps', 'db-tickets', 'db-ticket', 'db-decision',
    'db-options', 'db-option', 'db-weak', 'db-memo', 'db-per-item', 'db-item', 'db-approve',
    'db-submit', 'db-ref', 'db-pane', 'db-doc', 'db-markdown', 'db-note', 'db-facts', 'db-row',
    'db-dataset', 'db-col', 'db-record', 'db-cell', 'db-reveal', 'db-chips', 'db-shot',
    'db-variant', 'db-section', 'db-appendix', 'db-card', 'db-stack', 'db-badge', 'db-prose',
    'db-link', 'db-val', 'db-text-input', 'db-number-input', 'db-embed', 'db-meta'];

  var board = $('db-board');

  /* ── 保存。回答は URL ごと・base_url とテーマは board 横断 ── */
  var KEY = 'dbboard:' + location.pathname;
  var SHARED = 'dbboard:shared';
  var store = { ans: {}, note: {}, per: {}, appr: {}, inputs: {} };
  var shared = { inputs: {}, theme: 'auto' };
  var restoredHasContent = false;
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var d = JSON.parse(raw);
      ['ans', 'note', 'per', 'appr', 'inputs'].forEach(function (k) { if (d[k]) store[k] = d[k]; });
    }
    var rawS = localStorage.getItem(SHARED);
    if (rawS) {
      var s = JSON.parse(rawS);
      if (s.inputs) shared.inputs = s.inputs;
      if (s.theme) shared.theme = s.theme;
    }
  } catch (e) { /* localStorage 不可でも board は動く */ }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
      localStorage.setItem(SHARED, JSON.stringify(shared));
    } catch (e) { }
  }

  /* ── toast / copy ─────────────────────────────────── */
  var toast = el('div', 'db-toast');
  doc.body.appendChild(toast);
  var toastT = null;
  function flash(msg) {
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove('on'); }, 1800);
  }
  function copyText(text, msg) {
    var done = function () { flash(msg || 'コピーしました'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    } else { legacyCopy(text); done(); }
  }
  function legacyCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    try { doc.execCommand('copy'); } catch (e) { }
    ta.remove();
  }

  /* ── db-markdown: ticket.md / note.md をほぼそのまま貼るための簡易描画 ──
     対応: front matter / 見出し / 太字 / `code` / リンク / リスト（checkbox・1 段ネスト）/
           表 / 引用 / ``` フェンス（mermaid は pre.mermaid へ）/ 区切り線 / {#id} アンカー。
     さらに「**AC3 …」のような AC 項目には自動で id="ac3" を振る（db-ref の宛先になる）。 */
  function mdInline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, function (_, c) { return '<code>' + c + '</code>'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      if (!/^(https?:|#|\/)/.test(u)) return t;
      return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    return s;
  }
  function takeId(line, elm) {
    var id = null;
    line = line.replace(/\{#([A-Za-z0-9_-]+)\}/, function (_, i) { id = i; return ''; });
    if (id && elm) elm.id = id;
    return line;
  }
  function renderMarkdown(src, out) {
    var lines = src.replace(/\r\n/g, '\n').split('\n');
    var i = 0, n = lines.length;
    while (i < n && !lines[i].trim()) i++;
    if (lines[i] === '---') {                       /* front matter */
      var fm = [];
      i++;
      while (i < n && lines[i] !== '---') { fm.push(lines[i]); i++; }
      i++;
      out.appendChild(el('div', 'fm', fm.map(esc).join('<br>')));
    }
    while (i < n) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      var m;
      if ((m = line.match(/^```(\S*)/))) {          /* fence */
        var code = []; i++;
        while (i < n && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        if (m[1] === 'mermaid') {
          var pm = txt('pre', 'mermaid', code.join('\n'));
          out.appendChild(pm);
        } else {
          var pre = el('pre', null, '<code>' + esc(code.join('\n')) + '</code>');
          out.appendChild(pre);
        }
        continue;
      }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {  /* heading */
        var lv = m[1].length;
        var h = el(lv <= 2 ? 'h2' : (lv === 3 ? 'h3' : 'h4'));
        h.innerHTML = mdInline(takeId(m[2], h));
        out.appendChild(h);
        i++; continue;
      }
      if (/^>\s?/.test(line)) {                     /* blockquote */
        var bq = el('blockquote');
        while (i < n && /^>\s?/.test(lines[i])) {
          var t = lines[i].replace(/^>\s?/, '');
          if (t.trim()) { var dv = el('div'); dv.innerHTML = mdInline(takeId(t, dv)); bq.appendChild(dv); }
          i++;
        }
        out.appendChild(bq);
        continue;
      }
      if (/^\|/.test(line) && i + 1 < n && /^\|?[\s:|-]+\|?$/.test(lines[i + 1])) {   /* table */
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < n && /^\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        var wrap = el('div', 'tblwrap');
        var tb = el('table');
        var thead = el('thead'); var trh = el('tr');
        head.forEach(function (c) { var th = el('th'); th.innerHTML = mdInline(c); trh.appendChild(th); });
        thead.appendChild(trh); tb.appendChild(thead);
        var tbody = el('tbody');
        rows.forEach(function (r) {
          var tr = el('tr');
          r.forEach(function (c) { var td = el('td'); td.innerHTML = mdInline(c); tr.appendChild(td); });
          tbody.appendChild(tr);
        });
        tb.appendChild(tbody); wrap.appendChild(tb); out.appendChild(wrap);
        continue;
      }
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.appendChild(el('hr')); i++; continue; }
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {       /* list（1 段ネスト） */
        var ordered = /^\s*\d+\./.test(line);
        var list = el(ordered ? 'ol' : 'ul');
        var curLi = null, curSub = null;
        while (i < n && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          var raw = lines[i];
          var nested = /^\s{2,}/.test(raw);
          var item = raw.replace(/^\s*([-*]|\d+\.)\s+/, '');
          item = item.replace(/^\[( |x|X)\]\s*/, function (_, c) { return c === ' ' ? '☐ ' : '☑ '; });
          if (nested && curLi) {
            if (!curSub) { curSub = el('ul'); curLi.appendChild(curSub); }
            var sli = el('li'); sli.innerHTML = mdInline(takeId(item, sli)); curSub.appendChild(sli);
          } else {
            curLi = el('li'); curSub = null;
            curLi.innerHTML = mdInline(takeId(item, curLi));
            autoAcId(item, curLi);
            list.appendChild(curLi);
          }
          i++;
        }
        out.appendChild(list);
        continue;
      }
      var para = [];                                /* paragraph */
      while (i < n && lines[i].trim() && !/^(#{1,6}\s|>|\||```|\s*([-*]|\d+\.)\s)/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      var p = el('p');
      p.innerHTML = mdInline(takeId(para.join('\n'), p));
      out.appendChild(p);
    }
  }
  function splitRow(line) {
    return line.replace(/^\||\|\s*$/g, '').split('|').map(function (c) { return c.trim(); });
  }
  function autoAcId(rawItem, li) {
    var m = rawItem.match(/\*\*\s*(AC\d+)/) || rawItem.match(/^[☐☑]?\s*\*?\*?(AC\d+)/);
    if (m) {
      var id = m[1].toLowerCase();
      if (!doc.getElementById(id) && !li.id) li.id = id;
    }
  }
  $$('db-markdown').forEach(function (mdEl) {
    var srcEl = $('script[type="text/markdown"]', mdEl);
    var src = srcEl ? srcEl.textContent : mdEl.textContent;
    mdEl.textContent = '';
    var out = el('div', 'db-md');
    renderMarkdown(src, out);
    mdEl.appendChild(out);
  });

  /* ── 単純な見た目の enhance（prose / note / row / weak…） ── */
  $$('db-prose').forEach(function (p) {
    var body = el('div', 'db-pbody');
    moveChildren(p, body);
    var lb = p.getAttribute('label');
    if (lb) p.appendChild(txt('span', 'db-plabel', lb));
    p.appendChild(body);
  });
  $$('db-note').forEach(function (nt) {
    var lb = nt.getAttribute('label');
    if (lb) nt.insertBefore(txt('span', 'db-nlabel', lb), nt.firstChild);
  });
  $$('db-row').forEach(function (r) {
    var v = el('span', 'db-v');
    moveChildren(r, v);
    var k = txt('span', 'db-k', r.getAttribute('name') || '');
    if (r.hasAttribute('warn')) k.classList.add('warn');
    r.appendChild(k); r.appendChild(v);
  });

  /* ── dataset: 広い画面は表、狭い画面はカード。行の採用/警告を強調 ── */
  $$('db-dataset').forEach(function (ds) {
    var cols = $$('db-col', ds).map(function (c) {
      return { name: c.getAttribute('name') || c.textContent, num: c.hasAttribute('num'), wrap: c.hasAttribute('wrap') };
    });
    var recs = $$('db-record', ds);
    var cap = ds.getAttribute('caption');
    var box = el('div', 'db-ds');
    var t = el('div', 'db-ds-t');
    t.style.gridTemplateColumns = cols.map(function (c) { return c.wrap ? 'minmax(180px,1.4fr)' : 'auto'; }).join(' ');
    cols.forEach(function (c) {
      var h = txt('span', 'h' + (c.num ? ' num' : ''), c.name);
      t.appendChild(h);
    });
    recs.forEach(function (rec, ri) {
      var cells = $$('db-cell', rec);
      var wrap = el('div', 'db-ds-rec');
      if (rec.hasAttribute('pick')) wrap.classList.add('pick');
      if (rec.hasAttribute('warn')) wrap.classList.add('warn');
      if (ri === recs.length - 1) wrap.classList.add('last');
      cells.forEach(function (cell, ci) {
        var c = cols[ci] || {};
        var sp = el('span', (c.num ? 'num' : '') + (c.wrap ? ' wrap' : ''));
        sp.appendChild(txt('b', 'k', c.name || ''));
        var v = el('span', 'v');
        moveChildren(cell, v);
        if (rec.hasAttribute('warn')) v.classList.add('db-wv');
        sp.appendChild(v);
        if (ci === 0 && rec.getAttribute('pick')) sp.appendChild(txt('span', 'db-pickb', rec.getAttribute('pick')));
        wrap.appendChild(sp);
      });
      t.appendChild(wrap);
    });
    ds.textContent = '';
    if (cap) ds.appendChild(txt('div', 'db-ds-cap', cap));
    box.appendChild(t);
    ds.appendChild(box);
  });

  /* ── shot: 1 枚（light / default 固定）が既定。variant は「全部同時に」描く ── */
  function shotFrame(src, alt, w, h, label, sub) {
    if (src) {
      var img = el('img');
      img.src = src; img.alt = alt || label || '';
      if (w && h) { img.width = w; img.height = h; }
      return img;
    }
    var ph = el('div', 'db-ph');
    if (w && h) ph.style.aspectRatio = w + '/' + h;
    else ph.style.minHeight = '120px';
    if (w && h) ph.appendChild(txt('span', 'dim', w + ' × ' + h));
    if (label) ph.appendChild(txt('span', 'lb', label));
    if (sub) ph.appendChild(txt('span', 'sub', sub));
    return ph;
  }
  $$('db-shot').forEach(function (sh) {
    var vars = $$('db-variant', sh);
    var cap = el('div', 'db-cap');
    Array.prototype.slice.call(sh.childNodes).forEach(function (nd) {
      if (nd.nodeType === 1 && nd.tagName.toLowerCase() === 'db-variant') return;
      cap.appendChild(nd);
    });
    var tag = sh.getAttribute('tag'), note = sh.getAttribute('note');
    if (tag || note) {
      var row = el('div', 'db-shot-tag');
      if (tag) row.appendChild(txt('span', 'b', tag));
      if (note) row.appendChild(txt('span', 'm', note));
      sh.appendChild(row);
    }
    if (vars.length) {
      var grid = el('div', 'db-vars');
      vars.forEach(function (v) {
        var cellV = el('div');
        cellV.appendChild(txt('span', 'vl', v.getAttribute('label') || ''));
        cellV.appendChild(shotFrame(v.getAttribute('src'), v.getAttribute('alt') || sh.getAttribute('alt'),
          v.getAttribute('w') || sh.getAttribute('w'), v.getAttribute('h') || sh.getAttribute('h'),
          v.getAttribute('label'), null));
        grid.appendChild(cellV);
        v.remove();
      });
      sh.appendChild(grid);
    } else {
      sh.appendChild(shotFrame(sh.getAttribute('src'), sh.getAttribute('alt'),
        sh.getAttribute('w'), sh.getAttribute('h'), sh.getAttribute('label'), sh.getAttribute('sub')));
    }
    if (cap.childNodes.length) sh.appendChild(cap);
  });

  /* ── reveal / chips: 三角 = 1 つを開く、チップ = 複数から選ぶ ── */
  function setOpen(rv, on) {
    rv.setAttribute('data-open', on ? 'on' : 'off');
    if (rv._chipBtn) rv._chipBtn.classList.toggle('on', on);
    if (on) ensurePhead(rv);
  }
  function ensurePhead(rv) {
    /* 長いパネルには sticky の「付録 · ◯◯」+ 畳むを自動で付ける（内部スクロールは使わない） */
    if (rv._pheadDone) return;
    rv._pheadDone = true;
    var body = $('.db-body', rv);
    if (!body) return;
    requestAnimationFrame(function () {
      if (body.offsetHeight < 420) return;
      var label = rv.getAttribute('chip') || rv.getAttribute('label') || '';
      label = label.replace(/\s*[—–-]\s.*$/, '');
      var ph = el('div', 'db-phead');
      ph.appendChild(txt('span', null, '付録 · ' + label));
      var btn = el('button');
      btn.appendChild(el('span', 'db-tri'));
      btn.appendChild(doc.createTextNode('畳む'));
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); setOpen(rv, false); });
      ph.appendChild(btn);
      body.insertBefore(ph, body.firstChild);
    });
  }
  $$('db-reveal').forEach(function (rv) {
    var body = el('div', 'db-body');
    moveChildren(rv, body);
    var trig = el('button', 'db-trig');
    trig.type = 'button';
    trig.appendChild(el('span', 'db-tri'));
    var lb = rv.getAttribute('label') || rv.getAttribute('chip') || '';
    var quiet = rv.getAttribute('quiet');
    if (quiet) trig.appendChild(txt('span', 'db-quiet', quiet));
    trig.appendChild(doc.createTextNode(lb));
    trig.addEventListener('click', function () { setOpen(rv, rv.getAttribute('data-open') !== 'on'); });
    rv.appendChild(trig);
    rv.appendChild(body);
    setOpen(rv, rv.hasAttribute('open'));
  });
  $$('db-chips').forEach(function (ch) {
    var row = el('div', 'db-chips-row');
    var cap = ch.getAttribute('label');
    if (cap) row.appendChild(txt('span', 'cap', cap));
    $$('db-reveal[chip]', ch).forEach(function (rv) {
      var b = txt('button', 'db-chip', rv.getAttribute('chip'));
      b.type = 'button';
      b.addEventListener('click', function () { setOpen(rv, rv.getAttribute('data-open') !== 'on'); });
      rv._chipBtn = b;
      row.appendChild(b);
      if (rv.getAttribute('data-open') === 'on') b.classList.add('on');
    });
    ch.insertBefore(row, ch.firstChild);
  });

  /* ── section / appendix ── */
  var sections = [];
  $$('db-section').forEach(function (sec, i) {
    var body = el('div', 'db-sbody');
    moveChildren(sec, body);
    var head = el('div', 'db-shead');
    var l = el('div', 'l');
    var h2 = el('h2');
    h2.appendChild(txt('span', null, sec.getAttribute('title') || ''));
    l.appendChild(h2);
    var sum = sec.getAttribute('summary');
    if (sum) { var sp = el('p', 'sum'); sp.innerHTML = sum; l.appendChild(sp); }
    head.appendChild(l);
    var btn = el('button', 'db-openb');
    btn.type = 'button';
    btn.appendChild(el('span', 'db-tri'));
    var openLabel = sec.getAttribute('open-label') || '全文';
    var btnText = doc.createTextNode(openLabel);
    btn.appendChild(btnText);
    head.appendChild(btn);
    sec.insertBefore(head, sec.firstChild);
    sec.appendChild(body);
    function tog(on) {
      if (on == null) on = sec.getAttribute('data-open') !== 'on';
      sec.setAttribute('data-open', on ? 'on' : 'off');
      btnText.nodeValue = on ? '畳む' : openLabel;
    }
    head.addEventListener('click', function () { tog(); });
    tog(sec.hasAttribute('open'));
    if (!sec.id) sec.id = 'sec-' + (i + 1);
    sections.push({ el: sec, title: sec.getAttribute('title') || ('資料 ' + (i + 1)), open: tog });
  });
  var appendixes = [];
  $$('db-appendix').forEach(function (apx) {
    var card = el('div', 'db-apx-card');
    var l = el('div', 'l');
    l.appendChild(txt('span', 't', apx.getAttribute('title') || '資料'));
    var s = apx.getAttribute('summary');
    if (s) { var sp = el('span', 's'); sp.innerHTML = s; l.appendChild(sp); }
    card.appendChild(l);
    var btn = el('button', 'db-openb');
    btn.type = 'button';
    btn.appendChild(el('span', 'db-tri'));
    var btnText = doc.createTextNode('全文を出す');
    btn.appendChild(btnText);
    card.appendChild(btn);
    apx.insertBefore(card, apx.firstChild);
    var secs = $$('db-section', apx);
    function tog(on) {
      if (on == null) on = apx.getAttribute('data-open') !== 'on';
      apx.setAttribute('data-open', on ? 'on' : 'off');
      btnText.nodeValue = on ? '畳む' : '全文を出す';
      if (on) secs.forEach(function (sc, i) { sc.style.animationDelay = (i * 0.02) + 's'; });
      railRefresh();
    }
    card.addEventListener('click', function () { tog(); });
    tog(apx.hasAttribute('open'));
    apx._tog = tog;
    appendixes.push(apx);
  });
  function openSection(sec) {
    var apx = sec.closest('db-appendix');
    if (apx && apx.getAttribute('data-open') !== 'on') apx._tog(true);
    var s = null;
    sections.some(function (x) { if (x.el === sec) { s = x; return true; } return false; });
    if (s) s.open(true);
  }

  /* ── 入力（db-text-input / db-number-input / db-val / db-link） ── */
  var inputs = {};   /* name -> {get, set, els:[]} */
  function inputValue(name) { return inputs[name] ? inputs[name].get() : ''; }
  function refreshBound() {
    $$('db-val').forEach(function (v) {
      var nm = v.getAttribute('name');
      v.textContent = inputValue(nm) || v.getAttribute('empty') || '—';
    });
    $$('db-link').forEach(function (lk) { lk._refresh && lk._refresh(); });
  }
  /* 同じ name の入力は複数箇所に置ける（例: base_url を資料と判断の両方に）。
     どこで書き換えても全インスタンスとリンクに即反映する。 */
  $$('db-text-input, db-number-input').forEach(function (ip) {
    var name = ip.getAttribute('name');
    if (!name) return;
    var isNum = ip.tagName.toLowerCase() === 'db-number-input';
    var reg = inputs[name];
    if (!reg) {
      reg = inputs[name] = {
        els: [], shared: false,
        get: function () { var e0 = this.els[0]; return e0 ? e0.value.trim() : ''; }
      };
    }
    if (ip.getAttribute('persist') === 'shared') reg.shared = true;
    var wrap = el('label', 'db-in');
    var lb = ip.getAttribute('label');
    if (lb) wrap.appendChild(txt('span', 'lb', lb + (isNum && ip.getAttribute('unit') ? '（' + ip.getAttribute('unit') + '）' : '')));
    var input = el('input');
    input.type = isNum ? 'number' : 'text';
    ['min', 'max', 'step', 'placeholder'].forEach(function (a) {
      if (ip.getAttribute(a) != null) input.setAttribute(a, ip.getAttribute(a));
    });
    var saved = reg.shared ? shared.inputs[name] : store.inputs[name];
    if (saved == null && reg.shared) saved = shared.inputs[name];
    input.value = (saved != null) ? saved
      : (reg.els.length ? reg.els[0].value : (ip.getAttribute('value') || ''));
    input.addEventListener('input', function () {
      reg.els.forEach(function (o) { if (o !== input) o.value = input.value; });
      if (reg.shared) shared.inputs[name] = input.value;
      else store.inputs[name] = input.value;
      save();
      refreshBound();
      updateAll();
    });
    wrap.appendChild(input);
    ip.textContent = '';
    ip.appendChild(wrap);
    reg.els.push(input);
  });
  $$('db-link').forEach(function (lk) {
    var tpl = lk.getAttribute('href') || '';
    var names = [];
    tpl.replace(/\{([A-Za-z0-9_]+)\}/g, function (_, nm) { names.push(nm); return ''; });
    var req = (lk.getAttribute('requires') || names.join(',')).split(',').filter(Boolean);
    var path = el('span', 'db-lk-path');
    moveChildren(lk, path);
    lk.appendChild(path);
    var a = el('a');
    a.target = '_blank'; a.rel = 'noopener'; a.textContent = '開く';
    lk.appendChild(a);
    var copyBtn = null;
    if (lk.hasAttribute('copy')) {
      copyBtn = txt('button', 'db-lk-copy', 'URL をコピー');
      copyBtn.type = 'button';
      lk.appendChild(copyBtn);
    }
    lk._refresh = function () {
      var ok = req.every(function (nm) { return inputValue(nm); });
      var url = tpl.replace(/\{([A-Za-z0-9_]+)\}/g, function (_, nm) { return inputValue(nm); });
      a.style.display = ok ? '' : 'none';
      a.href = url;
      lk._resolved = ok ? url : path.textContent;
    };
    if (copyBtn) copyBtn.addEventListener('click', function () { copyText(lk._resolved, 'URL をコピーしました'); });
    lk._refresh();
  });

  /* ── 判断（decision）・選択肢・メモ・項目別・承認 ── */
  var decisions = [];
  $$('db-decision').forEach(function (dEl, di) {
    var id = dEl.id || ('d' + (di + 1));
    dEl.id = id;
    var d = {
      id: id, n: di + 1, el: dEl,
      title: dEl.getAttribute('title') || ('判断 ' + (di + 1)),
      tag: dEl.getAttribute('tag') || '要判断',
      ticket: dEl.getAttribute('ticket') || '',
      triage: dEl.getAttribute('triage') || '',
      opts: [], multi: false, per: [], approve: null, memoEl: null
    };
    /* ヘッダ（sticky）と部分コピー */
    var head = el('div', 'db-dhead');
    var l = el('div', 'l');
    var row = el('div', 'row');
    row.appendChild(txt('span', 'num', '判断 ' + d.n + ' · ' + d.tag));
    if (d.ticket) row.appendChild(txt('span', 'tk', d.ticket));
    l.appendChild(row);
    l.appendChild(txt('h2', null, d.title));
    head.appendChild(l);
    var cp = txt('button', 'db-copy1', 'この判断だけコピー');
    cp.type = 'button';
    cp.addEventListener('click', function () { copyText(decisionText(d), '判断 ' + d.n + ' をコピーしました'); });
    head.appendChild(cp);
    var bodyWrap = el('div', 'db-dbody');
    moveChildren(dEl, bodyWrap);
    dEl.appendChild(head);
    dEl.appendChild(bodyWrap);

    /* 選択肢 */
    var opts = $('db-options', dEl);
    if (opts) {
      d.multi = opts.hasAttribute('multi');
      var capRow = el('div', 'db-opts-cap');
      capRow.appendChild(txt('span', 'a', '選択肢'));
      capRow.appendChild(txt('span', 'b', d.multi ? '複数選択' : '単一選択'));
      opts.insertBefore(capRow, opts.firstChild);
      $$('db-option', opts).forEach(function (o) {
        var key = o.getAttribute('key') || '';
        var rec = o.hasAttribute('recommended');
        var label = o.getAttribute('label') || '';
        d.opts.push({ key: key, label: label, rec: rec, el: o });
        var headO = el('span', 'db-opt-head');
        headO.appendChild(el('span', d.multi ? 'db-box' : 'db-dot'));
        headO.appendChild(txt('span', 'db-opt-title', label));
        if (rec) headO.appendChild(txt('span', 'db-rec', '推奨'));
        o.insertBefore(headO, o.firstChild);
        o.setAttribute('role', d.multi ? 'checkbox' : 'radio');
        o.tabIndex = 0;
        function pick() {
          if (d.multi) {
            var cur = store.ans[d.id] || [];
            store.ans[d.id] = cur.indexOf(key) >= 0 ? cur.filter(function (k) { return k !== key; }) : cur.concat([key]);
          } else {
            store.ans[d.id] = store.ans[d.id] === key ? null : key;
          }
          if (key === 'other' && isPicked(d, 'other') && d.memoEl) d.memoEl.focus();
          save(); updateAll();
        }
        o.addEventListener('click', function (ev) {
          if (ev.target.closest('a, db-ref, button, input, textarea, db-link')) return;
          pick();
        });
        o.addEventListener('keydown', function (ev) {
          if (ev.key === ' ' || ev.key === 'Enter') {
            if (ev.target !== o) return;
            ev.preventDefault(); pick();
          }
        });
      });
    }
    /* メモ */
    var memo = $('db-memo', dEl);
    if (memo) {
      var ta = el('textarea');
      ta.placeholder = memo.getAttribute('placeholder') || 'メモ（任意）';
      ta.value = store.note[d.id] || '';
      ta.addEventListener('input', function () {
        store.note[d.id] = ta.value; save(); updateAll();
      });
      memo.appendChild(ta);
      d.memoEl = ta;
    }
    /* 項目別 */
    $$('db-per-item', dEl).forEach(function (pi) {
      var name = pi.getAttribute('name') || (d.id + '-items');
      var choices = (pi.getAttribute('choices') || '').split(/[,、／]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var items = [];
      $$('db-item', pi).forEach(function (it) {
        var key = it.getAttribute('key');
        var lwrap = el('div', 'db-it-l');
        lwrap.appendChild(txt('div', 'db-it-label', it.getAttribute('label') || key));
        if (it.getAttribute('detail')) lwrap.appendChild(txt('div', 'db-it-detail', it.getAttribute('detail')));
        var seg = el('div', 'db-seg');
        var btns = choices.map(function (c) {
          var b = txt('button', null, c);
          b.type = 'button';
          b.addEventListener('click', function () {
            var cur = (store.per[name] || {});
            cur[key] = cur[key] === c ? null : c;
            store.per[name] = cur;
            save(); updateAll();
          });
          seg.appendChild(b);
          return { c: c, b: b };
        });
        it.insertBefore(lwrap, it.firstChild);
        it.appendChild(seg);
        items.push({ key: key, label: it.getAttribute('label') || key, btns: btns });
      });
      d.per.push({ name: name, items: items });
    });
    /* 承認 */
    var ap = $('db-approve', dEl) || null;
    if (ap) {
      var lbA = ap.getAttribute('label') || '承認する';
      var noteA = el('div', 'db-ap-note');
      moveChildren(ap, noteA);
      var bA = txt('button', null, lbA);
      bA.type = 'button';
      bA.addEventListener('click', function () {
        store.appr[d.id] = !store.appr[d.id];
        save(); updateAll();
      });
      ap.appendChild(noteA);
      ap.appendChild(bA);
      d.approve = { el: ap, btn: bA, label: lbA, requiresAll: ap.getAttribute('requires-all') !== 'false' };
    }
    decisions.push(d);
  });
  function isPicked(d, key) {
    var v = store.ans[d.id];
    return d.multi ? (v || []).indexOf(key) >= 0 : v === key;
  }
  /* 選択肢・項目別だけを見た「答えたか」。approve は含めない（承認ボタン自身の
     活性判定に使う — 自分の選択肢が未回答のまま承認できてはいけないため） */
  function inputsAnswered(d) {
    if (d.opts.length) {
      var v = store.ans[d.id];
      return !!(d.multi ? (v && v.length) : v);
    }
    if (d.per.length) {
      return d.per.every(function (p) {
        return p.items.every(function (it) { return (store.per[p.name] || {})[it.key]; });
      });
    }
    return true; /* 承認だけの判断は「他に答えるものが無い」扱い */
  }
  function decisionAnswered(d) {
    if (d.opts.length || d.per.length) return inputsAnswered(d);
    if (d.approve) return !!store.appr[d.id];
    return false;
  }
  function optLabel(d, key) {
    var o = null;
    d.opts.some(function (x) { if (x.key === key) { o = x; return true; } return false; });
    return o ? o.label : key;
  }
  function decisionText(d) {
    var lines = ['## 判断 ' + d.n + ' · ' + d.title];
    if (d.opts.length) {
      var v = store.ans[d.id];
      if (d.multi) {
        if (v && v.length) {
          d.opts.forEach(function (o) {
            lines.push('- [' + (v.indexOf(o.key) >= 0 ? 'x' : ' ') + '] ' + o.label);
          });
        } else lines.push('選択: （未選択）');
      } else {
        lines.push('選択: ' + (v ? optLabel(d, v) : '（未選択）'));
      }
    }
    d.per.forEach(function (p) {
      p.items.forEach(function (it) {
        lines.push('- ' + it.label + ': ' + ((store.per[p.name] || {})[it.key] || '（未回答）'));
      });
    });
    if (d.approve) lines.push(store.appr[d.id] ? '承認: ' + d.approve.label + ' — 承認済み' : '承認: （未承認）');
    var note = (store.note[d.id] || '').trim();
    if (note) lines.push('メモ: ' + note);
    return lines.join('\n');
  }

  /* ── board chrome（topbar / レール / トリアージ / 提出） ── */
  var boardTitle = board ? (board.getAttribute('title') || doc.title) : doc.title;
  var paneDocs = [];
  var pane = $('db-pane');
  var main = null, topbar = null, rail = null, railScrim = null, paneScrim = null, restoredBanner = null;
  var tocLinks = {};

  if (board) {
    /* main で包む */
    main = el('div', 'db-main');
    var mainIn = el('div', 'db-main-in');
    main.appendChild(mainIn);
    board.parentNode.insertBefore(main, board);
    /* header */
    var header = el('header', 'db-header');
    var gate = board.getAttribute('gate');
    var round = parseInt(board.getAttribute('round') || '1', 10);
    if (gate) header.appendChild(txt('span', 'db-gate', gate + (round > 1 ? ' · ' + round + ' 回目' : '')));
    header.appendChild(txt('h1', null, boardTitle));
    var lede = $('db-lede', board);
    mainIn.appendChild(header);
    if (lede) header.appendChild(lede);
    /* 復元バナー（実際に保存内容がある時だけ） */
    restoredHasContent = decisions.some(function (d) { return decisionAnswered(d); }) ||
      Object.keys(store.note).some(function (k) { return (store.note[k] || '').trim(); });
    if (restoredHasContent) {
      restoredBanner = el('div', 'db-restored');
      restoredBanner.appendChild(txt('b', null, '復元しました'));
      restoredBanner.appendChild(txt('span', null, '前回この URL で選んだ内容とメモを戻しています。'));
      var x = txt('button', null, '×');
      x.type = 'button';
      x.addEventListener('click', function () { restoredBanner.remove(); });
      restoredBanner.appendChild(x);
      mainIn.appendChild(restoredBanner);
    }
    /* トリアージ */
    if (decisions.length) {
      var tri = el('section', 'db-triage');
      var th = el('div', 'db-triage-head');
      th.appendChild(txt('span', null, 'やること — ' + decisions.length + ' 問に答えて、末尾の提出欄からコピーして返信'));
      tri.appendChild(th);
      decisions.forEach(function (d) {
        var a = el('a');
        a.href = '#' + d.id;
        a.addEventListener('click', function (ev) { ev.preventDefault(); scrollToEl(d.el); });
        var ck = el('span', 'db-check');
        d._triCheck = ck;
        a.appendChild(ck);
        var mid = el('span', 't-mid');
        mid.appendChild(txt('span', 't-title', d.n + ' · ' + d.title));
        if (d.triage) mid.appendChild(txt('span', 't-sub', d.triage));
        a.appendChild(mid);
        a.appendChild(txt('span', 't-tag', d.tag));
        tri.appendChild(a);
      });
      var deps = $('db-deps', board);
      if (deps) tri.appendChild(deps);
      mainIn.appendChild(tri);
    }
    /* 残りの本文を main へ移す */
    Array.prototype.slice.call(board.childNodes).forEach(function (nd) { mainIn.appendChild(nd); });
    board.remove();

    /* topbar */
    topbar = el('div', 'db-topbar');
    var ti = el('div', 'db-topbar-in');
    if (board.getAttribute('date')) ti.appendChild(txt('span', 'db-topbar-date', board.getAttribute('date')));
    ti.appendChild(el('span', 'db-topbar-sep'));
    ti.appendChild(txt('span', 'db-topbar-title', boardTitle));
    var tocBtn = txt('button', 'db-tbtn db-tbtn-toc', '目次');
    tocBtn.type = 'button';
    ti.appendChild(tocBtn);
    topbar.appendChild(ti);
    doc.body.insertBefore(topbar, main);

    /* レール */
    rail = el('nav', 'db-rail');
    var rh = el('div', 'db-rail-head');
    rh.appendChild(txt('span', null, '判断ボード'));
    var rClose = txt('button', 'db-rail-close', '閉じる');
    rClose.type = 'button';
    rh.appendChild(rClose);
    rail.appendChild(rh);
    var rb = el('div', 'db-rail-body');
    if (decisions.length) {
      rb.appendChild(txt('div', 'db-rail-cap dec', '判断 — ' + decisions.length + ' 件'));
      decisions.forEach(function (d) {
        var a = el('a', 'db-toc');
        a.href = '#' + d.id;
        var ck = el('span', 'db-check');
        d._tocCheck = ck;
        a.appendChild(ck);
        a.appendChild(txt('span', 't', d.n + ' · ' + d.title));
        a.addEventListener('click', function (ev) { ev.preventDefault(); closeToc(); scrollToEl(d.el); });
        tocLinks[d.id] = a;
        rb.appendChild(a);
      });
    }
    if (sections.length) {
      rb.appendChild(txt('div', 'db-rail-cap doc', '資料'));
      sections.forEach(function (s) {
        var a = el('a', 'db-toc ref');
        a.href = '#' + s.el.id;
        a.appendChild(txt('span', 't', s.title));
        a.addEventListener('click', function (ev) {
          ev.preventDefault(); closeToc();
          openSection(s.el);
          setTimeout(function () { scrollToEl(s.el); }, 60);
        });
        tocLinks[s.el.id] = a;
        rb.appendChild(a);
      });
    }
    var subEl = $('db-submit');
    if (subEl) {
      subEl.id = subEl.id || 'submit';
      var a2 = el('a', 'db-toc submit');
      a2.href = '#' + subEl.id;
      a2.appendChild(txt('span', 't', '提出欄'));
      a2.addEventListener('click', function (ev) { ev.preventDefault(); closeToc(); scrollToEl(subEl); });
      tocLinks[subEl.id] = a2;
      rb.appendChild(a2);
    }
    rail.appendChild(rb);
    doc.body.appendChild(rail);
    railScrim = el('div', 'db-scrim');
    doc.body.appendChild(railScrim);
    function openToc() { rail.classList.add('open'); railScrim.classList.add('open', 'on'); }
    function closeToc() { rail.classList.remove('open'); railScrim.classList.remove('open', 'on'); }
    window._dbCloseToc = closeToc;
    tocBtn.addEventListener('click', openToc);
    rClose.addEventListener('click', closeToc);
    railScrim.addEventListener('click', closeToc);

    /* topbar: ペインのボタン + テーマ */
    if (pane) {
      $$('db-doc', pane).forEach(function (dc, i) {
        var b = txt('button', 'db-tbtn', dc.getAttribute('tab') || ('資料 ' + (i + 1)));
        b.type = 'button';
        b.addEventListener('click', function () { openPane(i); });
        ti.appendChild(b);
        paneDocs.push(dc);
      });
    }
    var themeBtn = txt('button', 'db-tbtn db-tbtn-theme', '');
    themeBtn.type = 'button';
    function applyTheme() {
      if (shared.theme === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', shared.theme);
      themeBtn.textContent = '表示: ' + ({ auto: '自動', light: '明', dark: '暗' })[shared.theme];
    }
    themeBtn.addEventListener('click', function () {
      shared.theme = ({ auto: 'light', light: 'dark', dark: 'auto' })[shared.theme] || 'auto';
      applyTheme(); save();
    });
    applyTheme();
    ti.appendChild(themeBtn);
  }

  /* ── チケットカード ── */
  $$('db-tickets').forEach(function (tks) {
    var list = $$('db-ticket', tks);
    list.forEach(function (tk, i) {
      var head = el('div', 'db-tk-head');
      if (i === 0) head.appendChild(txt('span', 'cap', '扱っているチケット — ' + list.length + ' 件'));
      if (tk.getAttribute('status')) head.appendChild(txt('span', 'st', tk.getAttribute('status')));
      if (tk.getAttribute('who')) head.appendChild(txt('span', 'who', '担当: ' + tk.getAttribute('who')));
      tk.insertBefore(head, tk.firstChild);
      var h2 = txt('h2', null, tk.getAttribute('name') || '');
      tk.insertBefore(h2, head.nextSibling);
    });
    if (pane) tks.appendChild(txt('div', 'db-tk-note', '全文は右のパネルで開けます（上の「チケット」ボタン）。'));
  });

  /* ── 右ペイン ── */
  var paneOpen = false, paneScrimEl = null;
  if (pane) {
    var tabs = el('div', 'db-pane-tabs');
    var body = el('div', 'db-pane-body');
    var tabBtns = [];
    paneDocs.forEach(function (dc, i) {
      var b = txt('button', 'db-ptab', dc.getAttribute('tab') || ('資料 ' + (i + 1)));
      b.type = 'button';
      b.addEventListener('click', function () { showTab(i); });
      tabBtns.push(b);
      tabs.appendChild(b);
      body.appendChild(dc);
    });
    var pClose = txt('button', 'db-pane-close', '閉じる');
    pClose.type = 'button';
    pClose.addEventListener('click', closePane);
    tabs.appendChild(pClose);
    pane.textContent = '';
    pane.appendChild(tabs);
    pane.appendChild(body);
    doc.body.appendChild(pane);
    paneScrimEl = el('div', 'db-panescrim');
    paneScrimEl.addEventListener('click', closePane);
    doc.body.appendChild(paneScrimEl);
    pane.setAttribute('data-open', 'off');
    var showTab = function (i) {
      paneDocs.forEach(function (dc, j) {
        dc.classList.toggle('on', i === j);
        tabBtns[j].classList.toggle('on', i === j);
      });
    };
    window._dbShowTab = showTab;
    window._dbPaneBody = body;
    showTab(0);
  }
  function openPane(tabIdx, anchorId) {
    if (!pane) return;
    paneOpen = true;
    pane.setAttribute('data-open', 'on');
    if (paneScrimEl) paneScrimEl.classList.add('on');
    if (main) main.setAttribute('data-pane', 'on');
    if (topbar) topbar.setAttribute('data-pane', 'on');
    toast.setAttribute('data-pane', 'on');
    if (tabIdx != null) window._dbShowTab(tabIdx);
    if (anchorId) {
      setTimeout(function () {
        var t = doc.getElementById(anchorId);
        var b = window._dbPaneBody;
        if (!t || !b) return;
        var top = t.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 12;
        b.scrollTop = top;
        highlight(t);
      }, 260);
    }
  }
  function closePane() {
    if (!pane) return;
    paneOpen = false;
    pane.setAttribute('data-open', 'off');
    if (paneScrimEl) paneScrimEl.classList.remove('on');
    if (main) main.removeAttribute('data-pane');
    if (topbar) topbar.removeAttribute('data-pane');
    toast.removeAttribute('data-pane');
  }
  function highlight(t) {
    t.removeAttribute('data-hl');
    void t.offsetWidth;
    t.setAttribute('data-hl', 'on');
    setTimeout(function () { t.removeAttribute('data-hl'); }, 1900);
  }

  /* ── db-ref: AC・資料・判断を 1 本で参照。押すとその場で開いて光る ── */
  $$('db-ref').forEach(function (ref) {
    ref.setAttribute('role', 'button');
    ref.tabIndex = 0;
    function go() {
      var to = ref.getAttribute('to');
      var t = to && doc.getElementById(to);
      if (!t) return;
      var dcDoc = t.closest('db-doc');
      if (dcDoc) {
        openPane(paneDocs.indexOf(dcDoc), to);
        return;
      }
      var sec = t.closest('db-section');
      if (sec) openSection(sec);
      setTimeout(function () { scrollToEl(t); highlight(t); }, sec ? 80 : 0);
    }
    ref.addEventListener('click', go);
    ref.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
    });
  });

  /* ── 提出欄 ── */
  var submitEl = $('db-submit');
  var outPre = null;
  if (submitEl) {
    var sh = el('div', 'db-sub-head');
    sh.appendChild(txt('h2', null, '提出欄'));
    var btns = el('div', 'db-sub-btns');
    var copyAll = txt('button', 'db-sub-copy', '全部コピー');
    copyAll.type = 'button';
    copyAll.addEventListener('click', function () { copyText(fullText()); });
    var reset = txt('button', 'db-sub-ghost', '選択をクリア');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      store.ans = {}; store.note = {}; store.per = {}; store.appr = {};
      decisions.forEach(function (d) { if (d.memoEl) d.memoEl.value = ''; });
      save(); updateAll();
      flash('クリアしました');
    });
    btns.appendChild(copyAll);
    btns.appendChild(reset);
    sh.appendChild(btns);
    submitEl.appendChild(sh);
    submitEl.appendChild(txt('p', 'db-sub-note',
      '選んだ内容がここに溜まります。決まったものから順に返して構いません（各判断の「この判断だけコピー」）。'));
    /* ticket が 2 種類以上あるときだけ、ticket ごとのコピー */
    var tickets = [];
    decisions.forEach(function (d) {
      if (d.ticket && tickets.indexOf(d.ticket) < 0) tickets.push(d.ticket);
    });
    if (tickets.length >= 2) {
      var tkRow = el('div', 'db-sub-tks');
      tickets.forEach(function (tk) {
        var b = txt('button', 'db-sub-ghost', '「' + tk + '」のぶんだけコピー');
        b.type = 'button';
        b.addEventListener('click', function () {
          var ds = decisions.filter(function (d) { return d.ticket === tk; });
          copyText('# 判断ボードの回答 — ' + boardTitle + '（' + tk + '）\n\n' +
            ds.map(decisionText).join('\n\n'));
        });
        tkRow.appendChild(b);
      });
      submitEl.appendChild(tkRow);
    }
    outPre = el('pre');
    outPre.id = 'out';
    submitEl.appendChild(outPre);
  }
  function fullText() {
    var done = decisions.filter(decisionAnswered).length;
    return '# 判断ボードの回答 — ' + boardTitle + '\n\n' +
      decisions.map(decisionText).join('\n\n') +
      '\n\n---\n回答済み ' + done + ' / ' + decisions.length;
  }

  /* ── 全 UI の再計算 ── */
  function updateAll() {
    decisions.forEach(function (d) {
      var on = decisionAnswered(d);
      if (d._triCheck) d._triCheck.classList.toggle('on', on);
      if (d._tocCheck) d._tocCheck.classList.toggle('on', on);
      d.opts.forEach(function (o) {
        o.el.setAttribute('data-sel', isPicked(d, o.key) ? 'on' : 'off');
        o.el.setAttribute('aria-checked', isPicked(d, o.key) ? 'true' : 'false');
      });
      d.per.forEach(function (p) {
        p.items.forEach(function (it) {
          var cur = (store.per[p.name] || {})[it.key];
          it.btns.forEach(function (cb) { cb.b.classList.toggle('on', cb.c === cur); });
        });
      });
      if (d.approve) {
        var ready = !d.approve.requiresAll || decisions.every(function (x) {
          return x === d ? inputsAnswered(x) : decisionAnswered(x);
        });
        d.approve.btn.disabled = !ready && !store.appr[d.id];
        d.approve.el.setAttribute('data-on', store.appr[d.id] ? 'on' : 'off');
        d.approve.btn.textContent = store.appr[d.id] ? d.approve.label + ' — 承認済み（押すと取り消し）' : d.approve.label;
      }
    });
    if (outPre) outPre.textContent = fullText();
  }

  /* ── scroll spy ── */
  var spyTargets = [];
  decisions.forEach(function (d) { spyTargets.push(d.el); });
  sections.forEach(function (s) { spyTargets.push(s.el); });
  if (submitEl) spyTargets.push(submitEl);
  var railRefreshT = null;
  function railRefresh() { clearTimeout(railRefreshT); railRefreshT = setTimeout(onScroll, 80); }
  function topH() {
    return topbar ? topbar.offsetHeight : 0;
  }
  function onScroll() {
    var line = topH() + 15;
    var cur = null;
    spyTargets.forEach(function (t) {
      if (t.offsetParent === null) return;
      var r = t.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) cur = t.id;
    });
    Object.keys(tocLinks).forEach(function (id) {
      tocLinks[id].classList.toggle('on', id === cur);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  function scrollToEl(t) {
    var top = t.getBoundingClientRect().top + window.scrollY - topH() - 8;
    try { window.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, top); }
  }

  /* ── Esc: ドロワー → ペイン の順で閉じる ── */
  window.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (rail && rail.classList.contains('open')) { window._dbCloseToc(); return; }
    if (paneOpen) closePane();
  });

  /* ── 未知の db-* タグ: 既定の表示に落として、そのことを画面に出す ── */
  $$('*').forEach(function (e) {
    var tag = e.tagName.toLowerCase();
    if (tag.indexOf('db-') === 0 && KNOWN.indexOf(tag) < 0) {
      e.classList.add('db-unknown');
      e.setAttribute('data-tag', tag);
    }
  });
  /* db-embed は reason 必須（生成側チェックの二重化。無ければ画面に出す） */
  $$('db-embed').forEach(function (e) {
    if (!e.getAttribute('reason')) {
      e.classList.add('db-unknown');
      e.setAttribute('data-tag', 'db-embed（reason 無し）');
    }
  });

  /* ── 仕上げ: sticky 位置の実測・初期状態の反映・#nojs 撤去 ── */
  refreshBound();
  updateAll();
  onScroll();
  function measure() {
    if (topbar) root.style.setProperty('--top1', topbar.offsetHeight + 'px');
  }
  measure();
  window.addEventListener('resize', measure);
  var nojs = doc.getElementById('nojs');
  if (nojs) nojs.remove();

  /* ── mermaid: bundle（beautiful-mermaid）が同梱されていれば SVG へ。
     戻り値が Promise でも文字列でも受ける。失敗したらソースを見せる（黙って消さない）。 ── */
  (function renderMermaid() {
    if (!window.__renderMermaidSVG) return;
    $$('pre.mermaid').forEach(function (pm) {
      var fail = function () { pm.style.display = 'block'; };
      try {
        Promise.resolve(window.__renderMermaidSVG(pm.textContent)).then(function (svg) {
          svg = String(svg)
            .replace(/@import\s+url\([^)]*\);?/g, '')
            .replace(/font-family:\s*'Inter'[^;}]*/g, 'font-family: var(--sans)')
            .replace(/--bg:\s*#[0-9A-Fa-f]{3,8}/, '--bg:var(--card2)')
            .replace(/--fg:\s*#[0-9A-Fa-f]{3,8}/, '--fg:var(--ink)');
          var d = el('div', 'mmwrap');
          d.innerHTML = svg;
          pm.replaceWith(d);
        }, fail);
      } catch (e) { fail(); }
    });
  })();
})();
