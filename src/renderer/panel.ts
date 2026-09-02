import {
  WORK_STATE_LABELS,
  type CodexImportPreview,
  type DashboardView,
  type WorkDetailView,
  type WorkStateField,
  type WorkStatus
} from "../ui-contract.js";

const list = required<HTMLElement>("#work-list");
const detail = required<HTMLElement>("#work-detail");
const notice = required<HTMLElement>("#notice");
const importDialog = required<HTMLDialogElement>("#import-dialog");
const deleteDialog = required<HTMLDialogElement>("#delete-dialog");
const threadSelect = required<HTMLSelectElement>("#codex-thread");
const preview = required<HTMLElement>("#import-preview");
let dashboard: DashboardView;
let filter: WorkStatus = "OPEN";
let pendingDeleteWorkId: string | null = null;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function render(): void {
  notice.hidden = !dashboard.notice;
  notice.textContent = dashboard.notice ?? "";
  const works = dashboard.works.filter((work) => work.status === filter);
  list.innerHTML = works.length
    ? works.map((work) => `<button class="work-row ${work.id === dashboard.selectedWorkId ? "selected" : ""}" data-work-id="${work.id}">
        <h3>${escapeHtml(work.title)}</h3><span class="status">${work.status}</span>
        <span class="counts">${work.eventCount} 条记录 · ${work.artifactCount} 份资料 · ${work.episodeCount} 段执行</span>
        <time>${formatDate(work.updatedAt)}</time>
      </button>`).join("")
    : `<div class="empty">${filter === "OPEN" ? "还没有正在记录的工作" : filter === "COMPLETED" ? "还没有已完成的工作" : "还没有已归档的工作"}</div>`;

  for (const row of list.querySelectorAll<HTMLElement>("[data-work-id]")) {
    row.addEventListener("click", () => void selectWork(row.dataset.workId ?? ""));
  }
  renderDetail(dashboard.selectedWork?.status === filter ? dashboard.selectedWork : null);
}

function renderDetail(work: WorkDetailView | null): void {
  detail.hidden = !work;
  if (!work) { detail.innerHTML = ""; return; }
  const actions = work.status === "OPEN"
    ? `<button data-action="refresh">刷新记录</button><button data-action="handoff" class="handoff">交给 WorkBuddy</button><button data-action="complete">完成</button><button data-action="archive">归档</button>`
    : work.status === "COMPLETED"
      ? `<button data-action="resume">继续原工作</button><button data-action="archive">归档</button>`
      : `<button data-action="resume">恢复为进行中</button>`;
  detail.innerHTML = `
    <div class="detail-head"><span class="eyebrow">${work.id.slice(0, 8)}</span><h2>${escapeHtml(work.title)}</h2><p class="detail-meta">${work.eventCount} 条来源记录 · ${work.episodeCount} 个 Execution Episode</p></div>
    <div class="detail-actions">${actions}<button data-action="delete">永久删除</button></div>
    ${Object.entries(WORK_STATE_LABELS).map(([field, label]) => stateSection(work, field as WorkStateField, label)).join("")}
    <section class="state-section"><h3>执行片段</h3>${work.episodes.map((episode) => `<div class="episode"><span>${escapeHtml(episode.environment)} · ${escapeHtml(episode.executor)}</span><strong>${episode.status}</strong></div>`).join("")}</section>`;

  for (const textarea of detail.querySelectorAll<HTMLTextAreaElement>("textarea[data-item-id]")) {
    textarea.addEventListener("change", () => void updateItem(work.id, textarea));
  }
  for (const button of detail.querySelectorAll<HTMLButtonElement>("button[data-remove-item]")) {
    button.addEventListener("click", () => void removeItem(work.id, button));
  }
  for (const button of detail.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    button.addEventListener("click", () => void runAction(work.id, button.dataset.action ?? ""));
  }
}

function stateSection(work: WorkDetailView, field: WorkStateField, label: string): string {
  const items = work.state[field];
  return `<section class="state-section"><h3>${label}</h3>${items.length ? items.map((item) => `<div class="state-item">
    <textarea data-field="${field}" data-item-id="${item.id}">${escapeHtml(item.text)}</textarea>
    <button class="remove" data-remove-item="${item.id}" data-field="${field}" aria-label="删除">×</button>
    <span class="origin">${item.origin} · ${item.sourceMessageIds.length} 个来源</span>
  </div>`).join("") : `<p class="empty-field">暂无</p>`}</section>`;
}

async function selectWork(workId: string): Promise<void> {
  dashboard = await window.workpet.getDashboard(workId);
  render();
}

async function updateItem(workId: string, textarea: HTMLTextAreaElement): Promise<void> {
  dashboard = await window.workpet.editStateItem(workId, textarea.dataset.field as WorkStateField, textarea.dataset.itemId ?? "", textarea.value.trim());
  render();
}

async function removeItem(workId: string, button: HTMLButtonElement): Promise<void> {
  dashboard = await window.workpet.deleteStateItem(workId, button.dataset.field as WorkStateField, button.dataset.removeItem ?? "");
  render();
}

async function runAction(workId: string, action: string): Promise<void> {
  if (action === "delete") { pendingDeleteWorkId = workId; deleteDialog.showModal(); return; }
  const operation = {
    refresh: () => window.workpet.refreshWork(workId),
    handoff: () => window.workpet.handoffToWorkBuddy(workId),
    complete: () => window.workpet.completeWork(workId),
    archive: () => window.workpet.archiveWork(workId),
    resume: () => window.workpet.resumeWork(workId)
  }[action];
  if (!operation) return;
  dashboard = await operation();
  render();
}

async function openImport(): Promise<void> {
  const threads = await window.workpet.listCodexThreads();
  threadSelect.innerHTML = threads.map((thread) => `<option value="${thread.id}">${escapeHtml(thread.title)} · ${escapeHtml(thread.cwd)}</option>`).join("");
  if (!threads.length) preview.textContent = "没有找到可导入的 Codex 任务";
  else await updatePreview();
  importDialog.showModal();
}

async function updatePreview(): Promise<void> {
  const data: CodexImportPreview = await window.workpet.previewCodexThread(threadSelect.value);
  preview.innerHTML = `<strong>${escapeHtml(data.title)}</strong><br>${data.messageCount} 条消息 · ${data.artifactCount} 份资料 · ${data.toolEventCount} 条工具记录<br>${escapeHtml(data.cwd)}`;
}

required("#record-codex").addEventListener("click", () => void openImport());
required("#setup-integrations").addEventListener("click", async () => {
  const result = await window.workpet.installIntegrations();
  if (result && typeof result === "object" && "cancelled" in result) return;
  notice.hidden = false;
  notice.textContent = "Codex 与 WorkBuddy 本地接入已安装。请重启两个应用使插件生效。";
});
required("#close-panel").addEventListener("click", () => void window.workpet.closePanel());
threadSelect.addEventListener("change", () => void updatePreview());
required<HTMLButtonElement>("#confirm-import").addEventListener("click", async (event) => {
  event.preventDefault();
  dashboard = await window.workpet.createWorkFromCodex({ threadId: threadSelect.value, allowCloudExtraction: required<HTMLInputElement>("#cloud-consent").checked });
  importDialog.close();
  filter = "OPEN";
  render();
});
required<HTMLButtonElement>("#confirm-delete").addEventListener("click", async (event) => {
  event.preventDefault();
  if (!pendingDeleteWorkId) return;
  const confirmation = required<HTMLInputElement>("#delete-confirmation").value;
  dashboard = await window.workpet.deleteWork(pendingDeleteWorkId, confirmation);
  pendingDeleteWorkId = null;
  deleteDialog.close();
  render();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(".filter")) {
  button.addEventListener("click", () => {
    filter = button.dataset.filter as WorkStatus;
    document.querySelectorAll(".filter").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    render();
  });
}

dashboard = await window.workpet.getDashboard();
render();
