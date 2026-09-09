import type { ExecutorAdapter, ConversationPage } from "./types.js";

export async function conversationPage(
  adapter: ExecutorAdapter,
  cursor?: string,
): Promise<ConversationPage> {
  const source = adapter.source;
  if (source.listThreadPage) return source.listThreadPage(30, cursor);
  return {
    threads: cursor ? [] : ((await source.listRecentThreads?.(100)) ?? []),
    nextCursor: null,
  };
}
export class ExecutorRegistry {
  readonly #adapters = new Map<string, ExecutorAdapter>();
  constructor(adapters: ExecutorAdapter[]) {
    for (const adapter of adapters) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(adapter.id) ||
        this.#adapters.has(adapter.id)
      )
        throw new Error("执行者 ID 无效或重复");
      this.#adapters.set(adapter.id, adapter);
    }
  }
  get(id: string): ExecutorAdapter {
    const adapter = this.#adapters.get(id);
    if (!adapter) throw new Error(`未接入执行者：${id}`);
    return adapter;
  }
  all(): ExecutorAdapter[] {
    return [...this.#adapters.values()];
  }
  forApplication(bundleId: string): ExecutorAdapter | null {
    return (
      this.all().find((adapter) => adapter.bundleIds.includes(bundleId)) ?? null
    );
  }
  close(): void {
    for (const adapter of this.all()) adapter.source.close();
  }
}
