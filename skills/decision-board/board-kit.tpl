<!doctype html>
<!-- decision-board v2 shell.
     markers: __TITLE__ / __CONTENT__ / __RUNTIME__ / __MERMAID__ (build-board.sh が置換する)
     中身は db-* コンポーネントで書く。CSS / JS はこのシェルと board-runtime.js が持つ — 書き直さないこと。 -->
<html lang="ja">
<head>
__TITLE__
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<style>
/* ── tokens ──
   有彩色は「選択中 / 推奨 / ⚠ / 判断ラベル」だけに使う。他はグレー系。 */
:root{color-scheme:light dark;
  --bg:#f4f3ef; --card:#fff; --card2:#faf9f5; --ink:#191a1c; --dim:#63676c;
  --line:#e3e2db; --rule:#eceae3;
  --doc:#1d5fa4; --dec:#8f4f0d; --decbg:#fcf2e6; --warn:#a32a1e; --ok:#1c6b45;
  --chip:#efeee7; --rail:#efeee9; --optline:#c9c7bb; --opthover:#efeade;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic",Meiryo,sans-serif;
  --top1:45px; /* topbar 高さ。runtime が実測で上書きする */
  --db-w:830px; /* 本文の幅上限。日本語 45〜50 字/行。広い画面では下の media query が広げる */
  --db-pane-w:400px; /* 右ペインの幅。掴んで動かすと runtime が上書きし、board 横断で保存する */
  --cast1:rgba(0,0,0,.21); --cast2:rgba(0,0,0,.08); /* 本文がペインへ落とす影 */
}
/* 本文幅は «上限» であって固定値ではない。広い画面では余白を捨てず段階的に広げる。
   board 側で変えたいときは content の先頭で :root{--db-w:...} を 1 行上書きすればよい
   （右ペインを開くと .db-main が margin-right される分だけ実効幅は縮む。max-width なので溢れない） */
@media (min-width:1500px){:root{--db-w:1000px}}
@media (min-width:1900px){:root{--db-w:1180px}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#141619; --card:#1c1f23; --card2:#22262b; --ink:#e8e9ea; --dim:#9aa1a9;
  --line:#2f343a; --rule:#282d33; --doc:#7db4ea; --dec:#e2a869; --decbg:#33240f;
  --warn:#f08a7d; --ok:#6fc79b; --chip:#262b31; --rail:#191c20; --optline:#4d555e; --opthover:#262b31;
  --cast1:rgba(0,0,0,.55); --cast2:rgba(0,0,0,.22);}}
:root[data-theme="dark"]{
  --bg:#141619; --card:#1c1f23; --card2:#22262b; --ink:#e8e9ea; --dim:#9aa1a9;
  --line:#2f343a; --rule:#282d33; --doc:#7db4ea; --dec:#e2a869; --decbg:#33240f;
  --warn:#f08a7d; --ok:#6fc79b; --chip:#262b31; --rail:#191c20; --optline:#4d555e; --opthover:#262b31;
  --cast1:rgba(0,0,0,.55); --cast2:rgba(0,0,0,.22);}

*{box-sizing:border-box}
html{overflow-x:hidden}
html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font-family:var(--sans);font-size:15px;line-height:1.65;text-wrap:pretty;-webkit-text-size-adjust:100%}
a{color:var(--doc)} a:hover{color:var(--dec)}
button{font:inherit;color:inherit}
img{max-width:100%;height:auto;display:block}
code{font-family:var(--mono);font-size:.86em;background:var(--card2);border:1px solid var(--rule);border-radius:4px;padding:0 4px}

/* ── JS 無効（CSP に止められた場合）のフォールバック ──
   #nojs は既定で表示し、runtime の最後で消す。走れば消え、止められれば残る。
   その場合も db-* の中身は light DOM のテキストとしてそのまま読める。 */
#nojs{display:block;margin:14px auto;max-width:var(--db-w);border:1.5px solid var(--warn);border-radius:10px;
  padding:12px 15px;font-size:13.5px;line-height:1.7;background:var(--card)}
#nojs strong{color:var(--warn)}

/* JS 前の素の状態でも読めるよう、主要 db-* をブロック表示にしておく */
db-board,db-decision,db-section,db-appendix,db-options,db-option,db-note,db-facts,db-row,
db-dataset,db-record,db-cell,db-reveal,db-chips,db-shot,db-variant,db-card,db-stack,db-prose,db-lede,
db-tickets,db-ticket,db-deps,db-pane,db-doc,db-markdown,db-submit,db-memo,db-per-item,db-item,
db-approve,db-embed,db-meta,db-weak{display:block}
db-badge,db-ref,db-val,db-link,db-col{display:inline}
db-col{color:var(--dim);font-size:12px}
db-markdown>script[type="text/markdown"]{display:none}
/* JS が止められた場合の読みやすさ: 属性に入っている見出し・ラベルを ::before で描く。
   runtime が動けば <html class="js"> になり、こちらは消えて本組みに置き換わる */
html:not(.js) db-decision{border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0;background:var(--card)}
html:not(.js) db-decision::before{content:"判断 — " attr(title);display:block;font-size:18px;font-weight:700;margin-bottom:8px}
html:not(.js) db-option{border:1px solid var(--optline);border-radius:10px;padding:10px 12px;margin:6px 0}
html:not(.js) db-option::before{content:attr(key) ": " attr(label);display:block;font-weight:700}
html:not(.js) db-section{border:1px solid var(--line);border-radius:10px;padding:13px;margin:8px 0;background:var(--card)}
html:not(.js) db-section::before{content:"資料 — " attr(title);display:block;font-size:16px;font-weight:700;margin-bottom:6px}
html:not(.js) db-appendix::before{content:attr(title);display:block;font-weight:700;margin:10px 0 4px}
html:not(.js) db-ticket::before{content:attr(name) "（" attr(status) "）";display:block;font-size:17px;font-weight:700;margin-bottom:6px}
html:not(.js) db-row{margin:3px 0}
html:not(.js) db-row::before{content:attr(name) " — ";font-weight:700;color:var(--dim);font-size:.92em}
html:not(.js) db-prose[label]::before{content:attr(label);display:block;font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
html:not(.js) db-reveal[label]::before{content:"▸ " attr(label);display:block;font-size:12.5px;font-weight:700;color:var(--dim);margin:6px 0 2px}
html:not(.js) db-reveal[chip]::before{content:"▸ " attr(chip);display:block;font-size:12.5px;font-weight:700;color:var(--dim);margin:6px 0 2px}
html:not(.js) db-shot::before{content:attr(tag) " " attr(label) "（画像スロット " attr(w) "×" attr(h) "）";display:block;font-size:12px;color:var(--dim)}
html:not(.js) db-note[label]::before{content:attr(label);display:block;font-weight:700;font-size:13px}
html:not(.js) db-item::before{content:attr(label) " — " attr(detail);display:block;font-weight:700;font-size:13.5px}
html:not(.js) db-col{display:none}
html:not(.js) db-cell{display:inline;padding-right:10px}
html:not(.js) db-record{display:block;border-bottom:1px solid var(--rule);padding:3px 0}
html:not(.js) db-pane{border-top:2px solid var(--line);margin-top:20px;padding-top:10px}
html:not(.js) db-doc::before{content:"（参考全文: " attr(tab) " — ビューアの制限で整形表示できません）";display:block;font-size:12px;color:var(--dim)}
/* JS が動いたら（<html class="js">）、runtime が組み立てるまでの畳み対象を隠して flash を防ぐ */
.js db-reveal:not([data-open])>*{display:none}
.js db-pane:not([data-open]){display:none}
.js db-appendix:not([data-open])>db-section{display:none}

/* ── 生成 chrome: topbar ── */
.db-topbar{position:sticky;top:0;z-index:45;background:var(--card);border-bottom:1px solid var(--line);margin-left:262px}
.db-topbar-in{max-width:var(--db-w);margin:0 auto;padding:8px 16px;display:flex;align-items:center;gap:10px}
.db-topbar-date{font-family:var(--mono);font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums;flex:none}
.db-topbar-sep{width:1px;height:11px;background:var(--line);flex:none}
.db-topbar-title{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.db-tbtn{border:1px solid var(--line);background:var(--card2);border-radius:8px;padding:4px 11px;font-size:12px;cursor:pointer;color:var(--dim);white-space:nowrap;flex:none}
.db-tbtn:hover{color:var(--ink);border-color:var(--dim)}
.db-tbtn-toc{display:none}
@media (max-width:700px){.db-tbtn-theme{display:none}}

/* ── 生成 chrome: 左レール（目次） ── */
.db-rail{position:fixed;left:0;top:0;bottom:0;width:262px;background:var(--rail);border-right:1px solid var(--line);overflow-y:auto;z-index:40}
.db-rail-head{padding:0 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;position:sticky;top:0;background:var(--rail);border-bottom:1px solid var(--line);min-height:45px;z-index:1}
.db-rail-head>span{font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--dim)}
.db-rail-close{display:none;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer}
.db-rail-body{padding:10px 9px 26px;display:flex;flex-direction:column;gap:2px}
.db-rail-cap{font-size:10px;font-weight:700;letter-spacing:.12em;padding:6px 9px 5px}
.db-rail-cap.dec{color:var(--dec)} .db-rail-cap.doc{color:var(--dim);padding-top:14px}
.db-toc{display:flex;gap:9px;align-items:center;padding:7px 9px;border-radius:7px;font-size:13px;color:var(--dim);text-decoration:none;transition:background .14s ease,color .14s ease}
.db-toc:hover{background:var(--chip);color:var(--ink)}
.db-toc.ref{font-size:12.5px;padding:6px 9px}
.db-toc.on{background:var(--chip);font-weight:700;color:var(--ink)}
.db-toc.submit{margin-top:14px;font-weight:700}
.db-toc>span.t{flex:1;min-width:0}
.db-check{width:18px;height:18px;border-radius:99px;border:1.5px dashed var(--line);flex:none;position:relative}
.db-check.on{background:var(--ok);border:1.5px solid var(--ok)}
.db-check.on::after{content:"";position:absolute;left:5.5px;top:3px;width:5px;height:9px;border-right:2px solid var(--card);border-bottom:2px solid var(--card);transform:rotate(40deg)}
.db-scrim{display:none}

/* ── main 配置 ── */
.db-main{margin-left:262px;min-height:100vh;padding:0 0 48px}
.db-main-in{max-width:var(--db-w);margin:0 auto;padding:16px 16px 0;display:flex;flex-direction:column;gap:13px}
.db-header{display:flex;flex-direction:column;gap:13px}
.db-gate{display:inline-flex;align-self:flex-start;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:700;background:var(--decbg);color:var(--dec)}
.db-header h1{margin:0;font-size:26px;line-height:1.32;letter-spacing:-.01em}
db-lede{margin:0;font-size:15.5px;line-height:1.75}

/* 復元バナー */
.db-restored{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--ok);border-radius:9px;background:var(--card);font-size:13px}
.db-restored b{color:var(--ok)} .db-restored span{flex:1;color:var(--dim)}
.db-restored button{border:none;background:transparent;color:var(--dim);cursor:pointer;font-size:17px;line-height:1}

/* ── 生成 chrome: トリアージ ── */
.db-triage{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.db-triage-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 15px;border-bottom:1px solid var(--rule)}
.db-triage-head span{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
.db-triage a{display:flex;gap:11px;align-items:flex-start;padding:11px 15px;border-top:1px solid var(--rule);text-decoration:none;color:inherit}
.db-triage a:first-of-type{border-top:none}
.db-triage a:hover{background:var(--card2)}
.db-triage .t-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.db-triage .t-title{font-size:14.5px;font-weight:700;display:block}
.db-triage .t-sub{font-size:12.5px;color:var(--dim);display:block}
.db-triage .t-tag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;background:var(--decbg);color:var(--dec);white-space:nowrap;margin-top:2px}
.db-triage .db-check{margin-top:2px}
db-deps{border-top:1px solid var(--rule);padding:11px 15px;display:flex;flex-direction:column;gap:5px;background:var(--card2);font-size:13.5px;line-height:1.7}
db-deps::before{content:"順番の依存";font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}

/* ── チケットカード ── */
db-tickets{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:15px;display:flex;flex-direction:column;gap:12px;scroll-margin-top:calc(var(--top1) + 8px)}
db-ticket{display:flex;flex-direction:column;gap:10px}
db-ticket+db-ticket{border-top:1px solid var(--rule);padding-top:14px}
.db-tk-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.db-tk-head .cap{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
.db-tk-head .st{display:inline-flex;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;background:var(--chip)}
.db-tk-head .who{font-size:12px;color:var(--dim)}
db-ticket h2{margin:0;font-size:18px}
.db-tk-note{font-size:12.5px;color:var(--dim)}
/* 原文への入口。チップと同じ «押せるもの» の見た目に揃える（開く UI を増やさない） */
.db-tk-open{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.db-openbtn{cursor:pointer;border:1px solid var(--line);color:var(--dim);background:var(--card2);border-radius:99px;
  padding:3px 11px;font-size:12px;font-weight:700;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
.db-openbtn:hover{background:var(--chip);border-color:var(--optline);color:var(--ink)}

/* ── facts（語 + 説明の行） ── */
db-facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;align-items:baseline}
db-facts>db-row{display:contents}
db-row>.db-k{font-size:11.5px;font-weight:700;color:var(--dim);white-space:nowrap}
db-row>.db-v{min-width:0}
db-row>.db-k.warn{color:var(--warn)}
@media (max-width:560px){
  db-facts{display:flex;flex-direction:column;gap:8px}
  db-facts>db-row{display:block}
  db-facts db-row>.db-k{display:block;margin-bottom:1px}
}

/* ── 判断カード ── */
db-decision{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:clip;scroll-margin-top:calc(var(--top1) + 8px)}
.db-dhead{position:sticky;top:var(--top1);z-index:20;display:flex;gap:12px;align-items:flex-start;padding:11px 15px;background:var(--card2);border-bottom:1px solid var(--rule)}
.db-dhead .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.db-dhead .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.db-dhead .num{font-size:11px;font-weight:700;color:var(--dec)}
.db-dhead .tk{font-size:11.5px;color:var(--dim)}
.db-dhead h2{margin:0;font-size:18px;line-height:1.4}
.db-copy1{flex:none;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;white-space:nowrap}
.db-copy1:hover{border-color:var(--dim)}
.db-dbody{padding:14px 15px;display:flex;flex-direction:column;gap:13px}

/* prose ブロック */
db-prose{display:flex;flex-direction:column;gap:4px}
db-prose>.db-plabel{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
db-prose>.db-pbody{margin:0;font-size:14px;line-height:1.7}
db-prose[emphasis]>.db-pbody{font-size:15.5px;font-weight:700;line-height:1.6}
db-prose[accent]{border-left:2px solid var(--dec);padding:2px 0 2px 12px}
db-prose[accent]>.db-plabel{color:var(--dec)}
db-prose[accent="check"]{border-left-color:var(--doc)}
db-prose[accent="check"]>.db-plabel{color:var(--doc)}
db-prose[accent]>.db-pbody{color:var(--dim)}
db-prose[accent]>.db-pbody strong{color:var(--ink)}

/* ── 選択肢 ── */
db-options{display:flex;flex-direction:column;gap:8px}
.db-opts-cap{display:flex;align-items:baseline;gap:9px}
.db-opts-cap .a{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
.db-opts-cap .b{font-size:12px;color:var(--dim)}
db-option{cursor:pointer;text-align:left;width:100%;border:1.5px solid var(--optline);background:var(--card);border-radius:10px;padding:12px 13px;display:flex;flex-direction:column;gap:9px;transition:background .14s ease,border-color .14s ease}
db-option:hover{border-color:var(--dec);background:var(--opthover)}
db-option[data-sel="on"]{border-color:var(--dec);background:var(--decbg);box-shadow:inset 0 0 0 1px var(--dec)}
.db-opt-head{display:flex;align-items:center;gap:9px;width:100%}
.db-opt-title{flex:1;font-size:15px;font-weight:700}
.db-dot{width:16px;height:16px;border-radius:99px;border:1.5px solid var(--line);background:var(--card);flex:none}
db-option[data-sel="on"] .db-dot{background:var(--dec);border-color:var(--dec);box-shadow:inset 0 0 0 3.5px var(--card)}
.db-box{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--line);background:var(--card);flex:none;position:relative}
db-option[data-sel="on"] .db-box{background:var(--dec);border-color:var(--dec)}
db-option[data-sel="on"] .db-box::after{content:"";position:absolute;left:4.5px;top:1.5px;width:5px;height:9px;border-right:2px solid var(--card);border-bottom:2px solid var(--card);transform:rotate(40deg)}
.db-rec{font-size:11px;font-weight:700;background:var(--dec);color:#fff;border-radius:99px;padding:2px 9px;white-space:nowrap}
db-option>db-row{display:block;position:relative;padding-left:106px;font-size:13.5px;line-height:1.6}
db-option db-row>.db-k{position:absolute;left:0;top:1.5px;width:96px;letter-spacing:.05em;font-size:10.5px;white-space:normal}
@media (max-width:980px){
  db-option>db-row{padding-left:0}
  db-option db-row>.db-k{position:static;width:auto;display:block;margin-bottom:2px}
}
db-weak{display:block;font-size:13px;line-height:1.6;color:var(--dim);border-top:1px solid var(--line);padding-top:8px;width:100%}
db-weak::before{content:"⚠ 弱点: ";color:var(--warn);font-weight:700}
db-memo textarea{width:100%;min-height:64px;resize:vertical;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font:inherit;font-size:14px;background:var(--card2);color:var(--ink)}

/* per-item */
db-per-item{display:flex;flex-direction:column;gap:8px}
db-item{border:1px solid var(--optline);border-radius:10px;padding:10px 13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--card)}
db-item .db-it-l{flex:1;min-width:200px}
db-item .db-it-label{font-size:14px;font-weight:700}
db-item .db-it-detail{font-size:12.5px;color:var(--dim)}
.db-seg{display:flex;gap:6px;flex:none}
.db-seg button{border:1px solid var(--line);background:var(--card2);border-radius:99px;padding:3px 11px;font-size:12px;font-weight:700;cursor:pointer;color:var(--dim);transition:background .14s ease,border-color .14s ease,color .14s ease}
.db-seg button:hover{border-color:var(--dim);color:var(--ink)}
.db-seg button.on{background:var(--dec);border-color:var(--dec);color:#fff}

/* 承認 */
db-approve{border:1.5px solid var(--optline);border-radius:10px;padding:12px 13px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--card)}
db-approve .db-ap-note{flex:1;min-width:200px;font-size:13px;color:var(--dim)}
db-approve button{border:1px solid var(--dec);background:var(--dec);color:#fff;border-radius:9px;padding:7px 14px;font-size:13.5px;font-weight:700;cursor:pointer;white-space:nowrap}
db-approve button:disabled{background:var(--chip);border-color:var(--line);color:var(--dim);cursor:not-allowed}
db-approve[data-on="on"]{border-color:var(--ok)}
db-approve[data-on="on"] button{background:var(--ok);border-color:var(--ok)}

/* ── チップと折りたたみ ── */
db-chips{display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--line);padding-top:12px}
.db-chips-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.db-chips-row .cap{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}
.db-chip{cursor:pointer;border:1px solid var(--line);color:var(--dim);background:var(--card2);border-radius:99px;padding:3px 11px;font-size:12px;font-weight:700;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
.db-chip:hover{border-color:var(--dim);color:var(--ink);background:var(--chip)}
.db-chip.on{background:var(--ink);border-color:var(--ink);color:var(--card)}

/* 三角マーカー: 「1 つのものを開く」の共通アフォーダンス */
.db-tri{display:inline-block;width:0;height:0;margin-right:7px;position:relative;top:1px;
  border-left:5px solid var(--dim);border-top:4px solid transparent;border-bottom:4px solid transparent;flex:none}
[data-open="on"]>.db-trig .db-tri,[data-open="on"]>.db-shead .db-tri,[data-open="on"]>.db-apx-card .db-tri{
  border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--dim);border-bottom:0;top:-1px}

db-reveal{display:flex;flex-direction:column;gap:0}
db-reveal>.db-trig{cursor:pointer;border:none;background:transparent;padding:0;text-align:left;display:flex;align-items:center;font-size:13.5px;font-weight:700;color:var(--ink)}
db-reveal>.db-trig .db-quiet{color:var(--dim);font-weight:400;margin-right:6px}
db-reveal[data-open="on"]>.db-trig{margin-bottom:8px}
db-reveal>.db-body{display:none}
db-reveal[data-open="on"]>.db-body{display:flex;flex-direction:column;gap:10px;animation:dbIn .2s ease-out}
db-reveal[boxed]>.db-trig{border:1px solid var(--line);border-radius:9px;background:var(--card2);padding:10px 13px;margin-bottom:0}
db-reveal[boxed][data-open="on"]>.db-trig{border-radius:9px 9px 0 0;border-bottom:none}
db-reveal[boxed]>.db-body{border:1px solid var(--line);border-radius:0 0 9px 9px;background:var(--card2);padding:0 13px 13px}
db-reveal[chip]{margin-left:18px}
db-reveal[chip]>.db-trig{display:none}
db-reveal[chip]>.db-body{border:1px solid var(--line);border-radius:9px;background:var(--card2);padding:11px 13px;font-size:13.5px;line-height:1.65}
db-reveal[chip][tone="warn"]>.db-body{border-color:var(--warn)}
@media (max-width:700px){db-reveal[chip]{margin-left:9px}}
/* 長いパネルの sticky ヘッダ（付録 · ◯◯ + 畳む）。runtime が高さで自動付与 */
.db-phead{position:sticky;top:calc(var(--top1) + 44px);z-index:5;display:flex;align-items:center;gap:8px;margin:-11px -13px 9px;padding:8px 13px;background:var(--card2);border-bottom:1px solid var(--line);border-radius:8px 8px 0 0}
.db-phead span{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim);flex:1}
.db-phead button{border:1px solid var(--line);background:var(--card);border-radius:7px;padding:3px 9px;font-size:11.5px;cursor:pointer;color:var(--dim);white-space:nowrap;flex:none;display:flex;align-items:center}
@keyframes dbIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}

/* ── note / badge / card / stack ── */
db-note{border:1px solid var(--line);border-radius:9px;padding:11px 13px;background:var(--card2);font-size:14px;line-height:1.65}
db-note[tone="warn"]{border-color:var(--warn);background:var(--card)}
db-note[tone="ok"]{border-color:var(--ok);background:var(--card)}
db-note[tone="quiet"]{border-style:dashed;color:var(--dim)}
db-note>.db-nlabel{display:block;font-weight:700;font-size:13px;margin-bottom:4px}
db-note[tone="warn"]>.db-nlabel{color:var(--warn)}
db-note[tone="ok"]>.db-nlabel{color:var(--ok)}
db-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:700;background:var(--chip);border:1px solid var(--line);color:var(--dim)}
db-badge[tone="warn"]{color:var(--warn);border-color:var(--warn);background:transparent}
db-badge[tone="ok"]{color:var(--ok);border-color:var(--ok);background:transparent}
db-badge[tone="acc"]{color:var(--dec);border-color:transparent;background:var(--decbg)}
db-card{border:1px solid var(--line);border-radius:9px;padding:11px 13px;background:var(--card2)}
db-stack{display:flex;flex-direction:column;gap:9px}
db-stack[dir="row"]{flex-direction:row;flex-wrap:wrap;align-items:baseline}
db-meta{font-size:12px;color:var(--dim);border-top:1px solid var(--rule);padding-top:11px}
.db-tail{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--rule);padding-top:11px}
.db-tail>.cap{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim)}

/* ── dataset（広い画面=表 / 狭い画面=カード） ── */
db-dataset{display:flex;flex-direction:column;gap:6px}
db-dataset>.db-ds-cap{font-size:12.5px;color:var(--dim)}
.db-ds{border:1px solid var(--line);border-radius:9px;overflow-x:auto}
.db-ds-t{display:grid;min-width:min-content;font-size:13.5px;font-variant-numeric:tabular-nums}
.db-ds-t>.h{padding:8px 11px;border-bottom:1px solid var(--rule);font-size:11.5px;color:var(--dim);background:var(--card2);font-weight:700;white-space:nowrap}
.db-ds-t>.h.num{text-align:right}
.db-ds-rec{display:contents}
.db-ds-rec>span{padding:8px 11px;border-bottom:1px solid var(--rule);white-space:nowrap}
.db-ds-rec>span.wrap{white-space:normal;min-width:180px}
.db-ds-rec>span.num{text-align:right;font-family:var(--mono)}
.db-ds-rec.last>span{border-bottom:none}
.db-ds-rec.pick>span{background:var(--decbg);font-weight:700}
.db-ds-rec.warn>span .db-wv{color:var(--warn)}
.db-ds-rec>span>.k{display:none}
.db-pickb{font-size:11px;color:var(--dec);font-weight:700;margin-left:6px}
@media (max-width:700px){
  .db-ds{overflow:visible;border:none}
  .db-ds-t{display:flex;flex-direction:column;gap:9px;min-width:0}
  .db-ds-t>.h{display:none}
  .db-ds-rec{display:grid;grid-template-columns:1fr;gap:5px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--card)}
  .db-ds-rec.pick{border-color:var(--dec);background:var(--decbg)}
  .db-ds-rec.pick>span{background:none}
  .db-ds-rec>span{padding:0;border:none;white-space:normal;text-align:left}
  .db-ds-rec>span.num{text-align:left}
  .db-ds-rec>span>.k{display:block;font-size:10.5px;font-weight:700;color:var(--dim)}
}

/* ── shot ── */
db-shot{display:flex;flex-direction:column;gap:8px;margin:0}
db-shot .db-shot-tag{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
db-shot .db-shot-tag .b{font-size:11px;font-weight:700;background:var(--card2);border:1px solid var(--line);border-radius:99px;padding:2px 8px;color:var(--doc)}
db-shot[tone="warn"] .db-shot-tag .b{border-color:var(--warn);color:var(--warn)}
db-shot .db-shot-tag .m{font-family:var(--mono);font-size:12px;color:var(--dim);word-break:break-all}
db-shot .db-ph{border:1.5px dashed var(--line);border-radius:9px;background:var(--card2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:var(--dim);text-align:center;padding:10px}
db-shot[tone="warn"] .db-ph{border-color:var(--warn)}
db-shot .db-ph .dim{font-family:var(--mono);font-size:12.5px}
db-shot .db-ph .lb{font-size:12.5px;font-weight:700}
db-shot .db-ph .sub{font-size:11.5px}
db-shot img{border:1px solid var(--line);border-radius:9px}
db-shot .db-cap{margin:0;font-size:13.5px;line-height:1.65;border-left:2px solid var(--line);padding-left:11px}
db-shot[tone="warn"] .db-cap{border-left-color:var(--warn);color:var(--warn)}
.db-vars{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
db-variant .vl{font-size:11px;font-weight:700;color:var(--dim);margin-bottom:4px;display:block}

/* ── 資料セクションと付録 ── */
db-appendix{display:flex;flex-direction:column;gap:13px}
db-appendix>.db-apx-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 15px;display:flex;gap:12px;align-items:center;cursor:pointer;margin-top:5px}
db-appendix>.db-apx-card .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
db-appendix>.db-apx-card .t{font-size:15px;font-weight:700}
db-appendix>.db-apx-card .s{font-size:13px;line-height:1.6;color:var(--dim)}
db-appendix[data-open="off"]>db-section{display:none}
db-appendix[data-open="on"]>db-section{display:block;animation:dbIn .26s ease-out both}
db-section{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:clip;scroll-margin-top:calc(var(--top1) + 8px)}
.db-shead{position:sticky;top:var(--top1);z-index:6;display:flex;gap:12px;align-items:flex-start;padding:13px 15px;cursor:pointer;background:var(--card)}
db-section[data-open="on"]>.db-shead{background:var(--card2);border-bottom:1px solid var(--rule)}
.db-shead .l{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.db-shead h2{margin:0;font-size:14.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.db-shead .sum{margin:0;font-size:13.5px;line-height:1.6;color:var(--dim)}
db-section[data-open="on"] .db-shead .sum{display:none}
db-section>.db-sbody{display:none}
db-section[data-open="on"]>.db-sbody{display:flex;flex-direction:column;gap:10px;padding:13px 15px 15px;animation:dbIn .2s ease-out}
.db-openb{flex:none;border:1px solid var(--line);background:var(--card2);border-radius:8px;padding:4px 11px;font-size:12px;cursor:pointer;color:var(--dim);white-space:nowrap;display:flex;align-items:center}

/* ── 提出 ── */
db-submit{scroll-margin-top:calc(var(--top1) + 8px);margin-top:18px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px;display:flex;flex-direction:column;gap:11px}
.db-sub-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.db-sub-head h2{margin:0;font-size:17px}
.db-sub-btns{display:flex;gap:8px;flex-wrap:wrap}
.db-sub-copy{border:1px solid var(--dec);background:var(--dec);color:#fff;border-radius:9px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
.db-sub-ghost{border:1px solid var(--line);background:var(--card2);color:var(--dim);border-radius:9px;padding:7px 14px;font-size:13px;cursor:pointer;white-space:nowrap}
db-submit pre{margin:0;padding:13px;border:1px solid var(--line);border-radius:9px;background:var(--card2);font-family:var(--mono);font-size:12.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto}
.db-sub-note{margin:0;font-size:13.5px;color:var(--dim)}
.db-sub-tks{display:flex;gap:8px;flex-wrap:wrap}

/* ── 右ペイン ── */
db-pane{position:fixed;right:0;top:0;bottom:0;width:var(--db-pane-w);background:var(--card);border-left:1px solid var(--line);z-index:65;display:flex;flex-direction:column;transform:translateX(101%);transition:transform .22s ease;box-shadow:-8px 0 30px rgba(0,0,0,.12)}
db-pane[data-open="on"]{transform:none}
.db-pane-tabs{flex:none;display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid var(--line);background:var(--card2)}
.db-ptab{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:5px 12px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--dim)}
.db-ptab.on{background:var(--ink);border-color:var(--ink);color:var(--card)}
.db-pane-close{margin-left:auto;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--dim)}
.db-pane-body{flex:1;overflow-y:auto;padding:14px 16px 44px;overscroll-behavior:contain}
db-doc{display:none}
db-doc.on{display:block}
.db-panescrim{display:none}
@media (min-width:1200px){
  .db-main[data-pane="on"]{margin-right:var(--db-pane-w)}
  .db-topbar[data-pane="on"]{margin-right:var(--db-pane-w)}
  .db-toast[data-pane="on"]{margin-left:calc(var(--db-pane-w) / -2)}
  /* 本文を押し縮めるモードでは、ペインは «下に敷かれた資料» である。
     ペイン側が外へ影を落とすと «上に浮いたパネル» に見えるので、向きを逆にして
     本文が落とす影をペインの左端に描く。覆うモード（1199px 以下）は本当に上に来るので
     元の影のまま — 見た目が «どちらが上か» を正しく言うようにする */
  db-pane[data-open="on"]{box-shadow:none}
  db-pane[data-open="on"]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:26px;z-index:3;pointer-events:none;
    background:linear-gradient(to right,var(--cast1),var(--cast2) 45%,transparent)}
}
@media (max-width:1199px){
  .db-panescrim.on{display:block;position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:60}
}
@media (max-width:700px){db-pane{width:100%;border-left:none}.db-pane-grip{display:none}}

/* ペイン幅の drag。掴む帯は 9px（枠より広い当たり判定）、見える線は hover / drag のときだけ */
.db-pane-grip{position:absolute;left:-4px;top:0;bottom:0;width:9px;z-index:4;cursor:col-resize;
  background:transparent;border:none;padding:0;touch-action:none}
.db-pane-grip::before{content:"";position:absolute;left:3px;top:0;bottom:0;width:3px;border-radius:2px;
  background:transparent;transition:background .15s ease}
.db-pane-grip:hover::before,.db-pane-grip:focus-visible::before,html.db-resizing .db-pane-grip::before{background:var(--optline)}
.db-pane-grip:focus-visible{outline:none}
html.db-resizing{cursor:col-resize}
html.db-resizing db-pane{transition:none}
html.db-resizing .db-pane-body,html.db-resizing .db-main{user-select:none}
[data-hl]{animation:dbHl 1.8s ease-out}
@keyframes dbHl{0%,55%{background:var(--decbg);box-shadow:0 0 0 5px var(--decbg);border-radius:3px}100%{background:transparent;box-shadow:none}}

/* ── markdown 描画（db-markdown が生成） ── */
.db-md{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;font-size:13.5px;line-height:1.8;display:flex;flex-direction:column;gap:11px}
.db-md h2{margin:0;font-size:16.2px;font-weight:700}
.db-md h3{margin:5px 0 0;font-size:13.5px;font-weight:700;border-bottom:1px solid var(--rule);padding-bottom:5px}
.db-md h4{margin:0;font-size:13.5px;font-weight:700}
.db-md p{margin:0}
.db-md ul,.db-md ol{margin:0;padding-left:19px;display:flex;flex-direction:column;gap:7px}
.db-md blockquote{margin:0;border-left:2px solid var(--line);padding-left:12px;color:var(--dim);display:flex;flex-direction:column;gap:5px}
.db-md .fm{font-family:var(--mono);font-size:11.5px;line-height:1.7;color:var(--dim);background:var(--card2);border:1px solid var(--rule);border-radius:7px;padding:9px 11px}
.db-md pre{margin:0;padding:10px 12px;border:1px solid var(--rule);border-radius:7px;background:var(--card2);font-family:var(--mono);font-size:12px;line-height:1.7;overflow-x:auto}
.db-md pre code{border:none;background:none;padding:0}
.db-md .tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:7px}
.db-md table{border-collapse:collapse;font-size:12.5px;min-width:100%}
.db-md th,.db-md td{padding:7px 11px;border-top:1px solid var(--rule);text-align:left;vertical-align:top}
.db-md thead th{border-top:none;background:var(--card2);font-weight:700;font-size:12px;color:var(--dim)}
.db-md hr{border:none;border-top:1px solid var(--rule);margin:4px 0;width:100%}

/* ── ref / link / embed / unknown ── */
db-ref{color:var(--doc);font-weight:700;border-bottom:1px dotted var(--doc);cursor:pointer;font-size:.95em}
db-embed{border:1px dashed var(--line);border-radius:9px;padding:11px 13px}
.db-unknown{display:block;border:1px dashed var(--line);border-radius:9px;padding:9px 12px;margin:4px 0}
.db-unknown::before{content:"この節は既定の表示です（未対応の部品: " attr(data-tag) "）";display:block;font-size:11px;color:var(--dim);margin-bottom:5px}

/* ── mermaid ── */
pre.mermaid{margin:0;padding:12px;border:1px solid var(--rule);border-radius:9px;background:var(--card2);font-family:var(--mono);font-size:12px;overflow-x:auto}
.mmwrap{overflow-x:auto;border:1px solid var(--rule);border-radius:9px;background:var(--card2);padding:8px}
.mmwrap svg{display:block;margin:0 auto}
figure{margin:0;display:flex;flex-direction:column;gap:8px}
figure figcaption{font-size:13.5px;line-height:1.65;border-left:2px solid var(--line);padding-left:11px}

/* ── toast ── */
.db-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:80;background:var(--ink);color:var(--bg);padding:8px 15px;border-radius:99px;font-size:13px;font-weight:700;opacity:0;transition:opacity .2s;pointer-events:none}
.db-toast.on{opacity:1}

/* ── 入力（base_url など） ── */
.db-in{display:flex;flex-direction:column;gap:3px;min-width:0}
.db-in .lb{font-size:10.5px;font-weight:700;letter-spacing:.08em;color:var(--dim)}
.db-in input{border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-family:var(--mono);font-size:13px;background:var(--card);color:var(--ink);width:100%}
db-text-input,db-number-input{display:inline-flex;min-width:0;vertical-align:bottom}
db-text-input{flex:1;min-width:140px}
db-number-input{width:110px}
db-val{font-family:var(--mono);font-size:.95em}
.db-inrow{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
db-link .db-lk-path{font-family:var(--mono);font-size:12px;word-break:break-all}
db-link a{font-size:12px;margin-left:6px}
db-link .db-lk-copy{border:1px solid var(--line);background:var(--card2);border-radius:7px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--dim);margin-left:6px}

/* ── モバイル（≤980px）: レールがドロワーに ── */
@media (max-width:980px){
  .db-rail{top:auto;right:0;width:auto;height:74vh;border-right:none;border-top:1px solid var(--line);border-radius:16px 16px 0 0;transform:translateY(103%);transition:transform .24s;box-shadow:0 -12px 40px rgba(0,0,0,.2);z-index:70}
  .db-rail.open{transform:translateY(0)}
  .db-rail-close{display:block}
  .db-main{margin-left:0}
  .db-topbar{margin-left:0}
  .db-tbtn-toc{display:block}
  .db-scrim.on{display:block;position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:60}
}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
@media print{
  .db-rail,.db-scrim,db-pane,.db-panescrim,.db-topbar,.db-toast,#nojs{display:none!important}
  .db-main{margin:0}
  db-reveal>.db-body{display:flex!important}
  db-appendix[data-open="off"]>db-section{display:block!important}
  db-section>.db-sbody{display:flex!important}
}
</style>
</head>
<body>
<div id="nojs">
  <strong>このページの仕組み（選択・集計・コピー）が動いていません。</strong>
  開いているビューアが script を止めている可能性があります。ブラウザで直接開くか、
  そのディレクトリで <code>python3 -m http.server</code> を実行して開き直してください。
  このままでも本文は読めます。<strong>判断は、会話に「判断 1: A」「判断 2: 起票候補 1 と 3」のように
  番号と記号で直接答えても構いません。</strong>
</div>
__CONTENT__
<script>
__MERMAID__
</script>
<script>
__RUNTIME__
</script>
</body>
</html>
