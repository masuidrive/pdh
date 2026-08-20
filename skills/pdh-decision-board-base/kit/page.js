// 判断ボード kit v2 — page.js（文書版のページ機構）
// 1) 目次ボタンの開閉  2) 現在地 spy — スクロール位置から決定論で計算する
//    （IntersectionObserver は上向きスクロールで発火順が前後し、1 つ先の項目が残る）
// 3) h2 の stuck 検出 — 貼り付き中だけ 1 行に切り詰める
// 前提 DOM: nav#toc(+button#toct) / 節は <section id> で包む（sticky の効く範囲を節に閉じ、
// アンカーの宛先は静的な section 側に置く — sticky 要素へ飛ぶと停泊位置に着地する）
(function(){
  var KEY='board-ui-sample-theme', root=document.documentElement, pick=document.getElementById('themePick');
  if(!pick) return;  // picker は見本ページ専用 — 無い board では何もしない
  function apply(v){ if(v) root.setAttribute('data-theme', v); else root.removeAttribute('data-theme');
    pick.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on', b.dataset.set===(v||'')); }); }
  apply(localStorage.getItem(KEY)||'');
  pick.addEventListener('click', function(e){ var b=e.target.closest('button'); if(!b) return;
    localStorage.setItem(KEY, b.dataset.set); apply(b.dataset.set); });
})();
(function(){
  var KEY='board-ui-sample-font', root=document.documentElement, pick=document.getElementById('fontPick');
  if(!pick) return;
  if(localStorage.getItem(KEY)==='gothic') localStorage.setItem(KEY,'');
  function apply(v){ if(v) root.setAttribute('data-font', v); else root.removeAttribute('data-font');
    pick.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on', b.dataset.set===(v||'')); }); }
  apply(localStorage.getItem(KEY)||'');
  pick.addEventListener('click', function(e){ var b=e.target.closest('button'); if(!b) return;
    localStorage.setItem(KEY, b.dataset.set); apply(b.dataset.set); });
})();
(function(){
  var t=document.getElementById('toct'), nav=document.getElementById('toc');
  if(!nav) return;  // 目次の無い board では spy も含めて何もしない
  if(t) t.addEventListener('click', function(){ nav.classList.toggle('open'); });
  nav.addEventListener('click', function(e){ if(e.target.tagName==='A') nav.classList.remove('open'); });
  var links={}, order=[];
  nav.querySelectorAll('a[href^="#"]').forEach(function(a){
    var id=a.getAttribute('href').slice(1); links[id]=a; order.push(id);
  });
  // 現在地はスクロール位置から決定論で決める。IntersectionObserver は上向きスクロールで
  // 発火順が前後し、下から戻ると 1 つ先の項目が残る（実測 2026-08-19）。
  var ticking=false;
  function spy(){
    ticking=false;
    var y=window.scrollY+120, cur=order[0];
    order.forEach(function(id){
      var el=document.getElementById(id); if(!el) return;
      var top=el.getBoundingClientRect().top+window.scrollY;
      if(top<=y) cur=id;
    });
    if(window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-2) cur=order[order.length-1];
    order.forEach(function(id){ links[id].classList.toggle('on', id===cur); });
  }
  window.addEventListener('scroll', function(){ if(!ticking){ ticking=true; requestAnimationFrame(spy); } }, {passive:true});
  spy();
  // h2 が上端に貼り付いた瞬間だけ .stuck を付ける（目次ボタンとの衝突回避を貼り付き中に限定する）
  var stuck=new IntersectionObserver(function(es){ es.forEach(function(e){
    e.target.classList.toggle('stuck', e.intersectionRatio < 1 && e.boundingClientRect.top <= 0);
  }); }, {threshold:[1], rootMargin:'-1px 0px 0px 0px'});
  document.querySelectorAll('h2').forEach(function(h){ stuck.observe(h); });
})();
