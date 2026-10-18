/* pdh-decision-board kit — view.js（combined layout のトグル）
   文書 / スライドの切り替え。スライドは隠れている間 clientHeight が 0 で deck.js が
   採寸できないので、表示へ切り替えた瞬間に window.__fitAll を呼んで測り直す。 */
(function () {
  var board = document.querySelector(".board[data-view]");
  if (!board) return;
  var btns = Array.prototype.slice.call(board.querySelectorAll("[data-view-btn]"));
  if (!btns.length) return;
  function set(v) {
    if (v !== "deck") v = "document";
    board.setAttribute("data-view", v);
    btns.forEach(function (b) {
      var on = b.getAttribute("data-view-btn") === v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // 表示直後は clientHeight が確定していないことがあるので次フレームでもう一度測る。
    if (v === "deck" && window.__fitAll) { window.__fitAll(); requestAnimationFrame(window.__fitAll); }
  }
  board.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-view-btn]") : null;
    if (b) set(b.getAttribute("data-view-btn"));
  });
  set(board.getAttribute("data-view") || "document");   // 既定は文書
})();
