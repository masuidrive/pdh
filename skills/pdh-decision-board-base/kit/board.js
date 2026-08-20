/* pdh-decision-board kit — board.js
   回答フォームの動作（選択・メモ・進捗・貼り戻し文の生成・コピー）。
   文書版とデッキ版で «同じ 1 つ» を使う。board ごとにロジックを書き換えない。
   規則の本体は ../render-html-common.md「状態と同期」「コピーは 3 段で受ける」。 */
(() => {
  const root = document.querySelector('[data-board-id]');
  if (!root) return;

  const boardId = root.dataset.boardId;
  const storageKey = `decision-board:${boardId}:answers`;
  const qids = [...new Set(
    [...root.querySelectorAll('[data-q]')].map(el => el.dataset.q).filter(Boolean)
  )];
  const state = Object.fromEntries(qids.map(q => [q, { value: '', note: '' }]));

  const titleFor = q => {
    const host = root.querySelector(`.answer-set[data-q="${CSS.escape(q)}"]`);
    return (host && host.dataset.title) || q;
  };

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
    if (!option) return value;
    // ⚠ カードを選択肢にすると textContent は «カード全部» になる。
    //    貼り戻し文に本文が丸ごと入るので、短い名前を必ず data-label から取る。
    const label = option.dataset.label
      || option.querySelector('[data-choice-label]')?.textContent
      || option.textContent;
    return label.trim().replace(/\s+/g, ' ');
  };

  // 判断 1 件ぶんの回答（選択・ラベル・メモ）を集める。貼り戻し文も送信 hook も
  // «この 1 つ» から作る。2 か所で組み立てると、コピーした文と送った内容がいつかずれる。
  const collect = () => qids.map(q => ({
    q,
    title: titleFor(q),
    value: state[q].value,
    label: state[q].value ? labelFor(q, state[q].value) : '',
    note: state[q].note.trim()
  }));

  // 集めた回答から貼り戻し文を組む。見出しは board 側が data-answer-title で持つ。
  // ここに board 固有の文字列を書くと、board ごとに board.js を分岐させることになる。
  const answerText = (items, done) => {
    const lines = [`# 判断ボードの回答 — ${root.dataset.answerTitle || boardId}`, ''];
    items.forEach(item => {
      lines.push(`## ${item.title}`);
      lines.push(`選択: ${item.label || '（未選択）'}`);
      if (item.note) lines.push(`メモ: ${item.note}`);
      lines.push('');
    });
    lines.push('---');
    lines.push(`回答済み ${done} / ${items.length}`);
    return lines.join('\n');
  };

  const render = (source = null) => {
    qids.forEach(q => {
      const answered = Boolean(state[q].value);
      root.querySelectorAll(`.answer-choice[data-q="${CSS.escape(q)}"]`).forEach(button => {
        const selected = button.dataset.value === state[q].value;
        button.classList.toggle('is-selected', selected);
        // 選んだ 1 枚だけが前に出るよう、同じ判断の他のカードを引く。
        // 枠の色だけだと、どのカードが選択中か一目で読めない。
        button.classList.toggle('is-dimmed', answered && !selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      root.querySelectorAll(`.answer-note[data-q="${CSS.escape(q)}"]`).forEach(note => {
        if (note !== source) note.value = state[q].note;
      });
    });

    const items = collect();
    const done = items.filter(item => item.value || item.note).length;
    const count = root.querySelector('[data-progress-count]');
    const dots = root.querySelector('[data-progress-dots]');
    if (count) count.textContent = `回答 ${done} / ${qids.length}`;
    if (dots) dots.textContent = items.map(item => item.value || item.note ? '●' : '○').join('');

    const output = root.querySelector('[data-answer-output]');
    if (output) output.value = answerText(items, done);
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

  // カードを選択肢にすると <button> ではなくなるので、キーボードは自前で受ける。
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.card.answer-choice');
    if (!card || !root.contains(card)) return;
    event.preventDefault();
    card.click();
  });

  root.addEventListener('input', event => {
    const note = event.target.closest('.answer-note');
    if (!note || !root.contains(note)) return;
    state[note.dataset.q].note = note.value;
    save();
    render(note);
  });

  // コピーは 3 段で受ける。手でコピーさせるのは最後だけ。
  async function copyAnswer() {
    const output = root.querySelector('[data-answer-output]');
    const status = root.querySelector('[data-copy-status]');
    if (!output) return;

    // 1) 標準の API。sandbox された iframe（artifact など）では権限で弾かれる。
    try {
      await navigator.clipboard.writeText(output.value);
      if (status) status.textContent = '回答をコピーしました。';
      return;
    } catch (_) { /* 2) へ */ }

    // 2) 古い API。押した操作の中で呼べば iframe でも通る。
    //    ⚠ readonly な textarea は iOS で選択できないので、一時的に外す。
    const wasReadOnly = output.readOnly;
    output.readOnly = false;
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    output.readOnly = wasReadOnly;

    if (copied) {
      if (status) status.textContent = '回答をコピーしました。';
      return;
    }
    // 3) どちらも通らなかったときだけ、手でのコピーを案内する（選択は残す）。
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
    if (status) status.textContent = '選択しました。長押しまたはキーボードでコピーしてください。';
  }

  root.querySelector('[data-copy-answer]')?.addEventListener('click', copyAnswer);

  // 送信 hook — board を配信する側（ホスト）が window.boardHost.submit を用意しているときだけ、
  // 「回答をコピー」の隣に送信ボタンを出す。board.js は送信先も送信の方法も知らない
  // （URL・認証・成功時の表示は、ページを配信するホストが submit の中で決める）。
  // ホストが無い環境（ファイルを直接開く・artifact）では、この節は何もせずコピーだけが残る。
  //   window.boardHost = {
  //     label:    '回答を送信',            // 省略可。ボタンの文字
  //     disabled: false,                  // 省略可。true なら押せないボタンを出す（期限切れなど）
  //     submit:   async (payload) => {}   // 必須。resolve = 送信できた / reject = その Error の文言を出す
  //   }
  //   payload = { boardId, title, answers: [{ q, title, value, label, note }], text, answered, total }
  //     text = 貼り戻し文の全文（コピーで渡すものと同じ 1 つ）
  (() => {
    const host = window.boardHost;
    if (!host || typeof host.submit !== 'function') return;
    const copyButton = root.querySelector('[data-copy-answer]');
    if (!copyButton) return;
    const status = root.querySelector('[data-copy-status]');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = copyButton.className;   // 見た目は「回答をコピー」と揃える
    button.setAttribute('data-submit-answer', '');
    button.textContent = host.label || '回答を送信';
    if (host.disabled) button.disabled = true;

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const items = collect();
      const done = items.filter(item => item.value || item.note).length;
      // 何も選ばず・何も書かずに押した送信は受けない。「回答済み」と記録されるのに
      // 中身が全部（未選択）になり、答えた本人も受け取る agent も気づけないため。
      if (done === 0) {
        if (status) status.textContent = 'まだ何も選んでいません。選択（またはメモ）をしてから送信してください。';
        return;
      }
      const payload = {
        boardId,
        title: root.dataset.answerTitle || boardId,
        answers: items,
        text: answerText(items, done),
        answered: done,
        total: items.length
      };
      const label = button.textContent;
      button.disabled = true;
      button.textContent = '送信中…';
      try {
        await host.submit(payload);
        button.textContent = '送信しました';
        if (status) status.textContent = '回答を送信しました。';
      } catch (error) {
        button.disabled = false;
        button.textContent = label;
        if (status) status.textContent = (error && error.message) || '送信できませんでした。';
      }
    });

    copyButton.before(button);
  })();

  render();
})();

/* 画面写真の原寸表示 — 開閉そのものは :target と <a href> だけで成立する（CSS 側）。
   ここは Esc で閉じる上乗せだけ。回答フォームの IIFE とは分け、ここが失敗しても
   回答は動き続ける。 */
(() => {
  try {
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const zoom = document.querySelector('.shot-zoom:target');
      if (!zoom) return;
      // overlay の href（元の figure）へ戻す = 押して閉じるのと同じ経路。
      location.hash = zoom.getAttribute('href') || '#';
    });
  } catch (_) { /* 上乗せの失敗で board を止めない */ }
})();

/* ホストと port の入力 → 確認 URL の生成。
   board には path だけが書いてある（読み手の環境のホスト名は書き手には分からない）。
   入力値は端末に保存し、次の board でも最初から入っている — 閲覧環境のアドレスは
   毎回同じなので、board ごとに入れ直させない。
   ⚠ file:// では localStorage が例外を投げることがある。ここで script が止まると
   回答フォームまで死ぬので、独立の IIFE + 全所 try/catch にする。 */
(() => {
  try {
    const KEY = 'decision-board:host-setup';   // board を跨いで共有（board 別にしない）
    const hostIn = document.querySelector('[data-host-input]');
    const portIn = document.querySelector('[data-port-input]');
    const paths = Array.from(document.querySelectorAll('[data-path]'));
    if (!hostIn || paths.length === 0) return;

    const load = () => {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
    };
    const save = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          host: hostIn.value.trim(),
          port: portIn ? String(portIn.value).trim() : ''
        }));
      } catch (_) { /* 保存できなくても URL 生成は続ける */ }
    };

    const saved = load();
    if (saved.host && !hostIn.value) hostIn.value = saved.host;
    if (portIn && saved.port && !portIn.value) portIn.value = saved.port;

    const baseUrl = () => {
      const host = hostIn.value.trim().replace(/\/+$/, '');
      if (!host) return '';
      const port = portIn ? String(portIn.value).trim() : '';
      // scheme 付きで入れたらそのまま使う。無ければ http（dev-server は http で立つ）。
      const origin = /^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `http://${host}`;
      return origin + (port ? `:${port}` : '');
    };

    async function copyText(text, button) {
      const done = () => {
        const old = button.dataset.label || (button.dataset.label = button.textContent);
        button.textContent = 'コピーしました';
        setTimeout(() => { button.textContent = old; }, 1600);
      };
      try { await navigator.clipboard.writeText(text); done(); return; } catch (_) { /* 2) へ */ }
      // 押した操作の中なら execCommand は sandbox された iframe でも通る。
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      ta.remove();
      if (copied) { done(); return; }
      button.textContent = 'コピーできません — 開くリンクを長押し';
    }

    const render = () => {
      const base = baseUrl();
      paths.forEach(el => {
        let tools = el.nextElementSibling;
        if (!tools || !tools.classList.contains('check-tools')) {
          tools = document.createElement('span');
          tools.className = 'check-tools';
          const a = document.createElement('a');
          a.className = 'check-open';
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = '開く';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'check-copy';
          btn.textContent = 'URL をコピー';
          btn.addEventListener('click', () => copyText(a.href, btn));
          tools.append(a, btn);
          el.after(tools);
        }
        if (!base) { tools.hidden = true; return; }   // 未入力の間は path だけを見せる
        tools.hidden = false;
        tools.querySelector('.check-open').href = base + (el.dataset.path || '');
      });
    };

    hostIn.addEventListener('input', () => { save(); render(); });
    if (portIn) portIn.addEventListener('input', () => { save(); render(); });
    render();
  } catch (_) { /* ここが失敗しても回答フォームと本文は生きている */ }
})();
