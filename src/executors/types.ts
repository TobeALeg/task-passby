import type { SourceEvent } from "../core/types.js";
import type { ExecutionEnvironment } from "../core/types.js";
import type { NormalizedThread } from "../adapters/types.js";
import type { ForegroundApplication } from "../adapters/foreground/context.js";

export interface ConversationSummary {
  id: string;
  title: string | null;
  preview: string;
  cwd: string;
  updatedAt: string;
  status: unknown;
}
export interface ConversationPage {
  threads: ConversationSummary[];
  nextCursor: string | null;
}
export interface ConversationSource {
  listThreadPage?(limit?: number, cursor?: string): Promise<ConversationPage>;
  listRecentThreads?(limit?: number): Promise<ConversationSummary[]>;
  readThread(id: string): Promise<NormalizedThread>;
  close(): void;
}
export interface DeliveryRequest {
  workId: string;
  deliveryId: string;
  title: string;
  purpose: "START" | "CONTINUE";
  prompt: string;
  cwd?: string;
}
export interface DeliveryReceipt {
  conversationId?: string;
  guidance?: string;
}
export interface ExecutorAdapter {
  id: string;
  name: string;
  mark: string;
  bundleIds: readonly string[];
  environment: ExecutionEnvironment;
  source: ConversationSource;
  reconcileHistory?(
    thread: NormalizedThread,
    archive: readonly SourceEvent[],
  ): NormalizedThread;
  resolveCurrent(
    application: ForegroundApplication,
  ): Promise<ConversationSummary | null>;
  install?(appPath: string): Promise<string>;
  inspect(): Promise<void>;
  deliver?(request: DeliveryRequest): Promise<DeliveryReceipt>;
}
