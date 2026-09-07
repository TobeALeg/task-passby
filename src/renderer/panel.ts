import {
  WORK_STATE_LABELS,
  CAPTURE_STATUS_LABELS,
  CAPTURE_WAITING_GUIDANCE,
  type DashboardView,
  type WorkDetailView,
  type WorkStateField,
  type WorkStatus
} from "../ui-contract.js";
import { setupRecordingSources } from "./recording-sources.js";

const list = required<HTMLElement>("#work-list");
const detail = required<HTMLElement>("#work-detail");
const notice = required<HTMLElement>("#notice");
const splitDialog = required<HTMLDialogElement>("#split-dialog");
const deleteDialog = required<HTMLDialogElement>("#delete-dialog");
const splitPointSelect = required<HTMLSelectElement>("#split-point");
let dashboard: DashboardView;
let filter: WorkStatus = "OPEN";
let pendingDeleteWorkId: string | null = null;
let pendingSplitWorkId: string | null = null;

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
  document.querySelectorAll<HTMLElement>(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
  notice.hidden = !dashboard.notice;
  notice.textContent = dashboard.notice ?? "";
  const works = dashboard.works.filter((work) => work.status === filter);
  list.innerHTML = works.length
    ? works.map((work) => `<button class="work-row ${work.id === dashboard.selectedWorkId ? "selected" : ""}" data-work-id="${work.id}">
        <h3>${escapeHtml(work.title)}</h3><span class="status ${work.captureStatus === "waiting" ? "status-waiting" : ""}">${work.status === "OPEN" ? CAPTURE_STATUS_LABELS[work.captureStatus] : work.status === "COMPLETED" ? "已完成" : "已归档"}</span>
        <span class="work-agent agent-label">${escapeHtml(work.agentName)}</span>
        ${work.captureStatus === "waiting" ? `<span class="capture-guidance">${CAPTURE_WAITING_GUIDANCE}</span>` : ""}
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
    ? `<button data-action="refresh">刷新记录</button><button data-action="split">从消息新建</button><button data-action="handoff" class="handoff">交给 WorkBuddy</button><button data-action="complete">完成</button><button data-action="archive">归档</button>`
    : work.status === "COMPLETED"
      ? `<button data-action="resume">继续原工作</button><button data-action="split">从消息新建</button><button data-action="archive">归档</button>`
      : `<button data-action="resume">恢复为进行中</button>`;
  detail.innerHTML = `
    <div class="detail-head"><span class="eyebrow">${escapeHtml(work.agentName)}</span><h2>${escapeHtml(work.title)}</h2><p class="detail-meta">${work.eventCount} 条来源记录 · ${work.episodeCount} 段执行</p>${work.captureStatus === "waiting" ? `<p class="capture-guidance">${CAPTURE_WAITING_GUIDANCE}</p>` : ""}</div>
    <div class="detail-actions">${actions}<button data-action="delete">永久删除</button></div>
    ${Object.entries(WORK_STATE_LABELS).map(([field, label]) => stateSection(work, field as WorkStateField, label)).join("")}
    <section class="state-section"><h3>执行片段</h3>${work.episodes.map((episode) => `<div class="episode"><span>${escapeHtml(episode.environment)} · ${escapeHtml(episode.executor)}</span><strong>${episode.status}</strong></div>`).join("")}</section>`;

  for (const button of detail.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    button.addEventListener("click", () => void runAction(work.id, button.dataset.action ?? ""));
  }
}

function stateSection(work: WorkDetailView, field: WorkStateField, label: string): string {
  const items = work.state[field];
  return `<section class="state-section"><h3>${label}</h3>${items.length ? items.map((item) => `<div class="state-item">
    <p>${escapeHtml(item.text)}</p>
    <span class="origin">只读提取 · ${item.sourceMessageIds.length} 个来源</span>
  </div>`).join("") : `<p class="empty-field">暂无</p>`}</section>`;
}

async function selectWork(workId: string): Promise<void> {
  dashboard = await window.workpet.getDashboard(workId);
  render();
}

async function runAction(workId: string, action: string): Promise<void> {
  if (action === "delete") { pendingDeleteWorkId = workId; deleteDialog.showModal(); return; }
  if (action === "split") { await openSplit(workId); return; }
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

async function openSplit(workId: string): Promise<void> {
  const points = await window.workpet.listCodexSplitPoints(workId);
  splitPointSelect.innerHTML = points.map((point) => `<option value="${escapeHtml(point.externalId)}">${escapeHtml(point.label)}</option>`).join("");
  if (!points.length) throw new Error("没有可作为新工作起点的用户消息");
  pendingSplitWorkId = workId;
  splitDialog.showModal();
}

required("#close-panel").addEventListener("click", () => void window.workpet.closePanel());
required<HTMLButtonElement>("#confirm-split").addEventListener("click", async (event) => {
  event.preventDefault();
  if (!pendingSplitWorkId) return;
  dashboard = await window.workpet.createWorkFromCodexMessage({
    sourceWorkId: pendingSplitWorkId,
    startExternalId: splitPointSelect.value
  });
  pendingSplitWorkId = null;
  splitDialog.close();
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

const refreshSources = setupRecordingSources((result) => {
  dashboard = result;
  filter = result.selectedWork?.status ?? "OPEN";
  render();
});
let refreshing = false;
async function refreshPanel(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const [result] = await Promise.allSettled([
      window.workpet.getDashboard(),
      refreshSources()
    ]);
    if (result.status === "fulfilled") {
      dashboard = result.value;
      render();
    } else {
      notice.hidden = false;
      notice.textContent = String(result.reason);
    }
  } finally {
    refreshing = false;
  }
}
void refreshPanel();
window.workpet.onPanelShown(() => void refreshPanel());
setInterval(() => { if (!document.hidden) void refreshPanel(); }, 5_000);
