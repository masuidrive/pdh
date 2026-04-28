import type { RuntimeBlock, SummaryBlock, GitInfo } from "../lib/types";

type Props = {
  ticketId?: string | null;
  ticketTitle?: string | null;
  branch?: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenFlow?: () => void;
  runtime?: RuntimeBlock | null;
  summary?: SummaryBlock | null;
  git?: GitInfo | null;
  mode?: string | null;
  repoName?: string | null;
};

const RUN_BADGE: Record<string, string> = {
  running: "badge-info",
  completed: "badge-success",
  failed: "badge-error",
  blocked: "badge-warning",
  paused: "badge-warning",
};

export function Navbar({ ticketId, ticketTitle, branch, collapsed, onToggle, onOpenFlow, runtime, summary, git, mode, repoName }: Props) {
  const run = runtime?.run ?? null;
  const supervisor = runtime?.supervisor ?? null;
  const ac = summary?.acCounts ?? {};
  const acVerified = ac.verified ?? 0;
  const acDeferred = ac.deferred ?? 0;
  const acUnverified = ac.unverified ?? 0;
  const head = git?.head ? git.head.slice(0, 7) : null;
  return (
    <div className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100">
      <div className="navbar-start gap-3">
        <button
          className="btn btn-ghost btn-square btn-sm"
          aria-label={collapsed ? "タイムラインを開く" : "タイムラインを折りたたむ"}
          aria-expanded={!collapsed}
          onClick={onToggle}
          type="button"
        >
          <span className="text-xl">{collapsed ? "›" : "☰"}</span>
        </button>
        <div className="avatar avatar-placeholder">
          <div className="w-9 rounded-box bg-neutral text-neutral-content">
            <span className="text-xs font-bold">PD</span>
          </div>
        </div>
        <div>
          <p className="text-base font-bold leading-tight">PDH Dev</p>
          <div className="breadcrumbs hidden p-0 text-xs sm:block">
            <ul>
              {branch ? <li>{branch}</li> : null}
              {ticketId ? <li>{ticketId}</li> : null}
            </ul>
          </div>
        </div>
      </div>
      <div className="navbar-end gap-3">
        {onOpenFlow ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFlow}>
            Flow
          </button>
        ) : null}
        {ticketTitle ? (
          <div className="hidden flex-col items-end leading-tight md:flex">
            <span className="text-sm font-semibold text-base-content/80">{ticketTitle}</span>
            {ticketId ? <span className="text-xs text-base-content/50">{ticketId}</span> : null}
          </div>
        ) : null}

        {summary ? (
          <div className="hidden items-center gap-2 lg:flex">
            <span className="badge badge-outline badge-sm">
              steps {summary.doneCount}/{summary.totalSteps}
            </span>
            {acVerified || acDeferred || acUnverified ? (
              <span
                className={`badge badge-sm ${
                  acUnverified > 0 ? "badge-warning badge-outline" : "badge-success badge-outline"
                }`}
                title="AC verified / deferred / unverified"
              >
                AC {acVerified}/{acDeferred}/{acUnverified}
              </span>
            ) : null}
            {summary.openItems ? (
              <span className="badge badge-warning badge-sm">open {summary.openItems}</span>
            ) : null}
            {summary.gateStatus ? (
              <span className="badge badge-warning badge-outline badge-sm">gate {summary.gateStatus}</span>
            ) : null}
          </div>
        ) : null}

        {run ? (
          <div className="hidden flex-col items-end leading-tight xl:flex">
            <div className="flex items-center gap-2">
              <span className={`badge ${RUN_BADGE[run.status ?? ""] ?? "badge-neutral"} badge-sm`}>{run.status ?? "—"}</span>
              {supervisor?.running ? <span className="badge badge-info badge-sm">supervisor</span> : null}
              {supervisor?.status === "stale" ? <span className="badge badge-error badge-sm">stale</span> : null}
            </div>
            <span className="font-mono text-[11px] text-base-content/50">{run.id ?? ""}</span>
          </div>
        ) : null}

        {(branch || head || repoName) ? (
          <div className="hidden flex-col items-end leading-tight xl:flex">
            {branch ? <span className="text-xs text-base-content/70">⎇ {branch}</span> : null}
            <span className="font-mono text-[11px] text-base-content/50">
              {repoName ?? ""}
              {head ? ` · ${head}` : ""}
              {mode ? ` · ${mode}` : ""}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
