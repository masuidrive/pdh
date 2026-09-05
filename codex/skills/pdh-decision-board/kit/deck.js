/* pdh-decision-board kit — deck.js
   2 軸デッキの動作（採番・面の移動・右下の地図・端の三角・押して送る・自動縮小）。
   規則の本体は ../html.md。列は .deck-col、面は .p、地図は #map を前提にする。 */
(function () {
  var deck = document.getElementById("deck");
  var cols = Array.prototype.slice.call(deck.querySelectorAll(".deck-col"));
  var panes = Array.prototype.slice.call(deck.querySelectorAll(".p"));

  // --- 採番 — 地図・現在地・移動より «先» に行う -------------------------
  // 書き手は列・面の id を書かない。手で振ると、面を 1 つ足した瞬間に以降が全部ずれる。
  // 書いてあっても DOM 順で上書きする — 出所を 2 つにすると、地図と #p3-2 直接参照が
  // どちらの番号を指しているのか分からなくなる。
  cols.forEach(function (col, ci) {
    col.id = "c" + ci;
    Array.prototype.slice.call(col.querySelectorAll(".p")).forEach(function (p, pi) {
      p.id = "p" + ci + "-" + (pi + 1);
    });
  });

  // 指された要素を含む «面»。デッキの移動は面の単位で行う。
  function paneOf(el) { return (el && el.closest && el.closest(".p")) || el; }

  // ⚠ 原寸表示を «閉じる» リンクは、図ではなく «面» を指す。図を指すと、脇へ float した
  //    図の左端を画面の左へ合わせようとブラウザが横へ送り、閉じた瞬間に次の列へ飛ぶ
  //    （2026-08-18 に実測）。これは deck.js の移動ではなく «ブラウザの anchor 処理» なので、
  //    JS では止められない — 行き先そのものを面にする以外に手がない。
  //    ⚠ 採番の «後» でなければ面の id がまだ無い。
  Array.prototype.slice.call(document.querySelectorAll(".shot-zoom")).forEach(function (z) {
    var href = z.getAttribute("href") || "";
    var fig = href.charAt(0) === "#" ? document.getElementById(href.slice(1)) : null;
    var pane = fig && fig.closest ? fig.closest(".p") : null;
    if (pane && pane.id) z.setAttribute("href", "#" + pane.id);
  });

  // テキストの採番。TreeWalker で文字ノードだけを書き換える（innerHTML の置換は
  // <b> などの入れ子を壊す）。
  function rewriteText(root, pattern, replace) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (pattern.test(node.nodeValue)) {
        node.nodeValue = node.nodeValue.replace(pattern, replace);
      }
    }
  }

  // 「主線 ✦」→「主線 n / N」。N は列の 1 段目の総数 = 列数。
  var topCount = cols.length;
  var mainlineSeq = 0;
  rewriteText(deck, /主線 ✦/g, function () {
    mainlineSeq += 1;
    return "主線 " + mainlineSeq + " / " + topCount;
  });

  // 「↓ 下に N 段」の N は、その面の «下に実際にある面の数» から書く。
  // 書き手が数を書くと、面を足したときにずれる（N や 0 を書いておけばよい）。
  panes.forEach(function (p) {
    var col = p.closest(".deck-col");
    var list = Array.prototype.slice.call(col.querySelectorAll(".p"));
    var below = list.length - 1 - list.indexOf(p);
    rewriteText(p, /↓ 下に\s*[0-9０-９N]*\s*段/g, function () {
      return "↓ 下に " + below + " 段";
    });
  });

  // 地図 — 横 = 面、縦 = 深さ。枡は <a href> なので JS が無効でも目次として働く。
  var map = document.getElementById("map");
  cols.forEach(function (col) {
    var mc = document.createElement("div");
    mc.className = "mapcol";
    Array.prototype.slice.call(col.querySelectorAll(".p")).forEach(function (p) {
      var a = document.createElement("a");
      a.className = "mapcell";
      a.href = "#" + p.id;
      a.dataset.for = p.id;
      a.setAttribute("aria-label", p.id);
      mc.appendChild(a);
    });
    map.appendChild(mc);
  });
  var cells = {};
  Array.prototype.slice.call(map.querySelectorAll(".mapcell")).forEach(function (a) {
    cells[a.dataset.for] = a;
  });

  // threshold 0.6 は移動途中に 2 面が同時選択されにくい実測由来の目安（html.md）。
  var current = panes[0];
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      current = e.target;
      Object.keys(cells).forEach(function (k) { cells[k].classList.remove("here"); });
      if (cells[e.target.id]) cells[e.target.id].classList.add("here");
      updateEdges();
    });
  }, { threshold: 0.6 });
  panes.forEach(function (p) { io.observe(p); });

  function colIndex() {
    for (var i = 0; i < cols.length; i++) if (cols[i].contains(current)) return i;
    return 0;
  }
  function paneIndexIn(ci) {
    var list = Array.prototype.slice.call(cols[ci].querySelectorAll(".p"));
    return { list: list, idx: list.indexOf(current) };
  }

  var edges = {
    l: document.querySelector(".edge-l"), r: document.querySelector(".edge-r"),
    u: document.querySelector(".edge-u"), d: document.querySelector(".edge-d")
  };
  function updateEdges() {
    var ci = colIndex(); var p = paneIndexIn(ci);
    edges.l.classList.toggle("on", ci > 0);
    edges.r.classList.toggle("on", ci < cols.length - 1);
    edges.u.classList.toggle("on", p.idx > 0);
    edges.d.classList.toggle("on", p.idx >= 0 && p.idx < p.list.length - 1);
  }

  // 横に動いたら、離れた列を一番上へ戻す。来る列をその場で戻すと目の前で内容が飛ぶ。
  // 初回読み込みでは戻さない — #p3-2 のような直接参照を壊すため（html.md）。
  var lastCol = 0, movedOnce = false;
  deck.addEventListener("scroll", function () {
    var ci = Math.round(deck.scrollLeft / deck.clientWidth);
    if (ci !== lastCol) {
      if (movedOnce && cols[lastCol]) cols[lastCol].scrollTo({ top: 0, behavior: "instant" });
      lastCol = ci;
    }
    movedOnce = true;
  }, { passive: true });

  function goCol(d) {
    var ci = colIndex() + d;
    if (ci < 0 || ci >= cols.length) return;
    cols[ci].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }
  function goPane(d) {
    var ci = colIndex(); var p = paneIndexIn(ci);
    var ni = p.idx + d;
    if (ni < 0 || ni >= p.list.length) return;
    p.list[ni].scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    // ⚠ Space は «フォーカスしている部品を押す» キーである。面送りにも使うと、
    //    選択肢を選んだ瞬間に隣の面へ動き、選べたかどうかを確かめられない
    //    （2026-08-17、独立 reviewer が検出）。押す場所の除外一覧を使い回す —
    //    一覧を 2 つ持つと、片方だけ育って同じ事故が戻る。
    //    矢印は部品の上でも面送りでよい（部品が矢印を使わないため）。
    if (e.key === " " && isUI(t)) return;
    switch (e.key) {
      case "ArrowRight": goCol(1); break;
      case "ArrowLeft": goCol(-1); break;
      case "ArrowDown": case "PageDown": case " ": goPane(1); break;
      case "ArrowUp": case "PageUp": goPane(-1); break;
      default: return;
    }
    e.preventDefault();
  });

  updateEdges();

  // 開いたときの #p3-2 直接参照。id は上の採番で «いま» 付いたばかりなので、
  // ブラウザの読み込み時 anchor 処理には間に合っていない — 自分で移動する。
  // ⚠ deck の中の対象だけ。#zoom-… のような fixed の overlay（原寸表示）は
  //    :target の CSS が開くのが正しく、面を動かしてはいけない。
  if (location.hash) {
    var target = null;
    try { target = document.querySelector(location.hash); } catch (_) { target = null; }
    // ⚠ 送るのは «面» であって、指された要素そのものではない。要素へ送ると、面の中で
    //    右寄りにある要素（脇へ float した画像など）の左端を画面の左へ合わせようとして、
    //    デッキが 1 列ぶん横へ動く（2026-08-18、拡大を閉じると次の列へ飛んだ）。
    if (target && deck.contains(target)) paneOf(target).scrollIntoView({ block: "start", inline: "start" });
  }

  // --- 画面を押して送る -------------------------------------------------
  // 左 1/4 = 前の面、右 1/4 = 次の面、中央 2/4 の上下 1/4 = 前後の段。
  // 中央は何もしない（文字を選んだり、回答フォームを触ったりするための場所）。
  var ZONE = { l: "l", r: "r", u: "u", d: "d" };

  function zoneAt(x, y) {
    var w = window.innerWidth, h = window.innerHeight;
    if (x < w * 0.25) return ZONE.l;
    if (x > w * 0.75) return ZONE.r;
    if (y < h * 0.25) return ZONE.u;
    if (y > h * 0.75) return ZONE.d;
    return null;
  }
  function canGo(z) { return !!(z && edges[z] && edges[z].classList.contains("on")); }

  // 回答フォーム・地図・リンクの上では送らない（押した先の操作を奪わないため）。
  // ⚠ 選択肢のカードは <button> ではなく role="button" の div である。
  //    ここに入れ忘れると «選ぶと同時に次の面へ動く»（2026-08-15 に実際に踏んだ）。
  //    カードは面の幅いっぱいに広がるため、左右 1/4 の送りゾーンに必ず重なる。
  // ⚠ summary も同じ理由で要る。折りたたみの見出しは行いっぱいに広がるので、
  //    左右 1/4 に必ず掛かり、押しても開かず面が送られる（2026-08-17 に AC 原文が
  //    スライド版で開けなかった）。details 側は入れない — 開いた本文まで除外すると
  //    送りゾーンが面のほとんどで消える。
  function isUI(t) {
    return !!(t && t.closest &&
      t.closest('a, button, textarea, input, select, label, summary, [role="button"], .answer-choice, .answer-set, .map'));
  }

  function paint(z, target) {
    Object.keys(edges).forEach(function (k) {
      edges[k].classList.toggle("hot", k === z && canGo(k) && !isUI(target));
    });
  }

  document.addEventListener("mousemove", function (e) {
    var z = zoneAt(e.clientX, e.clientY);
    // ⚠ e.target ではなく «その座標にある要素» を見る。回答フォームの上に居るのに
    //    三角が «押せば動く» と言ってしまうのを防ぐ（押しても動かないため）。
    var at = document.elementFromPoint(e.clientX, e.clientY);
    paint(z, at);
    document.body.style.cursor = (canGo(z) && !isUI(at)) ? "pointer" : "";
  }, { passive: true });

  document.addEventListener("mouseleave", function () {
    paint(null, null); document.body.style.cursor = "";
  });

  document.addEventListener("click", function (e) {
    if (isUI(e.target)) return;
    if (String(window.getSelection() || "")) return;   // 文字を選んでいる最中は送らない
    var z = zoneAt(e.clientX, e.clientY);
    if (!canGo(z)) return;
    e.preventDefault();
    if (z === ZONE.l) goCol(-1);
    else if (z === ZONE.r) goCol(1);
    else if (z === ZONE.u) goPane(-1);
    else goPane(1);
    paint(null, null);
  });
})();

/* 面ごとの自動縮小 — 中身が 1 画面に入りきらない面だけ縮める。
   offsetHeight は transform の影響を受けないので、1 回測れば必要な倍率が確定する。 */
(function () {
  var MIN = 0.55;   // これ以下は最後の逃げ道。ふだんは面を割って避ける
  var panes = Array.prototype.slice.call(document.querySelectorAll(".deck .p"));
  // 組んだときの高さ。⚠ offsetHeight は flex に押し込まれて «面の高さ» に丸められる
  // ことがある。溢れている中身の高さは scrollHeight でしか取れない（下余白は自分で足す）。
  function laidOutHeight(inn) {
    var cs = getComputedStyle(inn);
    var need = inn.scrollHeight;
    if (inn.scrollHeight > inn.clientHeight) need += parseFloat(cs.paddingBottom) || 0;
    return Math.max(need, inn.offsetHeight);
  }

  function fitAll() {
    panes.forEach(function (p) {
      var inn = p.firstElementChild;
      var have = p.clientHeight;
      if (!have) return;
      // ⚠ 中身の幅は deck.css で 1/s へ広げてある（横まで縮むのを打ち消すため）。
      //    倍率を変えると折り返しが変わり、組んだ高さも変わるので測り直す。
      //    4 回で足りることを実測で確かめている。落ち着いたら早く抜ける。
      var s = 1, raw = 1;
      for (var i = 0; i < 4; i++) {
        inn.style.setProperty("--s", s.toFixed(4));
        var need = laidOutHeight(inn);
        if (!need) return;
        raw = have / need;
        var next = Math.max(MIN, Math.min(1, raw));
        if (Math.abs(next - s) < 0.005) { s = next; break; }
        s = next;
      }
      inn.style.setProperty("--s", s.toFixed(4));
      p.dataset.fit = raw >= 1 ? "1" : raw.toFixed(3);
      // 下限に当たったら、切らずにスクロールさせる（黙って切れるのを防ぐ）
      p.classList.toggle("spill", raw < MIN);
    });
  }
  // 狭い画面のカード表示用に、見出し行の語を各セルへ写す（手で複製しない）。
  (function label() {
    document.querySelectorAll(".deck .tw table").forEach(function (t) {
      var hs = Array.prototype.map.call(t.querySelectorAll("thead th"), function (th) {
        return th.textContent.trim();
      });
      if (!hs.length) return;
      t.querySelectorAll("tbody tr").forEach(function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, i) {
          td.setAttribute("data-label", hs[i] || "");
        });
      });
    });
  })();

  // ページを開いたまま URL の hash だけが変わった場合も追う。
  // 読み込み時の hash はブラウザが処理するが、hashchange は自分で受ける必要がある。
  // ⚠ deck の中の対象だけ動かす。#zoom-…（原寸表示の overlay、deck の外）は :target の
  //    CSS が開閉するので、ここで scrollIntoView すると閉じるたびに面が飛ぶ。
  window.addEventListener("hashchange", function () {
    var t = null;
    try { t = document.querySelector(location.hash || "#none"); } catch (_) { t = null; }
    if (t && t.closest(".deck")) (t.closest(".p") || t).scrollIntoView({ block: "start", inline: "start" });
  });

  // ⚠ 折りたたみを開くと中身の高さが変わる。開く前に測った縮小率のままだと、
  //    増えた本文が .p { overflow: hidden } で切れて «無い» ように見える。
  //    toggle は bubble しないので capture で受ける。
  document.addEventListener("toggle", function (e) {
    if (e.target && e.target.tagName === "DETAILS") fitAll();
  }, true);

  window.__fitAll = fitAll;
  if (document.readyState === "complete") fitAll();
  else window.addEventListener("load", fitAll);
  var t;
  window.addEventListener("resize", function () {
    clearTimeout(t); t = setTimeout(fitAll, 120);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
})();
