import { useMemo, useState } from "react";
import { useAppState } from "./lib/use-app-state";
import { Navbar } from "./components/Navbar";
import { Timeline } from "./components/Timeline";
import { Workspace } from "./components/Workspace";
import { BottomBar } from "./components/BottomBar";
import { TerminalModal } from "./components/TerminalModal";
import { ArtifactModal } from "./components/ArtifactModal";
import { EventsFeed } from "./components/EventsFeed";

export function App() {
  const slot = useAppState();
  const [collapsed, setCollapsed] = useState(false);
  const [terminalStep, setTerminalStep] = useState<string | null>(null);
  const [artifactTarget, setArtifactTarget] = useState<{ stepId: string; name: string } | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  const variant = useMemo(() => {
    if (!slot.state) return null;
    const flow = slot.state.flow;
    return flow.variants[flow.activeVariant] ?? flow.variants[Object.keys(flow.variants)[0]] ?? null;
  }, [slot.state]);

  const focusedStepId =
    selectedStep ?? slot.state?.runtime?.run?.current_step_id ?? variant?.steps?.[0]?.id ?? null;
  const focusedStep = variant?.steps.find((s) => s.id === focusedStepId) ?? null;
  const next = focusedStep?.current ? slot.state?.current?.nextAction ?? null : null;

  if (slot.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (slot.status === "error" || !slot.state || !variant) {
    return (
      <div className="p-8">
        <div className="alert alert-error">
          <span>{slot.status === "error" ? slot.error : "状態を取得できませんでした"}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar
        ticketId={slot.state.runtime?.run?.ticket_id ?? null}
        ticketTitle={slot.state.tickets?.find((t) => t.id === slot.state?.runtime?.run?.ticket_id)?.title ?? null}
        branch={slot.state.git?.branch}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        runtime={slot.state.runtime}
        summary={slot.state.summary}
        git={slot.state.git}
        mode={slot.state.mode}
        repoName={slot.state.repoName}
      />
      <main
        id="workspace"
        className={`grid min-h-[calc(100vh-4rem)] grid-cols-1 ${collapsed ? "lg:grid-cols-1" : "lg:grid-cols-[24rem_minmax(0,1fr)]"}`}
      >
        {!collapsed ? (
          <aside className="border-r border-base-300 bg-base-100 p-5 pb-28">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-base-content/60">Ticket Flow</p>
                <h1 className="text-xl font-bold">PD-C 開発ライン</h1>
              </div>
              <div className="badge badge-neutral">{variant.variant}</div>
            </div>
            <Timeline
              steps={variant.steps}
              currentStepId={focusedStepId}
              onSelect={(id) => setSelectedStep(id)}
            />
            <div className="mt-6">
              <EventsFeed events={slot.state.events} />
            </div>
          </aside>
        ) : null}
        <Workspace
          step={focusedStep}
          next={next}
          onOpenTerminal={(id) => setTerminalStep(id)}
          onOpenArtifact={(stepId, name) => setArtifactTarget({ stepId, name })}
        />
      </main>
      <BottomBar step={focusedStep} ticketId={slot.state.runtime?.run?.ticket_id ?? null} />
      <TerminalModal open={terminalStep !== null} stepId={terminalStep} onClose={() => setTerminalStep(null)} />
      <ArtifactModal
        open={artifactTarget !== null}
        stepId={artifactTarget?.stepId ?? null}
        name={artifactTarget?.name ?? null}
        onClose={() => setArtifactTarget(null)}
      />
    </>
  );
}
