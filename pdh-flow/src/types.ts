export type AnyRecord = Record<string, any>;

export type CliOptions = Record<string, string>;

export type ProviderTimeoutKind = "wall" | "idle";

export interface ProviderEvent {
  type: string;
  message: string;
  finalMessage?: string | null;
  sessionId?: string | null;
  payload?: any;
}

export interface ProviderSpawnInfo {
  pid: number | null;
}

export interface ProviderRunResult {
  exitCode: number;
  pid: number | null;
  finalMessage: string;
  sessionId: string | null;
  stderr: string;
  timedOut: boolean;
  timeoutKind: ProviderTimeoutKind | null;
  signal: NodeJS.Signals | null;
}

export interface ProviderTimeoutInfo {
  timeoutMs: number;
  signal: "SIGTERM" | "SIGKILL";
  kind: ProviderTimeoutKind;
}
