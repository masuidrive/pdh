import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { URL } from "node:url";
import { renderMermaidSVG } from "beautiful-mermaid";
import { evaluateAcVerificationTable } from "./ac-verification.mjs";
import { buildFlowView, getStep, renderMermaidFlow } from "./flow.mjs";
import { loadStepInterruptions } from "./interruptions.mjs";
import { loadJudgements } from "./judgements.mjs";
import { extractSection, loadCurrentNote, parseStepHistory } from "./note-state.mjs";
import { createRedactor } from "./redaction.mjs";
import { loadStepUiOutput, loadStepUiRuntime } from "./step-ui.mjs";
import { hasCompletedProviderAttempt, latestAttemptResult, latestHumanGate, loadRuntime, readProgressEvents, stepDir } from "./runtime-state.mjs";

const MAX_TEXT = 120000;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".patch", ".diff", ".log", ".mmd"]);

export function startWebServer({ repoPath = process.cwd(), host = "127.0.0.1", port = 8765 } = {}) {
  const repo = resolve(repoPath);
  const server = createServer((request, response) => {
    handleRequest({ request, response, repo });
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualHost = address.address === "::" ? "localhost" : address.address;
      resolveServer({
        server,
        repo,
        url: `http://${actualHost}:${address.port}/`
      });
    });
  });
}

function handleRequest({ request, response, repo }) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    sendJson(response, 405, { error: "read_only_web_ui" });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendHtml(response, renderHtml());
    return;
  }
  if (url.pathname === "/api/state") {
    sendJson(response, 200, collectState({ repo }));
    return;
  }
  if (url.pathname === "/api/events") {
    sendEventStream({ request, response, repo });
    return;
  }
  if (url.pathname === "/api/flow.mmd") {
    sendText(response, 200, collectMermaid({ repo, variant: url.searchParams.get("variant") }));
    return;
  }
  if (url.pathname === "/api/render-mermaid") {
    const code = url.searchParams.get("code") ?? "";
    const svg = renderBeautifulMermaid(code);
    if (!svg) {
      sendJson(response, 400, { error: "invalid_mermaid" });
      return;
    }
    sendSvg(response, 200, svg);
    return;
  }
  if (url.pathname === "/api/artifact") {
    const payload = collectArtifactPayload({
      repo,
      stepId: url.searchParams.get("step"),
      name: url.searchParams.get("name")
    });
    if (!payload) {
      sendJson(response, 404, { error: "artifact_not_found" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  if (url.pathname === "/api/diff") {
    const payload = collectDiffPayload({
      repo,
      stepId: url.searchParams.get("step")
    });
    if (!payload) {
      sendJson(response, 404, { error: "diff_not_found" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  if (url.pathname === "/api/file") {
    const payload = collectRepoFilePayload({
      repo,
      stepId: url.searchParams.get("step"),
      path: url.searchParams.get("path")
    });
    if (!payload) {
      sendJson(response, 404, { error: "file_not_found" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

function sendEventStream({ request, response, repo }) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 3000\n\n");

  let previous = "";
  const pushState = () => {
    const payload = JSON.stringify(collectState({ repo }));
    if (payload === previous) {
      return;
    }
    previous = payload;
    response.write(`event: state\ndata: ${payload}\n\n`);
  };

  const heartbeat = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, 15000);
  const ticker = setInterval(pushState, 2000);
  pushState();

  const cleanup = () => {
    clearInterval(heartbeat);
    clearInterval(ticker);
    response.end();
  };
  request.on("close", cleanup);
  request.on("aborted", cleanup);
}

function collectState({ repo }) {
  const runtime = loadRuntime(repo);
  const redactor = createRedactor({ repoPath: repo });
  const note = runtime.note;
  const ticketText = existsSync(join(repo, "current-ticket.md")) ? readFileSync(join(repo, "current-ticket.md"), "utf8") : "";
  const run = runtime.run;
  const currentStep = run?.current_step_id ? getStep(runtime.flow, run.current_step_id) : null;
  const currentGate = run?.id && currentStep ? latestHumanGate({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id }) : null;
  const interruptions = run?.id && currentStep
    ? loadStepInterruptions({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id }).map((item) => redactObject(item, redactor))
    : [];
  const events = run ? readProgressEvents({ repoPath: repo, runId: run.id, limit: 120 }).map((event) => redactObject(event, redactor)) : [];
  const history = parseStepHistory(note.body).entries;
  const ac = evaluateAcVerificationTable({ repoPath: repo, allowUnverified: true });
  const variants = Object.fromEntries(["full", "light"].map((variant) => [
    variant,
    buildVariantState({ repo, runtime, variant, history, events, redactor, noteBody: note.body, ticketText, ac })
  ]));
  const activeVariant = run?.flow_variant ?? note.pdh.variant ?? "full";
  const summary = buildSummary({ runtime, activeVariant: variants[activeVariant], ac, currentStep, currentGate, interruptions });
  return {
    repo,
    repoName: basename(repo),
    mode: "read-only",
    generatedAt: new Date().toISOString(),
    runtime: {
      run: run ? redactObject(run, redactor) : null,
      noteState: redactObject(note.pdh, redactor),
      currentStep: currentStep ? stepMeta(currentStep) : null
    },
    summary,
    flow: {
      activeVariant,
      variants
    },
    current: {
      gate: currentGate ? gatePayload(currentGate, redactor) : null,
      interruptions,
      nextAction: describeNextAction({ repo, runtime, currentStep, currentGate, interruptions }),
      stepArtifacts: currentStep && run?.id ? listStepArtifacts({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id, redactor }) : []
    },
    history,
    events,
    ac: {
      ok: ac.ok,
      counts: ac.counts,
      errors: ac.errors
    },
    git: gitState(repo, redactor),
    files: {
      note: join(repo, "current-note.md"),
      ticket: join(repo, "current-ticket.md")
    },
    documents: {
      note: {
        path: join(repo, "current-note.md"),
        text: clampText(redactor(note.text), MAX_TEXT)
      },
      ticket: {
        path: join(repo, "current-ticket.md"),
        text: clampText(redactor(ticketText), MAX_TEXT)
      }
    }
  };
}

function buildVariantState({ repo, runtime, variant, history, events, redactor, noteBody, ticketText, ac }) {
  const view = buildFlowView(runtime.flow, variant, runtime.run?.current_step_id ?? null);
  const sequenceSet = new Set(view.sequence);
  const historyByStep = latestHistoryByStep(history);
  const ticketImplementationNotes = redactSection(extractSection(ticketText, "Implementation Notes"), redactor);
  const steps = view.steps.map((step, index) => {
    const historyEntry = historyByStep.get(step.id) ?? null;
    const current = runtime.run?.current_step_id === step.id;
    const attempt = runtime.run?.id
      ? latestAttemptResult({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, provider: step.provider })
      : null;
    const gate = runtime.run?.id ? latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const interruptions = current && runtime.run?.id
      ? loadStepInterruptions({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }).map((item) => redactObject(item, redactor))
      : [];
    const progress = stepProgress({
      runtime,
      variant,
      sequence: view.sequence,
      index,
      step,
      historyEntry,
      gate,
      attempt,
      interruptions
    });
    const uiOutput = runtime.run?.id ? loadStepUiOutput({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const uiRuntime = runtime.run?.id ? loadStepUiRuntime({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    return {
      ...stepMeta(step),
      progress,
      current,
      uiContract: step.ui ?? null,
      uiOutput: uiOutput ? redactObject(uiOutput, redactor) : null,
      uiRuntime: uiRuntime ? redactObject(uiRuntime, redactor) : null,
      noteSection: redactSection(resolveStepNoteSection(noteBody, step.id), redactor),
      ticketImplementationNotes,
      acTableText: redactSection(extractSection(noteBody, "AC 裏取り結果"), redactor),
      acSummary: {
        verified: ac.counts?.verified ?? 0,
        deferred: ac.counts?.deferred ?? 0,
        unverified: ac.counts?.unverified ?? 0
      },
      historyEntry,
      latestAttempt: attempt ? redactObject(attempt, redactor) : null,
      gate: gate ? gatePayload(gate, redactor) : null,
      interruptions,
      judgements: runtime.run?.id
        ? loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }).map((judgement) => redactObject(judgement, redactor))
        : [],
      reviewDiff: runtime.run?.id ? redactObject(collectDiffPayload({ repo, stepId: step.id, includePatch: false }), redactor) : null,
      artifacts: runtime.run?.id ? listStepArtifacts({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, redactor }) : [],
      events: events.filter((event) => event.stepId === step.id).slice(-12)
    };
  });
  const skippedSteps = runtime.flow.variants?.full?.sequence?.filter((stepId) => !sequenceSet.has(stepId)) ?? [];
  return {
    id: view.id,
    variant,
    count: steps.length,
    initial: view.initial,
    sequence: view.sequence,
    mermaid: renderMermaidFlow(runtime.flow, variant, runtime.run?.current_step_id ?? null),
    overview: buildOverview({ runtime, variant, steps }),
    steps,
    skippedSteps
  };
}

function buildOverview({ runtime, variant, steps }) {
  const groups = [
    { id: "start", label: "Start", title: "開始", stepIds: [] },
    { id: "plan", label: "Plan", title: "計画", stepIds: variant === "full" ? ["PD-C-2", "PD-C-3", "PD-C-4", "PD-C-5"] : ["PD-C-3", "PD-C-5"] },
    { id: "implement", label: "Build", title: "実装", stepIds: ["PD-C-6"] },
    { id: "review", label: "Review", title: "検証", stepIds: variant === "full" ? ["PD-C-7", "PD-C-8", "PD-C-9"] : ["PD-C-7", "PD-C-9"] },
    { id: "close", label: "Close", title: "完了承認", stepIds: ["PD-C-10"] },
    { id: "done", label: "End", title: "完了", stepIds: [] }
  ];
  return groups.map((group, index) => {
    if (group.id === "start") {
      return {
        ...group,
        state: runtime.run ? "done" : "pending"
      };
    }
    if (group.id === "done") {
      return {
        ...group,
        state: runtime.run?.status === "completed" ? "done" : "pending"
      };
    }
    const related = steps.filter((step) => group.stepIds.includes(step.id));
    if (related.some((step) => step.progress.status === "failed")) {
      return { ...group, state: "waiting" };
    }
    if (related.every((step) => step.progress.status === "done")) {
      return { ...group, state: "done" };
    }
    if (related.some((step) => step.current || step.progress.status === "running")) {
      return { ...group, state: "running" };
    }
    if (related.some((step) => step.progress.status === "waiting" || step.progress.status === "blocked")) {
      return { ...group, state: "waiting" };
    }
    const beforeCurrent = steps.findIndex((step) => step.current);
    const relatedIndex = Math.min(...related.map((step) => steps.findIndex((item) => item.id === step.id)).filter((value) => value >= 0));
    return { ...group, state: beforeCurrent >= 0 && relatedIndex < beforeCurrent ? "done" : "pending" };
  });
}

function buildSummary({ runtime, activeVariant, ac, currentStep, currentGate, interruptions }) {
  const doneCount = activeVariant.steps.filter((step) => step.progress.status === "done").length;
  const total = activeVariant.steps.length;
  const openItems = [
    runtime.run?.status === "needs_human" ? 1 : 0,
    interruptions.length > 0 ? 1 : 0,
    runtime.run?.status === "blocked" ? 1 : 0,
    runtime.run?.status === "failed" ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
  return {
    doneCount,
    totalSteps: total,
    currentLabel: currentStep ? `${currentStep.id} ${currentStep.label}` : "未開始",
    acCounts: ac.counts,
    openItems,
    gateStatus: currentGate?.decision ?? currentGate?.status ?? null
  };
}

function stepProgress({ runtime, sequence, index, step, historyEntry, gate, attempt, interruptions }) {
  const run = runtime.run;
  if (!sequence.includes(step.id)) {
    return progress("skipped", "スキップ", "選択中 variant では実行しない step です。");
  }
  if (!run) {
    return progress("pending", "未開始", "まだ run が始まっていません。");
  }
  if (run.status === "completed") {
    return progress("done", "完了", "この run は完了しています。");
  }
  const currentIndex = sequence.indexOf(run.current_step_id);
  if (step.id === run.current_step_id) {
    if (run.status === "needs_human") {
      return progress("waiting", "ユーザ回答待ち", gate?.summary ? "gate summary を確認して CLI で判断します。" : "gate summary を生成中です。");
    }
    if (run.status === "interrupted") {
      return progress("waiting", "割り込み待ち", interruptions.length > 0 ? "CLI で answer すると継続します。" : "割り込み回答待ちです。");
    }
    if (run.status === "blocked") {
      return progress("blocked", "ガード待ち", "必要な記録や検証を追加してから `run-next` を再実行します。");
    }
    if (run.status === "failed") {
      return progress("failed", "再試行待ち", "provider の再実行または resume が必要です。");
    }
    if (step.provider !== "runtime" && run.id && hasCompletedProviderAttempt({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id, provider: step.provider })) {
      return progress("waiting", "advance待ち", "`run-next` で guard 評価と遷移を進めます。");
    }
    return progress("running", "実行中", "provider がこの step を実行しています。");
  }
  if (historyEntry) {
    return progress("done", "完了", historyEntry.summary);
  }
  if (currentIndex >= 0 && index < currentIndex) {
    return progress("done", "完了", "履歴行がなくても先行 step とみなします。");
  }
  if (attempt?.status === "failed") {
    return progress("failed", "失敗", "最新 attempt が失敗しています。");
  }
  return progress("pending", "未着手", "前段 step の完了後に自動で開始されます。");
}

function progress(status, label, note = "") {
  return { status, label, note };
}

function latestHistoryByStep(entries) {
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.stepId, entry);
  }
  return map;
}

function stepMeta(step) {
  return {
    id: step.id,
    label: step.label ?? step.id,
    summary: step.summary ?? "",
    userAction: step.userAction ?? "",
    ui: step.ui ?? null,
    provider: step.provider,
    mode: step.mode
  };
}

function resolveStepNoteSection(noteBody, stepId) {
  const headingByStep = {
    "PD-C-2": "PD-C-2. 調査結果",
    "PD-C-3": "PD-C-3. 計画",
    "PD-C-4": "PD-C-4. 計画レビュー結果",
    "PD-C-6": "PD-C-6",
    "PD-C-7": "PD-C-7. 品質検証結果",
    "PD-C-8": "PD-C-8. 目的妥当性確認",
    "PD-C-9": "PD-C-9. プロセスチェックリスト",
    "PD-C-10": "PD-C-10"
  };
  const heading = headingByStep[stepId];
  return heading ? extractSection(noteBody, heading) ?? "" : "";
}

function redactSection(text, redactor) {
  return clampText(redactor(String(text ?? "")), 16000);
}

function describeNextAction({ repo, runtime, currentStep, currentGate, interruptions }) {
  if (!runtime.run || !currentStep) {
    const command = `node src/cli.mjs run --repo ${shellQuote(repo)} --ticket <ticket-id> --variant full`;
    return {
      title: "最初にすること",
      body: "repo root で `run` を実行して current-note.md の frontmatter を初期化します。",
      commands: [command],
      actions: [
        nextActionChoice({
          label: "Run",
          description: "新しい flow を開始して current-note.md の state を初期化します。",
          command
        })
      ],
      selection: "single",
      targetTab: "commands"
    };
  }
  if (runtime.run.status === "needs_human") {
    const actions = humanDecisionActions(repo, currentStep.id);
    return {
      title: `${currentStep.id} の判断`,
      body: "Web UI は read-only です。gate summary を読んで terminal から判断します。",
      commands: actions.map((item) => item.command),
      actions,
      selection: "choose_one",
      targetTab: "gate"
    };
  }
  if (interruptions.length > 0 || runtime.run.status === "interrupted") {
    const actions = interruptAnswerActions(repo, currentStep.id);
    return {
      title: `${currentStep.id} の割り込み回答`,
      body: "質問内容を確認して CLI の `answer` で返答します。",
      commands: actions.map((item) => item.command),
      actions,
      selection: "ordered",
      targetTab: "detail"
    };
  }
  if (runtime.run.status === "failed") {
    const command = `node src/cli.mjs resume --repo ${shellQuote(repo)}`;
    return {
      title: `${currentStep.id} の再実行`,
      body: "失敗 summary を確認して `resume` か `run-provider` を再実行します。",
      commands: [command],
      actions: [
        nextActionChoice({
          label: "Resume",
          description: "保存済み provider session から再開します。summary を確認してから使います。",
          command,
          tone: "revise"
        })
      ],
      selection: "single",
      targetTab: "commands"
    };
  }
  if (runtime.run.status === "blocked") {
    const command = `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
    return {
      title: `${currentStep.id} の不足を解消`,
      body: blockedActionBody(currentStep),
      commands: [command],
      actions: [
        nextActionChoice({
          label: "Run Next",
          description: "不足している guard-facing artifact を補完したうえで、この step を再評価します。",
          command,
          tone: "revise"
        })
      ],
      selection: "single",
      targetTab: "detail"
    };
  }
  const command = `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
  return {
    title: `${currentStep.id} を進める`,
    body: "通常は `run-next` だけで、gate や割り込みまで自動で進みます。",
    commands: [command],
    actions: [
      nextActionChoice({
        label: "Run Next",
        description: "通常進行です。次の gate / interruption / failure / complete まで自動で進めます。",
        command,
        tone: "approve"
      })
    ],
    selection: "single",
    targetTab: "commands"
  };
}

function blockedActionBody(step) {
  const failed = Array.isArray(step?.uiRuntime?.guards) ? step.uiRuntime.guards.filter((guard) => guard.status === "failed") : [];
  const first = failed[0];
  if (!first) {
    return "必須 guard が不足しています。詳細を確認して `run-next` を再実行します。";
  }
  const evidence = String(first.evidence || "");
  if (/ui-output\.yaml has parse errors/i.test(evidence)) {
    return "provider は完了していますが、ui-output.yaml の構文エラーで review judgement を guard 用 artifact に落とせていません。通常は `run-next` の再実行で補完されます。繰り返す場合は ui-output.yaml を確認します。";
  }
  if (/present in ui-output\.yaml/i.test(evidence)) {
    return "provider は judgement 自体を書いていますが、guard が読む judgement artifact が不足しています。通常は `run-next` の再実行で補完されます。繰り返す場合は ui-output.yaml と judgements/ を確認します。";
  }
  if (/provider step completed/i.test(evidence)) {
    return "provider step は完了していますが、guard が必要とする structured evidence が不足しています。step artifacts を確認してから `run-next` を再実行します。";
  }
  return `必須 guard が不足しています: ${evidence || first.id || first.guardId || "unknown"}`;
}

function gatePayload(gate, redactor) {
  return {
    ...redactObject(gate, redactor),
    summaryText: gate.summary && existsSync(gate.summary) ? safeReadText(gate.summary, redactor) : ""
  };
}

function listStepArtifacts({ stateDir, runId, stepId, redactor }) {
  const dir = stepDir(stateDir, runId, stepId);
  if (!existsSync(dir)) {
    return [];
  }
  const artifacts = [];
  visitArtifacts(dir, artifacts, dir);
  return artifacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((artifact) => redactObject(artifact, redactor))
    .slice(0, 40);
}

function visitArtifacts(dir, artifacts, root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      visitArtifacts(fullPath, artifacts, root);
      continue;
    }
    artifacts.push({
      name: fullPath.slice(root.length + 1),
      path: fullPath,
      size: safeSize(fullPath)
    });
  }
}

function collectMermaid({ repo, variant = null }) {
  const runtime = loadRuntime(repo);
  return renderMermaidFlow(runtime.flow, variant ?? runtime.run?.flow_variant ?? "full", runtime.run?.current_step_id ?? null);
}

function collectArtifactPayload({ repo, stepId, name }) {
  const runtime = loadRuntime(repo);
  const runId = runtime.run?.id;
  if (!runId || !stepId || !name) {
    return null;
  }
  const redactor = createRedactor({ repoPath: repo });
  const dir = stepDir(runtime.stateDir, runId, stepId);
  if (!existsSync(dir)) {
    return null;
  }
  const resolvedName = String(name);
  const fullPath = resolve(dir, resolvedName);
  if (!(fullPath === dir || fullPath.startsWith(`${dir}/`)) || !existsSync(fullPath)) {
    return null;
  }
  const extension = extname(fullPath).toLowerCase();
  if (!TEXT_ARTIFACT_EXTENSIONS.has(extension)) {
    return {
      name: resolvedName,
      path: redactor(fullPath),
      size: safeSize(fullPath),
      text: "This artifact is not rendered in the web viewer.",
      markdown: false
    };
  }
  return {
    name: resolvedName,
    path: redactor(fullPath),
    size: safeSize(fullPath),
    text: safeReadText(fullPath, redactor),
    markdown: MARKDOWN_EXTENSIONS.has(extension)
  };
}

function resolveDiffBaseline({ repo, stepId }) {
  const runtime = loadRuntime(repo);
  const run = runtime.run;
  if (!run?.id || !stepId) {
    return null;
  }
  const variant = run.flow_variant ?? runtime.note.pdh.variant ?? "full";
  const view = buildFlowView(runtime.flow, variant, run.current_step_id ?? null);
  const stepIndex = view.sequence.indexOf(stepId);
  if (stepIndex < 0) {
    return null;
  }
  const history = parseStepHistory(runtime.note.body).entries
    .filter((entry) => entry.commit && entry.commit !== "-");
  const gateIds = view.steps.filter((step) => step.mode === "human").map((step) => step.id);
  const anchorGateId = gateIds.includes(stepId)
    ? stepId
    : gateIds.filter((id) => view.sequence.indexOf(id) < stepIndex).at(-1) ?? null;

  let baseRef = null;
  let baseLabel = null;
  let baseCommit = null;

  if (!anchorGateId) {
    const firstCommit = history
      .filter((entry) => {
        const index = view.sequence.indexOf(entry.stepId);
        return index >= 0 && index < stepIndex;
      })
      .sort((left, right) => view.sequence.indexOf(left.stepId) - view.sequence.indexOf(right.stepId))[0];
    if (!firstCommit) {
      baseRef = currentHead(repo) ?? "HEAD";
      baseLabel = "ticket start";
      baseCommit = currentHead(repo);
    } else {
      baseRef = parentCommit(repo, firstCommit.commit) ?? emptyTreeHash(repo);
      baseLabel = "ticket start";
      baseCommit = firstCommit.commit;
    }
  } else if (gateIds.indexOf(anchorGateId) === 0) {
    const firstCommit = history
      .filter((entry) => {
        const index = view.sequence.indexOf(entry.stepId);
        return index >= 0 && index < stepIndex;
      })
      .sort((left, right) => view.sequence.indexOf(left.stepId) - view.sequence.indexOf(right.stepId))[0];
    if (!firstCommit) {
      baseRef = currentHead(repo) ?? "HEAD";
      baseLabel = "ticket start";
      baseCommit = currentHead(repo);
    } else {
      baseRef = parentCommit(repo, firstCommit.commit) ?? emptyTreeHash(repo);
      baseLabel = "ticket start";
      baseCommit = firstCommit.commit;
    }
  } else {
    const gateIndex = gateIds.indexOf(anchorGateId);
    const previousGateId = gateIds[gateIndex - 1];
    const previousGateIndex = view.sequence.indexOf(previousGateId);
    const baseline = history
      .filter((entry) => {
        const index = view.sequence.indexOf(entry.stepId);
        return index >= 0 && index < previousGateIndex;
      })
      .sort((left, right) => view.sequence.indexOf(left.stepId) - view.sequence.indexOf(right.stepId))
      .at(-1);
    if (!baseline) {
      return null;
    }
    baseRef = baseline.commit;
    const previousGateIsFirst = gateIds.indexOf(previousGateId) === 0;
    baseLabel = previousGateIsFirst ? `${previousGateId} gate baseline (ticket start)` : `${previousGateId} gate baseline`;
    baseCommit = baseline.commit;
  }

  return {
    baseRef,
    baseLabel,
    baseCommit
  };
}

function collectDiffPayload({ repo, stepId, includePatch = true }) {
  const baseline = resolveDiffBaseline({ repo, stepId });
  if (!baseline) {
    return null;
  }
  const { baseRef, baseLabel, baseCommit } = baseline;

  const diffArgs = ["diff", "--no-ext-diff", "--submodule=diff", "--unified=3", baseRef, "--"];
  const statArgs = ["diff", "--stat", baseRef, "--"];
  const filesArgs = ["diff", "--name-only", baseRef, "--"];
  const diff = runGit(repo, diffArgs);
  const stat = runGit(repo, statArgs);
  const files = runGit(repo, filesArgs);

  return {
    stepId,
    baseLabel,
    baseCommit: baseCommit ? baseCommit.slice(0, 7) : null,
    diffStat: splitLines(stat.stdout),
    changedFiles: splitLines(files.stdout),
    patch: includePatch ? clampText(diff.stdout, MAX_TEXT) : null
  };
}

function resolveRepoFilePath(repo, relativePath) {
  if (!relativePath) {
    return null;
  }
  const fullPath = resolve(repo, relativePath);
  if (fullPath !== repo && !fullPath.startsWith(`${repo}/`)) {
    return null;
  }
  return existsSync(fullPath) ? fullPath : null;
}

function collectRepoFilePayload({ repo, stepId, path }) {
  const fullPath = resolveRepoFilePath(repo, path);
  if (!fullPath) {
    return null;
  }
  const baseline = resolveDiffBaseline({ repo, stepId });
  const redactor = createRedactor({ repoPath: repo });
  const relativePath = String(path).replace(/^\.\/+/, "");
  const patch = baseline
    ? clampText(runGit(repo, ["diff", "--no-ext-diff", "--submodule=diff", "--unified=3", baseline.baseRef, "--", relativePath]).stdout, MAX_TEXT)
    : "";
  return {
    stepId,
    path: relativePath,
    text: safeReadText(fullPath, redactor),
    markdown: MARKDOWN_EXTENSIONS.has(extname(relativePath).toLowerCase()),
    size: safeSize(fullPath),
    diff: {
      baseLabel: baseline?.baseLabel || "working tree",
      baseCommit: baseline?.baseCommit ? baseline.baseCommit.slice(0, 7) : null,
      patch
    }
  };
}

function gitState(repo, redactor) {
  const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(repo, ["status", "--short"]);
  const diff = runGit(repo, ["diff", "--", "current-note.md", "current-ticket.md", "src", "flows", "README.md", "product-brief.md", "technical-plan.md", "tasks.md"]);
  return {
    branch: firstLine(branch.stdout || branch.stderr || "unknown"),
    clean: !(status.stdout ?? "").trim(),
    statusLines: redactLines(status.stdout, redactor, 20),
    diffText: clampText(redactor(diff.stdout ?? ""), MAX_TEXT)
  };
}

function runGit(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, text: true, encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
}

function parentCommit(repo, commit) {
  const result = runGit(repo, ["rev-parse", `${commit}^`]);
  return result.status === 0 ? firstLine(result.stdout) : null;
}

function currentHead(repo) {
  const result = runGit(repo, ["rev-parse", "HEAD"]);
  return result.status === 0 ? firstLine(result.stdout) : null;
}

function emptyTreeHash(repo) {
  const result = runGit(repo, ["hash-object", "-t", "tree", "/dev/null"]);
  return firstLine(result.stdout);
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function safeReadText(path, redactor) {
  try {
    return clampText(redactor(readFileSync(path, "utf8")), MAX_TEXT);
  } catch {
    return "";
  }
}

function safeSize(path) {
  try {
    return statLabel(readFileSync(path).byteLength);
  } catch {
    return "-";
  }
}

function statLabel(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function clampText(text, limit) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n…`;
}

function redactObject(value, redactor) {
  return JSON.parse(redactor(JSON.stringify(value)));
}

function redactLines(text, redactor, limit) {
  return redactor(text ?? "").split(/\r?\n/).filter(Boolean).slice(0, limit);
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function humanDecisionCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs approve${repoArg} --step ${stepId} --reason ok`,
    `node src/cli.mjs request-changes${repoArg} --step ${stepId} --reason "<reason>"`,
    `node src/cli.mjs reject${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function interruptAnswerCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs show-interrupts${repoArg} --step ${stepId}`,
    `node src/cli.mjs answer${repoArg} --step ${stepId} --message "<answer>"`
  ];
}

function nextActionChoice({ label, description, command, tone = "neutral" }) {
  return { label, description, command, tone };
}

function humanDecisionActions(repo, stepId) {
  const [approve, requestChanges, reject] = humanDecisionCommands(repo, stepId);
  return [
    nextActionChoice({
      label: "Approve",
      description: "計画・レビュー結果・差分に問題がなければこれを選びます。PD-C-6 に進みます。",
      command: approve,
      tone: "approve"
    }),
    nextActionChoice({
      label: "Request Changes",
      description: "方向性はよいが、実装前に計画の修正が必要なときに選びます。PD-C-3 に戻します。",
      command: requestChanges,
      tone: "revise"
    }),
    nextActionChoice({
      label: "Reject",
      description: "この計画では進めるべきではないときに選びます。スコープや進め方が間違っている場合です。",
      command: reject,
      tone: "reject"
    })
  ];
}

function interruptAnswerActions(repo, stepId) {
  const [showInterrupts, answer] = interruptAnswerCommands(repo, stepId);
  return [
    nextActionChoice({
      label: "Show Interrupt",
      description: "未回答の質問内容を terminal で確認します。",
      command: showInterrupts,
      tone: "neutral"
    }),
    nextActionChoice({
      label: "Answer",
      description: "質問への回答を返して current step を再開します。",
      command: answer,
      tone: "approve"
    })
  ];
}

function renderBeautifulMermaid(code) {
  const diagram = String(code ?? "").trim();
  if (!diagram || diagram.length > 20000) {
    return "";
  }
  try {
    return renderMermaidSVG(diagram, {
      bg: "var(--surface)",
      fg: "var(--text)",
      accent: "#ba7517",
      muted: "#6d6b64",
      surface: "#f5f4ef",
      border: "#d6d3c8",
      line: "#a3a097",
      transparent: true
    });
  } catch {
    return "";
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendSvg(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDH Dev Dashboard</title>
<style>
  :root {
    --bg: #ffffff;
    --surface: #fafaf8;
    --surface-2: #f5f4ef;
    --border: #e8e6df;
    --border-strong: #d6d3c8;
    --text: #1c1b18;
    --text-muted: #6d6b64;
    --text-dim: #a3a097;
    --done: #1d9e75;
    --done-bg: #e1f5ee;
    --done-text: #0f6e56;
    --pending-bg: #f6f5f1;
    --pending-text: #a3a097;
    --waiting: #ba7517;
    --waiting-bg: #faeeda;
    --waiting-text: #854f0b;
    --waiting-border: #fac775;
    --skip-bg: #ede9dc;
    --skip-text: #8a887d;
    --critical-bg: #fcebeb;
    --critical-text: #a32d2d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', 'Meiryo', sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    min-height: 100%;
  }
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .header {
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; background: var(--bg); flex-wrap: wrap;
  }
  .brand {
    display: flex; align-items: center; gap: 10px;
    font-weight: 500; font-size: 14px; white-space: nowrap;
  }
  .brand-logo {
    width: 22px; height: 22px; border-radius: 6px;
    background: #1c1b18; color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600;
  }
  .breadcrumbs {
    font-size: 12px; color: var(--text-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0; flex: 1;
  }
  .breadcrumbs .sep { color: var(--text-dim); margin: 0 6px; }
  .breadcrumbs .current { color: var(--text); font-weight: 500; }
  .header-right {
    display: flex; align-items: center; gap: 10px;
    font-size: 11px; color: var(--text-muted);
    flex-wrap: wrap;
  }
  .flow-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px;
    background: #efeefc; color: #3c3489;
    font-size: 11px; font-weight: 500;
    border: 1px solid #cecbf6; white-space: nowrap;
  }
  .waiting-indicator {
    display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    padding: 4px 10px; border-radius: 999px;
    background: var(--waiting-bg); color: var(--waiting-text);
    font-weight: 500; border: 1px solid var(--waiting-border);
  }
  .waiting-indicator.critical {
    background: var(--critical-bg); color: var(--critical-text); border-color: #f0b7b7;
  }
  .waiting-indicator.running {
    background: #eaf3ff; color: #1f5fbf; border-color: #b8d4fb;
  }
  .waiting-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    animation: pulse 1.8s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(1.3); }
  }
  .main { display: grid; grid-template-columns: minmax(280px, 0.82fr) minmax(620px, 1.68fr); min-height: 0; flex: 1; }
  .panel-left { padding: 18px 20px 32px; border-right: 1px solid var(--border); min-width: 0; }
  .panel-right { background: var(--surface); min-width: 0; }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px; margin-bottom: 18px;
  }
  .summary-card {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 12px; min-width: 0;
  }
  .summary-card.alert { background: var(--waiting-bg); border-color: var(--waiting-border); }
  .summary-card.error { background: var(--critical-bg); border-color: #f0b7b7; }
  .summary-card.running { background: #eaf3ff; border-color: #b8d4fb; }
  .summary-card .label {
    font-size: 11px; color: var(--text-muted); margin-bottom: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .summary-card .value { font-size: 15px; font-weight: 500; }
  .summary-card .value .sub { font-size: 11px; color: var(--text-muted); font-weight: 400; }
  .summary-card .value.done { color: var(--done); }
  .summary-card .value.waiting { color: var(--waiting-text); }
  .summary-card .value.error { color: var(--critical-text); }
  .summary-card .value.running { color: #1f5fbf; }
  .section-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin: 16px 0 10px; gap: 12px; flex-wrap: wrap;
  }
  .section-title { font-size: 13px; font-weight: 500; color: var(--text); }
  .section-title .subtitle { font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
  .legend { display: flex; gap: 10px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 5px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .flow-container {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px;
  }
  .overview-scroll { overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; }
  .overview-flow { display: flex; align-items: center; gap: 6px; min-width: min-content; }
  .overview-node {
    flex: 0 0 auto; padding: 8px 12px;
    border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg); cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
    min-width: 96px; text-align: center;
  }
  .overview-node .ov-label { font-size: 10px; color: var(--text-dim); margin-bottom: 1px; }
  .overview-node .ov-name { font-weight: 500; color: var(--text); font-size: 12px; }
  .overview-node.done { background: var(--done-bg); border-color: #9fe1cb; }
  .overview-node.done .ov-label, .overview-node.done .ov-name { color: var(--done-text); }
  .overview-node.waiting {
    background: var(--waiting-bg); border-color: var(--waiting-border);
    box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
  }
  .overview-node.waiting .ov-label, .overview-node.waiting .ov-name { color: var(--waiting-text); }
  .overview-node.running {
    background: #eaf3ff; border-color: #b8d4fb;
    box-shadow: 0 0 0 3px rgba(31, 95, 191, 0.14);
  }
  .overview-node.running .ov-label, .overview-node.running .ov-name { color: #1f5fbf; }
  .overview-node.pending {
    background: var(--pending-bg); border-color: var(--border); opacity: 0.55;
  }
  .overview-node.pending .ov-name { color: var(--pending-text); }
  .overview-node:hover { transform: translateY(-1px); border-color: var(--border-strong); }
  .overview-node.selected { outline: 2px solid #1c1b18; outline-offset: 1px; }
  .overview-arrow { color: var(--text-dim); flex: 0 0 auto; font-size: 12px; }
  .pdc-list { display: flex; flex-direction: column; gap: 8px; }
  .node {
    position: relative; background: var(--bg);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 12px; cursor: pointer;
    transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
    display: flex; align-items: center; gap: 10px;
  }
  .node:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .node.selected { outline: 2px solid #1c1b18; outline-offset: 1px; }
  .node-icon {
    flex: 0 0 auto; width: 26px; height: 26px;
    border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600;
  }
  .node-body { flex: 1; min-width: 0; }
  .node-step { font-size: 10px; color: var(--text-muted); font-weight: 500; }
  .node-title {
    font-size: 13px; font-weight: 500; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .node-meta {
    font-size: 11px; color: var(--text-muted); margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .node.done { background: var(--done-bg); border-color: #9fe1cb; }
  .node.done .node-icon { background: var(--done); color: #fff; }
  .node.done .node-title { color: var(--done-text); }
  .node.waiting {
    background: var(--waiting-bg); border-color: var(--waiting-border);
    box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
  }
  .node.running {
    background: #eaf3ff; border-color: #b8d4fb;
    box-shadow: 0 0 0 3px rgba(31, 95, 191, 0.14);
  }
  .node.blocked {
    background: var(--waiting-bg); border-color: var(--waiting-border);
    box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
  }
  .node.waiting .node-icon { background: var(--waiting); color: #fff; position: relative; }
  .node.running .node-icon { background: #1f5fbf; color: #fff; position: relative; }
  .node.blocked .node-icon { background: var(--waiting); color: #fff; position: relative; }
  .node.waiting .node-title { color: var(--waiting-text); }
  .node.waiting .node-meta { color: var(--waiting-text); opacity: 0.8; }
  .node.running .node-title { color: #1f5fbf; }
  .node.running .node-meta { color: #1f5fbf; opacity: 0.8; }
  .node.blocked .node-title { color: var(--waiting-text); }
  .node.blocked .node-meta { color: var(--waiting-text); opacity: 0.8; }
  .node.failed { background: var(--critical-bg); border-color: #f0b7b7; }
  .node.failed .node-icon { background: #b53a3a; color: #fff; }
  .node.failed .node-title, .node.failed .node-meta { color: var(--critical-text); }
  .node.pending { background: var(--pending-bg); border-color: var(--border); opacity: 0.55; }
  .node.pending .node-icon { background: #e0ddd2; color: #a3a097; }
  .node.pending .node-title { color: var(--pending-text); }
  .node.skipped { background: var(--skip-bg); border-color: var(--border); opacity: 0.45; }
  .node.skipped .node-icon { background: #d6d3c8; color: #8a887d; }
  .node.skipped .node-title {
    color: var(--skip-text);
    text-decoration: line-through;
    text-decoration-color: var(--text-dim);
  }
  .node + .node::before {
    content: ''; position: absolute;
    top: -9px; left: 23px;
    width: 1px; height: 10px;
    background: var(--border-strong);
  }
  .detail { padding: 18px 20px 32px; }
  .detail-head {
    margin-bottom: 14px; padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .detail-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
  .detail-title { font-size: 17px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
  .detail-desc { font-size: 12px; color: var(--text-muted); line-height: 1.6; }
  .status-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 500; margin-top: 8px;
  }
  .status-pill.done { background: var(--done-bg); color: var(--done-text); }
  .status-pill.waiting { background: var(--waiting-bg); color: var(--waiting-text); }
  .status-pill.running { background: #eaf3ff; color: #1f5fbf; }
  .status-pill.blocked { background: var(--waiting-bg); color: var(--waiting-text); }
  .status-pill.pending { background: var(--pending-bg); color: var(--text-muted); }
  .status-pill.skipped { background: var(--skip-bg); color: var(--skip-text); }
  .status-pill.failed { background: var(--critical-bg); color: var(--critical-text); }
  .detail-section { margin-top: 16px; }
  .detail-section-title {
    font-size: 11px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
    margin-bottom: 8px; font-weight: 500;
  }
  .question-card {
    background: var(--waiting-bg);
    border: 1px solid var(--waiting-border);
    border-radius: 10px;
    padding: 14px 14px 12px;
    margin-top: 16px;
  }
  .question-card.error { background: var(--critical-bg); border-color: #f0b7b7; }
  .question-card-head {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px; padding-bottom: 10px;
    border-bottom: 1px solid rgba(186, 117, 23, 0.18);
  }
  .question-card-head .icon {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--waiting); color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600;
    flex: 0 0 auto;
  }
  .question-card.error .question-card-head .icon { background: #b53a3a; }
  .question-card-head .title { font-size: 13px; font-weight: 500; color: inherit; flex: 1; }
  .question-card-head .elapsed {
    font-size: 11px; color: inherit;
    opacity: 0.75; font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .question-body { font-size: 12.5px; line-height: 1.65; color: var(--text); }
  .question-body p { margin: 0 0 10px; }
  .question-body p:last-child { margin-bottom: 0; }
  .question-body code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11.5px;
    background: rgba(255,255,255,0.7);
    padding: 1px 5px; border-radius: 3px;
  }
  .viewer-note {
    margin-top: 12px; padding: 8px 10px;
    background: rgba(255,255,255,0.6);
    border-radius: 6px;
    font-size: 11px; color: var(--text-muted);
    display: flex; gap: 6px; align-items: flex-start;
  }
  .viewer-note .info-icon {
    flex: 0 0 auto;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--text-dim); color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 600;
    margin-top: 1px;
  }
  .activity {
    display: flex; flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden;
  }
  .activity-item {
    background: var(--bg); padding: 8px 10px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .activity-item:last-child { border-bottom: 0; }
  .activity-item.highlight {
    background: var(--waiting-bg);
    border-left: 3px solid var(--waiting);
    padding-left: 9px;
  }
  .activity-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .activity-time {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px; color: var(--text-muted);
  }
  .activity-actor { font-size: 10px; padding: 1px 6px; border-radius: 3px; white-space: nowrap; }
  .activity-actor.runtime { background: #efeefc; color: #3c3489; }
  .activity-actor.codex { background: #e6f1fb; color: #185fa5; }
  .activity-actor.claude { background: #e1f5ee; color: #0f6e56; }
  .activity-msg { color: var(--text); line-height: 1.5; word-wrap: break-word; }
  .activity-msg code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px; background: var(--surface-2);
    padding: 1px 5px; border-radius: 3px;
  }
  .artifacts, .commands, .history-list { display: flex; flex-direction: column; gap: 5px; }
  .artifact, .command, .history-item {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    font-size: 12px;
    display: flex; align-items: center; gap: 8px;
    min-width: 0;
  }
  .artifact-name, .command-text, .history-text {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px; flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
  }
  .artifact-size, .history-meta { color: var(--text-muted); font-size: 11px; flex: 0 0 auto; }
  .artifact-button {
    width: 100%;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .artifact-button:hover { border-color: var(--border-strong); }
  .artifact-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .artifact-preview {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artifact-source {
    color: var(--text-muted);
    font-size: 11px;
    flex: 0 0 auto;
  }
  .document-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
  }
  .document-button {
    justify-content: space-between;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    width: 100%;
  }
  .document-button:hover { border-color: var(--border-strong); }
  .document-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  .document-subtitle {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .next-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .next-actions-note {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }
  .next-action {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    padding: 10px 12px;
  }
  .next-action.approve { border-color: #9fe1cb; background: #f7fcfa; }
  .next-action.revise { border-color: var(--waiting-border); background: #fffaf2; }
  .next-action.reject { border-color: #f0b7b7; background: #fff8f8; }
  .next-action-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 4px;
  }
  .next-action-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .next-action-choice {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .next-action-description {
    font-size: 12px;
    color: var(--text);
    margin-bottom: 8px;
  }
  .next-action-command {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .next-action-command:hover { border-color: var(--border-strong); }
  .next-action-command.copied {
    border-color: #9fe1cb;
    background: #f7fcfa;
  }
  .detail-diagnostics {
    margin-top: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
  }
  .detail-diagnostics > summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 500;
  }
  .detail-diagnostics > summary::-webkit-details-marker { display: none; }
  .detail-diagnostics-sub {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 400;
  }
  .detail-diagnostics-body {
    padding: 0 12px 12px;
  }
  .review-table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .review-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px; padding: 7px 10px;
    font-size: 12px; align-items: center;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .review-row:last-child { border-bottom: 0; }
  .review-row .rv-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .review-row .rv-round { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 11px; }
  .sev {
    display: inline-block;
    padding: 1px 7px; border-radius: 999px;
    font-size: 10px; font-weight: 500; white-space: nowrap;
  }
  .sev.none { background: var(--done-bg); color: var(--done-text); }
  .sev.minor { background: var(--waiting-bg); color: var(--waiting-text); }
  .sev.critical { background: var(--critical-bg); color: var(--critical-text); }
  .mono {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    background: var(--surface-2);
    padding: 1px 5px; border-radius: 3px;
  }
  .detail-modal {
    position: fixed;
    inset: 0;
    background: rgba(28, 27, 24, 0.38);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    z-index: 20;
  }
  .detail-modal.hidden { display: none; }
  .detail-dialog {
    width: min(860px, 100%);
    max-height: 88vh;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
  }
  .detail-dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .detail-dialog-title {
    font-size: 14px;
    font-weight: 500;
  }
  .detail-dialog-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .detail-view-toggle {
    display: inline-flex;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 3px;
    gap: 2px;
  }
  .detail-view-toggle button {
    border: 0;
    background: transparent;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .detail-view-toggle button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .detail-dialog-close {
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
    font: inherit;
    color: var(--text-muted);
  }
  .detail-dialog-body { padding: 16px; }
  .detail-dialog-grid {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 12px;
    font-size: 12px;
    margin-bottom: 14px;
  }
  .detail-dialog-grid .key { color: var(--text-muted); }
  .detail-dialog-pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.6;
    padding: 14px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .detail-dialog-section { margin-top: 16px; }
  .detail-dialog-section:first-child { margin-top: 0; }
  .detail-dialog-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
  .detail-doc-meta {
    display: grid;
    grid-template-columns: 84px 1fr;
    gap: 8px 12px;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .detail-doc-meta .key { color: var(--text-muted); }
  .detail-meta-list {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgba(255,255,255,0.6);
    padding: 8px 10px;
    max-height: 132px;
    overflow: auto;
  }
  .detail-meta-list div + div {
    margin-top: 4px;
  }
  .detail-doc-viewer {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 14px 16px;
    max-height: 58vh;
    overflow: auto;
  }
  .detail-doc-segment + .detail-doc-segment {
    margin-top: 18px;
  }
  .detail-doc-segment.dim {
    opacity: 0.56;
  }
  .detail-doc-segment.focus {
    opacity: 1;
    scroll-margin-top: 20px;
  }
  .detail-doc-markdown.detail-doc-segment.focus,
  .detail-doc-raw.detail-doc-segment.focus {
    background: rgba(255,255,255,0.72);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 12px 14px;
  }
  .detail-doc-raw {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.55;
    color: var(--text);
  }
  .detail-doc-markdown {
    color: var(--text);
    font-size: 12px;
    line-height: 1.7;
  }
  .detail-doc-markdown > *:first-child { margin-top: 0; }
  .detail-doc-markdown > *:last-child { margin-bottom: 0; }
  .detail-doc-markdown h1,
  .detail-doc-markdown h2,
  .detail-doc-markdown h3,
  .detail-doc-markdown h4,
  .detail-doc-markdown h5,
  .detail-doc-markdown h6 {
    margin: 1.1em 0 0.45em;
    font-weight: 600;
    line-height: 1.4;
  }
  .detail-doc-markdown h1 { font-size: 15px; }
  .detail-doc-markdown h2 { font-size: 14px; }
  .detail-doc-markdown h3,
  .detail-doc-markdown h4,
  .detail-doc-markdown h5,
  .detail-doc-markdown h6 { font-size: 13px; }
  .detail-doc-markdown p,
  .detail-doc-markdown ul,
  .detail-doc-markdown ol,
  .detail-doc-markdown pre,
  .detail-doc-markdown table,
  .detail-doc-markdown blockquote {
    margin: 0 0 12px;
  }
  .detail-doc-markdown ul,
  .detail-doc-markdown ol {
    padding-left: 20px;
  }
  .detail-doc-markdown li + li {
    margin-top: 4px;
  }
  .detail-doc-markdown code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    background: rgba(255,255,255,0.8);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .detail-inline-file {
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .detail-inline-file code {
    border: 1px solid #d6d3c8;
    background: #f5f4ef;
  }
  .detail-doc-markdown pre {
    margin: 0;
  }
  .detail-doc-markdown pre code {
    background: transparent;
    padding: 0;
  }
  .detail-code-block {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #f3f2ed;
    overflow: hidden;
  }
  .detail-code-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(214, 211, 200, 0.8);
    background: rgba(255,255,255,0.5);
  }
  .detail-code-language {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .detail-copy-button {
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    color: var(--text-muted);
  }
  .detail-copy-button:hover { border-color: var(--border-strong); color: var(--text); }
  .detail-code-block pre {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    padding: 12px;
    background: #f3f2ed;
  }
  .detail-mermaid-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgba(255,255,255,0.75);
    overflow: hidden;
  }
  .detail-mermaid {
    padding: 14px 16px;
    overflow: auto;
    display: flex;
    justify-content: center;
  }
  .detail-mermaid svg {
    max-width: 100%;
    height: auto;
  }
  .detail-mermaid-fallback {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
  }
  .detail-doc-markdown blockquote {
    padding-left: 12px;
    border-left: 3px solid var(--waiting-border);
    color: var(--text-muted);
  }
  .detail-doc-markdown table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  .detail-doc-markdown th,
  .detail-doc-markdown td {
    border: 1px solid var(--border);
    padding: 6px 8px;
    vertical-align: top;
  }
  .detail-doc-markdown th {
    background: rgba(255,255,255,0.6);
    text-align: left;
  }
  .detail-diff-lines {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: auto;
    background: #fbfaf7;
  }
  .detail-diff-line {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    line-height: 1.55;
    white-space: pre;
    padding: 0 12px;
  }
  .detail-diff-line.context { color: var(--text); }
  .detail-diff-line.meta { color: var(--text-muted); background: #f5f4ef; }
  .detail-diff-line.hunk { color: #185fa5; background: #eaf2fc; }
  .detail-diff-line.add { color: #0f6e56; background: #e1f5ee; }
  .detail-diff-line.remove { color: #a32d2d; background: #fcebeb; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
  @media (max-width: 820px) {
    .main { grid-template-columns: 1fr; }
    .panel-right { border-top: 1px solid var(--border); border-right: 0; }
    .panel-left { border-right: 0; }
  }
  @media (max-width: 600px) {
    .header { padding: 10px 14px; }
    .panel-left { padding: 14px 14px 24px; }
    .detail { padding: 16px 14px 24px; }
    .brand span:not(.brand-logo) { display: none; }
  }
</style>
</head>
<body>
  <div class="app">
    <header class="header">
      <div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;">
        <div class="brand">
          <span class="brand-logo">PD</span>
          <span>PDH Dev</span>
        </div>
        <div class="breadcrumbs" id="breadcrumbs"></div>
      </div>
      <div class="header-right" id="header-right"></div>
    </header>
    <div class="main">
      <section class="panel-left">
        <div class="summary" id="summary"></div>
        <div class="section-head">
          <div class="section-title">全体フロー<span class="subtitle">Ticket 開始 → Close</span></div>
          <div class="legend">
            <span class="legend-item"><span class="legend-dot" style="background: var(--done);"></span>完了</span>
            <span class="legend-item"><span class="legend-dot" style="background: var(--waiting);"></span>要対応</span>
            <span class="legend-item"><span class="legend-dot" style="background: #d3d1c7;"></span>未着手</span>
          </div>
        </div>
        <div class="flow-container" style="margin-bottom:20px;">
          <div class="overview-scroll"><div class="overview-flow" id="overview-flow"></div></div>
        </div>
        <div class="section-head">
          <div class="section-title">PD-C: Ticket 開発<span class="subtitle">ステップ詳細</span></div>
        </div>
        <div class="flow-container"><div class="pdc-list" id="pdc-list"></div></div>
      </section>
      <aside class="panel-right"><div class="detail" id="detail"></div></aside>
    </div>
  </div>
  <div class="detail-modal hidden" id="detail-modal">
    <div class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
      <div class="detail-dialog-head">
        <div class="detail-dialog-title" id="detail-modal-title">Detail</div>
        <div class="detail-dialog-actions">
          <div id="detail-view-toggle-slot"></div>
          <button class="detail-dialog-close" id="detail-modal-close" type="button">Close</button>
        </div>
      </div>
      <div class="detail-dialog-body" id="detail-modal-body"></div>
    </div>
  </div>
<script>
  const state = {
    data: null,
    selectedId: null,
    modalItem: null,
    modalViewMode: 'markdown',
    eventSource: null,
    pollTimer: null
  };

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function iconFor(status) {
    if (status === 'done') return '\\u2713';
    if (status === 'failed') return '!';
    if (status === 'waiting' || status === 'blocked') return '?';
    if (status === 'skipped') return '\\u2013';
    return '';
  }

  function variantData() {
    const activeVariant = state.data?.flow?.activeVariant;
    return activeVariant ? state.data?.flow?.variants?.[activeVariant] : null;
  }

  function selectedStep() {
    const flow = variantData();
    return flow?.steps?.find((step) => step.id === state.selectedId) || null;
  }

  function listOf(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function stepById(stepId) {
    return variantData()?.steps?.find((step) => step.id === stepId) || null;
  }

  function preferredText(...values) {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }

  function bulletsFromText(text, limit = 4) {
    const lines = String(text ?? '')
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#') && !line.startsWith('|') && !/^---+$/.test(line))
      .map((line) => line.replace(/^[-*]\\s+/, '').replace(/^\\d+\\.\\s+/, ''))
      .filter(Boolean);
    return lines.slice(0, limit);
  }

  function textPreview(value) {
    return String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, 140) || '未記録';
  }

  function joinedText(lines) {
    return listOf(lines).join('\\n');
  }

  function stepJudgementText(stepId) {
    return listOf(stepById(stepId)?.judgements).map((item) => {
      const summaryLine = item.summary ? ' - ' + item.summary : '';
      return item.kind + ': ' + item.status + summaryLine;
    }).join('\\n');
  }

  function formatGuardText(step, onlyFailed = false) {
    return listOf(step.uiRuntime?.guards)
      .filter((guard) => !onlyFailed || guard.status !== 'passed')
      .map((guard) => guard.id + ': ' + guard.status + (guard.evidence ? ' · ' + guard.evidence : ''))
      .join('\\n');
  }

  function stepFocusText(step) {
    switch (step.id) {
      case 'PD-C-2':
        return '調査として、変更対象と blast radius が後続の計画を拘束できる粒度まで固まっているかを見ます。';
      case 'PD-C-3':
        return '実装者として、変更ファイル・検証方針・リスク対応がこの ticket でそのまま実行できるかを見ます。';
      case 'PD-C-4':
        return 'レビュアーとして、実装前に残る Critical/Major や計画の穴がないかを見ます。';
      case 'PD-C-5':
        return '承認者として、計画・レビュー結果・テスト方針を見て PD-C-6 に進めてよいかを決めます。';
      case 'PD-C-6':
        return '実装担当として、承認済み計画との差分、未通過 guard、検証の残りを見て次の手を決めます。';
      case 'PD-C-7':
        return 'レビュアーとして、品質・回帰・security の懸念が残っていないかを見ます。';
      case 'PD-C-8':
        return 'PdM 視点で、動いていても close すべきでない理由が残っていないかを見ます。';
      case 'PD-C-9':
        return '完了確認者として、AC 裏取りと最終検証の証跡が close 判断に足るかを見ます。';
      case 'PD-C-10':
        return '承認者として、close-ready かどうかを最終確認します。';
      default:
        return step.userAction || step.summary || '';
    }
  }

  function derivedSummaryLines(step) {
    const own = listOf(step.uiOutput?.summary);
    if (own.length) {
      return own;
    }
    switch (step.id) {
      case 'PD-C-4':
        return bulletsFromText(stepById('PD-C-3')?.noteSection, 4);
      case 'PD-C-5':
        return [
          ...bulletsFromText(stepById('PD-C-3')?.noteSection, 3),
          ...bulletsFromText(preferredText(stepById('PD-C-4')?.noteSection, stepJudgementText('PD-C-4')), 1)
        ].slice(0, 4);
      case 'PD-C-6':
        return bulletsFromText(preferredText(step.noteSection, stepById('PD-C-3')?.noteSection), 4);
      case 'PD-C-7':
        return bulletsFromText(preferredText(step.noteSection, stepById('PD-C-6')?.noteSection), 4);
      case 'PD-C-8':
        return bulletsFromText(preferredText(step.noteSection, step.acTableText), 4);
      case 'PD-C-9':
        return bulletsFromText(preferredText(step.noteSection, step.acTableText), 4);
      case 'PD-C-10':
        return bulletsFromText(preferredText(step.acTableText, stepById('PD-C-9')?.noteSection), 4);
      default:
        return bulletsFromText(step.noteSection, 4);
    }
  }

  function derivedRiskLines(step) {
    const own = listOf(step.uiOutput?.risks);
    if (own.length) {
      return own;
    }
    switch (step.id) {
      case 'PD-C-3':
      case 'PD-C-4':
      case 'PD-C-5':
        return bulletsFromText(preferredText(stepById('PD-C-2')?.noteSection, stepById('PD-C-4')?.noteSection), 3);
      case 'PD-C-6':
        return bulletsFromText(preferredText(step.noteSection, stepById('PD-C-2')?.noteSection), 3);
      case 'PD-C-7':
      case 'PD-C-8':
      case 'PD-C-10':
        return bulletsFromText(preferredText(step.noteSection, stepJudgementText(step.id), stepById('PD-C-7')?.noteSection), 3);
      default:
        return [];
    }
  }

  function derivedNotesText(step, nextAction) {
    if (step.uiOutput?.notes) {
      return step.uiOutput.notes;
    }
    if (step.mode === 'human' && nextAction?.commands?.length) {
      return '判断はこの UI ではなく terminal の CLI で行います。必要なコマンドは下の Next に出します。';
    }
    if (step.id === 'PD-C-6') {
      return preferredText(formatGuardText(step, true), step.noteSection);
    }
    return '';
  }

  function nextActionItems(nextAction) {
    const actions = listOf(nextAction?.actions);
    if (actions.length) {
      return actions;
    }
    return listOf(nextAction?.commands).map((command) => ({
      label: 'Run',
      description: nextAction?.body || '',
      command,
      tone: 'neutral'
    }));
  }

  function nextActionNote(nextAction) {
    if (nextAction?.selection === 'choose_one') {
      return 'Choose one. 3つとも実行するのではなく、1つだけ選びます。';
    }
    if (nextAction?.selection === 'ordered') {
      return '上から順に使います。必要なら先に確認コマンド、その後に回答コマンドです。';
    }
    return '通常はこのコマンドを実行します。';
  }

  function documentData(docId) {
    return state.data?.documents?.[docId] || null;
  }

  function markdownArtifact(name) {
    return /\\.(md|markdown)$/i.test(String(name || ''));
  }

  function normalizeHeadings(headingOrHeadings) {
    if (Array.isArray(headingOrHeadings)) {
      return headingOrHeadings.map((value) => String(value || '').trim()).filter(Boolean);
    }
    const heading = String(headingOrHeadings || '').trim();
    return heading ? [heading] : [];
  }

  function documentExcerptText(docId, headingOrHeadings = null) {
    const document = documentData(docId);
    if (!document?.text) {
      return '';
    }
    const headings = normalizeHeadings(headingOrHeadings);
    if (!headings.length) {
      const range = findDocumentSectionRange(document.text, null);
      return range.lines.slice(range.start, range.end + 1).join('\\n').trim();
    }
    return headings.map((heading) => {
      const range = findDocumentSectionRange(document.text, heading);
      return range.lines.slice(range.start, range.end + 1).join('\\n').trim();
    }).filter(Boolean).join('\\n\\n');
  }

  function noteFocusHeadings(step) {
    switch (step.id) {
      case 'PD-C-4':
        return ['PD-C-3. 計画', 'PD-C-4. 計画レビュー結果'];
      case 'PD-C-5':
        return ['PD-C-3. 計画', 'PD-C-4. 計画レビュー結果'];
      case 'PD-C-7':
        return ['PD-C-6', 'PD-C-7. 品質検証結果'];
      case 'PD-C-8':
        return ['PD-C-8. 目的妥当性確認'];
      case 'PD-C-9':
      case 'PD-C-10':
        return ['AC 裏取り結果'];
      default:
        return [step.id];
    }
  }

  function noteMaterialItem(step) {
    const headings = noteFocusHeadings(step);
    const item = documentModalItem('note', headings);
    const preview = documentExcerptText('note', headings) || documentData('note')?.text || '';
    const focusText = headings.join(' / ');
    return {
      ...item,
      label: 'current-note.md',
      type: 'document',
      source: focusText ? 'current-note.md#' + focusText : 'current-note.md',
      detail: focusText ? 'focus: ' + focusText : 'full file view',
      preview: textPreview(preview)
    };
  }

  function ticketMaterialItem(step) {
    const headings = step.id === 'PD-C-8' || step.id === 'PD-C-9' || step.id === 'PD-C-10'
      ? ['Product AC']
      : ['Implementation Notes'];
    const item = documentModalItem('ticket', headings);
    const preview = documentExcerptText('ticket', headings) || documentData('ticket')?.text || '';
    const focusText = headings.join(' / ');
    return {
      ...item,
      label: 'current-ticket.md',
      type: 'document',
      source: focusText ? 'current-ticket.md#' + focusText : 'current-ticket.md',
      detail: focusText ? 'focus: ' + focusText : 'full file view',
      preview: textPreview(preview)
    };
  }

  function diffMaterialItem(step) {
    if (!step.reviewDiff?.baseLabel) {
      return null;
    }
    const detail = preferredText(
      joinedText(step.reviewDiff?.diffStat),
      joinedText(step.reviewDiff?.changedFiles),
      'click to open diff'
    );
    const item = buildShowItem('変更差分', 'diff', step.reviewDiff.baseLabel, detail);
    item.diffTarget = { stepId: step.id };
    item.preview = textPreview(detail);
    return item;
  }

  function judgementMaterialItems(step) {
    const items = [];
    const diff = diffMaterialItem(step);
    if (diff) {
      items.push(diff);
    }
    items.push(noteMaterialItem(step));
    items.push(ticketMaterialItem(step));
    return items;
  }

  function normalizeHeadingKey(value) {
    return String(value ?? '')
      .replace(/^#+\\s*/, '')
      .replace(/\\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function resolveDocumentTarget(source) {
    const text = String(source ?? '');
    if (!text.includes('current-note.md') && !text.includes('current-ticket.md')) {
      return null;
    }
    const noteIndex = text.indexOf('current-note.md');
    const ticketIndex = text.indexOf('current-ticket.md');
    const useNote = noteIndex >= 0 && (ticketIndex < 0 || noteIndex <= ticketIndex);
    const docName = useNote ? 'current-note.md' : 'current-ticket.md';
    const docId = useNote ? 'note' : 'ticket';
    const fragment = text.slice(text.indexOf(docName) + docName.length);
    const fragmentMatch = fragment.match(/^#(.+)/);
    const headings = fragmentMatch?.[1]
      ? fragmentMatch[1].split(' / ').map((value) => value.trim()).filter(Boolean)
      : [];
    return { docId, heading: headings[0] || null, headings, label: docName };
  }

  function findDocumentHighlightRanges(text, headingOrHeadings) {
    const headings = normalizeHeadings(headingOrHeadings);
    const ranges = headings.map((heading) => findDocumentSectionRange(text, heading))
      .filter((range) => range.highlightStart >= 0)
      .map((range) => ({ start: range.highlightStart, end: range.highlightEnd }))
      .sort((left, right) => left.start - right.start);
    if (!ranges.length) {
      return [];
    }
    const merged = [ranges[0]];
    for (let index = 1; index < ranges.length; index += 1) {
      const range = ranges[index];
      const previous = merged[merged.length - 1];
      if (range.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, range.end);
        continue;
      }
      merged.push(range);
    }
    return merged;
  }

  function findDocumentSectionRange(text, heading) {
    const lines = String(text ?? '').split(/\\r?\\n/);
    if (!heading) {
      return {
        lines,
        start: 0,
        end: Math.min(lines.length - 1, 159),
        highlightStart: -1,
        highlightEnd: -1,
        clipped: lines.length > 160
      };
    }
    const wanted = normalizeHeadingKey(heading);
    let start = -1;
    let headingLevel = 6;
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(#{1,6})\\s+(.*)$/);
      if (!match) {
        continue;
      }
      const currentHeading = normalizeHeadingKey(match[2]);
      if (currentHeading === wanted || currentHeading.startsWith(wanted) || wanted.startsWith(currentHeading)) {
        start = index;
        headingLevel = match[1].length;
        break;
      }
    }
    if (start < 0 && /^pd-c-\d+/i.test(wanted)) {
      const token = wanted.match(/^pd-c-\\d+/i)?.[0] || wanted;
      for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^(#{1,6})\\s+(.*)$/);
        if (!match) {
          continue;
        }
        const currentHeading = normalizeHeadingKey(match[2]);
        if (currentHeading.startsWith(token)) {
          start = index;
          headingLevel = match[1].length;
          break;
        }
      }
    }
    if (start < 0) {
      return {
        lines,
        start: 0,
        end: Math.min(lines.length - 1, 159),
        highlightStart: -1,
        highlightEnd: -1,
        clipped: lines.length > 160
      };
    }
    let end = lines.length - 1;
    for (let index = start + 1; index < lines.length; index += 1) {
      const match = lines[index].match(/^(#{1,6})\\s+(.*)$/);
      if (match && match[1].length <= headingLevel) {
        end = index - 1;
        break;
      }
    }
    return {
      lines,
      start: Math.max(0, start - 2),
      end: Math.min(lines.length - 1, end + 2),
      highlightStart: start,
      highlightEnd: end,
      clipped: start > 2 || end < lines.length - 3
    };
  }

  function renderInlineMarkdown(text) {
    const codeTick = String.fromCharCode(96);
    const inlineCodePattern = new RegExp(codeTick + '([^' + codeTick + ']+)' + codeTick, 'g');
    return esc(text)
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(inlineCodePattern, '<code>$1</code>');
  }

  function renderMarkdownExcerpt(text) {
    const codeFence = String.fromCharCode(96).repeat(3);
    const lines = String(text ?? '').split(/\\r?\\n/);
    const blocks = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];
    let tableRows = [];
    let inCode = false;
    let codeLines = [];
    let codeFenceInfo = '';

    function pushParagraph() {
      if (!paragraph.length) {
        return;
      }
      blocks.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    function pushList() {
      if (!listItems.length) {
        return;
      }
      const tag = listType === 'ol' ? 'ol' : 'ul';
      blocks.push('<' + tag + '>' + listItems.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>').join('') + '</' + tag + '>');
      listType = null;
      listItems = [];
    }

    function pushTable() {
      if (!tableRows.length) {
        return;
      }
      const rows = tableRows.map((line) => line.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map((cell) => cell.trim()));
      const divider = rows[1] && rows[1].every((cell) => /^:?-{3,}:?$/.test(cell));
      const head = rows[0] || [];
      const body = divider ? rows.slice(2) : rows.slice(1);
      blocks.push(
        '<table>' +
          (head.length ? '<thead><tr>' + head.map((cell) => '<th>' + renderInlineMarkdown(cell) + '</th>').join('') + '</tr></thead>' : '') +
          '<tbody>' + body.map((row) => '<tr>' + row.map((cell) => '<td>' + renderInlineMarkdown(cell) + '</td>').join('') + '</tr>').join('') + '</tbody>' +
        '</table>'
      );
      tableRows = [];
    }

    function pushCode() {
      if (!codeLines.length && !codeFenceInfo) {
        return;
      }
      const source = codeLines.join('\\n');
      const language = codeFenceInfo || 'text';
      const encoded = encodeURIComponent(source);
      if (codeFenceInfo === 'mermaid') {
        blocks.push(
          '<div class="detail-mermaid-card">' +
            '<div class="detail-code-toolbar">' +
              '<span class="detail-code-language">mermaid</span>' +
              '<button class="detail-copy-button" type="button" data-copy="' + encoded + '">Copy</button>' +
            '</div>' +
            '<div class="detail-mermaid" data-mermaid="' + encoded + '">' +
              '<div class="detail-mermaid-fallback">' + esc(source) + '</div>' +
            '</div>' +
          '</div>'
        );
      } else {
        blocks.push(
          '<div class="detail-code-block">' +
            '<div class="detail-code-toolbar">' +
              '<span class="detail-code-language">' + esc(language) + '</span>' +
              '<button class="detail-copy-button" type="button" data-copy="' + encoded + '">Copy</button>' +
            '</div>' +
            '<pre><code>' + esc(source) + '</code></pre>' +
          '</div>'
        );
      }
      codeLines = [];
      codeFenceInfo = '';
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/\\t/g, '  ');
      const trimmed = line.trim();
      if (trimmed.startsWith(codeFence)) {
        pushParagraph();
        pushList();
        pushTable();
        if (inCode) {
          pushCode();
          inCode = false;
        } else {
          codeFenceInfo = trimmed.slice(codeFence.length).trim().toLowerCase();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeLines.push(rawLine);
        continue;
      }
      if (!trimmed) {
        pushParagraph();
        pushList();
        pushTable();
        continue;
      }
      if (trimmed.startsWith('> ')) {
        pushParagraph();
        pushList();
        pushTable();
        blocks.push('<blockquote>' + renderInlineMarkdown(trimmed.slice(2)) + '</blockquote>');
        continue;
      }
      const headingMatch = trimmed.match(/^(#{1,6})\\s+(.*)$/);
      if (headingMatch) {
        pushParagraph();
        pushList();
        pushTable();
        const level = Math.min(6, headingMatch[1].length);
        blocks.push('<h' + level + '>' + renderInlineMarkdown(headingMatch[2]) + '</h' + level + '>');
        continue;
      }
      const orderedMatch = trimmed.match(/^\\d+\\.\\s+(.*)$/);
      if (orderedMatch) {
        pushParagraph();
        pushTable();
        if (listType && listType !== 'ol') {
          pushList();
        }
        listType = 'ol';
        listItems.push(orderedMatch[1]);
        continue;
      }
      const unorderedMatch = trimmed.match(/^[-*]\\s+(.*)$/);
      if (unorderedMatch) {
        pushParagraph();
        pushTable();
        if (listType && listType !== 'ul') {
          pushList();
        }
        listType = 'ul';
        listItems.push(unorderedMatch[1]);
        continue;
      }
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        pushParagraph();
        pushList();
        tableRows.push(trimmed);
        continue;
      }
      pushList();
      pushTable();
      paragraph.push(trimmed);
    }
    pushParagraph();
    pushList();
    pushTable();
    if (inCode) {
      pushCode();
    }
    return blocks.join('');
  }

  function renderDocumentViewer(target, mode = 'markdown') {
    const document = documentData(target?.docId);
    if (!document?.text) {
      return '';
    }
    const renderSegment = (text, segmentClass, focused = false) => {
      const value = String(text ?? '').trim();
      if (!value) {
        return '';
      }
      const attr = focused ? ' data-document-focus="true"' : '';
      if (mode === 'raw') {
        return '<div class="detail-doc-raw detail-doc-segment ' + segmentClass + '"' + attr + '>' + esc(value) + '</div>';
      }
      return '<div class="detail-doc-markdown detail-doc-segment ' + segmentClass + '"' + attr + '>' + renderMarkdownExcerpt(markdownizeDocumentSegment(value, document)) + '</div>';
    };
    const lines = String(document.text ?? '').split(/\\r?\\n/);
    const highlightRanges = findDocumentHighlightRanges(document.text, target.headings || target.heading);
    let viewer = '';
    if (!highlightRanges.length) {
      viewer = renderSegment(document.text, 'focus', true);
    } else {
      let cursor = 0;
      highlightRanges.forEach((range) => {
        viewer += renderSegment(lines.slice(cursor, range.start).join('\\n'), 'dim');
        viewer += renderSegment(lines.slice(range.start, range.end + 1).join('\\n'), 'focus', true);
        cursor = range.end + 1;
      });
      viewer += renderSegment(lines.slice(cursor).join('\\n'), 'dim');
    }
    return '<div class="detail-doc-viewer">' + viewer + '</div>';
  }

  function renderArtifactViewer(payload, mode = 'raw') {
    const viewer = mode === 'markdown' && payload?.markdown
      ? '<div class="detail-doc-markdown">' + renderMarkdownExcerpt(payload?.text || '未記録') + '</div>'
      : '<div class="detail-doc-raw">' + esc(payload?.text || '未記録') + '</div>';
    return '<div class="detail-doc-viewer">' + viewer + '</div>';
  }

  function renderRepoFileViewer(payload, mode = 'file') {
    if (mode === 'diff') {
      return renderDiffViewer(payload?.diff || {}, 'pretty');
    }
    return renderArtifactViewer({ text: payload?.text || '', markdown: false }, 'raw');
  }

  function renderDiffPretty(text) {
    const lines = String(text || '').split(/\\r?\\n/);
    return (
      '<div class="detail-diff-lines">' +
      lines.map((line) => {
        let kind = 'context';
        if (line.startsWith('@@')) {
          kind = 'hunk';
        } else if ((line.startsWith('+') && !line.startsWith('+++')) || line.startsWith('rename to ')) {
          kind = 'add';
        } else if ((line.startsWith('-') && !line.startsWith('---')) || line.startsWith('rename from ')) {
          kind = 'remove';
        } else if (
          line.startsWith('diff --git') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('new file mode') ||
          line.startsWith('deleted file mode')
        ) {
          kind = 'meta';
        }
        return '<div class="detail-diff-line ' + kind + '">' + esc(line || ' ') + '</div>';
      }).join('') +
      '</div>'
    );
  }

  function renderDiffViewer(payload, mode = 'pretty') {
    const viewer = mode === 'raw'
      ? '<div class="detail-doc-raw">' + esc(payload?.patch || '差分なし') + '</div>'
      : renderDiffPretty(payload?.patch || 'diff is empty');
    return '<div class="detail-doc-viewer">' + viewer + '</div>';
  }

  function artifactModalItem(step, artifact) {
    return {
      label: artifact.name,
      type: 'artifact',
      source: artifact.path || artifact.name,
      detail: artifact.size || '',
      artifactTarget: {
        stepId: step.id,
        name: artifact.name,
        markdown: markdownArtifact(artifact.name)
      }
    };
  }

  async function fetchArtifactPayload(target) {
    const response = await fetch('/api/artifact?step=' + encodeURIComponent(target.stepId) + '&name=' + encodeURIComponent(target.name), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('artifact fetch failed');
    }
    return response.json();
  }

  async function fetchDiffPayload(stepId) {
    const response = await fetch('/api/diff?step=' + encodeURIComponent(stepId), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('diff fetch failed');
    }
    return response.json();
  }

  async function fetchFilePayload(target) {
    const response = await fetch('/api/file?step=' + encodeURIComponent(target.stepId) + '&path=' + encodeURIComponent(target.path), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('file fetch failed');
    }
    return response.json();
  }

  function buildShowItem(label, type, source, detail) {
    return {
      label,
      type,
      source,
      detail: String(detail ?? '').trim(),
      preview: textPreview(detail),
      documentTarget: resolveDocumentTarget(source)
    };
  }

  function fileModalItem(stepId, path) {
    return {
      label: path,
      type: 'repo_file',
      source: path,
      detail: 'repo file',
      fileTarget: {
        stepId,
        path
      }
    };
  }

  function resolveGenericContractItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    const noteSection = step.noteSection || '';
    const ticketNotes = step.ticketImplementationNotes || '';
    const changedFiles = joinedText(step.uiRuntime?.changedFiles);
    const diffStat = joinedText(step.uiRuntime?.diffStat);
    const risks = joinedText(step.uiOutput?.risks);
    const summary = joinedText(step.uiOutput?.summary);
    const ready = joinedText(step.uiOutput?.readyWhen);
    const commands = joinedText(nextAction?.commands);
    const judgements = listOf(step.judgements).map((item) => {
      const summaryLine = item.summary ? ' - ' + item.summary : '';
      return item.kind + ': ' + item.status + summaryLine;
    }).join('\\n');

    if (lower.includes('変更ファイル')) {
      return buildShowItem(label, 'changed_files', 'git diff --name-only', changedFiles || diffStat);
    }
    if (lower.includes('diff')) {
      return buildShowItem(label, 'diff', 'git diff --stat', diffStat || changedFiles);
    }
    if (lower.includes('risk') || lower.includes('リスク') || lower.includes('懸念')) {
      return buildShowItem(label, 'risks', 'ui-output.yaml / current-note.md', risks || noteSection);
    }
    if (lower.includes('テスト') || lower.includes('verify') || lower.includes('検証')) {
      return buildShowItem(label, 'verification', 'current-note.md / ui-output.yaml', ready || noteSection);
    }
    if (lower.includes('設計判断') || lower.includes('durable')) {
      return buildShowItem(label, 'ticket_notes', 'current-ticket.md#Implementation Notes', ticketNotes);
    }
    if (lower.includes('approve') || lower.includes('reject') || lower.includes('cli')) {
      return buildShowItem(label, 'commands', 'CLI', commands);
    }
    if (lower.includes('review') || lower.includes('指摘') || lower.includes('目的ずれ') || lower.includes('security')) {
      return buildShowItem(label, 'review', 'judgements / current-note.md', judgements || noteSection);
    }
    if (lower.includes('ac')) {
      return buildShowItem(label, 'ac', 'AC summary', 'verified: ' + (step.acSummary?.verified || 0) + '\\ndeferred: ' + (step.acSummary?.deferred || 0) + '\\nunverified: ' + (step.acSummary?.unverified || 0) + (noteSection ? '\\n\\n' + noteSection : ''));
    }
    return buildShowItem(label, 'note', 'current-note.md', noteSection || summary || ticketNotes);
  }

  function resolveInvestigationItem(label, step, nextAction) {
    return resolveGenericContractItem(label, step, nextAction);
  }

  function resolvePlanItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    if (lower.includes('設計判断') || lower.includes('durable')) {
      return buildShowItem(label, 'ticket_notes', 'current-ticket.md#Implementation Notes', step.ticketImplementationNotes);
    }
    return buildShowItem(label, 'plan', 'current-note.md#PD-C-3. 計画', preferredText(step.noteSection, step.ticketImplementationNotes));
  }

  function resolvePlanReviewItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    const planText = stepById('PD-C-3')?.noteSection || '';
    const reviewText = preferredText(stepJudgementText('PD-C-4'), step.noteSection);
    if (lower.includes('critical') || lower.includes('major')) {
      return buildShowItem(label, 'review', 'judgements/plan_review + current-note.md#PD-C-4', reviewText);
    }
    if (lower.includes('検証不足')) {
      return buildShowItem(label, 'review', 'current-note.md#PD-C-4. 計画レビュー結果', preferredText(step.noteSection, planText));
    }
    return buildShowItem(label, 'plan', 'current-note.md#PD-C-3. 計画', planText);
  }

  function resolveImplementationApprovalItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    const planText = stepById('PD-C-3')?.noteSection || '';
    const reviewText = preferredText(stepById('PD-C-4')?.noteSection, stepJudgementText('PD-C-4'));
    const riskText = preferredText(stepById('PD-C-2')?.noteSection, reviewText, planText);
    if (lower.includes('diff') || lower.includes('差分')) {
      const diff = step.reviewDiff;
      const item = buildShowItem(label, 'diff', diff?.baseLabel || 'ticket start', preferredText(joinedText(diff?.diffStat), joinedText(diff?.changedFiles), 'click to open diff'));
      item.diffTarget = diff ? { stepId: step.id } : null;
      return item;
    }
    if (lower.includes('変更対象')) {
      return buildShowItem(label, 'plan', 'current-note.md#PD-C-3. 計画', planText);
    }
    if (lower.includes('主要リスク')) {
      return buildShowItem(label, 'risk', 'current-note.md#PD-C-2 / PD-C-4', riskText);
    }
    if (lower.includes('テスト')) {
      return buildShowItem(label, 'verification', 'current-note.md#PD-C-3. 計画', planText);
    }
    if (lower.includes('approve') || lower.includes('request-changes') || lower.includes('cli')) {
      return buildShowItem(label, 'commands', 'CLI', joinedText(nextAction?.commands));
    }
    return buildShowItem(label, 'plan', 'current-note.md#PD-C-3 / PD-C-4', preferredText(planText, reviewText));
  }

  function resolveImplementationItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    const planText = stepById('PD-C-3')?.noteSection || '';
    if (lower.includes('provider')) {
      return buildShowItem(label, 'provider', 'ui-output.yaml / latest attempt', preferredText(joinedText(step.uiOutput?.summary), step.uiRuntime?.latestAttempt ? step.uiRuntime.latestAttempt.provider + ' attempt ' + step.uiRuntime.latestAttempt.attempt + ': ' + step.uiRuntime.latestAttempt.status : '', step.noteSection));
    }
    if (lower.includes('guard')) {
      return buildShowItem(label, 'guards', 'ui-runtime.yaml', preferredText(formatGuardText(step, true), formatGuardText(step, false)));
    }
    if (lower.includes('割り込み')) {
      return buildShowItem(label, 'interruptions', 'ui-runtime.yaml', joinedText(listOf(step.uiRuntime?.interruptions).map((item) => item.message || item.artifact || item.id)));
    }
    if (lower.includes('test') || lower.includes('commit')) {
      return buildShowItem(label, 'verification', 'current-note.md#PD-C-6 / ui-runtime.yaml', preferredText(step.noteSection, formatGuardText(step, true)));
    }
    if (lower.includes('承認済み計画')) {
      return buildShowItem(label, 'plan', 'current-note.md#PD-C-3. 計画', planText);
    }
    return resolveGenericContractItem(label, step, nextAction);
  }

  function resolveQualityReviewItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    const implText = stepById('PD-C-6')?.noteSection || '';
    const reviewText = preferredText(stepJudgementText('PD-C-7'), step.noteSection);
    if (lower.includes('diff')) {
      const diff = step.reviewDiff;
      const item = buildShowItem(label, 'diff', diff?.baseLabel || 'PD-C-5 gate baseline', preferredText(joinedText(diff?.diffStat), joinedText(diff?.changedFiles), implText));
      item.diffTarget = diff ? { stepId: step.id } : null;
      return item;
    }
    if (lower.includes('テスト')) {
      return buildShowItem(label, 'verification', 'current-note.md#PD-C-6 / PD-C-7', preferredText(implText, step.noteSection));
    }
    if (lower.includes('review') || lower.includes('指摘')) {
      return buildShowItem(label, 'review', 'judgements/quality_review + current-note.md#PD-C-7', reviewText);
    }
    if (lower.includes('設計逸脱') || lower.includes('security')) {
      return buildShowItem(label, 'review', 'current-note.md#PD-C-7. 品質検証結果', preferredText(step.noteSection, reviewText, implText));
    }
    return resolveGenericContractItem(label, step, nextAction);
  }

  function resolvePurposeValidationItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    if (lower.includes('ac')) {
      return buildShowItem(label, 'ac', 'current-note.md#AC 裏取り結果', preferredText(step.acTableText, step.noteSection));
    }
    return buildShowItem(label, 'purpose', 'current-note.md#PD-C-8. 目的妥当性確認', preferredText(step.noteSection, stepJudgementText('PD-C-8'), step.acTableText));
  }

  function resolveFinalVerificationItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    if (lower.includes('ac')) {
      return buildShowItem(label, 'ac', 'current-note.md#AC 裏取り結果', step.acTableText);
    }
    if (lower.includes('deferred') || lower.includes('unverified')) {
      return buildShowItem(label, 'ac', 'AC summary', 'verified: ' + (step.acSummary?.verified || 0) + '\\ndeferred: ' + (step.acSummary?.deferred || 0) + '\\nunverified: ' + (step.acSummary?.unverified || 0) + (step.acTableText ? '\\n\\n' + step.acTableText : ''));
    }
    return buildShowItem(label, 'verification', 'current-note.md#PD-C-9. プロセスチェックリスト', preferredText(step.noteSection, step.acTableText));
  }

  function resolveCloseApprovalItem(label, step, nextAction) {
    const lower = String(label).toLowerCase();
    const verificationText = preferredText(stepById('PD-C-9')?.noteSection, step.acTableText);
    const riskText = preferredText(stepById('PD-C-8')?.noteSection, stepById('PD-C-7')?.noteSection, verificationText);
    if (lower.includes('diff') || lower.includes('差分')) {
      const diff = step.reviewDiff;
      const item = buildShowItem(label, 'diff', diff?.baseLabel || 'previous gate baseline', preferredText(joinedText(diff?.diffStat), joinedText(diff?.changedFiles), 'click to open diff'));
      item.diffTarget = diff ? { stepId: step.id } : null;
      return item;
    }
    if (lower.includes('ac')) {
      return buildShowItem(label, 'ac', 'current-note.md#AC 裏取り結果', step.acTableText);
    }
    if (lower.includes('risk')) {
      return buildShowItem(label, 'risk', 'current-note.md#PD-C-8 / PD-C-9', riskText);
    }
    if (lower.includes('cleanup')) {
      return buildShowItem(label, 'cleanup', 'current-note.md#Step History', preferredText(step.noteSection, joinedText((state.data.history || []).slice(-4).map((entry) => entry.updatedAt + ' | ' + entry.stepId + ' | ' + entry.summary))));
    }
    if (lower.includes('approve') || lower.includes('reject') || lower.includes('cli')) {
      return buildShowItem(label, 'commands', 'CLI', joinedText(nextAction?.commands));
    }
    return buildShowItem(label, 'verification', 'current-note.md#PD-C-9', verificationText);
  }

  function resolveContractItem(label, step, nextAction) {
    switch (step.id) {
      case 'PD-C-2':
        return resolveInvestigationItem(label, step, nextAction);
      case 'PD-C-3':
        return resolvePlanItem(label, step, nextAction);
      case 'PD-C-4':
        return resolvePlanReviewItem(label, step, nextAction);
      case 'PD-C-5':
        return resolveImplementationApprovalItem(label, step, nextAction);
      case 'PD-C-6':
        return resolveImplementationItem(label, step, nextAction);
      case 'PD-C-7':
        return resolveQualityReviewItem(label, step, nextAction);
      case 'PD-C-8':
        return resolvePurposeValidationItem(label, step, nextAction);
      case 'PD-C-9':
        return resolveFinalVerificationItem(label, step, nextAction);
      case 'PD-C-10':
        return resolveCloseApprovalItem(label, step, nextAction);
      default:
        return resolveGenericContractItem(label, step, nextAction);
    }
  }

  function stepShowItems(step, nextAction) {
    return listOf(step.uiContract?.mustShow).map((label) => resolveContractItem(label, step, nextAction));
  }

  function isProbableRepoFilePath(value) {
    const text = String(value || '').trim();
    return /[/.]/.test(text)
      && /\.(md|markdown|txt|json|ya?ml|patch|diff|log|mmd|mjs|cjs|js|jsx|ts|tsx|py|sh|toml|lock)$/i.test(text)
      && !text.includes(' ')
      && !text.startsWith('http');
  }

  function renderInlineRichText(text, step) {
    const source = String(text ?? '');
    const pieces = [];
    let lastIndex = 0;
    const tick = String.fromCharCode(96);
    const pattern = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
    let match;
    while ((match = pattern.exec(source))) {
      pieces.push(esc(source.slice(lastIndex, match.index)));
      const code = match[1];
      if (isProbableRepoFilePath(code)) {
        pieces.push(
          '<button type="button" class="detail-inline-file" data-file-path="' + esc(code) + '" data-step-id="' + esc(step.id) + '">' +
            '<code>' + esc(code) + '</code>' +
          '</button>'
        );
      } else {
        pieces.push('<code>' + esc(code) + '</code>');
      }
      lastIndex = match.index + match[0].length;
    }
    pieces.push(esc(source.slice(lastIndex)));
    return pieces.join('');
  }

  function stepReadyItems(step) {
    const items = [];
    listOf(step.uiOutput?.readyWhen).forEach((item) => items.push({ label: item, kind: 'ready' }));
    listOf(step.uiRuntime?.guards).forEach((guard) => {
      const label = guard.id + ': ' + guard.status + (guard.evidence ? ' · ' + guard.evidence : '');
      items.push({ label, kind: guard.status });
    });
    return items;
  }

  function defaultModalMode(item) {
    if (item?.diffTarget) {
      return 'pretty';
    }
    if (item?.fileTarget) {
      return 'file';
    }
    if (item?.artifactTarget) {
      return item.artifactTarget.markdown ? 'markdown' : 'raw';
    }
    return 'markdown';
  }

  function renderModalShell(_item, viewerHtml) {
    return viewerHtml;
  }

  async function loadRemoteModalBody(item) {
    const body = document.getElementById('detail-modal-body');
    try {
      const payload = item.diffTarget
        ? await fetchDiffPayload(item.diffTarget.stepId)
        : item.fileTarget
          ? await fetchFilePayload(item.fileTarget)
          : await fetchArtifactPayload(item.artifactTarget);
      if (state.modalItem !== item) {
        return;
      }
      const mode = item.diffTarget
        ? (state.modalViewMode === 'raw' ? 'raw' : 'pretty')
        : item.fileTarget
          ? (state.modalViewMode === 'diff' ? 'diff' : 'file')
        : (state.modalViewMode === 'raw' ? 'raw' : 'markdown');
      const viewer = item.diffTarget
        ? renderDiffViewer(payload, mode)
        : item.fileTarget
          ? renderRepoFileViewer(payload, mode)
        : renderArtifactViewer(payload, mode);
      body.innerHTML = renderModalShell(item, viewer);
    } catch {
      if (state.modalItem !== item) {
        return;
      }
      body.innerHTML = renderModalShell(
        item,
        '<div class="detail-dialog-section"><div class="detail-dialog-label">Viewer</div><div class="detail-doc-viewer"><div class="detail-doc-raw">Failed to load the requested content.</div></div></div>'
      );
    }
    hydrateModalBody();
  }

  function fetchState() {
    return fetch('/api/state', { cache: 'no-store' }).then((response) => response.json());
  }

  function markdownizeDocumentSegment(text, document) {
    const source = String(text || '');
    const match = source.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?/);
    const basename = String(document?.path || '').split('/').pop().trim().toLowerCase();
    const stripDocumentTitle = (value) => {
      if (!basename) {
        return value;
      }
      const titleMatch = value.match(/^#\\s+([^\\n]+)\\n+/);
      if (!titleMatch) {
        return value;
      }
      const heading = titleMatch[1].trim().toLowerCase();
      if (heading !== basename) {
        return value;
      }
      return value.slice(titleMatch[0].length).trimStart();
    };
    if (!match) {
      return stripDocumentTitle(source);
    }
    const frontmatter = match[1].trimEnd();
    const body = stripDocumentTitle(source.slice(match[0].length).trimStart());
    const parts = [
      '\`\`\`yaml',
      frontmatter,
      '\`\`\`'
    ];
    if (body) {
      parts.push('', body);
    }
    return parts.join('\\n');
  }

  function applyState(data) {
    state.data = data;
    const flow = variantData();
    const currentId = data.runtime?.run?.current_step_id || flow?.steps?.[0]?.id || null;
    state.selectedId = state.selectedId && flow?.steps?.some((step) => step.id === state.selectedId)
      ? state.selectedId
      : currentId;
    const requested = requestedModalItem();
    if (requested) {
      state.modalItem = requested.item;
      state.modalViewMode = requested.mode;
    }
    render();
  }

  function refresh() {
    fetchState().then((data) => {
      if (state.modalItem) {
        state.data = data;
        return;
      }
      applyState(data);
    });
  }

  function startPolling() {
    if (state.pollTimer) {
      return;
    }
    state.pollTimer = window.setInterval(() => {
      if (state.modalItem) {
        return;
      }
      refresh();
    }, 5000);
  }

  function stopPolling() {
    if (!state.pollTimer) {
      return;
    }
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function startLiveUpdates() {
    if (!('EventSource' in window)) {
      startPolling();
      return;
    }
    if (state.eventSource) {
      return;
    }
    const source = new EventSource('/api/events');
    state.eventSource = source;
    source.addEventListener('state', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (state.modalItem) {
          state.data = data;
          return;
        }
        applyState(data);
      } catch {
        // Ignore malformed events and let the next message recover.
      }
    });
    source.addEventListener('error', () => {
      source.close();
      if (state.eventSource === source) {
        state.eventSource = null;
      }
      startPolling();
    });
  }

  function render() {
    renderHeader();
    renderSummary();
    renderOverview();
    renderSteps();
    renderDetail();
    renderModal();
  }

  function renderHeader() {
    const data = state.data;
    const current = data.runtime.currentStep;
    document.getElementById('breadcrumbs').innerHTML =
      '<span>' + esc(data.repoName) + '</span>' +
      '<span class="sep">/</span>' +
      '<span class="current">' + esc(data.runtime.run?.ticket_id || 'no-ticket') + '</span>';

    const variant = (data.flow.activeVariant || 'full').toUpperCase();
    const status = data.runtime.run?.status || 'idle';
    const waitingClass = status === 'failed'
      ? 'waiting-indicator critical'
      : status === 'running'
        ? 'waiting-indicator running'
        : 'waiting-indicator';
    const indicatorText = current
      ? current.id + ' ' + current.label + ' · ' + status
      : '未開始';
    document.getElementById('header-right').innerHTML =
      '<span class="flow-badge">Flow: ' + esc(variant) + '</span>' +
      '<span class="' + waitingClass + '"><span class="waiting-dot"></span>' + esc(indicatorText) + '</span>';
  }

  function renderSummary() {
    const summary = state.data.summary;
    const ac = summary.acCounts || { verified: 0, deferred: 0, unverified: 0 };
    const runStatus = state.data.runtime.run?.status || 'idle';
    const currentCardClass = runStatus === 'running' ? 'summary-card running' : 'summary-card alert';
    const currentValueClass = runStatus === 'running' ? 'value running' : 'value waiting';
    document.getElementById('summary').innerHTML =
      '<div class="' + currentCardClass + '"><div class="label">現在</div><div class="' + currentValueClass + '">' + esc(summary.currentLabel) + '</div></div>' +
      '<div class="summary-card"><div class="label">AC 裏取り</div><div class="value">' + esc(ac.verified + ' verified') + ' <span class="sub">' + esc('deferred ' + ac.deferred + ' / unverified ' + ac.unverified) + '</span></div></div>';
  }

  function renderOverview() {
    const overview = variantData().overview;
    const root = document.getElementById('overview-flow');
    root.innerHTML = '';
    overview.forEach((node, index) => {
      const el = document.createElement('div');
      el.className = 'overview-node ' + node.state;
      el.innerHTML = '<div class="ov-label">' + esc(node.label) + '</div><div class="ov-name">' + esc(node.title) + '</div>';
      root.appendChild(el);
      if (index < overview.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'overview-arrow';
        arrow.textContent = '\\u2192';
        root.appendChild(arrow);
      }
    });
  }

  function renderSteps() {
    const steps = variantData().steps;
    const root = document.getElementById('pdc-list');
    root.innerHTML = '';
    steps.forEach((step) => {
      const el = document.createElement('div');
      el.className = 'node ' + step.progress.status + (step.id === state.selectedId ? ' selected' : '');
      el.innerHTML =
        '<div class="node-icon">' + iconFor(step.progress.status) + '</div>' +
        '<div class="node-body">' +
          '<div class="node-step">' + esc(step.id) + '</div>' +
          '<div class="node-title">' + esc(step.label) + '</div>' +
          '<div class="node-meta">' + esc(step.progress.label + ' · ' + (step.progress.note || step.summary || '')) + '</div>' +
        '</div>';
      el.addEventListener('click', () => {
        state.selectedId = step.id;
        state.modalItem = null;
        renderSteps();
        renderDetail();
        renderModal();
      });
      root.appendChild(el);
    });
  }

  function documentModalItem(docId, headingOrHeadings = null) {
    const document = documentData(docId);
    const fileLabel = docId === 'ticket' ? 'current-ticket.md' : 'current-note.md';
    const headings = normalizeHeadings(headingOrHeadings);
    const headingText = headings.join(' / ');
    return {
      label: fileLabel,
      type: 'document',
      source: document?.path || fileLabel,
      detail: headingText ? 'document focus: ' + headingText : 'full file view',
      documentTarget: {
        docId,
        heading: headings[0] || null,
        headings,
        label: fileLabel
      }
    };
  }

  function requestedModalItem() {
    const params = new URLSearchParams(window.location.search);
    const doc = params.get('doc');
    if (doc === 'note' || doc === 'ticket') {
      return {
        item: documentModalItem(doc, params.get('heading') || null),
        mode: params.get('mode') === 'raw' ? 'raw' : 'markdown'
      };
    }
    return null;
  }

  function clearRequestedModalQuery() {
    const url = new URL(window.location.href);
    url.searchParams.delete('doc');
    url.searchParams.delete('heading');
    url.searchParams.delete('mode');
    window.history.replaceState({}, '', url);
  }

  function openModalItem(item, mode = 'markdown') {
    state.modalItem = item;
    state.modalViewMode = mode;
    renderModal();
  }

  function wireCopyButtons(root) {
    root.querySelectorAll('.detail-copy-button').forEach((button) => {
      if (button.dataset.bound === 'true') {
        return;
      }
      button.dataset.bound = 'true';
      button.addEventListener('click', async () => {
        const original = button.textContent;
        const value = decodeURIComponent(button.dataset.copy || '');
        try {
          await navigator.clipboard.writeText(value);
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Copy failed';
        }
        window.setTimeout(() => {
          button.textContent = original;
        }, 1200);
      });
    });
  }

  function wireClickCopy(root) {
    root.querySelectorAll('[data-click-copy]').forEach((element) => {
      if (element.dataset.bound === 'true') {
        return;
      }
      element.dataset.bound = 'true';
      element.addEventListener('click', async () => {
        const original = element.textContent;
        const value = decodeURIComponent(element.dataset.clickCopy || '');
        try {
          await navigator.clipboard.writeText(value);
          element.classList.add('copied');
          element.textContent = value + '\\nCopied';
        } catch {
          element.textContent = value + '\\nCopy failed';
        }
        window.setTimeout(() => {
          element.classList.remove('copied');
          element.textContent = original;
        }, 1200);
      });
    });
  }

  async function hydrateMermaidBlocks(root) {
    const blocks = Array.from(root.querySelectorAll('.detail-mermaid[data-mermaid]'));
    if (!blocks.length) {
      return;
    }
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const source = decodeURIComponent(block.dataset.mermaid || '');
      try {
        const response = await fetch('/api/render-mermaid?code=' + encodeURIComponent(source), { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('render failed');
        }
        block.innerHTML = await response.text();
      } catch {
        block.innerHTML = '<div class="detail-mermaid-fallback">' + esc(source) + '</div>';
      }
    }
  }

  function hydrateModalBody() {
    const body = document.getElementById('detail-modal-body');
    wireCopyButtons(body);
    wireClickCopy(body);
    hydrateMermaidBlocks(body);
    const focus = body.querySelector('[data-document-focus="true"]');
    if (focus) {
      window.requestAnimationFrame(() => {
        focus.scrollIntoView({ block: 'center' });
      });
    }
  }

  function renderModal() {
    const modal = document.getElementById('detail-modal');
    const title = document.getElementById('detail-modal-title');
    const body = document.getElementById('detail-modal-body');
    const toggleSlot = document.getElementById('detail-view-toggle-slot');
    if (!state.modalItem) {
      modal.classList.add('hidden');
      title.textContent = 'Detail';
      body.innerHTML = '';
      toggleSlot.innerHTML = '';
      return;
    }
    modal.classList.remove('hidden');
    title.textContent = state.modalItem.label;
    const allowsMarkdown = Boolean(state.modalItem.documentTarget || state.modalItem.artifactTarget?.markdown);
    const isDiff = Boolean(state.modalItem.diffTarget);
    const isFile = Boolean(state.modalItem.fileTarget);
    if (allowsMarkdown || isDiff || isFile) {
      const primaryMode = isDiff ? 'pretty' : isFile ? 'file' : 'markdown';
      toggleSlot.innerHTML =
        '<div class="detail-view-toggle">' +
          '<button type="button" data-mode="' + primaryMode + '"' + (state.modalViewMode === primaryMode ? ' class="on"' : '') + '>' + (isDiff ? 'Pretty' : isFile ? 'File' : 'Markdown') + '</button>' +
          '<button type="button" data-mode="' + (isFile ? 'diff' : 'raw') + '"' + (state.modalViewMode === (isFile ? 'diff' : 'raw') ? ' class="on"' : '') + '>' + (isFile ? 'Diff' : 'Raw') + '</button>' +
        '</div>';
      toggleSlot.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          state.modalViewMode = button.dataset.mode || primaryMode;
          renderModal();
        });
      });
    } else {
      toggleSlot.innerHTML = '';
    }
    if (state.modalItem.documentTarget) {
      body.innerHTML = renderModalShell(state.modalItem, renderDocumentViewer(state.modalItem.documentTarget, state.modalViewMode === 'raw' ? 'raw' : 'markdown'));
      hydrateModalBody();
      return;
    }
    if (state.modalItem.artifactTarget || state.modalItem.diffTarget || state.modalItem.fileTarget) {
      body.innerHTML = renderModalShell(
        state.modalItem,
        '<div class="detail-dialog-section"><div class="detail-dialog-label">Viewer</div><div class="detail-doc-viewer"><div class="detail-doc-raw">Loading…</div></div></div>'
      );
      loadRemoteModalBody(state.modalItem);
      return;
    }
    body.innerHTML = renderModalShell(state.modalItem, '');
    hydrateModalBody();
  }

  function renderDetail() {
    const step = selectedStep();
    const root = document.getElementById('detail');
    if (!step) {
      root.innerHTML = '';
      return;
    }
    const current = state.data.runtime.currentStep;
    const nextAction = state.data.current.nextAction;
    const currentGate = state.data.current.gate;
    const interruptions = state.data.current.interruptions || [];
    let html =
      '<div class="detail-head">' +
        '<div class="detail-label">' + esc(step.id + ' · ' + step.provider + ' / ' + step.mode) + '</div>' +
        '<div class="detail-title">' + esc(step.label) + '</div>' +
        '<div class="detail-desc">' + esc(step.summary || '') + '</div>' +
        '<span class="status-pill ' + esc(step.progress.status) + '"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>' + esc(step.progress.label) + '</span>' +
      '</div>';

    if (current && current.id === step.id && (state.data.runtime.run?.status === 'needs_human' || state.data.runtime.run?.status === 'interrupted' || state.data.runtime.run?.status === 'failed' || state.data.runtime.run?.status === 'blocked')) {
      const isError = state.data.runtime.run.status === 'failed';
      const questionBody = [];
      if (state.data.runtime.run.status === 'needs_human') {
        questionBody.push('<p>' + esc(nextAction.body || 'この step は human gate です。terminal から判断してください。') + '</p>');
        questionBody.push('<p>判断材料は下の diff / current-note.md / current-ticket.md と Next に集約しています。生テキストは必要なときだけ modal で開けば十分です。</p>');
      } else if (state.data.runtime.run.status === 'interrupted') {
        const latest = interruptions[interruptions.length - 1];
        questionBody.push('<p>割り込み質問に未回答です。CLI の <code>answer</code> で回答してください。</p>');
        if (latest?.message) {
          questionBody.push('<p>' + esc(latest.message) + '</p>');
        }
      } else if (state.data.runtime.run.status === 'failed') {
        questionBody.push('<p>provider が失敗しています。summary を確認して <code>resume</code> か <code>run-provider</code> を再実行します。</p>');
      } else {
        questionBody.push('<p>' + esc(nextAction.body || 'guard が通っていません。必要な note/ticket 更新、commit、検証を追加してから run-next を再実行します。') + '</p>');
      }
      html +=
        '<div class="question-card' + (isError ? ' error' : '') + '">' +
          '<div class="question-card-head">' +
            '<span class="icon">' + (isError ? '!' : '?') + '</span>' +
            '<span class="title">' + esc(nextAction.title) + '</span>' +
          '</div>' +
          '<div class="question-body">' + questionBody.join('') + '</div>' +
          '<div class="viewer-note"><span class="info-icon">i</span><span>この UI は viewer です。操作は terminal の CLI で実行します。</span></div>' +
        '</div>';
    }

    html +=
      '<div class="detail-section"><div class="detail-section-title">この step の観点</div>' +
      '<div style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text);">' +
      esc(stepFocusText(step)) +
      '</div></div>';

    const contract = step.uiContract || {};
    const materialItems = judgementMaterialItems(step);
    const readyItems = stepReadyItems(step);
    const omitItems = listOf(contract.omit);
    const outputSummary = derivedSummaryLines(step);
    const outputRisks = derivedRiskLines(step);
    const outputNotes = derivedNotesText(step, current && current.id === step.id ? nextAction : null);
    const nextItems = current && current.id === step.id ? nextActionItems(nextAction) : [];
    html += '<div class="detail-section"><div class="detail-section-title">判断の前提</div>' +
      '<div style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text);">' +
      '<div><strong>Viewer:</strong> ' + esc(contract.viewer || '開発者') + '</div>' +
      '<div style="margin-top:6px;"><strong>Decision:</strong> ' + esc(contract.decision || step.summary || '') + '</div>' +
      (outputSummary.length
        ? '<div style="margin-top:10px;"><strong>Summary:</strong><div style="margin-top:4px;">' + outputSummary.map((item) => '&#8226; ' + renderInlineRichText(item, step)).join('<br>') + '</div></div>'
        : '') +
      (outputRisks.length
        ? '<div style="margin-top:10px;"><strong>Risks:</strong><div style="margin-top:4px;">' + outputRisks.map((item) => '&#8226; ' + renderInlineRichText(item, step)).join('<br>') + '</div></div>'
        : '') +
      (outputNotes
        ? '<div style="margin-top:10px;"><strong>Notes:</strong><div style="margin-top:4px;white-space:pre-wrap;">' + renderInlineRichText(outputNotes, step).replaceAll('\\n', '<br>') + '</div></div>'
        : '') +
      '</div></div>';

    html += '<div class="detail-section"><div class="detail-section-title">判断材料</div><div class="artifacts">';
    if (!materialItems.length) {
      html += '<div class="artifact"><span class="artifact-name">まだありません</span><span class="artifact-size">pending</span></div>';
    }
    materialItems.forEach((item, index) => {
      html +=
        '<button class="artifact artifact-button show-artifact-button" type="button" data-show-index="' + esc(String(index)) + '">' +
          '<div class="artifact-copy">' +
            '<span class="artifact-name">' + esc(item.label) + '</span>' +
            '<span class="artifact-preview">' + esc(item.preview) + '</span>' +
          '</div>' +
          '<span class="artifact-source">' + esc(item.source || item.type) + '</span>' +
        '</button>';
    });
    html += '</div></div>';

    if (step.judgements?.length) {
      html += '<div class="detail-section"><div class="detail-section-title">レビュー結果</div><div class="review-table">';
      step.judgements.forEach((judgement, index) => {
        const sev = judgement.status === 'No Critical/Major' || judgement.status === 'No Unverified' ? 'none' : judgement.status.toLowerCase().includes('critical') ? 'critical' : 'minor';
        html +=
          '<div class="review-row">' +
            '<div class="rv-name">' + esc(judgement.kind) + '</div>' +
            '<div class="rv-round">R' + esc(String(index + 1)) + '</div>' +
            '<div><span class="sev ' + esc(sev) + '">' + esc(judgement.status) + '</span></div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    if (nextItems.length) {
      html += '<div class="detail-section"><div class="detail-section-title">Next</div>';
      html += '<div class="next-actions-note">' + esc(nextActionNote(nextAction)) + '</div>';
      html += '<div class="next-actions">';
      nextItems.forEach((item, index) => {
        html +=
          '<div class="next-action ' + esc(item.tone || 'neutral') + '">' +
            '<div class="next-action-head">' +
              '<span class="next-action-label">' + esc(item.label || ('Action ' + String(index + 1))) + '</span>' +
              '<span class="next-action-choice">' + esc(nextAction?.selection === 'choose_one' ? 'choose one' : nextAction?.selection === 'ordered' ? 'run in order' : 'run this') + '</span>' +
            '</div>' +
            (item.description ? '<div class="next-action-description">' + esc(item.description) + '</div>' : '') +
            '<div class="next-action-command" data-click-copy="' + encodeURIComponent(item.command || '') + '">' + esc(item.command || '') + '</div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    const diagnostics = [];
    if (step.gate || step.interruptions?.length) {
      let section = '<div class="detail-section"><div class="detail-section-title">Current State</div><div class="artifacts">';
      if (step.gate?.summary) {
        section += '<div class="artifact"><span class="artifact-name">human gate summary</span><span class="artifact-size">' + esc(step.gate.decision || step.gate.status) + '</span></div>';
      }
      step.interruptions.forEach((item) => {
        section += '<div class="artifact"><span class="artifact-name">' + esc(item.message || item.kind || 'interruption') + '</span><span class="artifact-size">' + esc(item.status || item.kind || 'open') + '</span></div>';
      });
      section += '</div></div>';
      diagnostics.push(section);
    }
    if (readyItems.length) {
      let section = '<div class="detail-section"><div class="detail-section-title">Ready When</div><div class="artifacts">';
      readyItems.forEach((item) => {
        section += '<div class="artifact"><span class="artifact-name">' + esc(item.label) + '</span><span class="artifact-size">' + esc(item.kind) + '</span></div>';
      });
      section += '</div></div>';
      diagnostics.push(section);
    }
    if (step.events?.length) {
      let section = '<div class="detail-section"><div class="detail-section-title">Logs</div><div class="activity">';
      step.events.forEach((event) => {
        const highlight = event.type === 'interrupted' || event.type === 'guard_failed' || event.type === 'human_gate_resolved';
        section +=
          '<div class="activity-item' + (highlight ? ' highlight' : '') + '">' +
            '<div class="activity-meta">' +
              '<span class="activity-time">' + esc((event.ts || '').replace('T', ' ').replace('Z', '')) + '</span>' +
              '<span class="activity-actor ' + esc(event.provider || 'runtime') + '">' + esc((event.provider || 'runtime').toUpperCase()) + '</span>' +
            '</div>' +
            '<div class="activity-msg">' + esc(textPreview(event.message || event.type)) + '</div>' +
          '</div>';
      });
      section += '</div></div>';
      diagnostics.push(section);
    }
    if (step.artifacts?.length) {
      let section = '<div class="detail-section"><div class="detail-section-title">Artifacts</div><div class="artifacts">';
      step.artifacts.forEach((artifact, index) => {
        section +=
          '<button class="artifact artifact-button supplemental-artifact-button" type="button" data-artifact-index="' + esc(String(index)) + '">' +
            '<div class="artifact-copy">' +
              '<span class="artifact-name">' + esc(artifact.name) + '</span>' +
              '<span class="artifact-preview">' + esc(artifact.size || 'artifact') + '</span>' +
            '</div>' +
            '<span class="artifact-source">open</span>' +
          '</button>';
      });
      section += '</div></div>';
      diagnostics.push(section);
    }
    if (omitItems.length) {
      let section = '<div class="detail-section"><div class="detail-section-title">Omitted From Main View</div><div class="artifacts">';
      omitItems.forEach((item) => {
        section += '<div class="artifact"><span class="artifact-name">' + esc(item) + '</span><span class="artifact-size">omit</span></div>';
      });
      section += '</div></div>';
      diagnostics.push(section);
    }
    if (diagnostics.length) {
      html +=
        '<details class="detail-diagnostics">' +
          '<summary><span>Diagnostics</span><span class="detail-diagnostics-sub">state / logs / artifacts</span></summary>' +
          '<div class="detail-diagnostics-body">' + diagnostics.join('') + '</div>' +
        '</details>';
    }

    root.innerHTML = html;
    root.querySelectorAll('.show-artifact-button').forEach((button) => {
      button.addEventListener('click', () => {
        const item = materialItems[Number(button.dataset.showIndex)];
        if (!item) {
          return;
        }
        openModalItem(item, defaultModalMode(item));
      });
    });
    root.querySelectorAll('.supplemental-artifact-button').forEach((button) => {
      button.addEventListener('click', () => {
        const artifact = step.artifacts?.[Number(button.dataset.artifactIndex)];
        if (!artifact) {
          return;
        }
        const item = artifactModalItem(step, artifact);
        openModalItem(item, defaultModalMode(item));
      });
    });
    root.querySelectorAll('.detail-inline-file').forEach((button) => {
      button.addEventListener('click', () => {
        const filePath = button.dataset.filePath;
        const stepId = button.dataset.stepId;
        if (!filePath || !stepId) {
          return;
        }
        openModalItem(fileModalItem(stepId, filePath), 'file');
      });
    });
    wireClickCopy(root);
  }

  document.getElementById('detail-modal-close').addEventListener('click', () => {
    state.modalItem = null;
    state.modalViewMode = 'markdown';
    clearRequestedModalQuery();
    renderModal();
  });
  document.getElementById('detail-modal').addEventListener('click', (event) => {
    if (event.target.id !== 'detail-modal') return;
    state.modalItem = null;
    state.modalViewMode = 'markdown';
    clearRequestedModalQuery();
    renderModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.modalItem) {
      state.modalItem = null;
      state.modalViewMode = 'markdown';
      clearRequestedModalQuery();
      renderModal();
    }
  });

  refresh();
  if (!requestedModalItem()) {
    startLiveUpdates();
  }
</script>
</body>
</html>`;
}
