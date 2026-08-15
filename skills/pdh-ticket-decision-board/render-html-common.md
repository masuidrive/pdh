# HTML renderer 共通実装
このファイルは、2 つの HTML renderer が共有する CSS・DOM・回答フォームの実装規則である。
HTML 文書または `html-2d-deck` を選んだときだけ、該当 renderer と一緒に読む。

## 数値既定値の扱い

このファイルと各 renderer の数値は、過去の表示確認から得た **実測由来の目安**である。
プロジェクトが想定 viewport やアクセシビリティ基準を定めている場合は、その条件を優先し、
変更後の値を設計トークンまたは定数の 1 か所だけで管理する。

- 狭い画面の既定検査幅: `380px`

`html-2d-deck` 固有の既定値は `create-slides.md` だけに置く。

## HTML の外枠

一番外の要素に、一意な board ID と日本語指定を置く。

```html
<main class="board" lang="ja" data-board-id="<ticket-or-board-id>">
  ...
</main>
```

artifact host などが `<html>` を所有する場合でも、board 自身の外枠に `lang="ja"` を置く。
`line-break: strict` だけを書いても、ブラウザが日本語と認識しなければ禁則は期待どおりに働かない。

全要素へ `box-sizing: border-box` を適用する。padding が viewport 幅へ加算されて横 overflow を
作ることを防ぐ。

```css
.board, .board *, .deck, .deck * { box-sizing: border-box; }
.board, .deck { line-break: strict; overflow-wrap: anywhere; }
.board pre, .deck pre { line-break: strict; white-space: pre-wrap; }
```

日本語の ticket 原文を `<pre>` に置く場合も `line-break: strict` を当てる。ソースコードには、
文字位置を変える組版指定を当てない。

## 設計トークン

2 renderer は次の token set を共有する。個別部品に色や寸法を直接書かず、必要な変更はこの定義へ戻す。
インライン `style` で値を増やさない。

体裁は判断材料ではないため、装飾の作り込みを目的にしない。一方、同じ読み手が複数の board を
読むときに意味を学び直さないよう、token と強調の意味は揃える。

```css
:root {
  --u: 0.25rem;

  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.125rem;
  --text-lg: 1.3125rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;

  --lh-body: calc(var(--u) * 7);
  --lh-sm: calc(var(--u) * 6);
  --lh-lg: calc(var(--u) * 8);
  --lh-xl: calc(var(--u) * 9);
  --lh-2xl: calc(var(--u) * 11);

  --measure: 46em;
  --wide: 72rem;
  --wide-in: 64rem;

  --bg: #ffffff;
  --fg: #1c2024;
  --muted: #5a6472;
  --line: #d8dde3;
  --panel: #f4f6f8;
  --accent: #1f5f8b;
  --rec-bg: #eef4f9;
  --hl: #ffe9a0;
  --ok: #2f6b4f;
  --ok-bg: #eaf3ee;
  --gap: #8a5512;
  --gap-bg: #fbf1e3;
  --care: #a2600f;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #15191e;
    --fg: #edf1f5;
    --muted: #aab4c0;
    --line: #3b4652;
    --panel: #202730;
    --accent: #8fc7ed;
    --rec-bg: #1c3445;
    --hl: rgba(255, 205, 74, 0.45);
    --ok: #8ed0ab;
    --ok-bg: #193a2b;
    --gap: #f0bd72;
    --gap-bg: #432d17;
    --care: #f1b765;
  }
}

:root[data-theme="dark"] {
  --bg: #15191e;
  --fg: #edf1f5;
  --muted: #aab4c0;
  --line: #3b4652;
  --panel: #202730;
  --accent: #8fc7ed;
  --rec-bg: #1c3445;
  --hl: rgba(255, 205, 74, 0.45);
  --ok: #8ed0ab;
  --ok-bg: #193a2b;
  --gap: #f0bd72;
  --gap-bg: #432d17;
  --care: #f1b765;
}
```

文字サイズは 16 を基準にした 7 段だけを使い、`14px` 相当未満を使わない。縦寸法は `--u` の
整数倍にする。明暗テーマは token だけを差し替え、部品ごとに暗色版を増やさない。

## 強調

見出しと強調だけを順に読んだとき、推奨の筋と検証の筋が両方通るようにする。
節ごとに `mark.k` を 1〜2 か所だけ置く。

```css
mark.k {
  color: inherit;
  background: linear-gradient(transparent 60%, var(--hl) 60%);
  font-weight: 700;
}
```

- 帯は下 40% だけを塗る。全面を塗らない。
- 同じ文に帯と太字を重ねない。
- 太字は 1 段落に 1 か所までとし、段落全体を太字にしない。
- 推奨だけでなく、反証条件、停止条件、未測定にも斜め読みの手掛かりを置く。
- 帯を置ける主張がない節は、見出しと本文を見直す。表自体が主張なら帯を無理に足さない。
- 色を消しても、語、枠、帯、ラベルで意味が残るようにする。
- 色の使用数へ機械的な上限を置かない。意味の重複と色だけへの依存を検査する。
- 記号だけで重要さを表さない。注意が必要な理由を文で書く。
- 枠線は境界を示す場合だけ使う。閉じた折りたたみを空の箱にしない。
- 色 token は「青」「黄」ではなく、推奨、実測、未測定のような意味で命名する。

明暗両方を描画し、`--hl` などの計算値がテーマ間で実際に異なることを確認する。

## 回答フォームを置く条件

`N = 0` の承認だけの board には、複数選択と集計の仕組みを置かない。承認文、AC、
承認が間違いになる条件、返答用テキストだけを置く。

`N >= 1` では、各判断に次を置く。

- 材料の直後にある選択肢。
- 自由記述欄。「その他」を選んだ場合は記述が回答本体になる。
- 最後にある貼り戻し用の回答一覧。同じ選択肢を再表示する場合は同じ状態へ同期する。
- 回答済み件数と、判断ごとの完了状態。
- 未回答を `（未選択）` と明示した貼り戻し文。

### DOM 契約

同じ論理判断に属する要素は、表示場所が違っても同じ `data-q` を持つ。

```html
<section class="answer-set" data-q="scope">
  <button type="button" class="answer-choice" data-q="scope" data-value="recommended">
    推奨を承認する
  </button>
  <button type="button" class="answer-choice" data-q="scope" data-value="alternative">
    別案を指示する
  </button>
  <textarea class="answer-note" data-q="scope" aria-label="判断 scope の補足"></textarea>
</section>

<a class="answer-jump" href="#answer-summary" data-scroll-target="answer-summary">
  回答欄へ進む
</a>

<aside class="answer-progress" aria-live="polite">
  <span data-progress-count>回答 0 / 1</span>
  <span data-progress-dots aria-hidden="true">○</span>
</aside>

<section id="answer-summary">
  <textarea data-answer-output readonly></textarea>
  <button type="button" data-copy-answer>回答をコピー</button>
  <p data-copy-status role="status"></p>
</section>
```

判断 ID は意味のある安定名にする。同じ `data-q` を持つ選択肢とメモを 1 件として数え、
表示されたボタン数を判断数として数えない。

回答 UI の class は DOM へ書くだけでなく、共通 CSS に実装する。

```css
.answer-set {
  display: grid;
  gap: calc(var(--u) * 3);
  margin-block: calc(var(--u) * 5);
}
.answer-choice,
[data-copy-answer] {
  appearance: none;
  border: 1px solid var(--line);
  border-radius: calc(var(--u) * 2);
  padding: calc(var(--u) * 3) calc(var(--u) * 4);
  color: var(--fg);
  background: var(--bg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.answer-choice.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
  background: var(--rec-bg);
}
.answer-note,
[data-answer-output] {
  width: 100%;
  min-height: calc(var(--u) * 24);
  border: 1px solid var(--line);
  border-radius: calc(var(--u) * 2);
  padding: calc(var(--u) * 3);
  color: var(--fg);
  background: var(--bg);
  font: inherit;
  line-height: var(--lh-body);
}
.answer-jump {
  color: var(--accent);
  text-underline-offset: 0.18em;
}
.answer-progress {
  position: fixed;
  inset: calc(var(--u) * 3) calc(var(--u) * 3) auto auto;
  z-index: 20;
  display: flex;
  gap: calc(var(--u) * 2);
  padding: calc(var(--u) * 2) calc(var(--u) * 3);
  border: 1px solid var(--line);
  border-radius: calc(var(--u) * 2);
  color: var(--fg);
  background: var(--bg);
  font-size: var(--text-sm);
}
```

### 状態と同期

次の実装を 1 か所だけに置き、文書とデッキへ同じコードを差し込む。board ごとにロジックを
書き換えない。

```js
(() => {
  const root = document.querySelector('[data-board-id]');
  if (!root) return;

  const boardId = root.dataset.boardId;
  const storageKey = `decision-board:${boardId}:answers`;
  const qids = [...new Set(
    [...root.querySelectorAll('[data-q]')].map(el => el.dataset.q).filter(Boolean)
  )];
  const state = Object.fromEntries(qids.map(q => [q, { value: '', note: '' }]));

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    qids.forEach(q => Object.assign(state[q], saved[q] || {}));
  } catch (_) {
    /* 保存不能でも回答操作は続ける */
  }

  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {}
  };

  const labelFor = (q, value) => {
    const option = root.querySelector(`.answer-choice[data-q="${CSS.escape(q)}"][data-value="${CSS.escape(value)}"]`);
    return option ? option.textContent.trim() : value;
  };

  const render = (source = null) => {
    qids.forEach(q => {
      root.querySelectorAll(`.answer-choice[data-q="${CSS.escape(q)}"]`).forEach(button => {
        const selected = button.dataset.value === state[q].value;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      root.querySelectorAll(`.answer-note[data-q="${CSS.escape(q)}"]`).forEach(note => {
        if (note !== source) note.value = state[q].note;
      });
    });

    const done = qids.filter(q => state[q].value || state[q].note.trim()).length;
    const count = root.querySelector('[data-progress-count]');
    const dots = root.querySelector('[data-progress-dots]');
    if (count) count.textContent = `回答 ${done} / ${qids.length}`;
    if (dots) dots.textContent = qids.map(q => state[q].value || state[q].note.trim() ? '●' : '○').join('');

    const lines = qids.map(q => {
      const selected = state[q].value ? labelFor(q, state[q].value) : '（未選択）';
      const note = state[q].note.trim() ? `\n  補足: ${state[q].note.trim()}` : '';
      return `- ${q}: ${selected}${note}`;
    });
    lines.push(`回答済み ${done} / ${qids.length}`);
    const output = root.querySelector('[data-answer-output]');
    if (output) output.value = lines.join('\n');
  };

  root.addEventListener('click', event => {
    const button = event.target.closest('.answer-choice');
    if (button && root.contains(button)) {
      state[button.dataset.q].value = button.dataset.value;
      save();
      render();
      return;
    }

    const jump = event.target.closest('[data-scroll-target]');
    if (jump && root.contains(jump)) {
      const target = root.querySelector(`#${CSS.escape(jump.dataset.scrollTarget)}`);
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'start' });
      }
    }
  });

  root.addEventListener('input', event => {
    const note = event.target.closest('.answer-note');
    if (!note || !root.contains(note)) return;
    state[note.dataset.q].note = note.value;
    save();
    render(note);
  });

  render();
})();
```

入力中の `<textarea>` 自身は同期処理で書き換えない。書き換えるとカーソル位置が飛ぶ。
保存に失敗しても、回答と貼り戻し文の生成は続ける。

### コピーの fallback

埋め込みブラウザや preview では `navigator.clipboard` が失敗する前提にする。失敗時は回答文を
選択し、「長押しまたはキーボードでコピーしてください」と表示する。

```js
async function copyAnswer(root) {
  const output = root.querySelector('[data-answer-output]');
  const status = root.querySelector('[data-copy-status]');
  if (!output) return;
  try {
    await navigator.clipboard.writeText(output.value);
    if (status) status.textContent = '回答をコピーしました。';
  } catch (_) {
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
    if (status) status.textContent = '長押しまたはキーボードでコピーしてください。';
  }
}

document.querySelectorAll('[data-board-id]').forEach(root => {
  root.querySelector('[data-copy-answer]')?.addEventListener('click', () => copyAnswer(root));
});
```

`href` は JS が無効な場合の移動先として残す。横方向へ読むデッキでは `href` だけに頼らず、
`scrollIntoView` の `inline` 方向を明示する。

## AC 原文の重複を追う

AC の本文は、一覧、参照 popover、選択肢、scope、貼り戻し文へ複製されうる。AC を直したら、
文章ではなく AC 番号と参照 ID で全箇所を出す。

```bash
rg -n 'AC[0-9]+|pop-ac[0-9]+-' <board.html>
rg -n 'AC10|pop-ac10-' <board.html>
```

番号のない AC を複製しない。表示を増やす場合は同じデータから生成するか、同じ識別子を必ず付ける。

## クラスが実在し、期待した役割かを確認する

HTML の `class` 値を全部出し、同じファイルの selector に定義があるかを確認する。一般語の短い
クラス名を、別部品へ再利用しない。存在するが役割が違うクラスも不正である。

```bash
rg -o 'class="[^"]+"' <board.html> | sort -u
rg -n '\.(answer-choice|answer-note|answer-progress|<class-name>)([^a-zA-Z0-9_-]|$)' <board.html>
```

grep は定義の存在しか示さない。ブラウザで代表要素の計算値を読み、期待するレイアウトや境界が
実際に効いていることを確認する。

```js
getComputedStyle(document.querySelector('.answer-progress')).position
getComputedStyle(document.querySelector('.answer-choice')).borderTopWidth
```

見た目のためだけに新しいクラスを増やさない。必要な役割が既存 token と素の要素で表せる場合は、
新しい selector を作らない。

## 共通の発行前検査

1. プロジェクトが定める最小・最大 viewport と、このファイルの既定狭幅で描画する。
2. 明暗テーマを描画し、token の計算値とスクリーンショットの両方を確認する。
3. ページ本体の `scrollWidth - clientWidth` が `0` であることを確認する。
4. 開始・終了タグ、見出し、判断 ID、回答件数が編集前後で意図せず変わっていないか数える。
5. AC 番号と参照 ID を検索し、古い表示が残っていないか確認する。
6. 使用 class の定義と `getComputedStyle` を確認する。
7. 回答の選択、押し直し、メモ同期、再読み込み、未回答表示、移動、コピー fallback を操作する。
8. 日本語の禁則違反を狭い画面と広い画面で確認する。

### 日本語の行頭禁則を測る

目視だけに頼らず、各文字を `Range` で測り、x 座標が前の文字より左へ戻った位置を行頭とみなす。
`ぁぃぅぇぉっゃゅょー、。・：；？！）」』】` が行頭へ来た件数を数え、想定 viewport で 0 にする。

### 検査自体を反証する

overflow、未定義 class、壊れた参照、保存失敗などを一時的に作り、検査が失敗を返すことを確認する。
検査方法を変更した直後は、緑の結果だけで検査が働くと判断しない。
