# Web UI feature inventory

The legacy UI shipped inline in `src/web-server.mjs` (~5,300 lines, deleted in
commit `557d559`). This document catalogs every feature it exposed, what is
already restored in the React SPA under `web/`, and what still has to be ported.

The legacy source can be re-read at any time:

```bash
git show 557d559^:pdh-flow/src/web-server.mjs > /tmp/legacy-web-server.mjs
```

Each row uses one of:
- `done` — already on parity in the SPA
- `partial` — present but lighter than the legacy version
- `missing` — not implemented yet in the SPA

## 1. Layout

| Feature | Status | Notes |
| --- | --- | --- |
| App shell (navbar + timeline + workspace + bottom bar) | `done` | `App.tsx`, daisyUI pancake theme |
| Right-hand header info (run id, status, AC counts, branch, mode) | `done` | `Navbar.tsx` |
| Collapsible timeline pane | `done` | `App.tsx` toggle |
| Per-step status icons + selection ring | `done` | `Timeline.tsx` |
| Recent events feed in sidebar | `partial` | `EventsFeed.tsx` shows last 12; legacy showed live tail with kind/provider/step grouping |
| Bottom bar process group lines (reviewer ×N (M:SS), elapsed) | `partial` | `BottomBar.tsx` aggregates kind+count+longest, legacy also showed provider activity events from `events` |
| Auto-keep-clear of fixed bars (smooth scroll padding) | `missing` | `keepElementClearOfFixedBars()` |

## 2. Step (中央) workspace

| Feature | Status | Notes |
| --- | --- | --- |
| Title + summary + status badge | `done` | `Workspace.tsx` |
| Next action alert (warning/info/error) | `done` | `Workspace.tsx` |
| Action tiles (Approve / Run Next / Open Terminal / Resume / Stop) | `partial` | All wired except `apply_assist` is stubbed in API layer; legacy could distinguish `recommend` vs `direct` modes per kind |
| CLI-equivalent dropdown (commands list) | `done` | `Workspace.tsx` `CLI で実行` |
| Per-step bespoke 判断材料 layouts (resolvers per step kind) | `missing` | Legacy: `resolveInvestigationItem`, `resolvePlanItem`, `resolvePlanReviewItem`, `resolveImplementationApprovalItem`, `resolveImplementationItem`, `resolveQualityReviewItem`, `resolvePurposeValidationItem`, `resolveFinalVerificationItem`, `resolveCloseApprovalItem`. Each resolved `mustShow`/`mustReady` labels into rich items (diff target, plan excerpt, risk excerpt, AC verifier table, etc.) |
| Generic 判断材料 fallback (note / ticket / diff / judgement excerpts) | `partial` | `EvidencePanel.tsx` shows diff/note/findings/judgements + artifact list, but content does not match legacy semantics (`buildShowItem` types: `plan`, `risk`, `verification`, `diff`, `commands`, `note`, `ticket`, `judgement`, `live`) |
| Inline rich text with `[label](path)` repo-file links | `missing` | Legacy `renderInlineRichText()` recognizes file paths and turns them into modal-launching links |
| AC verifier table render | `missing` | Legacy: `acTableText` parsed and rendered as table |
| Reviewer findings panel with severity grouping | `partial` | `EvidencePanel.tsx` lists top 5 findings; legacy had per-reviewer rounds, repair history, and grouped by severity |
| Ticket implementation notes block | `missing` | Legacy showed `ticketImplementationNotes` next to plan |
| Diagnostics block (failed-step output) | `missing` | Legacy: `detail-diagnostics` |
| Live event tail per step | `missing` | Legacy: `detail-live` shows recent provider/runtime events for the focused step |
| Failure summary card with exit codes | `missing` | Legacy: `currentFailedDiagnosis()` |

## 3. Assist terminal modal (largest gap)

| Feature | Status | Notes |
| --- | --- | --- |
| xterm.js connected over `/api/assist/ws` | `done` | `TerminalModal.tsx` |
| Modal close via `Close` button + backdrop | `done` | |
| Resize observer → fit | `done` | |
| **Quick-keys row** (`assist-key-quick`) — Enter, Esc, Ctrl-C, Tab, ↑↓←→, Ctrl-D, Ctrl-L, etc. | `missing` | Legacy: `bindAssistShellInteractions()` + `assistSequence(kind)` |
| **Login button** (auto-detected from terminal output) | `missing` | Legacy: `updateAssistLoginAvailability()`, `sendAssistLoginSequence()` |
| **Recommendation prompt drawer** (`assist-prompt-drawer`) — composes "follow the recommendation" prompt and sends it | `missing` | Legacy: `assistRecommendationPromptText()` + `sendAssistPromptSequence()` |
| **Copy fallback dialog** for clipboard-restricted browsers | `missing` | Legacy: `renderCopyFallback()` |
| Auto-open on `needs_human` / `failed` / `stop_after_step` | `missing` | Legacy: `maybeAutoOpenAssist()` |
| Auto-dismiss on assist signal | `missing` | Legacy: `closeAssistModal({ suppressAutoOpenDismissal })` |
| Status line above terminal (running / disconnected / waiting) | `missing` | Legacy: `assist-status` |
| Modal header with provider label, ticket id, copy session link | `partial` | Currently just `Terminal · <stepId>` |
| Ticket-scope terminal (`/api/ticket/terminal`) for runs not yet started | `partial` | Endpoint wired in `api.ts` but no UI button to call it |

## 4. Action confirm modal

| Feature | Status | Notes |
| --- | --- | --- |
| Generic confirm dialog with reason field | `missing` | Legacy: `openActionConfirm()` (`#action-modal`) — used for force-restart, stop, accept-recommendation flows |
| Force-restart prompt (different ticket / archive prior tags) | `missing` | Legacy: confirm before `/api/ticket/start?force=1` |
| Stop with reason input | `missing` | Legacy: stop sent `reason=user_stopped` |
| Accept recommendation review modal | `missing` | Legacy: `assist-confirm` previewed the recommendation before applying |

## 5. Detail viewers (markdown / diff / mermaid)

| Feature | Status | Notes |
| --- | --- | --- |
| Markdown viewer modal with section highlight | `partial` | `ArtifactModal.tsx` renders markdown via `markdown-it`; legacy also supported `?doc=note&heading=...` deep links and highlighted the section. Clicking a heading link opened a sub-modal. |
| Raw / markdown view toggle | `missing` | Legacy: `detail-view-toggle` |
| Diff pretty viewer with +/-/@@ syntax highlight | `missing` | Legacy: `renderDiffPretty()` |
| Code block toolbar with language label + copy button | `missing` | Legacy: `detail-code-toolbar`, `detail-code-language`, `detail-copy-button` |
| Mermaid flow render | `missing` | Legacy fetched `/api/flow.mmd` + posted to `/api/render-mermaid`; rendered into a card |
| Repo file viewer (open arbitrary repo file) | `missing` | Legacy: `fileModalItem`, `/api/file?step=...&path=...` |
| Inline repo-file embedding in detail panel | `missing` | Legacy: `detail-inline-file` |

## 6. Ticket / runtime control

| Feature | Status | Notes |
| --- | --- | --- |
| Ticket chooser list with status badges (`todo`, `doing`, `done`) | `missing` | Legacy: `renderTicketList()` (`pdc-list`); rendered the `tickets` array |
| Start ticket flow (variant picker, force toggle) | `missing` | Legacy: ticket card → confirm modal → `/api/ticket/start` |
| Pending ticket-start request banners | `missing` | Legacy consumed `ticketRequests[]` and showed actionable cards |
| Run id / status / supervisor controls in header | `done` | `Navbar.tsx` shows badges; legacy also had a "stop supervisor" button |
| Resume / stop supervisor buttons | `partial` | Wired in `api.ts`; UI surface only when state exposes them via `nextAction.actions[]` |
| Recover-from-tags command | `missing` | CLI-only (`pdh-flow recover`); no UI button yet |

## 7. Documents & navigation

| Feature | Status | Notes |
| --- | --- | --- |
| Read current-note.md / current-ticket.md / product-brief.md / epic.md | `missing` | Legacy: top-level "Docs" links + `documentModalItem(docId, headingOrHeadings)` |
| Section deep links (`#PD-C-3. 計画` etc.) | `missing` | Legacy resolved heading prefixes and scrolled the modal |
| URL-based modal state (`?doc=...&heading=...&mode=markdown`) | `missing` | Legacy: `requestedModalItem()` + `clearRequestedModalQuery()` |

## 8. Diagnostics / observability

| Feature | Status | Notes |
| --- | --- | --- |
| Live polling fallback when SSE drops | `partial` | SPA EventSource auto-reconnects but no manual fallback to polling |
| Last-update relative time badge | `missing` | Legacy showed "5s ago" on the navbar |
| Failed step diagnosis card (provider stderr tail, exit code) | `missing` | Legacy: `currentFailedDiagnosis()` |
| Provider activity ticker in bottom bar (`assist_started`, `provider_started`, etc.) | `missing` | Legacy: `providerActivityLines()` |

## 9. Misc

| Feature | Status | Notes |
| --- | --- | --- |
| `Ctrl/⌘+Enter` primary-action shortcut | `missing` | Legacy: `bindPrimaryPress()` |
| Auto scroll of selected step into view | `missing` | Legacy: `ensureSelectedVisible()` |
| Body modal lock (prevent double scroll) | `missing` | Legacy: `updateBodyModalLock()` |
| Copy button (with fallback dialog) | `missing` | Legacy: `wireCopyButtons()` + `renderCopyFallback()` |

---

## Suggested port order (high → low impact)

1. **Action confirm modal + recommendation accept dialog** — currently every
   action is one click with no preview, which is dangerous for force-restart.
2. **Per-step 判断材料 resolvers** — Investigation / Plan / PlanReview /
   Approval / Implementation / Quality / Purpose / Final / Close. The current
   generic panel does not match how the legacy decides what to surface.
3. **Assist terminal quick-keys + login button + prompt drawer** — without
   these the terminal modal cannot drive Claude (only observe).
4. **Detail viewers** — diff pretty, markdown deep-link, mermaid flow,
   repo-file viewer.
5. **Ticket chooser + start flow + pending requests** — required to start a
   new ticket from the UI.
6. **Failed-step diagnostics** — surface failure summary so users can decide
   between Open Terminal, Run Next (force), or Stop.
7. **Document deep links + URL state** — restore `?doc=note&heading=...`
   compatibility.
8. **Polish** — copy fallback, last-update badge, primary-action shortcut,
   ensure-visible scrolling.

The legacy reference file is `git show 557d559^:pdh-flow/src/web-server.mjs`
— ~5,300 lines starting at `function renderHtml(initialState = null)`.
