import type { ConversationView, DashboardView } from "../ui-contract.js";

const RECENT_SOURCE_COUNT = 5;

export function setupRecordingSources(
  onRecorded: (dashboard: DashboardView) => void,
): {
  refresh: () => Promise<void>;
  open: (executorId?: string) => Promise<void>;
} {
  const recent = document.querySelector<HTMLElement>("#recent-sources")!;
  const sourceError = document.querySelector<HTMLElement>("#source-error")!;
  const dialog = document.querySelector<HTMLDialogElement>("#history-dialog")!;
  const history = document.querySelector<HTMLElement>("#history-sources")!;
  const historyError = document.querySelector<HTMLElement>("#history-error")!;
  const search = document.querySelector<HTMLInputElement>("#history-search")!;
  const more = document.querySelector<HTMLButtonElement>("#history-more")!;
  const executor =
    document.querySelector<HTMLSelectElement>("#history-executor")!;
  let threads: ConversationView[] = [];
  let nextCursor: string | null = null;
  let loading = false;
  let recording = false;

  function showError(element: HTMLElement, error: unknown): void {
    element.hidden = !error;
    element.textContent =
      error instanceof Error ? error.message : error ? String(error) : "";
  }

  function renderSources(
    container: HTMLElement,
    sources: ConversationView[],
    empty: string,
  ): void {
    container.replaceChildren();
    if (!sources.length) {
      const message = document.createElement("p");
      message.className = "source-empty";
      message.textContent = empty;
      container.append(message);
    }
    for (const source of sources) {
      const row = document.createElement("div");
      row.className = "source-row";
      row.dataset.threadId = source.id;
      const text = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = source.title || "未命名聊天";
      const meta = document.createElement("p");
      meta.className = "source-meta";
      const agent = document.createElement("span");
      agent.className = "agent-label";
      agent.textContent = source.agentName;
      meta.append(
        agent,
        document.createTextNode(
          `${source.cwd.split("/").filter(Boolean).at(-1) || "无项目"} · ${new Date(source.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
        ),
      );
      text.append(title, meta);
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = source.workId ? "打开记录" : "开始记录";
      button.disabled = recording;
      button.addEventListener("click", async () => {
        if (recording) return;
        recording = true;
        button.disabled = true;
        button.textContent = source.workId ? "正在打开…" : "正在导入…";
        const errorElement = dialog.open ? historyError : sourceError;
        showError(errorElement, null);
        try {
          const dashboard = source.workId
            ? await window.workpet.getDashboard(source.workId)
            : await window.workpet.createWorkFromConversation({
                executorId: source.executorId,
                threadId: source.id,
              });
          dialog.close();
          onRecorded(dashboard);
        } catch (error) {
          showError(errorElement, error);
        } finally {
          recording = false;
          button.disabled = false;
          button.textContent = source.workId ? "打开记录" : "开始记录";
          await refresh();
        }
      });
      row.append(text, button);
      container.append(row);
    }
  }

  function renderHistory(): void {
    const query = search.value.trim().toLocaleLowerCase();
    renderSources(
      history,
      threads.filter((thread) =>
        `${thread.title ?? ""} ${thread.cwd}`
          .toLocaleLowerCase()
          .includes(query),
      ),
      "没有匹配的聊天",
    );
    more.hidden = !nextCursor;
  }

  async function loadHistory(cursor?: string): Promise<void> {
    if (loading) return;
    loading = true;
    more.disabled = true;
    executor.disabled = true;
    showError(historyError, null);
    try {
      const page = await window.workpet.listConversationHistory(
        executor.value,
        cursor,
      );
      threads = [
        ...new Map(
          [...(cursor ? threads : []), ...page.threads].map((thread) => [
            `${thread.executorId}:${thread.id}`,
            thread,
          ]),
        ).values(),
      ];
      nextCursor = page.nextCursor;
      renderHistory();
    } catch (error) {
      showError(historyError, error);
    } finally {
      loading = false;
      more.disabled = false;
      executor.disabled = false;
    }
  }

  async function refresh(): Promise<void> {
    if (recording) return;
    try {
      const result = await window.workpet.listRecentConversations();
      const sources = result.threads;
      renderSources(
        recent,
        sources
          .slice(0, RECENT_SOURCE_COUNT)
          .filter((source) => !source.workId),
        "最近的聊天均已记录，或暂无可用聊天",
      );
      showError(sourceError, result.errors.join("\n"));
    } catch (error) {
      showError(sourceError, error);
    }
  }

  async function open(executorId?: string): Promise<void> {
    search.value = "";
    threads = [];
    nextCursor = null;
    history.textContent = "正在加载聊天…";
    more.hidden = true;
    if (!dialog.open) dialog.showModal();
    try {
      const executors = await window.workpet.listExecutors();
      executor.replaceChildren(
        ...executors.map((item) => {
          const option = document.createElement("option");
          option.value = item.id;
          option.textContent = item.name;
          return option;
        }),
      );
      if (executorId) executor.value = executorId;
      if (executor.value) await loadHistory();
      else history.textContent = "暂无已接入的执行者";
    } catch (error) {
      showError(historyError, error);
    }
  }
  document
    .querySelector("#record-history")!
    .addEventListener("click", () => void open());
  executor.addEventListener("change", () => void loadHistory());
  document
    .querySelector("#history-close")!
    .addEventListener("click", () => dialog.close());
  document
    .querySelector("#history-retry")!
    .addEventListener("click", () => void loadHistory());
  search.addEventListener("input", renderHistory);
  more.addEventListener("click", () => {
    if (nextCursor) void loadHistory(nextCursor);
  });
  return { refresh, open };
}
