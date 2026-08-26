#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DEFAULT_CONFIG = { widths: [380, 390, 1440], lang: 'ja', layout: 'document' };
const CHECK_NAMES = {
  A: 'page error',
  B: '横 overflow',
  C: '表は自分の箱の中で横に動く',
  D: 'タグの均衡',
  E: '未定義 class',
  F: '画像',
  G: 'ページ内参照',
  H: 'テーマ',
  I: 'details',
  J: '回答フォームの DOM 契約',
  K: '日本語の行頭禁則',
};

function usageError(message) {
  console.error(`check.js: ERROR: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { board: null, config: null, out: null, playwright: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('-') && !options.board) options.board = arg;
    else if (['--config', '--out', '--playwright'].includes(arg)) {
      if (!argv[i + 1]) usageError(`${arg} に値が必要です`);
      options[arg.slice(2)] = argv[++i];
    } else usageError(`不明な引数です: ${arg}`);
  }
  if (!options.board) usageError('board.html を指定してください');
  return options;
}

function loadPlaywright(explicitPath) {
  try { return require('playwright'); } catch (_) { /* Try configured paths next. */ }
  for (const candidate of [process.env.PLAYWRIGHT_ROOT, explicitPath].filter(Boolean)) {
    try { return require(path.resolve(candidate)); } catch (_) { /* Continue in the documented order. */ }
  }
  usageError(
    "Playwright が見つかりません。npm install playwright で導入するか、" +
    '既存 package のディレクトリを PLAYWRIGHT_ROOT または --playwright <path> で指定してください。'
  );
}

function loadConfig(configPath) {
  if (!configPath) return { ...DEFAULT_CONFIG };
  let incoming;
  try {
    incoming = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    usageError(`設定を読めません: ${configPath}: ${error.message}`);
  }
  if (!incoming || Array.isArray(incoming) || typeof incoming !== 'object') {
    usageError('設定 JSON の最上位は object にしてください');
  }
  const config = { ...DEFAULT_CONFIG, ...incoming };
  if (!Array.isArray(config.widths) || !config.widths.length ||
      config.widths.some(width => !Number.isInteger(width) || width <= 0)) {
    usageError('widths は正の整数の配列にしてください');
  }
  if (!['document', 'deck'].includes(config.layout)) {
    usageError('layout は document または deck にしてください');
  }
  return config;
}

function result(status, details = [], counterexample = null) {
  return { status, details, counterexample };
}

async function newPage(browser, boardUrl, width, colorScheme = 'light') {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme,
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${String(error)}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  await page.goto(boardUrl, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(40);
  return { context, page, errors };
}

async function closePage(handle) {
  await handle.context.close();
}

async function overflowState(page) {
  return page.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const body = document.body.scrollWidth - document.body.clientWidth;
    const offenders = [...document.body.querySelectorAll('*')]
      .filter(element => !element.closest('.table-wrap, .shot-zoom, .toc'))
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > innerWidth + 0.5 || rect.left < -0.5)
      .slice(0, 8)
      .map(({ element, rect }) => ({
        where: element.id ? `${element.tagName.toLowerCase()}#${element.id}` :
          `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map(c => `.${c}`).join('')}`,
        rightBy: Math.max(0, Math.round(rect.right - innerWidth)),
        leftBy: Math.max(0, Math.round(-rect.left)),
      }));
    return { doc, body, offenders };
  });
}

async function setAllDetails(page, open) {
  await page.evaluate(value => document.querySelectorAll('details').forEach(item => { item.open = value; }), open);
  await page.waitForTimeout(20);
}

function scanTagBalance(source) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const optionalEnd = new Set(['html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'rt', 'rp', 'optgroup', 'option', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
  const starts = new Map();
  const ends = new Map();
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[index] !== '<') { index += 1; continue; }
    const match = source.slice(index).match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)\b([^>]*)>/);
    if (!match) { index += 1; continue; }
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const selfClosing = /\/\s*>$/.test(match[0]);
    index += match[0].length;
    if (voidTags.has(tag) || optionalEnd.has(tag) || selfClosing) continue;
    const target = closing ? ends : starts;
    target.set(tag, (target.get(tag) || 0) + 1);
    if (!closing && ['script', 'style', 'textarea', 'title'].includes(tag)) {
      const closePattern = new RegExp(`<\\/\\s*${tag}\\s*>`, 'ig');
      closePattern.lastIndex = index;
      const close = closePattern.exec(source);
      if (close) {
        ends.set(tag, (ends.get(tag) || 0) + 1);
        index = close.index + close[0].length;
      }
    }
  }
  return [...new Set([...starts.keys(), ...ends.keys()])]
    .map(tag => ({ tag, difference: (starts.get(tag) || 0) - (ends.get(tag) || 0) }))
    .filter(item => item.difference !== 0)
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

async function undefinedClasses(page) {
  return page.evaluate(() => {
    const selectors = [];
    const collect = rules => {
      for (const rule of rules) {
        if (rule.selectorText) selectors.push(rule.selectorText);
        if (rule.cssRules) collect(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { collect(sheet.cssRules); } catch (_) { /* check only readable inline CSS */ }
    }
    const css = selectors.join('\n');
    const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isDefined = name => {
      const raw = new RegExp(`\\.${escapeRegExp(name)}(?![A-Za-z0-9_-])`);
      const escaped = new RegExp(`\\.${escapeRegExp(CSS.escape(name))}(?![A-Za-z0-9_-])`);
      return raw.test(css) || escaped.test(css);
    };
    const used = new Set();
    document.body.querySelectorAll('[class]').forEach(element => {
      element.getAttribute('class').split(/\s+/).filter(Boolean).forEach(name => used.add(name));
    });
    return [...used].filter(name => !isDefined(name)).sort();
  });
}

async function imageFailures(page) {
  return page.evaluate(() => [...document.images].flatMap(image => {
    const failures = [];
    const where = image.id ? `img#${image.id}` : `img[src="${(image.getAttribute('src') || '').slice(0, 80)}"]`;
    if (image.naturalWidth <= 0) failures.push(`${where}: 読み込めない`);
    if (!(image.getAttribute('alt') || '').trim()) failures.push(`${where}: alt が空`);
    return failures;
  }));
}

async function referenceFailures(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].flatMap(anchor => {
    const href = anchor.getAttribute('href');
    if (href === '#') return [];
    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch (_) { id = href.slice(1); }
    if (id && document.getElementById(id)) return [];
    const where = anchor.id ? `a#${anchor.id}` : `a[href="${href}"]`;
    return [`${where}: ${href} の宛先が無い`];
  }));
}

async function detailsFailures(page) {
  return page.evaluate(() => {
    const describe = element => element.id ? `${element.tagName.toLowerCase()}#${element.id}` :
      `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map(c => `.${c}`).join('')}`;
    return [...document.querySelectorAll('details')].flatMap(details => {
      details.open = true;
      const summary = details.querySelector(':scope > summary');
      const failures = [];
      if (!summary) return [`${describe(details)}: summary が無い`];
      const range = document.createRange();
      range.setStartAfter(summary);
      range.setEnd(details, details.childNodes.length);
      if (range.getBoundingClientRect().height <= 0) failures.push(`${describe(details)}: 開いても中身の高さが無い`);
      const marker = getComputedStyle(summary, '::marker');
      const before = getComputedStyle(summary, '::before');
      const markerVisible = getComputedStyle(summary).listStyleType !== 'none' &&
        !['none', '""', "''"].includes(marker.content);
      const beforeVisible = !['none', 'normal', '""', "''"].includes(before.content) &&
        before.display !== 'none';
      if (markerVisible && beforeVisible) failures.push(`${describe(details)}: marker と ::before が二重`);
      return failures;
    });
  });
}

async function kinsokuFailures(page) {
  return page.evaluate(() => {
    const prohibited = 'ぁぃぅぇぉっゃゅょー、。・：；？！）」』】';
    const root = document.querySelector('[data-board-id]') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('pre, textarea, style, script')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    const hits = [];
    let previous = null;
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '\u2060' || character === '\u200b' || /\s/.test(character)) continue;
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const lineStart = !previous || rect.left < previous.left - 0.5 || rect.top >= previous.bottom - 1;
        const inCode = Boolean(node.parentElement.closest('code'));
        if (lineStart && !inCode && prohibited.includes(character)) {
          const owner = node.parentElement.closest('[id]');
          hits.push(`${owner ? `#${owner.id}` : node.parentElement.tagName.toLowerCase()}: ` +
            `${text.slice(Math.max(0, index - 10), index)}【${character}】${text.slice(index + 1, index + 11)}`);
        }
        previous = rect;
      }
    }
    return hits;
  });
}

async function runPageErrors(browser, boardUrl, widths) {
  const failures = [];
  for (const width of widths) {
    const handle = await newPage(browser, boardUrl, width);
    failures.push(...handle.errors.map(error => `幅 ${width}px: ${error}`));
    await closePage(handle);
  }
  return result(failures.length ? 'fail' : 'pass', failures, 'fixture: broken-a.html');
}

async function runOverflow(browser, boardUrl, widths) {
  const failures = [];
  const modes = [
    { name: 'media-light', scheme: 'light', theme: null },
    { name: 'media-dark', scheme: 'dark', theme: null },
    { name: 'data-light', scheme: 'dark', theme: 'light' },
    { name: 'data-dark', scheme: 'light', theme: 'dark' },
  ];
  for (const width of widths) {
    for (const mode of modes) {
      const handle = await newPage(browser, boardUrl, width, mode.scheme);
      if (mode.theme) await handle.page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, mode.theme);
      for (const open of [false, true]) {
        await setAllDetails(handle.page, open);
        const state = await overflowState(handle.page);
        if (state.doc !== 0 || state.body !== 0 || state.offenders.length > 0) {
          const locations = state.offenders.length
            ? state.offenders.map(item => `${item.where} (右 +${item.rightBy}px / 左 +${item.leftBy}px)`).join(', ')
            : `documentElement +${state.doc}px / body +${state.body}px`;
          failures.push(`幅 ${width}px / ${mode.name} / details ${open ? 'open' : 'closed'}: ${locations}`);
        }
      }
      await closePage(handle);
    }
  }

  const probe = await newPage(browser, boardUrl, widths[0]);
  await probe.page.evaluate(() => {
    const wide = document.createElement('div');
    wide.id = 'pdh-check-wide';
    wide.style.width = `${innerWidth + 200}px`;
    wide.style.height = '1px';
    document.body.appendChild(wide);
  });
  const caught = await overflowState(probe.page);
  await probe.page.evaluate(() => document.getElementById('pdh-check-wide').remove());
  await closePage(probe);
  if (!caught.offenders.some(item => item.where === 'div#pdh-check-wide')) {
    failures.push('反証失敗: 故意の横はみ出しを検出できない');
  }
  return result(failures.length ? 'fail' : 'pass', failures, 'runtime injection: #pdh-check-wide');
}

async function runTables(browser, boardUrl, widths) {
  const failures = [];
  const inspect = page => page.evaluate(() => {
    const pageMoves = document.documentElement.scrollWidth !== document.documentElement.clientWidth ||
      document.body.scrollWidth !== document.body.clientWidth;
    return [...document.querySelectorAll('.table-wrap')].flatMap(wrap => {
      if (wrap.scrollWidth <= wrap.clientWidth) return [];
      const overflow = getComputedStyle(wrap).overflowX;
      const where = wrap.id ? `#${wrap.id}` : `.${[...wrap.classList].join('.')}`;
      const failures = [];
      if (!['auto', 'scroll'].includes(overflow)) failures.push(`${where}: overflow-x が ${overflow}`);
      if (pageMoves) failures.push(`${where}: 表と一緒にページ本体も横へ動く`);
      return failures;
    });
  });
  for (const width of widths) {
    const handle = await newPage(browser, boardUrl, width);
    const found = await inspect(handle.page);
    failures.push(...found.map(item => `幅 ${width}px: ${item}`));
    await closePage(handle);
  }

  const handle = await newPage(browser, boardUrl, widths[0]);
  await handle.page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.id = 'pdh-check-table-wrap';
    wrap.className = 'table-wrap';
    wrap.style.overflowX = 'visible';
    wrap.style.width = '100px';
    const table = document.createElement('table');
    table.style.width = '400px';
    table.innerHTML = '<tbody><tr><td>probe</td></tr></tbody>';
    wrap.appendChild(table);
    (document.querySelector('[data-board-id]') || document.body).appendChild(wrap);
  });
  const caught = await inspect(handle.page);
  await handle.page.evaluate(() => document.getElementById('pdh-check-table-wrap').remove());
  await closePage(handle);
  if (!caught.length) failures.push('反証失敗: 箱からはみ出す表を検出できない');
  return result(failures.length ? 'fail' : 'pass', failures, 'runtime injection: #pdh-check-table-wrap');
}

async function runClasses(browser, boardUrl, width) {
  const handle = await newPage(browser, boardUrl, width);
  const failures = (await undefinedClasses(handle.page)).map(name => `.${name}`);
  await handle.page.evaluate(() => {
    const target = document.createElement('div');
    target.id = 'pdh-check-class';
    target.className = 'pdh-check-intentionally-undefined';
    document.body.appendChild(target);
  });
  const caught = await undefinedClasses(handle.page);
  await handle.page.evaluate(() => document.getElementById('pdh-check-class').remove());
  await closePage(handle);
  if (!caught.includes('pdh-check-intentionally-undefined')) failures.push('反証失敗: 故意の未定義 class を検出できない');
  return result(failures.length ? 'fail' : 'pass', failures, 'runtime injection: .pdh-check-intentionally-undefined');
}

async function runImages(browser, boardUrl, width) {
  const handle = await newPage(browser, boardUrl, width);
  const failures = await imageFailures(handle.page);
  await handle.page.evaluate(async () => {
    const image = document.createElement('img');
    image.id = 'pdh-check-broken-image';
    image.alt = '反証用';
    image.src = 'data:image/png;base64,broken';
    document.body.appendChild(image);
    await new Promise(resolve => { image.onload = resolve; image.onerror = resolve; });
  });
  const caught = await imageFailures(handle.page);
  await handle.page.evaluate(() => document.getElementById('pdh-check-broken-image').remove());
  await closePage(handle);
  if (!caught.some(item => item.includes('#pdh-check-broken-image'))) failures.push('反証失敗: 壊れた画像を検出できない');
  return result(failures.length ? 'fail' : 'pass', failures, 'runtime injection: img#pdh-check-broken-image');
}

async function runReferences(browser, boardUrl, width) {
  const handle = await newPage(browser, boardUrl, width);
  const failures = await referenceFailures(handle.page);
  await handle.page.evaluate(() => {
    const anchor = document.createElement('a');
    anchor.id = 'pdh-check-reference';
    anchor.href = '#pdh-check-missing-target';
    document.body.appendChild(anchor);
  });
  const caught = await referenceFailures(handle.page);
  await handle.page.evaluate(() => document.getElementById('pdh-check-reference').remove());
  await closePage(handle);
  if (!caught.some(item => item.includes('#pdh-check-reference'))) failures.push('反証失敗: 壊れたページ内参照を検出できない');
  return result(failures.length ? 'fail' : 'pass', failures, 'runtime injection: a#pdh-check-reference');
}

async function runTheme(browser, boardUrl, width) {
  const samples = [];
  for (const mode of [
    { name: 'media-light', scheme: 'light', theme: null },
    { name: 'media-dark', scheme: 'dark', theme: null },
    { name: 'data-light', scheme: 'dark', theme: 'light' },
    { name: 'data-dark', scheme: 'light', theme: 'dark' },
  ]) {
    const handle = await newPage(browser, boardUrl, width, mode.scheme);
    if (mode.theme) await handle.page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, mode.theme);
    samples.push(await handle.page.evaluate(name => ({
      name,
      background: getComputedStyle(document.body).backgroundColor,
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }), mode.name));
    await closePage(handle);
  }
  const failures = [];
  const transparent = value => !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
  samples.forEach(sample => {
    if (transparent(sample.background)) failures.push(`${sample.name}: body の背景が透明`);
    if (!sample.bg) failures.push(`${sample.name}: --bg が未定義`);
  });
  const mediaLight = samples.find(sample => sample.name === 'media-light');
  const dataLight = samples.find(sample => sample.name === 'data-light');
  for (const darkName of ['media-dark', 'data-dark']) {
    const dark = samples.find(sample => sample.name === darkName);
    const light = darkName === 'media-dark' ? mediaLight : dataLight;
    if (dark.background === light.background) failures.push(`${darkName}: body の背景が明テーマと同じ`);
  }
  return result(failures.length ? 'fail' : 'pass', failures, 'fixture: broken-h.html');
}

async function runDetails(browser, boardUrl, widths) {
  const failures = [];
  for (const width of widths) {
    const handle = await newPage(browser, boardUrl, width);
    failures.push(...(await detailsFailures(handle.page)).map(item => `幅 ${width}px: ${item}`));
    const afterOpen = await overflowState(handle.page);
    if (afterOpen.doc !== 0 || afterOpen.body !== 0) failures.push(`幅 ${width}px: すべて開いた状態でページ本体が横 overflow する`);
    await closePage(handle);
  }
  return result(failures.length ? 'fail' : 'pass', failures, 'fixture: broken-i.html');
}

async function runAnswerForm(browser, boardUrl, width) {
  const handle = await newPage(browser, boardUrl, width);
  const page = handle.page;
  const hasForm = await page.evaluate(() => Boolean(document.querySelector('[data-q]')));
  if (!hasForm) {
    await closePage(handle);
    return result('skip', ['この board には回答フォームが無い'], 'fixture: broken-j.html');
  }
  const failures = await page.evaluate(() => {
    const describe = element => element.id ? `${element.tagName.toLowerCase()}#${element.id}` :
      `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 2).map(c => `.${c}`).join('')}`;
    const issues = [];
    document.querySelectorAll('.answer-choice').forEach(choice => {
      if (!choice.dataset.q) issues.push(`${describe(choice)}: data-q が無い`);
      if (!choice.dataset.label) issues.push(`${describe(choice)}: data-label が無い`);
    });
    const root = document.querySelector('[data-board-id]');
    if (!root) return [...issues, '回答フォームの外枠 [data-board-id] が無い'];
    const required = [
      ['textarea[data-answer-output]', '貼り戻し欄が外枠内にちょうど 1 つ必要', true],
      ['.answer-progress', '.answer-progress が外枠内に無い'],
      ['[data-copy-answer]', '[data-copy-answer] が外枠内に無い'],
      ['[data-copy-status]', '[data-copy-status] が外枠内に無い'],
    ];
    required.forEach(([selector, message, exact]) => {
      const matches = root.querySelectorAll(selector);
      if ((exact && matches.length !== 1) || (!exact && matches.length === 0)) issues.push(message);
    });
    return issues;
  });

  const choice = page.locator('.answer-choice').first();
  const note = page.locator('.answer-note').first();
  const output = page.locator('textarea[data-answer-output]').first();
  const copy = page.locator('[data-copy-answer]').first();
  const status = page.locator('[data-copy-status]').first();
  const hasChoice = await page.evaluate(() => Boolean(document.querySelector('.answer-choice')));
  const hasOutput = await page.evaluate(() => Boolean(document.querySelector('textarea[data-answer-output]')));
  if (!hasChoice || !hasOutput) {
    failures.push('選択肢または貼り戻し欄が無く、動作検査を続けられない');
  } else {
    const beforeAria = await choice.getAttribute('aria-pressed');
    const beforeOutput = await output.inputValue();
    await choice.click();
    const afterAria = await choice.getAttribute('aria-pressed');
    const afterOutput = await output.inputValue();
    if (beforeAria === afterAria || afterAria !== 'true') failures.push('選択肢を click しても aria-pressed が変わらない');
    if (beforeOutput === afterOutput) failures.push('選択肢を click しても貼り戻し欄が変わらない');

    const storageAvailable = await page.evaluate(() => {
      try { localStorage.clear(); return true; } catch (_) { return false; }
    });
    if (!storageAvailable) failures.push('localStorage が使えず reload 後の復元を検査できない');
    await page.reload({ waitUntil: 'load' });
    await page.locator('.answer-choice').first().focus();
    await page.keyboard.press('Space');
    if (await page.locator('.answer-choice').first().getAttribute('aria-pressed') !== 'true') {
      failures.push('選択肢を focus して Space を押しても選べない');
    }
    const hasNote = await page.evaluate(() => Boolean(document.querySelector('.answer-note')));
    if (hasNote) {
      const beforeNoteOutput = await output.inputValue();
      await note.fill('selftest note');
      if (await output.inputValue() === beforeNoteOutput) failures.push('.answer-note に入力しても貼り戻し欄が変わらない');
    } else failures.push('.answer-note が無い');

    const savedOutput = await output.inputValue();
    const savedNote = hasNote ? await note.inputValue() : null;
    await page.reload({ waitUntil: 'load' });
    if (await page.locator('.answer-choice').first().getAttribute('aria-pressed') !== 'true' ||
        await output.inputValue() !== savedOutput ||
        (savedNote !== null && await note.inputValue() !== savedNote)) {
      failures.push('reload すると選択またはメモが残らない');
    }

    const hasCopyParts = await page.evaluate(() => Boolean(
      document.querySelector('[data-copy-answer]') && document.querySelector('[data-copy-status]')
    ));
    if (hasCopyParts) {
      const oldStatus = await status.textContent();
      const originalReadOnly = await output.evaluate(element => element.readOnly);
      await copy.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      if (await status.textContent() === oldStatus) failures.push('コピーボタンをキーボードで押しても状態表示が変わらない');
      if (await output.evaluate(element => element.readOnly) !== originalReadOnly) {
        failures.push('コピー後に貼り戻し欄の readOnly が元へ戻らない');
      }

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('intentional clipboard rejection')) },
        });
        document.execCommand = () => false;
        document.querySelector('[data-copy-status]').textContent = '';
      });
      await copy.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      const fallbackStatus = (await status.textContent()).trim();
      if (!fallbackStatus || !/コピー|選択|長押し|キーボード/.test(fallbackStatus)) {
        failures.push('clipboard.writeText を拒否しても fallback の案内が出ない');
      }
    }
  }
  if (handle.errors.length) failures.push(...handle.errors.map(error => `回答操作中: ${error}`));
  await closePage(handle);
  return result(failures.length ? 'fail' : 'pass', failures, 'fixture: broken-j.html');
}

async function runKinsoku(browser, boardUrl, widths, lang) {
  if (!String(lang).toLowerCase().startsWith('ja')) {
    return result('skip', ['lang が ja ではないため検査しない'], 'runtime injection on ja board');
  }
  const failures = [];
  let counterexampleCaught = false;
  for (const width of widths) {
    const handle = await newPage(browser, boardUrl, width);
    for (const open of [false, true]) {
      await setAllDetails(handle.page, open);
      const hits = await kinsokuFailures(handle.page);
      failures.push(...hits.map(hit => `幅 ${width}px / details ${open ? 'open' : 'closed'}: ${hit}`));
    }
    if (!counterexampleCaught) {
      await handle.page.evaluate(() => {
        const probe = document.createElement('p');
        probe.id = 'pdh-check-kinsoku';
        probe.innerHTML = 'あ<br>。い';
        (document.querySelector('[data-board-id]') || document.body).appendChild(probe);
      });
      counterexampleCaught = (await kinsokuFailures(handle.page)).some(hit => hit.includes('#pdh-check-kinsoku'));
      await handle.page.evaluate(() => document.getElementById('pdh-check-kinsoku').remove());
    }
    await closePage(handle);
  }
  if (!counterexampleCaught) failures.push('反証失敗: 故意の行頭約物を検出できない');
  return result(failures.length ? 'fail' : 'pass', failures, 'runtime injection: #pdh-check-kinsoku');
}

function printSummary(results) {
  for (const letter of Object.keys(CHECK_NAMES)) {
    const item = results[letter];
    const label = item.status === 'pass' ? 'PASS' : item.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`${label} ${letter}. ${CHECK_NAMES[letter]}`);
    item.details.forEach(detail => console.log(`  - ${detail}`));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const boardPath = path.resolve(args.board);
  if (!fs.existsSync(boardPath)) usageError(`board が見つかりません: ${boardPath}`);
  const config = loadConfig(args.config ? path.resolve(args.config) : null);
  const playwright = loadPlaywright(args.playwright);
  const boardUrl = pathToFileURL(boardPath).href;
  const source = fs.readFileSync(boardPath, 'utf8');
  const browser = await playwright.chromium.launch({ headless: true });
  const results = {};
  try {
    results.A = await runPageErrors(browser, boardUrl, config.widths);
    results.B = await runOverflow(browser, boardUrl, config.widths);
    results.C = await runTables(browser, boardUrl, config.widths);
    const imbalance = scanTagBalance(source);
    results.D = result(imbalance.length ? 'fail' : 'pass',
      imbalance.length
        ? ['均衡していない', ...imbalance.map(item => `${item.tag}: ${item.difference > 0 ? '+' : ''}${item.difference}`)]
        : ['均衡している'],
      'fixture: broken-d.html');
    results.E = await runClasses(browser, boardUrl, config.widths[0]);
    results.F = await runImages(browser, boardUrl, config.widths[0]);
    results.G = await runReferences(browser, boardUrl, config.widths[0]);
    results.H = await runTheme(browser, boardUrl, config.widths[0]);
    results.I = await runDetails(browser, boardUrl, config.widths);
    results.J = await runAnswerForm(browser, boardUrl, config.widths[0]);
    results.K = await runKinsoku(browser, boardUrl, config.widths, config.lang);
  } finally {
    await browser.close();
  }
  printSummary(results);
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify({ board: boardPath, checks: results }, null, 2) + '\n');
  }
  process.exitCode = Object.values(results).some(item => item.status === 'fail') ? 1 : 0;
}

main().catch(error => {
  console.error(`check.js: ERROR: ${error.stack || error.message}`);
  process.exit(2);
});
