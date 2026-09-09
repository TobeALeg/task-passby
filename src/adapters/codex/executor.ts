import { CodexAppServerClient } from "./app-server-client.js";
import { installCodexIntegration } from "./install.js";
import { conversationPage } from "../../executors/registry.js";
import {
  resolveThreadFromWindowTitle,
  resolveThreadFromRecentActivity,
} from "../../executors/conversation-resolution.js";
import { buildWorkBootstrap } from "../../executors/work-bootstrap.js";
import type {
  ExecutorAdapter,
  ConversationSource,
} from "../../executors/types.js";
export function createCodexExecutor(options: {
  codex?: ConversationSource;
  openUrl?: (url: string) => Promise<void>;
}): ExecutorAdapter {
  const codex = options.codex ?? new CodexAppServerClient();
  const adapter: ExecutorAdapter = {
    id: "codex",
    name: "Codex",
    mark: "⌘",
    bundleIds: ["com.openai.codex", "DOVE.tauri"],
    environment: { type: "CODEX_DESKTOP", name: "Codex Desktop" },
    source: codex,
    install: installCodexIntegration,
    async inspect() {
      await conversationPage(adapter);
    },
    async resolveCurrent(app) {
      const { threads } = await conversationPage(adapter);
      const thread = app.windowTitle?.trim()
        ? resolveThreadFromWindowTitle(
            app.windowTitle?.replace(/\s+[—–-]\s+(?:Codex|ChatGPT)$/iu, "") ??
              null,
            threads,
          )
        : resolveThreadFromRecentActivity(threads);
      return thread?.title?.trim() ? thread : null;
    },
    ...(options.openUrl
      ? {
          async deliver(
            request: import("../../executors/types.js").DeliveryRequest,
          ) {
            const url = new URL("codex://new");
            url.searchParams.set(
              "prompt",
              buildWorkBootstrap({
                workId: request.workId,
                deliveryId: request.deliveryId,
                purpose: request.purpose,
                title: request.title,
                currentTask: "请读取本次完整工作包。",
                nextStep: "按工作包继续执行并等待用户验收。",
                artifactPaths: [],
              }),
            );
            if (request.cwd) url.searchParams.set("path", request.cwd);
            await options.openUrl!(url.toString());
            return { guidance: "新聊天已准备好，请在 Codex 确认发送。" };
          },
        }
      : {}),
  };
  return adapter;
}
