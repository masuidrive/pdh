import { useState } from "react";
import { actions } from "../lib/api";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";
import type { RunRecord, StepView } from "../lib/types";

type Props = {
  run: RunRecord | null;
  steps: StepView[];
  // True once the run has moved past the editable window (provider
  // spawned at PD-C-1, current_step_id advanced, or variant lock
  // engaged). Disables every control and shows a banner. The variant
  // lock state is independent and still surfaced separately for clarity.
  readOnly?: boolean;
  onApplied?: () => void;
};

const PROVIDERS = ["claude", "codex"] as const;
type Provider = (typeof PROVIDERS)[number];

// PD-C-1 composition editor. Surfaces:
//   1. flow_variant toggle (light / full).
//   2. per-step provider override for the active variant. Edit-mode
//      steps get a single provider; review-mode steps get aggregator
//      + repair (reviewer roster stays default — power users can edit
//      raw frontmatter for that).
// Defaults come from buildFlowView (variant-resolved). Overrides come
// from current-note.md frontmatter (run.agent_overrides). On change we
// patch the relevant slot, merge with the existing map, and POST the
// full agent_overrides object so the server can pruneEmpty.
export function RunCompositionPanel({ run, steps, readOnly = false, onApplied }: Props) {
  const variant = (run?.flow_variant ?? "full") as "light" | "full";
  const variantLocked = run?.flow_variant_locked === true;
  // Variant controls were already locked once flow_variant_locked engaged;
  // the new readOnly flag locks the per-step composition too.
  const editorLocked = readOnly || variantLocked;
  const [pendingVariant, setPendingVariant] = useState<"light" | "full" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<string | null>(null);
  const [pendingClearAll, setPendingClearAll] = useState(false);
  // Last variant-switch's pruned step ids. Surfaces what got auto-removed
  // so the destruction isn't silent.
  const [lastPruned, setLastPruned] = useState<string[]>([]);
  // Per-step pickers are collapsed by default — most users want the
  // global preset only. Expand to fine-tune individual steps.
  const [showPerStep, setShowPerStep] = useState(false);
  const flights = useSingleFlight();
  const { notifyError } = useNotifications();

  // The committed override map from the server. We don't keep an
  // unsaved local edit — every control is "save on click" so the
  // visible state is always what's persisted.
  const overrides = (run?.agent_overrides ?? {}) as Record<string, AgentOverrideEntry>;
  const overrideCount = countOverrides(overrides, steps.map((s) => s.id));

  async function applyVariant(next: "light" | "full") {
    if (editorLocked) return;
    if (next === variant) return;
    setError(null);
    setPendingVariant(next);
    try {
      const res = await flights.run(`run-variant:${next}`, () => actions.updateNoteFrontmatter({ flow_variant: next }));
      const pruned = Array.isArray((res as { pruned_agent_overrides?: unknown }).pruned_agent_overrides)
        ? ((res as { pruned_agent_overrides: string[] }).pruned_agent_overrides)
        : [];
      setLastPruned(pruned);
      onApplied?.();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notifyError(e, { title: "Flow variant を更新できませんでした" });
    } finally {
      setPendingVariant(null);
    }
  }

  async function applyStepOverride(stepId: string, patch: AgentOverrideEntry | null) {
    if (editorLocked) return;
    setError(null);
    setPendingStep(stepId);
    try {
      const next = { ...overrides };
      if (patch === null) {
        delete next[stepId];
      } else {
        next[stepId] = patch;
      }
      await flights.run(`run-step-override:${stepId}`, () => actions.updateNoteFrontmatter({ agent_overrides: next }));
      onApplied?.();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notifyError(e, { title: `${stepId} の provider を更新できませんでした` });
    } finally {
      setPendingStep(null);
    }
  }

  async function clearAllOverrides() {
    if (editorLocked) return;
    if (overrideCount === 0) return;
    setError(null);
    setPendingClearAll(true);
    try {
      await flights.run("run-clear-overrides", () => actions.updateNoteFrontmatter({ agent_overrides: {} }));
      onApplied?.();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notifyError(e, { title: "override のリセットに失敗しました" });
    } finally {
      setPendingClearAll(false);
    }
  }

  // Apply a preset to ALL steps in one shot. claude/codex make every
  // step's provider/aggregator/repair/reviewers that provider; default
  // drops every override so the flow YAML's roster is the active one.
  async function applyGlobalPreset(preset: "claude" | "codex" | "default") {
    if (editorLocked) return;
    setError(null);
    setPendingClearAll(true);
    try {
      let next: Record<string, AgentOverrideEntry> = {};
      if (preset !== "default") {
        for (const step of steps) {
          const built = buildPresetOverride(step, preset);
          if (built) next[step.id] = built;
        }
      }
      await flights.run(`run-global-preset:${preset}`, () => actions.updateNoteFrontmatter({ agent_overrides: next }));
      onApplied?.();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      notifyError(e, { title: "global preset の反映に失敗しました" });
    } finally {
      setPendingClearAll(false);
    }
  }
  const globalPreset = deriveGlobalPreset(steps, overrides);

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="card-title">Run composition</h3>
            <p className="text-sm text-base-content/70">
              variant とステップごとの provider は <code>current-note.md</code> frontmatter に保存され、次の loadRuntime で反映されます。
              {variantLocked
                ? " このチケットは PD-C-3 commit 済みで variant lock されています。変更には --force-reset が必要です。"
                : " PD-C-3 が commit されると variant が lock され、それ以降は variant を変更できなくなります。"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`badge ${overrideCount > 0 ? "badge-warning" : "badge-ghost"}`}>
              {overrideCount} override{overrideCount === 1 ? "" : "s"}
            </span>
            {overrideCount > 0 ? (
              <button
                type="button"
                onClick={clearAllOverrides}
                disabled={pendingClearAll || editorLocked}
                className="btn btn-xs btn-ghost"
              >
                {pendingClearAll ? "..." : "すべて reset"}
              </button>
            ) : null}
          </div>
        </div>

        {readOnly && !variantLocked ? (
          <div className="alert alert-warning alert-soft text-sm">
            <span>
              <strong>編集できません</strong>: 既に PD-C-1 から実行が始まっているため、編成の変更は次回の <code>--force-reset</code> 時まで反映されません。
            </span>
          </div>
        ) : null}

        {lastPruned.length > 0 ? (
          <div className="alert alert-warning alert-soft text-sm">
            <span>
              <strong>variant 切替時に override を整理しました</strong> ({lastPruned.length} 件):{" "}
              {lastPruned.map((id) => (
                <code key={id} className="mx-1">{id}</code>
              ))}{" "}
              これらは新しい variant の sequence に含まれないため自動で削除されました。
            </span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLastPruned([])}>
              閉じる
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Flow variant:</span>
          <div className="join">
            {(["light", "full"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => applyVariant(v)}
                disabled={editorLocked || pendingVariant !== null}
                className={[
                  "btn btn-sm join-item",
                  v === variant ? "btn-primary" : "btn-outline",
                  editorLocked ? "btn-disabled" : ""
                ].join(" ")}
              >
                {pendingVariant === v ? "..." : v}
                {v === variant ? " ✓" : ""}
              </button>
            ))}
          </div>
          {variantLocked ? <span className="badge badge-warning">locked</span> : null}
          {readOnly && !variantLocked ? <span className="badge badge-warning">read-only (run started)</span> : null}
        </div>

        <div className="divider my-1" />

        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h4 className="text-sm font-semibold">Agents</h4>
            <PresetChips
              active={globalPreset}
              pending={pendingClearAll || editorLocked}
              onApply={applyGlobalPreset}
            />
          </div>
          <p className="text-xs text-base-content/60 mb-2">
            <span className="font-semibold">preset</span> は全ステップを一括設定します:
            claude / codex はすべてその provider に固定、default はフロー YAML の編成 (override なし) に戻します。
          </p>
          <button
            type="button"
            onClick={() => setShowPerStep((s) => !s)}
            className="btn btn-ghost btn-xs gap-1"
          >
            <span>{showPerStep ? "▾" : "▸"}</span>
            <span>per-step を{showPerStep ? "閉じる" : "開く"}</span>
            {!showPerStep && globalPreset === "custom" ? (
              <span className="badge badge-warning badge-xs ml-1">custom</span>
            ) : null}
          </button>
          {showPerStep ? (
            <div className="mt-3 flex flex-col gap-3">
              {steps.map((step) => (
                <StepCompositionRow
                  key={step.id}
                  step={step}
                  override={overrides[step.id] ?? null}
                  pending={pendingStep === step.id || editorLocked}
                  onChange={(patch) => applyStepOverride(step.id, patch)}
                />
              ))}
            </div>
          ) : null}
        </div>

        {error ? <p className="text-xs text-error break-words">{error}</p> : null}
        {Array.isArray(run?.note_overrides_warnings) && run!.note_overrides_warnings!.length > 0 ? (
          <ul className="text-xs text-warning">
            {run!.note_overrides_warnings!.map((w, i) => (
              <li key={i} className="break-words">⚠ {w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

// parseStepOverride in src/core/note-overrides.ts has an asymmetric
// shape: it accepts edit-mode fields at the TOP level on input
// ({ provider, model, bare }) but emits them under a wrapping `edit`
// key ({ edit: { provider, ... } }) so the parsed object is uniform
// with review-mode keys (aggregator / repair). The UI follows the
// same convention: read `entry.edit?.provider`, write `entry.provider`.
type AgentOverrideEntry = {
  // edit-mode write shape (top-level)
  provider?: Provider;
  model?: string;
  bare?: boolean;
  // edit-mode read shape (after parseStepOverride normalization)
  edit?: { provider?: Provider; model?: string; bare?: boolean };
  // review-mode (same on both sides)
  aggregator?: { provider?: Provider; model?: string };
  repair?: { provider?: Provider; model?: string };
  reviewers?: unknown;
  maxInPlaceRepairs?: number;
};

type StepRowProps = {
  step: StepView;
  override: AgentOverrideEntry | null;
  pending: boolean;
  onChange: (patch: AgentOverrideEntry | null) => void;
};

function StepCompositionRow({ step, override, pending, onChange }: StepRowProps) {
  const isReview = step.mode === "review";
  // Highlight the row when ANY field on this step is overridden so the
  // user can scan the list and find their edits at a glance.
  const rowOverridden = isStepOverridden(override, isReview);
  const rowClass = [
    "rounded-lg border p-3",
    rowOverridden ? "border-warning/60 bg-warning/5" : "border-base-300 bg-base-200/40"
  ].join(" ");

  if (isReview) {
    const aggDefault = (step.aggregatorProvider ?? null) as Provider | null;
    const repairDefault = (step.repairProvider ?? null) as Provider | null;
    const aggCurrent = (override?.aggregator?.provider ?? null) as Provider | null;
    const repairCurrent = (override?.repair?.provider ?? null) as Provider | null;
    const aggOverridden = aggCurrent !== null;
    const repairOverridden = repairCurrent !== null;

    // The runtime treats `reviewers` as a wholesale replacement (see
    // resolveReviewAgent / parseReviewers). To override a single
    // reviewer-instance provider we have to materialize the FULL roster
    // from step.reviewers and swap that one slot.
    const defaultReviewers = step.reviewers ?? [];
    const overrideReviewers = Array.isArray(override?.reviewers)
      ? (override.reviewers as Array<{ role?: string; providers?: string[] }>)
      : null;
    function defaultsFor(role: string): Provider[] {
      const def = defaultReviewers.find((r) => r.role === role);
      return ((def?.providers ?? []) as string[]).filter((p): p is Provider => p === "claude" || p === "codex");
    }
    function currentFor(role: string): Provider[] {
      if (!overrideReviewers) return defaultsFor(role);
      const ovr = overrideReviewers.find((r) => r.role === role);
      if (!ovr || !Array.isArray(ovr.providers)) return defaultsFor(role);
      const defaults = defaultsFor(role);
      return defaults.map((d, i) => {
        const v = ovr.providers?.[i];
        return (v === "claude" || v === "codex") ? v : d;
      });
    }
    function instanceOverridden(role: string, idx: number): boolean {
      const def = defaultsFor(role)[idx];
      const cur = currentFor(role)[idx];
      return def !== cur;
    }

    function setAggregator(next: Provider | null) {
      const merged: AgentOverrideEntry = { ...(override ?? {}) };
      if (next === null) delete merged.aggregator;
      else merged.aggregator = { provider: next };
      const empty = isOverrideEmpty(merged);
      onChange(empty ? null : merged);
    }
    function setRepair(next: Provider | null) {
      const merged: AgentOverrideEntry = { ...(override ?? {}) };
      if (next === null) delete merged.repair;
      else merged.repair = { provider: next };
      const empty = isOverrideEmpty(merged);
      onChange(empty ? null : merged);
    }
    function setReviewerInstance(role: string, idx: number, next: Provider | null) {
      // Build the full roster (every role × every spawn) and swap this
      // single slot. If the resulting roster matches YAML defaults
      // exactly, drop the override entry so we don't leave stale
      // identity-overrides in frontmatter.
      const full = defaultReviewers.map((r) => {
        const cur = currentFor(r.role);
        const providers = cur.map((p, i) => {
          if (r.role !== role || i !== idx) return p;
          return next ?? (defaultsFor(r.role)[i] ?? p);
        });
        return { role: r.role, providers };
      });
      const matchesDefault = full.every((r) => {
        const defs = defaultsFor(r.role);
        return r.providers.length === defs.length && r.providers.every((p, i) => p === defs[i]);
      });
      const merged: AgentOverrideEntry = { ...(override ?? {}) };
      if (matchesDefault) {
        delete merged.reviewers;
      } else {
        merged.reviewers = full;
      }
      const empty = isOverrideEmpty(merged);
      onChange(empty ? null : merged);
    }
    return (
      <div className={rowClass}>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="font-mono text-xs">{step.id}</span>
          <span className="text-sm font-semibold">{step.label}</span>
          <span className="badge badge-ghost badge-sm">review</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ProviderPicker
            label="Aggregator"
            defaultProvider={aggDefault}
            current={aggCurrent}
            overridden={aggOverridden}
            pending={pending}
            onChange={setAggregator}
          />
          <ProviderPicker
            label="Repair"
            defaultProvider={repairDefault}
            current={repairCurrent}
            overridden={repairOverridden}
            pending={pending}
            onChange={setRepair}
          />
        </div>
        {defaultReviewers.length > 0 ? (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold">Reviewers</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {defaultReviewers.flatMap((r) => {
                const defs = defaultsFor(r.role);
                if (defs.length === 0) return [];
                return defs.map((def, idx) => {
                  const overridden = instanceOverridden(r.role, idx);
                  const cur = overridden ? currentFor(r.role)[idx] : null;
                  // Per-spawn label: "Devil's Advocate #1 / #2"
                  const label = defs.length > 1
                    ? `${r.label || r.role} #${idx + 1}`
                    : (r.label || r.role);
                  return (
                    <ProviderPicker
                      key={`${r.role}:${idx}`}
                      label={label}
                      defaultProvider={def}
                      current={cur}
                      overridden={overridden}
                      pending={pending}
                      onChange={(next) => setReviewerInstance(r.role, idx, next)}
                    />
                  );
                });
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const editDefault = (step.provider ?? null) as Provider | null;
  const editCurrent = (override?.edit?.provider ?? override?.provider ?? null) as Provider | null;
  const editOverridden = editCurrent !== null;

  function setEdit(next: Provider | null) {
    // Drop both the parsed-shape (.edit) and the write-shape (.provider/.model/.bare)
    // before re-applying so the frontmatter doesn't accumulate stale fields.
    const merged: AgentOverrideEntry = { ...(override ?? {}) };
    delete merged.edit;
    delete merged.provider;
    delete merged.model;
    delete merged.bare;
    if (next !== null) merged.provider = next;
    const empty = isOverrideEmpty(merged);
    onChange(empty ? null : merged);
  }

  return (
    <div className={rowClass}>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-mono text-xs">{step.id}</span>
        <span className="text-sm font-semibold">{step.label}</span>
        <span className="badge badge-ghost badge-sm">{step.mode ?? "edit"}</span>
      </div>
      <ProviderPicker
        label="Edit"
        defaultProvider={editDefault}
        current={editCurrent}
        overridden={editOverridden}
        pending={pending}
        onChange={setEdit}
      />
    </div>
  );
}

type PresetKind = "claude" | "codex" | "custom" | "default";

type PresetChipsProps = {
  active: PresetKind;
  pending: boolean;
  onApply: (preset: "claude" | "codex" | "default") => void;
};

function PresetChips({ active, pending, onApply }: PresetChipsProps) {
  const buttons: Array<{ key: "claude" | "codex" | "default"; label: string }> = [
    { key: "claude", label: "claude" },
    { key: "codex", label: "codex" },
    { key: "default", label: "default" }
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-base-content/60">preset:</span>
      <div className="join">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            disabled={pending}
            onClick={() => onApply(b.key)}
            className={[
              "btn btn-xs join-item",
              active === b.key ? "btn-primary" : "btn-outline"
            ].join(" ")}
          >
            {b.label}
          </button>
        ))}
      </div>
      {active === "custom" ? <span className="badge badge-ghost badge-xs">custom</span> : null}
    </div>
  );
}

// Detect which preset (if any) every step in the active variant matches.
// "default" — no overrides anywhere.
// "claude" / "codex" — every step matches buildPresetOverride for that provider.
// "custom" — anything else.
function deriveGlobalPreset(steps: StepView[], overrides: Record<string, AgentOverrideEntry>): PresetKind {
  if (steps.length === 0) return "default";
  let anyOverride = false;
  for (const step of steps) {
    if (overrides[step.id] && !isOverrideEmpty(overrides[step.id])) {
      anyOverride = true;
      break;
    }
  }
  if (!anyOverride) return "default";
  for (const preset of ["claude", "codex"] as const) {
    let matches = true;
    for (const step of steps) {
      const expected = buildPresetOverride(step, preset);
      const actual = overrides[step.id] ?? null;
      if (!overridesEqual(expected, actual)) {
        matches = false;
        break;
      }
    }
    if (matches) return preset;
  }
  return "custom";
}

function overridesEqual(a: AgentOverrideEntry | null, b: AgentOverrideEntry | null): boolean {
  const aEmpty = !a || isOverrideEmpty(a);
  const bEmpty = !b || isOverrideEmpty(b);
  if (aEmpty && bEmpty) return true;
  if (aEmpty || bEmpty) return false;
  // Compare normalized read-shape: edit.provider OR top-level provider
  const aEdit = a!.edit?.provider ?? a!.provider ?? null;
  const bEdit = b!.edit?.provider ?? b!.provider ?? null;
  if (aEdit !== bEdit) return false;
  const aAgg = a!.aggregator?.provider ?? null;
  const bAgg = b!.aggregator?.provider ?? null;
  if (aAgg !== bAgg) return false;
  const aRep = a!.repair?.provider ?? null;
  const bRep = b!.repair?.provider ?? null;
  if (aRep !== bRep) return false;
  const aRev = (a!.reviewers ?? []) as Array<{ role?: string; providers?: string[] }>;
  const bRev = (b!.reviewers ?? []) as Array<{ role?: string; providers?: string[] }>;
  if (aRev.length !== bRev.length) return false;
  for (let i = 0; i < aRev.length; i++) {
    const x = aRev[i];
    const y = bRev.find((r) => r.role === x.role);
    if (!y) return false;
    const xp = x.providers ?? [];
    const yp = y.providers ?? [];
    if (xp.length !== yp.length) return false;
    if (!xp.every((p, j) => p === yp[j])) return false;
  }
  return true;
}

// Build the per-step override entry that a given preset would produce.
// claude / codex set every slot (provider/aggregator/repair/reviewer
// spawns) to that provider for the step. Returns null when the
// resulting override is identical to YAML defaults — that lets the
// caller drop the entry instead of writing a no-op.
function buildPresetOverride(step: StepView, preset: "claude" | "codex"): AgentOverrideEntry | null {
  const isReview = step.mode === "review";
  if (!isReview) {
    if (step.provider === preset) return null;
    return { provider: preset };
  }
  const entry: AgentOverrideEntry = {};
  if (step.aggregatorProvider !== preset) entry.aggregator = { provider: preset };
  if (step.repairProvider !== preset) entry.repair = { provider: preset };
  const reviewers = step.reviewers ?? [];
  const rosters = reviewers
    .map((r) => {
      const defs = ((r.providers ?? []) as string[]).filter((p) => p === "claude" || p === "codex") as Provider[];
      const providers = defs.map(() => preset);
      const matchesDefault = providers.length === defs.length && providers.every((p, i) => p === defs[i]);
      return matchesDefault ? null : { role: r.role, providers };
    })
    .filter(Boolean) as Array<{ role: string; providers: Provider[] }>;
  if (rosters.length > 0) entry.reviewers = rosters;
  if (isOverrideEmpty(entry)) return null;
  return entry;
}

type PickerProps = {
  label: string;
  defaultProvider: Provider | null;
  current: Provider | null;
  overridden: boolean;
  pending: boolean;
  onChange: (next: Provider | null) => void;
};

function ProviderPicker({ label, defaultProvider, current, overridden, pending, onChange }: PickerProps) {
  const effective = current ?? defaultProvider;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold">{label}</span>
        {defaultProvider ? (
          <span className="text-xs text-base-content/50">(YAML: {defaultProvider})</span>
        ) : null}
      </div>
      <div className="join">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => onChange(p === defaultProvider && overridden ? null : p)}
            className={[
              "btn btn-xs join-item",
              p === effective ? (overridden ? "btn-warning" : "btn-primary") : "btn-outline"
            ].join(" ")}
          >
            {p}
          </button>
        ))}
      </div>
      {!defaultProvider ? (
        <p className="mt-1 text-xs text-base-content/50">
          このステップは現在の variant では実行されません。
        </p>
      ) : null}
    </div>
  );
}

function isOverrideEmpty(entry: AgentOverrideEntry): boolean {
  return (
    !entry.provider &&
    !entry.edit &&
    !entry.aggregator &&
    !entry.repair &&
    !entry.reviewers &&
    entry.maxInPlaceRepairs === undefined
  );
}

function isStepOverridden(entry: AgentOverrideEntry | null, isReview: boolean): boolean {
  if (!entry) return false;
  if (isReview) {
    return Boolean(entry.aggregator?.provider || entry.repair?.provider || entry.reviewers || entry.maxInPlaceRepairs !== undefined);
  }
  return Boolean(entry.edit?.provider || entry.provider);
}

// Count steps in the active variant's sequence that have any kind of
// override applied. Steps not in the sequence are ignored — they're
// either dormant (carried from a previous variant) or pruned at write
// time by updateNoteFrontmatterFromWeb.
function countOverrides(overrides: Record<string, AgentOverrideEntry>, activeStepIds: string[]): number {
  let n = 0;
  for (const id of activeStepIds) {
    const entry = overrides[id];
    if (!entry) continue;
    if (isStepOverridden(entry, false) || isStepOverridden(entry, true)) {
      n += 1;
    }
  }
  return n;
}
