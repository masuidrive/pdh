// 判断ボード kit v2 — mermaid-render.js
// beautiful-mermaid.iife.js（global: BeautifulMermaid）の後に読み込む。
// pre.mermaid を kit token 色で描画し、テーマ変更で再描画。失敗時はソースを見せ、
// console.error も残す（fallback がエラーの種類を隠さないため）。
;(function(){
  function tokenColors(){
    var cs = getComputedStyle(document.documentElement);
    var v = function(n){ return cs.getPropertyValue(n).trim(); };
    return { bg: v('--paper'), fg: v('--ink'), line: v('--muted'), accent: v('--accent'),
             muted: v('--muted'), surface: v('--fill'), border: v('--line'),
             font: 'ui-sans-serif, system-ui, sans-serif' };
  }
  var slots = Array.prototype.map.call(document.querySelectorAll('pre.mermaid'), function(pre){
    var slot = document.createElement('div');
    slot.className = 'mermaid-svg';
    pre.parentNode.insertBefore(slot, pre);
    return { pre: pre, slot: slot };
  });
  function renderAll(){
    var colors = tokenColors();
    slots.forEach(function(s){
      try {
        s.slot.innerHTML = BeautifulMermaid.renderMermaidSVG(s.pre.textContent, colors);
        s.pre.style.display = 'none';        // 成功したときだけソースを隠す
      } catch (e) {
        s.slot.innerHTML = '';
        s.pre.style.display = '';            // 失敗したら黙って消えない — ソースを見せる
        if (window.console) console.error('mermaid render failed:', e);
      }
    });
  }
  renderAll();
  new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
})();
