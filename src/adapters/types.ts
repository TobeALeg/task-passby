export type SourceEventKind =
  | "user.prompt"
  | "agent.response"
  | "reasoning.summary"
  | "tool.call"
  | "tool.result"
  | "artifact.added"
  | "artifact.changed";

export type ExecutorType = "HUMAN" | "AGENT" | "TOOL" | "SAAS";
export type ExecutionEnvironmentType = "CODEX_DESKTOP" | "WORKBUDDY_DESKTOP";

export interface NormalizedSourceEvent {
  id: string;
  externalId: string;
  sequence: number;
  kind: SourceEventKind;
  content: string;
  timestamp: string;
  executorType: ExecutorType;
  environmentType: ExecutionEnvironmentType;
  metadata?: Record<string, unknown>;
}

export interface NormalizedThread {
  threadId: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  events: NormalizedSourceEvent[];
}
