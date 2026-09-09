import { createCodexExecutor } from "../adapters/codex/executor.js";
import { createWorkBuddyExecutor } from "../adapters/workbuddy/executor.js";
import type { ExecutorAdapter, ConversationSource } from "./types.js";
import type { WorkBuddyLauncher } from "../adapters/workbuddy/launcher.js";
export function createDefaultExecutors(options: {
  codex?: ConversationSource;
  workbuddy?: ConversationSource;
  launcher: WorkBuddyLauncher;
  openUrl?: (url: string) => Promise<void>;
}): ExecutorAdapter[] {
  return [createCodexExecutor(options), createWorkBuddyExecutor(options)];
}
