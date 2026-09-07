import type { CodexThreadView, DashboardView } from "../ui-contract.js";

const RECENT_SOURCE_COUNT = 5;

export function setupRecordingSources(onRecorded: (dashboard: DashboardView) => void): () => Promise<void> {
  const recent = document.querySelector<HTMLElement>("#recent-sources")!;
  const sourceError = document.querySelector<HTMLElement>("#source-error")!;
  const dialog = document.querySelector<HTMLDialogElement>("#history-dialog")!;
  const history = document.querySelector<HTMLElement>("#history-sources")!;
  const historyError = document.querySelector<HTMLElement>("#history-error")!;
  const search = document.querySelector<HTMLInputElement>("#history-search")!;
  const more = document.querySelector<HTMLButtonElement>("#history-more")!;
  let threads: CodexThreadView[] = [];
  let nextCursor: string | null = null;
  let loading = false;
  let recording = false;

  function showError(element: HTMLElement, error: unknown): void {
    element.hidden = !error;
    element.textContent = error instanceof Error ? error.message : error ? String(error) : "";
  }

  function renderSources(container: HTMLElement, sources: CodexThreadView[], empty: string): void {
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
      title.textContent = source.title || "等待 Codex 生成标题";
      const meta = document.createElement("p");
      meta.textContent = `${source.cwd.split("/").filter(Boolean).at(-1) || "Codex"} · ${new Date(source.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      text.append(title, meta);
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = source.workId ? "打开记录" : "开始记录";
      button.disabled = !source.title || recording;
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
            : await window.workpet.createWorkFromCodex({ threadId: source.id });
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
    renderSources(history, threads.filter((thread) => `${thread.title ?? ""} ${thread.cwd}`.toLocaleLowerCase().includes(query)), "没有匹配的聊天");
    more.hidden = !nextCursor;
  }

  async function loadHistory(cursor?: string): Promise<void> {
    if (loading) return;
    loading = true;
    more.disabled = true;
    showError(historyError, null);
    try {
      const page = await window.workpet.listCodexHistory(cursor);
      threads = [...new Map([...(cursor ? threads : []), ...page.threads].map((thread) => [thread.id, thread])).values()];
      nextCursor = page.nextCursor;
      renderHistory();
    } catch (error) {
      showError(historyError, error);
    } finally {
      loading = false;
      more.disabled = false;
    }
  }

  async function refresh(): Promise<void> {
    if (recording) return;
    try {
      const sources = await window.workpet.listCodexThreads();
      renderSources(recent, sources.slice(0, RECENT_SOURCE_COUNT).filter((source) => !source.workId), "最近的聊天均已记录，或暂无可用聊天");
      showError(sourceError, null);
    } catch (error) {
      showError(sourceError, error);
    }
  }

  document.querySelector("#record-history")!.addEventListener("click", () => {
    search.value = "";
    threads = [];
    nextCursor = null;
    history.textContent = "正在加载聊天…";
    more.hidden = true;
    dialog.showModal();
    void loadHistory();
  });
  document.querySelector("#history-close")!.addEventListener("click", () => dialog.close());
  document.querySelector("#history-retry")!.addEventListener("click", () => void loadHistory());
  search.addEventListener("input", renderHistory);
  more.addEventListener("click", () => { if (nextCursor) void loadHistory(nextCursor); });
  return refresh;
}
