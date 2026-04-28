import type { HistoryEntry, NextAction, StepView } from "./types";

export type EvidenceItem = {
  label: string;
  kind: EvidenceKind;
  source?: string;
  body?: string;
  diffStepId?: string | null;
  filePath?: string | null;
};

export type EvidenceKind =
  | "diff"
  | "plan"
  | "risk"
  | "risks"
  | "verification"
  | "commands"
  | "note"
  | "ticket_notes"
  | "provider"
  | "guards"
  | "interruptions"
  | "review"
  | "ac"
  | "purpose"
  | "cleanup"
  | "changed_files"
  | "ready";

type Ctx = {
  allSteps: StepView[];
  history: HistoryEntry[];
};

const EMPTY_CTX: Ctx = { allSteps: [], history: [] };

export function resolveStepEvidence(step: StepView, nextAction: NextAction | null, ctx: Ctx = EMPTY_CTX): EvidenceItem[] {
  const labels = listOf((step.uiContract as { mustShow?: string[] } | undefined)?.mustShow);
  if (!labels.length) {
    return [];
  }
  return labels.map((label) => resolveContractItem(label, step, nextAction, ctx));
}

export function resolveStepReady(step: StepView): { label: string; kind: string }[] {
  const items: { label: string; kind: string }[] = [];
  listOf((step.uiOutput as { readyWhen?: string[] } | undefined)?.readyWhen).forEach((label) => {
    items.push({ label, kind: "ready" });
  });
  listOf((step.uiRuntime as { guards?: { id: string; status: string; evidence?: string }[] } | undefined)?.guards).forEach((guard) => {
    const evidence = guard.evidence ? ` · ${guard.evidence}` : "";
    items.push({ label: `${guard.id}: ${guard.status}${evidence}`, kind: guard.status });
  });
  return items;
}

function resolveContractItem(label: string, step: StepView, nextAction: NextAction | null, ctx: Ctx): EvidenceItem {
  switch (step.id) {
    case "PD-C-2":
      return resolveGeneric(label, step, nextAction);
    case "PD-C-3":
      return resolvePlan(label, step);
    case "PD-C-4":
      return resolvePlanReview(label, step, ctx);
    case "PD-C-5":
      return resolveImplementationApproval(label, step, nextAction, ctx);
    case "PD-C-6":
      return resolveImplementation(label, step, nextAction, ctx);
    case "PD-C-7":
      return resolveQualityReview(label, step, ctx);
    case "PD-C-8":
      return resolvePurposeValidation(label, step);
    case "PD-C-9":
      return resolveFinalVerification(label, step);
    case "PD-C-10":
      return resolveCloseApproval(label, step, nextAction, ctx);
    default:
      return resolveGeneric(label, step, nextAction);
  }
}

function resolveGeneric(label: string, step: StepView, nextAction: NextAction | null): EvidenceItem {
  const lower = label.toLowerCase();
  const noteSection = step.noteSection ?? "";
  const ticketNotes = (step as { ticketImplementationNotes?: string }).ticketImplementationNotes ?? "";
  const ui = (step.uiOutput ?? {}) as { summary?: string[]; risks?: string[]; readyWhen?: string[] };
  const runtime = (step.uiRuntime ?? {}) as { changedFiles?: string[]; diffStat?: string[] };
  const summary = joinedText(ui.summary);
  const risks = joinedText(ui.risks);
  const ready = joinedText(ui.readyWhen);
  const changedFiles = joinedText(runtime.changedFiles);
  const diffStat = joinedText(runtime.diffStat);
  const commands = joinedText(nextAction?.commands);
  const judgements = (step.judgements ?? [])
    .map((j) => `${j.kind}: ${j.status}${j.summary ? " - " + j.summary : ""}`)
    .join("\n");

  if (lower.includes("変更ファイル")) {
    return item(label, "changed_files", "git diff --name-only", changedFiles || diffStat);
  }
  if (lower.includes("diff")) {
    return item(label, "diff", "git diff --stat", diffStat || changedFiles, { diffStepId: step.id });
  }
  if (lower.includes("risk") || lower.includes("リスク") || lower.includes("懸念")) {
    return item(label, "risks", "ui-output.json / current-note.md", risks || noteSection);
  }
  if (lower.includes("テスト") || lower.includes("verify") || lower.includes("検証")) {
    return item(label, "verification", "current-note.md / ui-output.json", ready || noteSection);
  }
  if (lower.includes("設計判断") || lower.includes("durable")) {
    return item(label, "ticket_notes", "current-ticket.md#Implementation Notes", ticketNotes);
  }
  if (lower.includes("approve") || lower.includes("reject") || lower.includes("cli")) {
    return item(label, "commands", "CLI", commands);
  }
  if (lower.includes("review") || lower.includes("指摘") || lower.includes("目的ずれ") || lower.includes("security")) {
    return item(label, "review", "judgements / current-note.md", judgements || noteSection);
  }
  if (lower.includes("ac")) {
    const ac = step.acSummary ?? {};
    const body = `verified: ${ac.verified ?? 0}\ndeferred: ${ac.deferred ?? 0}\nunverified: ${ac.unverified ?? 0}${noteSection ? "\n\n" + noteSection : ""}`;
    return item(label, "ac", "AC summary", body);
  }
  return item(label, "note", "current-note.md", noteSection || summary || ticketNotes);
}

function resolvePlan(label: string, step: StepView): EvidenceItem {
  const lower = label.toLowerCase();
  const ticketNotes = (step as { ticketImplementationNotes?: string }).ticketImplementationNotes ?? "";
  if (lower.includes("設計判断") || lower.includes("durable")) {
    return item(label, "ticket_notes", "current-ticket.md#Implementation Notes", ticketNotes);
  }
  return item(label, "plan", "current-note.md#PD-C-3. 計画", preferred(step.noteSection, ticketNotes));
}

function resolvePlanReview(label: string, step: StepView, ctx: Ctx): EvidenceItem {
  const lower = label.toLowerCase();
  const planText = lookupNote(ctx, "PD-C-3");
  const reviewText = preferred(judgementText(step), step.noteSection);
  if (lower.includes("critical") || lower.includes("major")) {
    return item(label, "review", "judgements/plan_review + current-note.md#PD-C-4", reviewText);
  }
  if (lower.includes("検証不足")) {
    return item(label, "review", "current-note.md#PD-C-4. 計画レビュー結果", preferred(step.noteSection, planText));
  }
  return item(label, "plan", "current-note.md#PD-C-3. 計画", planText);
}

function resolveImplementationApproval(label: string, step: StepView, nextAction: NextAction | null, ctx: Ctx): EvidenceItem {
  const lower = label.toLowerCase();
  const planText = lookupNote(ctx, "PD-C-3");
  const reviewText = preferred(lookupNote(ctx, "PD-C-4"), judgementText(lookupStep(ctx, "PD-C-4")));
  const riskText = preferred(lookupNote(ctx, "PD-C-2"), reviewText, planText);
  if (lower.includes("diff") || lower.includes("差分")) {
    const diff = step.reviewDiff;
    const body = preferred(joinedText(diff?.changedFiles), joinedText((diff as { diffStat?: string[] } | null | undefined)?.diffStat), "click to open diff");
    return item(label, "diff", diff?.baseLabel || "ticket start", body, { diffStepId: diff ? step.id : null });
  }
  if (lower.includes("変更対象")) {
    return item(label, "plan", "current-note.md#PD-C-3. 計画", planText);
  }
  if (lower.includes("主要リスク")) {
    return item(label, "risk", "current-note.md#PD-C-2 / PD-C-4", riskText);
  }
  if (lower.includes("テスト")) {
    return item(label, "verification", "current-note.md#PD-C-3. 計画", planText);
  }
  if (lower.includes("approve") || lower.includes("request-changes") || lower.includes("cli")) {
    return item(label, "commands", "CLI", joinedText(nextAction?.commands));
  }
  return item(label, "plan", "current-note.md#PD-C-3 / PD-C-4", preferred(planText, reviewText));
}

function resolveImplementation(label: string, step: StepView, nextAction: NextAction | null, ctx: Ctx): EvidenceItem {
  const lower = label.toLowerCase();
  const planText = lookupNote(ctx, "PD-C-3");
  const ui = (step.uiOutput ?? {}) as { summary?: string[] };
  const runtime = (step.uiRuntime ?? {}) as { latestAttempt?: { provider?: string; attempt?: number; status?: string }; interruptions?: { message?: string; artifact?: string; id?: string }[] };
  if (lower.includes("provider")) {
    const attemptText = runtime.latestAttempt
      ? `${runtime.latestAttempt.provider} attempt ${runtime.latestAttempt.attempt}: ${runtime.latestAttempt.status}`
      : "";
    return item(label, "provider", "ui-output.json / latest attempt", preferred(joinedText(ui.summary), attemptText, step.noteSection));
  }
  if (lower.includes("guard")) {
    return item(label, "guards", "ui-runtime.json", formatGuardText(step, false));
  }
  if (lower.includes("割り込み")) {
    const lines = (runtime.interruptions ?? []).map((entry) => entry.message ?? entry.artifact ?? entry.id ?? "");
    return item(label, "interruptions", "ui-runtime.json", joinedText(lines));
  }
  if (lower.includes("test") || lower.includes("commit")) {
    return item(label, "verification", "current-note.md#PD-C-6 / ui-runtime.json", preferred(step.noteSection, formatGuardText(step, true)));
  }
  if (lower.includes("承認済み計画")) {
    return item(label, "plan", "current-note.md#PD-C-3. 計画", planText);
  }
  return resolveGeneric(label, step, nextAction);
}

function resolveQualityReview(label: string, step: StepView, ctx: Ctx): EvidenceItem {
  const lower = label.toLowerCase();
  const implText = lookupNote(ctx, "PD-C-6");
  const reviewText = preferred(judgementText(step), step.noteSection);
  if (lower.includes("diff")) {
    const diff = step.reviewDiff;
    const body = preferred(joinedText(diff?.changedFiles), joinedText((diff as { diffStat?: string[] } | null | undefined)?.diffStat), implText);
    return item(label, "diff", diff?.baseLabel || "PD-C-5 gate baseline", body, { diffStepId: diff ? step.id : null });
  }
  if (lower.includes("テスト")) {
    return item(label, "verification", "current-note.md#PD-C-6 / PD-C-7", preferred(implText, step.noteSection));
  }
  if (lower.includes("review") || lower.includes("指摘")) {
    return item(label, "review", "judgements/quality_review + current-note.md#PD-C-7", reviewText);
  }
  if (lower.includes("設計逸脱") || lower.includes("security")) {
    return item(label, "review", "current-note.md#PD-C-7. 品質検証結果", preferred(step.noteSection, reviewText, implText));
  }
  return resolveGeneric(label, step, null);
}

function resolvePurposeValidation(label: string, step: StepView): EvidenceItem {
  const lower = label.toLowerCase();
  const acTable = (step as { acTableText?: string }).acTableText ?? "";
  if (lower.includes("ac")) {
    return item(label, "ac", "current-note.md#AC 裏取り結果", preferred(acTable, step.noteSection));
  }
  return item(label, "purpose", "current-note.md#PD-C-8. 目的妥当性確認", preferred(step.noteSection, judgementText(step), acTable));
}

function resolveFinalVerification(label: string, step: StepView): EvidenceItem {
  const lower = label.toLowerCase();
  const acTable = (step as { acTableText?: string }).acTableText ?? "";
  const ac = step.acSummary ?? {};
  if (lower.includes("ac")) {
    return item(label, "ac", "current-note.md#AC 裏取り結果", acTable);
  }
  if (lower.includes("deferred") || lower.includes("unverified")) {
    const body = `verified: ${ac.verified ?? 0}\ndeferred: ${ac.deferred ?? 0}\nunverified: ${ac.unverified ?? 0}${acTable ? "\n\n" + acTable : ""}`;
    return item(label, "ac", "AC summary", body);
  }
  return item(label, "verification", "current-note.md#PD-C-9. プロセスチェックリスト", preferred(step.noteSection, acTable));
}

function resolveCloseApproval(label: string, step: StepView, nextAction: NextAction | null, ctx: Ctx): EvidenceItem {
  const lower = label.toLowerCase();
  const acTable = (step as { acTableText?: string }).acTableText ?? "";
  const verificationText = preferred(lookupNote(ctx, "PD-C-9"), acTable);
  const riskText = preferred(lookupNote(ctx, "PD-C-8"), lookupNote(ctx, "PD-C-7"), verificationText);
  if (lower.includes("diff") || lower.includes("差分")) {
    const diff = step.reviewDiff;
    const body = preferred(joinedText(diff?.changedFiles), joinedText((diff as { diffStat?: string[] } | null | undefined)?.diffStat), "click to open diff");
    return item(label, "diff", diff?.baseLabel || "previous gate baseline", body, { diffStepId: diff ? step.id : null });
  }
  if (lower.includes("ac")) {
    return item(label, "ac", "current-note.md#AC 裏取り結果", acTable);
  }
  if (lower.includes("risk")) {
    return item(label, "risk", "current-note.md#PD-C-8 / PD-C-9", riskText);
  }
  if (lower.includes("cleanup")) {
    const recent = (ctx.history ?? []).slice(-4).map((h) => `${h.completed_at ?? h.started_at ?? ""} | ${h.step_id ?? ""} | ${h.status ?? ""}`);
    return item(label, "cleanup", "current-note.md#Step History", preferred(step.noteSection, joinedText(recent)));
  }
  if (lower.includes("approve") || lower.includes("reject") || lower.includes("cli")) {
    return item(label, "commands", "CLI", joinedText(nextAction?.commands));
  }
  return item(label, "verification", "current-note.md#PD-C-9", verificationText);
}

function item(label: string, kind: EvidenceKind, source: string, body: string, extras: Partial<EvidenceItem> = {}): EvidenceItem {
  return { label, kind, source, body: body || "", ...extras };
}

function listOf<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function joinedText(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).map((x) => String(x)).join("\n");
  if (typeof value === "string") return value;
  return "";
}

function preferred(...values: (string | undefined | null)[]): string {
  for (const v of values) {
    if (v && v.trim()) return v;
  }
  return "";
}

function lookupStep(ctx: Ctx, id: string): StepView | undefined {
  return ctx.allSteps.find((s) => s.id === id);
}

function lookupNote(ctx: Ctx, id: string): string {
  return lookupStep(ctx, id)?.noteSection ?? "";
}

function judgementText(step?: StepView): string {
  if (!step) return "";
  return (step.judgements ?? [])
    .map((j) => `${j.kind}: ${j.status}${j.summary ? " - " + j.summary : ""}`)
    .join("\n");
}

function formatGuardText(step: StepView, onlyFailed: boolean): string {
  const guards = ((step.uiRuntime as { guards?: { id: string; status: string; evidence?: string }[] } | undefined)?.guards) ?? [];
  const filtered = onlyFailed ? guards.filter((g) => g.status !== "ok") : guards;
  return filtered.map((g) => `${g.id}: ${g.status}${g.evidence ? " · " + g.evidence : ""}`).join("\n");
}
