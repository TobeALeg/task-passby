import type { Executor, SourceEventKind } from "../core/types.js";

export type ExecutionEnvironmentType = "CODEX_DESKTOP" | "WORKBUDDY_DESKTOP";

export interface NormalizedSourceEvent {
  id: string;
  externalId: string;
  sequence: number;
  kind: SourceEventKind;
  content: string;
  timestamp: string;
  executorType: Executor["type"];
  environmentType: ExecutionEnvironmentType;
  metadata?: Record<string, unknown>;
}

export interface NormalizedThread {
  threadId: string;
  title: string;
  applicationTitle?: string | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  events: NormalizedSourceEvent[];
}
