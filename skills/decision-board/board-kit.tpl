__TITLE__
<style>
  :root{
    --ink:#16130d; --ink-2:#413a2f; --ink-3:#6b6156; --rule:#e0d9cc;
    --bg:#faf8f4; --card:#ffffff; --raise:#f3efe6;
    --acc:#a8641a; --acc-soft:#f6ead9; --acc-ink:#ffffff;
    --ok:#2f6b3f; --ok-soft:#e6f0e4;
    --bad:#a32b28; --bad-soft:#f8e6e2;
    --warn:#8a6a12; --warn-soft:#f7eecd;
    --decide-bg:#f7f0e3;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root{
      --ink:#e8edf3; --ink-2:#b0b5bc; --ink-3:#858b92; --rule:#373d44;
      --bg:#1d232a; --card:#242a31; --raise:#2c3239;
      --acc:#e0b085; --acc-soft:#363637; --acc-ink:#1d232a;
      --ok:#86c98f; --ok-soft:#2a3737;
      --bad:#f0938c; --bad-soft:#373237;
      --warn:#ddbe62; --warn-soft:#343634;
      --decide-bg:#272a2f;}}
  :root[data-theme="dark"]{
      --ink:#e8edf3; --ink-2:#b0b5bc; --ink-3:#858b92; --rule:#373d44;
      --bg:#1d232a; --card:#242a31; --raise:#2c3239;
      --acc:#e0b085; --acc-soft:#363637; --acc-ink:#1d232a;
      --ok:#86c98f; --ok-soft:#2a3737;
      --bad:#f0938c; --bad-soft:#373237;
      --warn:#ddbe62; --warn-soft:#343634;
      --decide-bg:#272a2f;}
  :root[data-theme="light"]{
      --ink:#16130d; --ink-2:#413a2f; --ink-3:#6b6156; --rule:#e0d9cc;
      --bg:#faf8f4; --card:#ffffff; --raise:#f3efe6;
      --acc:#a8641a; --acc-soft:#f6ead9; --acc-ink:#ffffff; --ok:#2f6b3f; --ok-soft:#e6f0e4;
      --bad:#a32b28; --bad-soft:#f8e6e2; --warn:#8a6a12; --warn-soft:#f7eecd;
      --decide-bg:#f7f0e3;}
  html{scroll-behavior:smooth;}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);
       line-height:1.75;font-size:16px;padding:clamp(20px,4vw,56px) clamp(16px,4vw,40px);}
  .shell{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:30px;}
  @media (min-width:1080px){ .shell{grid-template-columns:236px minmax(0,1fr);gap:44px;align-items:start;} }
  main{max-width:880px;margin:0;display:flex;flex-direction:column;gap:32px;min-width:0;}

  /* ── 目次 ── */
  /* モバイル既定: 画面外のドロワー。z-index で本文の上に重ねる */
  nav.toc{font-size:13.5px;line-height:1.55;
          position:fixed;inset:0 auto 0 0;z-index:100;
          width:min(300px,82vw);max-width:82vw;
          background:var(--card);border-right:1px solid var(--rule);
          padding:66px 16px calc(24px + env(safe-area-inset-bottom));
          overflow-y:auto;overscroll-behavior:contain;
          transform:translateX(-101%);transition:transform .22s ease;
          box-shadow:0 0 40px rgba(0,0,0,.22);}
  nav.toc.open{transform:none;}
  body.toc-open{overflow:hidden;}

  .toc-backdrop{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.42);
                opacity:0;pointer-events:none;transition:opacity .22s ease;}
  .toc-backdrop.open{opacity:1;pointer-events:auto;}

  .toc-toggle{position:fixed;z-index:101;left:12px;top:12px;
              width:44px;height:44px;padding:0;border-radius:11px;
              display:flex;align-items:center;justify-content:center;
              background:var(--card);color:var(--acc);border:1px solid var(--rule);
              box-shadow:0 2px 10px rgba(0,0,0,.13);}
  .toc-toggle span{display:block;width:19px;height:2px;background:currentColor;
                   position:relative;border-radius:2px;}
  .toc-toggle span::before,.toc-toggle span::after{content:"";position:absolute;left:0;
      width:19px;height:2px;background:currentColor;border-radius:2px;}
  .toc-toggle span::before{top:-6px;} .toc-toggle span::after{top:6px;}
  .toc-toggle .badge{position:absolute;right:-5px;top:-5px;min-width:18px;height:18px;
      border-radius:999px;background:var(--acc);color:var(--acc-ink);font-size:10.5px;font-weight:700;
      display:flex;align-items:center;justify-content:center;padding:0 4px;}
  .swipe-hint{display:none;}

  @media (min-width:1080px){
    nav.toc{position:sticky;inset:auto;top:24px;width:auto;max-width:none;
            transform:none;background:transparent;border-right:0;box-shadow:none;
            padding:0;max-height:calc(100vh - 48px);z-index:auto;}
    .toc-toggle,.toc-backdrop{display:none;}
    body.toc-open{overflow:auto;}
  }
  @media (max-width:1079px){
    body{padding-top:68px;}
    .swipe-hint{display:block;font-size:12px;color:var(--ink-3);
                margin:6px 0 0;padding-left:9px;line-height:1.5;}
  }
  @media (prefers-reduced-motion:reduce){
    html{scroll-behavior:auto;}
    nav.toc,.toc-backdrop{transition:none;}
  }
  nav.toc h4{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);
             margin:0 0 10px;font-weight:700;}
  nav.toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;}
  nav.toc a{display:flex;gap:8px;align-items:baseline;text-decoration:none;color:var(--ink-2);
            padding:6px 9px;border-radius:7px;border-left:3px solid transparent;}
  nav.toc a:hover{background:var(--raise);color:var(--ink);}
  nav.toc a:focus-visible{outline:2px solid var(--acc);outline-offset:1px;}
  nav.toc a.is-decide{color:var(--acc);font-weight:700;border-left-color:var(--acc);}
  nav.toc a.is-decide:hover{background:var(--raise);}
  nav.toc a.is-decide:hover{opacity:.85;}
  nav.toc .mark{font-size:10px;font-variant-numeric:tabular-nums;flex:none;min-width:13px;}
  nav.toc a.done .mark{color:var(--ok);}
  nav.toc .sep{height:1px;background:var(--rule);margin:9px 2px;}
  .toc-hint{font-size:12px;color:var(--ink-3);margin-top:12px;padding-left:9px;}

  /* ── 判断セクション（手を動かす場所）と 資料セクション（読む場所）の区別 ── */
  section.decide{background:var(--decide-bg);border:1px solid var(--rule);
                 border-left:4px solid var(--acc);border-radius:14px;
                 padding:clamp(16px,2.6vw,24px);scroll-margin-top:20px;}
  section.decide > h2{color:var(--acc);display:flex;align-items:center;gap:9px;}
  section.decide .card{border-color:var(--rule);}
  section:not(.decide){scroll-margin-top:20px;}
  .kicker{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.1em;
          padding:3px 8px;margin-right:9px;border-radius:5px;background:var(--acc);color:var(--acc-ink);}
  .kicker.read{background:transparent;color:var(--ink-3);border:1px solid var(--rule);}
  /* ── 判断の導入: 症状 → 仕組み → 選択肢 の順を «構造で» 強制する ── */
  /* 判断の見出し行: 「判断 N · <どの ticket の話か>」 */
  .dhead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
  .dnum{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.1em;
        color:var(--acc);text-transform:uppercase;flex:none;}
  .dtk{font-size:13px;font-weight:700;color:var(--ink-2);
       display:flex;align-items:baseline;gap:7px;}
  .dtk::before{content:"";width:5px;height:5px;border-radius:50%;
               background:var(--acc);flex:none;transform:translateY(-2px);}
  /* 決めてほしいこと（1 行） */
  .sym{font-size:19px;line-height:1.6;margin:0;letter-spacing:-.01em;text-wrap:pretty;}
  .sym strong{color:var(--acc);}

  /* なぜ聞くのか — 「決めてほしい」と「念のため確認」を «種別として» 分ける */
  .askwhy{display:flex;flex-direction:column;gap:6px;border-radius:9px;padding:12px 15px;
          border:1px solid var(--rule);}
  .askwhy.need{border-color:var(--acc);}
  .askwhy.check{border-style:dashed;}
  .askwhy .kind{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:700;
                letter-spacing:.08em;}
  .askwhy.need .kind{color:var(--acc);}
  .askwhy.check .kind{color:var(--ink-3);}
  .askwhy p{font-size:14px;color:var(--ink-2);line-height:1.7;}
  .askwhy p strong{color:var(--ink);}

  /* 経緯: 元の問題 → やろうとしたこと → 起きたこと → 期限 */
  .story{display:flex;flex-direction:column;gap:0;
         background:var(--raise);border-radius:9px;padding:4px 16px;}
  .story .row{display:grid;grid-template-columns:minmax(96px,auto) 1fr;gap:4px 16px;
              padding:11px 0;border-bottom:1px solid var(--rule);align-items:baseline;}
  .story .row:last-child{border-bottom:none;}
  .story .rk{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--ink-3);
             white-space:nowrap;}
  .story .rv{font-size:14.5px;color:var(--ink-2);line-height:1.75;}
  .story .rv strong{color:var(--ink);}
  @media (max-width:620px){ .story .row{grid-template-columns:1fr;} }

  /* 選択肢の «軸» を固定する — 利用者 / コスト / 取り返し */
  .axes{display:flex;flex-direction:column;gap:0;margin-top:2px;}
  .axes .ax{display:grid;grid-template-columns:minmax(104px,auto) 1fr;gap:3px 14px;
            padding:7px 0;border-bottom:1px dashed var(--rule);align-items:baseline;}
  .axes .ax:last-child{border-bottom:none;}
  .axes .ak{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--ink-3);white-space:nowrap;}
  .axes .av{font-size:14px;color:var(--ink-2);line-height:1.7;}
  .axes .av strong{color:var(--ink);}
  @media (max-width:620px){ .axes .ax{grid-template-columns:1fr;} }

  /* 決めないとどうなるか */
  .blocking{font-size:13.5px;color:var(--ink-2);display:flex;gap:9px;align-items:baseline;}
  .blocking .k{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--acc);white-space:nowrap;}
  .blocking strong{color:var(--ink);}
  .why{display:flex;flex-direction:column;gap:5px;
       background:var(--raise);border-radius:9px;padding:13px 16px;}
  .why > .lbl{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
              color:var(--ink-3);font-weight:700;}
  .why p{font-size:14.5px;color:var(--ink-2);line-height:1.75;}
  .why p strong{color:var(--ink);}
  .ask{font-size:15px;font-weight:700;margin:2px 0 0;}
  /* ── 折りたたみ: 既定は閉じる。読みやすさを壊さずに «裏取り» を残す ── */
  details.more{border:1px solid var(--rule);border-radius:9px;background:var(--card);
               overflow:hidden;}
  details.more > summary{cursor:pointer;padding:11px 15px;font-size:13.5px;font-weight:700;
      color:var(--acc);list-style:none;display:flex;gap:9px;align-items:center;
      user-select:none;}
  details.more > summary::-webkit-details-marker{display:none;}
  details.more > summary::before{content:"\25B8";display:inline-block;
      transition:transform .15s ease;font-size:11px;}
  details.more[open] > summary::before{transform:rotate(90deg);}
  details.more > summary:hover{background:var(--raise);}
  details.more > summary:focus-visible{outline:2px solid var(--acc);outline-offset:-2px;}
  details.more .inner{padding:2px 15px 15px;display:flex;flex-direction:column;gap:11px;
      font-size:14px;color:var(--ink-2);line-height:1.75;}
  details.more .inner strong{color:var(--ink);}
  details.more .inner table{font-size:13.5px;}
  @media (prefers-reduced-motion:reduce){ details.more > summary::before{transition:none;} }

  /* ── この board で扱う ticket の一覧 ── */
  .tks{display:flex;flex-direction:column;gap:14px;}
  .tk{display:flex;flex-direction:column;gap:7px;
      border-left:3px solid var(--acc);padding:2px 0 2px 14px;}
  .tk .tk-head{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap;}
  .tk .tk-who{font-size:12px;font-weight:700;letter-spacing:.05em;color:var(--acc);}
  .tk .tk-name{font-size:16.5px;font-weight:700;letter-spacing:-.01em;}
  .tk .tk-sym{font-size:14.5px;color:var(--ink-2);}
  .tk .tk-sym strong{color:var(--ink);}
  .tk .tk-id{font-family:var(--mono);font-size:11.5px;color:var(--ink-3);word-break:break-all;}
  .tk .tk-q{font-size:12.5px;color:var(--ink-3);}
  .tk .tk-q b{color:var(--acc);}

  /* 追跡情報は «下に小さく»。先頭に置かない */
  .meta{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;
        font-size:11.5px;color:var(--ink-3);border-top:1px solid var(--rule);
        padding-top:10px;margin-top:4px;}
  .meta .k{font-weight:700;letter-spacing:.05em;}
  .meta code{font-size:11px;background:transparent;padding:0;color:var(--ink-3);}
  h1{font-size:clamp(25px,4vw,34px);line-height:1.28;letter-spacing:-.02em;
     text-wrap:balance;margin:0;font-weight:700;}
  .lede{color:var(--ink-2);font-size:17px;margin:0;}
  .src{font-size:13px;color:var(--ink-3);}
  h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);
     margin:0 0 2px;font-weight:700;}
  h3{font-size:19px;margin:0;letter-spacing:-.01em;text-wrap:balance;}
  p{margin:0;}
  a{color:var(--acc);text-decoration:underline;text-underline-offset:3px;
    text-decoration-thickness:1px;text-decoration-color:color-mix(in srgb,var(--acc) 45%,transparent);}
  a:hover{text-decoration-color:var(--acc);}
  a:focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:3px;}
  code{font-family:var(--mono);font-size:.87em;background:var(--raise);
       padding:.1em .38em;border-radius:4px;}
  section{display:flex;flex-direction:column;gap:13px;}
  .card{background:var(--card);border:1px solid var(--rule);border-radius:12px;
        padding:clamp(17px,3vw,25px);display:flex;flex-direction:column;gap:14px;}
  .scroll{overflow-x:auto;}
  table{border-collapse:collapse;width:100%;font-size:14px;min-width:460px;}
  th{text-align:left;font-size:11px;letter-spacing:.09em;text-transform:uppercase;
     color:var(--ink-3);border-bottom:1px solid var(--rule);padding:0 12px 8px 0;font-weight:600;}
  td{padding:9px 12px 9px 0;border-bottom:1px solid var(--rule);vertical-align:top;}
  tbody tr:last-child td{border-bottom:none;}
  .num{font-variant-numeric:tabular-nums;white-space:nowrap;}
  .chip{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;
        padding:2px 9px;border-radius:999px;white-space:nowrap;}
  .c-ok{background:var(--ok-soft);color:var(--ok);}
  .c-bad{background:var(--bad-soft);color:var(--bad);}
  .c-warn{background:var(--warn-soft);color:var(--warn);}
  .c-acc{background:var(--acc-soft);color:var(--acc);}
  .note{background:var(--raise);border-radius:9px;padding:13px 16px;font-size:14px;color:var(--ink-2);}
  .note strong{color:var(--ink);}
  hr{border:none;border-top:1px solid var(--rule);margin:0;}
  blockquote{margin:0;padding-left:16px;border-left:3px solid var(--acc);
             color:var(--ink-2);font-size:15px;}
  pre.code{background:var(--raise);border-radius:8px;padding:12px 14px;overflow-x:auto;
           font-family:var(--mono);font-size:12.5px;margin:0;line-height:1.6;white-space:pre;}
  figure{margin:0;display:flex;flex-direction:column;gap:8px;}
  figure img{width:100%;max-width:100%;border:1px solid var(--rule);border-radius:9px;display:block;}
  /* 図(SVG)は元の寸法を持つので、そのままだと親からはみ出す。
     縮めて収め、それでも足りない場合は «図だけ» を横スクロールさせる（本文は動かさない）。 */
  figure svg{max-width:100%;height:auto;display:block;margin:0 auto;}
  figure .mmwrap{overflow-x:auto;max-width:100%;}
  figcaption{font-size:13.5px;color:var(--ink-2);}
  figcaption strong{color:var(--ink);}
  .shot-dark{display:none;}
  @media (prefers-color-scheme:dark){.shot-light{display:none}.shot-dark{display:block}}
  :root[data-theme="dark"] .shot-light{display:none}
  :root[data-theme="dark"] .shot-dark{display:block}
  :root[data-theme="light"] .shot-light{display:block}
  :root[data-theme="light"] .shot-dark{display:none}

  .opt{background:var(--card);border:1px solid var(--rule);border-left-width:3px;
       border-radius:9px;padding:14px 16px;display:block;cursor:pointer;
       transition:background .12s,border-color .12s;}
  .opt:hover{border-color:var(--acc);}
  .opt.rec{border-left-color:var(--acc);}
  .opt.other{border-style:dashed;}
  .opt:has(input:checked){background:var(--raise);border-color:var(--acc);
                          box-shadow:inset 0 0 0 1px var(--acc);}
  .opt:has(input:checked) .opt-title{color:var(--acc);}
  .opt:focus-within{outline:2px solid var(--acc);outline-offset:2px;}
  .opt-head{display:flex;align-items:flex-start;gap:11px;}
  .opt-head input{margin:6px 0 0;width:17px;height:17px;accent-color:var(--acc);flex:none;cursor:pointer;}
  .opt-title{font-size:16px;font-weight:700;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
  .opt-body{margin:9px 0 0 28px;display:flex;flex-direction:column;gap:7px;}
  .opt dl{margin:0;display:flex;flex-direction:column;gap:4px;font-size:14.5px;}
  .opt dt,.lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:700;}
  .opt dd{margin:0;color:var(--ink-2);}
  .opt ul{margin:0;padding-left:19px;color:var(--ink-2);font-size:14.5px;}
  .opt li{margin:2px 0;}
  .qgroup{display:flex;flex-direction:column;gap:9px;}
  label.free{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:700;}
  textarea{width:100%;box-sizing:border-box;background:var(--raise);color:var(--ink);
           border:1px solid var(--rule);border-radius:8px;padding:11px 13px;
           font-family:var(--sans);font-size:14.5px;line-height:1.7;resize:vertical;}
  textarea:focus{outline:2px solid var(--acc);outline-offset:1px;border-color:var(--acc);}
  textarea#out{font-family:var(--mono);font-size:13px;min-height:230px;line-height:1.65;}
  .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
  button{font-family:var(--sans);font-size:14.5px;font-weight:700;cursor:pointer;
         border-radius:8px;padding:9px 18px;border:1px solid var(--acc);
         background:var(--acc);color:var(--acc-ink);}
  button:hover{opacity:.86;}
  button.ghost{background:transparent;color:var(--acc);}
  button:focus-visible{outline:2px solid var(--acc);outline-offset:2px;}
  .flash{font-size:13.5px;font-weight:700;color:var(--ok);opacity:0;transition:opacity .18s;}
  .flash.on{opacity:1;}

  /* ── 先頭の要約ストリップ: 決めることだけを 1 行ずつ ── */
  .strip{display:flex;flex-direction:column;}
  .strip a.sr{display:grid;grid-template-columns:14px auto 1fr auto;gap:3px 12px;
              align-items:baseline;padding:12px 6px;text-decoration:none;color:inherit;
              border-bottom:1px solid var(--rule);border-radius:6px;}
  .strip a.sr:last-child{border-bottom:none;}
  .strip a.sr:hover{background:var(--raise);}
  .strip a.sr:focus-visible{outline:2px solid var(--acc);outline-offset:-2px;}
  .strip .sr-m{font-size:12px;color:var(--ink-3);}
  .strip a.sr.done .sr-m{color:var(--ok);}
  .strip .sr-n{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.08em;
               color:var(--ink-3);white-space:nowrap;}
  .strip .sr-t{font-size:14.5px;line-height:1.6;color:var(--ink-2);}
  .strip .sr-t strong{color:var(--ink);}
  .strip a.sr.done .sr-t,.strip a.sr.done .sr-t strong{color:var(--ink-3);}
  .strip .sr-k{font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 8px;
               border-radius:999px;white-space:nowrap;}
  .strip .sr-k.need{background:var(--acc-soft);color:var(--acc);}
  .strip .sr-k.check{border:1px solid var(--rule);color:var(--ink-3);}
  @media (max-width:620px){
    .strip a.sr{grid-template-columns:14px auto 1fr;}
    .strip .sr-k{grid-column:3;justify-self:start;margin-top:4px;}
  }

  /* ── 判断ごとのコピー ── */
  .copy1{margin-left:auto;font-size:11.5px;font-weight:700;padding:4px 11px;border-radius:7px;
         background:transparent;border:1px solid var(--rule);color:var(--ink-3);}
  .copy1:hover{border-color:var(--acc);color:var(--acc);opacity:1;}

  /* ── 常時見える回答バー ── */
  body{padding-bottom:74px;}
  .abar{position:fixed;left:0;right:0;bottom:0;z-index:98;
        background:color-mix(in srgb,var(--card) 94%,transparent);
        -webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);
        border-top:1px solid var(--rule);padding:10px 14px;
        display:flex;gap:9px 14px;align-items:center;justify-content:center;flex-wrap:wrap;}
  .abar .prog{font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap;}
  .abar .prog b{color:var(--acc);font-size:15px;}
  .abar .dots{display:flex;gap:5px;}
  .abar .dot{width:9px;height:9px;border-radius:50%;background:var(--rule);}
  .abar .dot.on{background:var(--acc);}
  .abar button{padding:7px 15px;font-size:13.5px;}
  .abar .flash{font-size:12.5px;}
  /* 狭い画面ではバーが 2 行に折り返すので、その分だけ本文の下を空ける */
  @media (max-width:620px){ .abar .dots{display:none;} body{padding-bottom:104px;} }

  /* ── 出力欄を手で編集したときの警告 ── */
  .stale{display:none;gap:11px;align-items:center;flex-wrap:wrap;font-size:13px;
         color:var(--warn);background:var(--warn-soft);border-radius:8px;padding:9px 13px;}
  .stale.on{display:flex;}
  .stale button{padding:5px 12px;font-size:12.5px;border-color:var(--warn);
                background:transparent;color:var(--warn);}

  /* ── 目次: 現在地 ── */
  nav.toc a.current{background:var(--raise);color:var(--ink);}
  nav.toc a.is-decide.current{color:var(--acc);}

  @media (prefers-reduced-motion:reduce){*{transition:none!important;}}
</style>

<button class="toc-toggle" id="tocToggle" type="button"
        aria-label="目次を開く" aria-expanded="false" aria-controls="toc"><span></span><em class="badge" id="tocBadge" hidden></em></button>
<div class="toc-backdrop" id="tocBackdrop" hidden></div>

<div class="shell">
<nav class="toc" id="toc" aria-label="目次">
  <h4>目次</h4>
  <ol id="toclist"></ol>
  <p class="toc-hint">色が付いているのが<strong>判断する場所</strong>です。</p>
  <p class="swipe-hint">左へスワイプ、または背景をタップで閉じます。</p>
</nav>

<main>
__CONTENT__
</main>
</div>

__MERMAID__

<script>
(function(){
  var TITLE = "__BOARDTITLE__";
  var main    = document.querySelector('main');
  var out     = document.getElementById('out');
  var flashEl = document.getElementById('flash');
  var tocList = document.getElementById('toclist');
  var strip = null, abar = null, abarProg = null, abarDots = null, abarFlash = null;
  var dirty = false, stale = null;

  function secs(){ return Array.prototype.slice.call(document.querySelectorAll('section[data-q]')); }
  function label(sec){ return sec.getAttribute('data-label') || ('判断 ' + sec.getAttribute('data-q')); }
  function picked(sec){
    return Array.prototype.slice
      .call(sec.querySelectorAll('input[name="q' + sec.getAttribute('data-q') + '"]:checked'))
      .map(function(i){ return i.value; });
  }
  function answered(sec){ return picked(sec).length > 0; }

  // ── 回答のテキスト化。list を絞れば「その判断だけ」「その ticket だけ」になる ──
  function buildFrom(list, heading){
    var lines = ['# 判断ボードの回答 — ' + heading, ''];
    var n = 0;
    list.forEach(function(sec){
      var p = picked(sec);
      var note = sec.querySelector('textarea[data-note]');
      var noteVal = note ? note.value.trim() : '';
      var isMulti = !!sec.querySelector('input[type=checkbox]');
      var hasOther = p.indexOf('__OTHER__') !== -1;
      var normal = p.filter(function(v){ return v !== '__OTHER__'; });
      var otherText = hasOther ? (noteVal || '（メモ未記入）') : '';
      lines.push('## ' + label(sec));
      if (p.length) {
        n++;
        if (isMulti) {
          // ⚠ 選ばなかったものも '- [ ]' で全部出す。
          //    選んだものだけ書くと、読む側は «却下» と «選び忘れ» を区別できない。
          //    実際、3 択のうち 1 つだけ選ばれた回答が来て、残り 2 つの意図を
          //    問い直すことになった（2026-08-04）。
          Array.prototype.slice.call(sec.querySelectorAll('input[type=checkbox]'))
            .forEach(function(i){
              if (i.value === '__OTHER__') return;
              lines.push((i.checked ? '- [x] ' : '- [ ] ') + i.value);
            });
          if (hasOther) lines.push('- [x] その他: ' + otherText);
        } else if (hasOther) { lines.push('選択: その他 — ' + otherText); }
        else { lines.push('選択: ' + normal[0]); }
      } else { lines.push('選択: （未選択）'); }
      if (noteVal && !hasOther) lines.push('メモ: ' + noteVal);
      lines.push('');
    });
    lines.push('---');
    lines.push('回答済み ' + n + ' / ' + list.length);
    return lines.join('\n');
  }
  function build(){ return buildFrom(secs(), TITLE); }

  function flashOn(el, msg, bad){
    if (!el) return;
    el.textContent = msg;
    el.style.color = bad ? 'var(--bad)' : 'var(--ok)';
    el.classList.add('on');
    setTimeout(function(){ el.classList.remove('on'); }, 2400);
  }
  function copyText(text, fl){
    function fallback(){
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly','');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch(e) { ok = false; }
      document.body.removeChild(ta);
      if (!ok && out) { out.focus(); out.select(); }
      flashOn(fl, ok ? 'コピーしました' : '全選択しました — Cmd/Ctrl+C', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ flashOn(fl, 'コピーしました'); }, fallback);
    } else { fallback(); }
  }

  // ── 回答の自動保存。URL ごとに保存するので、板が変われば混ざらない ──
  var KEY = 'dboard:' + location.pathname;
  function save(){
    try {
      var d = {r:{}, n:{}};
      secs().forEach(function(sec){
        var name = 'q' + sec.getAttribute('data-q');
        var p = picked(sec);
        if (p.length) d.r[name] = p;
        var t = sec.querySelector('textarea[data-note]');
        if (t && t.value.trim()) d.n[name] = t.value;
      });
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch(e){}
  }
  function restore(){
    try {
      var raw = localStorage.getItem(KEY); if (!raw) return false;
      var d = JSON.parse(raw) || {}, any = false;
      secs().forEach(function(sec){
        var name = 'q' + sec.getAttribute('data-q');
        var want = (d.r || {})[name];
        if (want && want.length) {
          Array.prototype.slice.call(sec.querySelectorAll('input[name="' + name + '"]')).forEach(function(i){
            if (want.indexOf(i.value) !== -1) { i.checked = true; any = true; }
          });
        }
        var t = sec.querySelector('textarea[data-note]');
        if (t && (d.n || {})[name]) { t.value = d.n[name]; any = true; }
      });
      return any;
    } catch(e){ return false; }
  }
  function clearSaved(){ try { localStorage.removeItem(KEY); } catch(e){} }

  // ── ① 先頭の要約ストリップ。本文から生成するので中身とズレない ──
  if (main && secs().length) {
    var stripSec = document.createElement('section');
    stripSec.id = 'strip-sec';
    stripSec.innerHTML = '<h2><span class="kicker">一覧</span>決めることは ' + secs().length + ' 件</h2>'
      + '<div class="card"><div class="strip" id="strip"></div></div>';
    var hdr = main.querySelector('header');
    if (hdr) { main.insertBefore(stripSec, hdr.nextSibling); }
    else { main.insertBefore(stripSec, main.firstChild); }
    strip = stripSec.querySelector('#strip');
    secs().forEach(function(sec){
      if (!sec.id) sec.id = 'dec-' + sec.getAttribute('data-q');
      var kind = sec.querySelector('.askwhy.check') ? 'check' : 'need';
      var sym  = sec.querySelector('.sym');
      var a = document.createElement('a');
      a.className = 'sr'; a.href = '#' + sec.id;
      a.innerHTML = '<span class="sr-m">○</span>'
        + '<span class="sr-n">判断 ' + sec.getAttribute('data-q') + '</span>'
        + '<span class="sr-t">' + (sym ? sym.innerHTML : label(sec)) + '</span>'
        + '<span class="sr-k ' + kind + '">' + (kind === 'need' ? '決めてほしい' : '念のため確認') + '</span>';
      strip.appendChild(a);
    });
  }

  // ── ② 判断ごとのコピー。決まったものから順に返せる ──
  secs().forEach(function(sec){
    var head = sec.querySelector('.dhead'); if (!head) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'copy1'; b.textContent = 'この判断だけコピー';
    b.addEventListener('click', function(e){
      e.preventDefault();
      copyText(buildFrom([sec], label(sec)), null);
      b.textContent = 'コピーしました';
      setTimeout(function(){ b.textContent = 'この判断だけコピー'; }, 1800);
    });
    head.appendChild(b);
  });

  // ── ③ ticket 単位のコピー（section に data-tk があるときだけ） ──
  var barEl = document.querySelector('.bar');
  var groups = [];
  secs().forEach(function(sec){
    var tk = sec.getAttribute('data-tk'); if (!tk) return;
    var g = groups.filter(function(x){ return x.tk === tk; })[0];
    if (!g) { g = {tk: tk, list: []}; groups.push(g); }
    g.list.push(sec);
  });
  if (barEl && groups.length > 1) {
    var wrap = document.createElement('div');
    wrap.className = 'bar';
    groups.forEach(function(g){
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ghost';
      b.textContent = '「' + g.tk + '」の ' + g.list.length + ' 件だけ';
      b.addEventListener('click', function(){ copyText(buildFrom(g.list, g.tk), flashEl); });
      wrap.appendChild(b);
    });
    barEl.parentNode.insertBefore(wrap, barEl.nextSibling);
  }

  // ── ④ 出力欄を手で編集すると自動更新が止まる。それを黙って起こさない ──
  if (out) {
    stale = document.createElement('div');
    stale.className = 'stale';
    stale.innerHTML = '<span><strong>手で編集したので、自動更新を止めています。</strong>'
      + 'このあと選択を変えても、下の文には反映されません。</span>';
    var rb = document.createElement('button');
    rb.type = 'button'; rb.textContent = '選択から作り直す';
    rb.addEventListener('click', function(){ dirty = false; stale.classList.remove('on'); refresh(); });
    stale.appendChild(rb);
    out.parentNode.insertBefore(stale, out);
  }

  // ── ⑤ 常時見える回答バー ──
  if (out && secs().length) {
    abar = document.createElement('div');
    abar.className = 'abar';
    abar.innerHTML = '<span class="prog"><b>0</b> / ' + secs().length + ' 回答済み</span><span class="dots"></span>';
    var bCopy = document.createElement('button');
    bCopy.type = 'button'; bCopy.textContent = 'まとめてコピー';
    var bJump = document.createElement('button');
    bJump.type = 'button'; bJump.className = 'ghost'; bJump.textContent = '内容を見る';
    abarFlash = document.createElement('span');
    abarFlash.className = 'flash';
    abarFlash.setAttribute('role', 'status'); abarFlash.setAttribute('aria-live', 'polite');
    abar.appendChild(bCopy); abar.appendChild(bJump); abar.appendChild(abarFlash);
    document.body.appendChild(abar);
    abarProg = abar.querySelector('.prog b');
    abarDots = abar.querySelector('.dots');
    secs().forEach(function(){
      var d = document.createElement('span'); d.className = 'dot'; abarDots.appendChild(d);
    });
    bCopy.addEventListener('click', function(){ copyText(out.value, abarFlash); });
    bJump.addEventListener('click', function(){
      out.scrollIntoView({behavior: 'smooth', block: 'center'});
      setTimeout(function(){ out.focus({preventScroll: true}); }, 420);
    });
  }

  // ── 目次を生成（見出しから。手書きしないので本文とずれない） ──
  var allSecs = Array.prototype.slice.call(document.querySelectorAll('main section'));
  allSecs.forEach(function(sec, i){
    // 判断セクションは data-label を使う（h2 を持たない設計のため）。
    // 資料セクションは h2 のテキストから kicker を除いたもの。
    var isDecide = sec.hasAttribute('data-q');
    var text;
    if (isDecide) {
      text = sec.getAttribute('data-label') || ('判断 ' + sec.getAttribute('data-q'));
    } else {
      var h = sec.querySelector('h2'); if (!h) return;
      var kicker = h.querySelector('.kicker');
      text = h.textContent.replace(kicker ? kicker.textContent : '', '').trim();
    }
    if (!sec.id) sec.id = 'sec-' + i;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + sec.id;
    a.innerHTML = '<span class="mark"></span><span>' + text + '</span>';
    if (isDecide) { a.className = 'is-decide'; a.dataset.q = sec.getAttribute('data-q'); }
    li.appendChild(a); tocList.appendChild(li);
  });

  var badge = document.getElementById('tocBadge');
  function syncToc(){
    var left = 0;
    tocList.querySelectorAll('a.is-decide').forEach(function(a){
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      var ok = sec && answered(sec);
      a.classList.toggle('done', !!ok);
      a.querySelector('.mark').textContent = ok ? '✓' : '○';
      if (!ok) left++;
    });
    if (badge) { badge.hidden = left === 0; badge.textContent = left; }
  }
  function syncStrip(){
    if (!strip) return;
    Array.prototype.slice.call(strip.querySelectorAll('a.sr')).forEach(function(a){
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      var ok = sec && answered(sec);
      a.classList.toggle('done', !!ok);
      a.querySelector('.sr-m').textContent = ok ? '✓' : '○';
    });
  }
  function syncBar(){
    if (!abar) return;
    var n = 0;
    secs().forEach(function(s, i){
      var ok = answered(s);
      if (ok) n++;
      var d = abarDots.children[i]; if (d) d.classList.toggle('on', ok);
    });
    abarProg.textContent = n;
  }
  function refresh(){
    if (out && !dirty) out.value = build();
    syncToc(); syncStrip(); syncBar(); save();
  }

  document.addEventListener('change', function(e){
    if (!e.target.matches('input[type=radio], input[type=checkbox]')) return;
    refresh();
    if (e.target.value === '__OTHER__' && e.target.checked) {
      var ta = e.target.closest('section').querySelector('textarea[data-note]');
      if (ta) ta.focus();
    }
  });
  document.addEventListener('input', function(e){
    if (e.target.matches('textarea[data-note]')) refresh();
    if (out && e.target === out) {
      dirty = true;
      if (stale) stale.classList.add('on');
      save();
    }
  });

  var copyBtn = document.getElementById('copy');
  if (copyBtn) copyBtn.addEventListener('click', function(){ copyText(out.value, flashEl); });
  var resetBtn = document.getElementById('reset');
  if (resetBtn) resetBtn.addEventListener('click', function(){
    document.querySelectorAll('input[type=radio], input[type=checkbox]').forEach(function(i){ i.checked = false; });
    document.querySelectorAll('textarea[data-note]').forEach(function(t){ t.value = ''; });
    dirty = false;
    if (stale) stale.classList.remove('on');
    clearSaved(); refresh(); flashOn(flashEl, 'クリアしました');
  });

  var restored = restore();
  refresh();
  if (restored) { flashOn(flashEl, '前回の回答を復元しました'); flashOn(abarFlash, '前回の回答を復元しました'); }

  // ── 目次の現在地 ──
  var spyLinks = Array.prototype.slice.call(tocList.querySelectorAll('a'));
  var spyTargets = spyLinks.map(function(a){ return document.getElementById(a.getAttribute('href').slice(1)); });
  var rafId = 0;
  function spy(){
    rafId = 0;
    var best = -1;
    for (var i = 0; i < spyTargets.length; i++) {
      var t = spyTargets[i]; if (!t) continue;
      if (t.getBoundingClientRect().top <= 140) best = i;
    }
    spyLinks.forEach(function(a, i){ a.classList.toggle('current', i === best); });
  }
  function spySoon(){ if (!rafId) rafId = requestAnimationFrame(spy); }
  window.addEventListener('scroll', spySoon, {passive: true});
  window.addEventListener('resize', spySoon);
  spy();

  // ── モバイル: ドロワー（ハンバーガー + スワイプ） ──
  var toc = document.getElementById('toc');
  var toggle = document.getElementById('tocToggle');
  var backdrop = document.getElementById('tocBackdrop');
  var mq = window.matchMedia('(max-width:1079px)');

  function isDrawer(){ return mq.matches; }
  function isOpen(){ return toc.classList.contains('open'); }
  function setOpen(open){
    if (!isDrawer()) return;
    toc.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    backdrop.hidden = !open;
    document.body.classList.toggle('toc-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '目次を閉じる' : '目次を開く');
    if (open) { var f = toc.querySelector('a'); if (f) f.focus({preventScroll: true}); }
    else { toggle.focus({preventScroll: true}); }
  }
  toggle.addEventListener('click', function(){ setOpen(!isOpen()); });
  backdrop.addEventListener('click', function(){ setOpen(false); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && isOpen()) setOpen(false); });
  toc.addEventListener('click', function(e){ if (e.target.closest('a')) setOpen(false); });
  mq.addEventListener('change', function(){
    if (!isDrawer()) {
      toc.classList.remove('open'); backdrop.classList.remove('open');
      backdrop.hidden = true; document.body.classList.remove('toc-open');
    }
  });

  // スワイプ: 右で開く / 左で閉じる。
  // 横スクロールする要素の中で始めた指は無視する（表・コード・入力欄を奪わない）
  var sx = 0, sy = 0, tracking = false;
  function scrollableAncestor(el){
    while (el && el !== document.body) {
      if (el.scrollWidth > el.clientWidth + 4) return true;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return true;
      el = el.parentElement;
    }
    return false;
  }
  document.addEventListener('touchstart', function(e){
    if (!isDrawer() || e.touches.length !== 1) { tracking = false; return; }
    var t = e.touches[0];
    if (!isOpen() && scrollableAncestor(e.target)) { tracking = false; return; }
    sx = t.clientX; sy = t.clientY; tracking = true;
  }, {passive: true});
  document.addEventListener('touchend', function(e){
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0 && !isOpen()) setOpen(true);
    else if (dx < 0 && isOpen()) setOpen(false);
  }, {passive: true});
})();
</script>
