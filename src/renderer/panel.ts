import { chooseExecutor } from "./executor-picker.js";
import {
  setupDistillation,
  renderDefinitions,
  workDefinitionAction,
} from "./distillation.js";
import {
  WORK_STATE_LABELS,
  CAPTURE_STATUS_LABELS,
  CAPTURE_WAITING_GUIDANCE,
  RECORDING_UPLOAD_NOTICE,
  type DashboardView,
  type WorkDetailView,
  type WorkStateField,
  type WorkStatus,
} from "../ui-contract.js";
import { setupRecordingSources } from "./recording-sources.js";

const list = required<HTMLElement>("#work-list");
const detail = required<HTMLElement>("#work-detail");
const notice = required<HTMLElement>("#notice");
const splitDialog = required<HTMLDialogElement>("#split-dialog");
const cancelRecordingDialog = required<HTMLDialogElement>("#cancel-recording-dialog");
const splitPointSelect = required<HTMLSelectElement>("#split-point");
let dashboard: DashboardView;
let recordingNoticeRequired = true;
type PanelTab = WorkStatus | "RECENT" | "DEFINITIONS";
let filter: PanelTab = "OPEN";
const selectedDistillationIds = new Set<string>();
let pendingCancelRecordingWorkId: string | null = null;
let pendingSplitWorkId: string | null = null;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ] ?? char,
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function render(): void {
  document.querySelectorAll<HTMLElement>(".filter").forEach((button) => {
    const selected = button.dataset.filter === filter;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && filter !== "RECENT")
      required("#works-panel").setAttribute("aria-labelledby", button.id);
  });
  required<HTMLElement>("#sources-panel").hidden = filter !== "RECENT";
  required<HTMLElement>("#works-panel").hidden =
    filter === "RECENT" || filter === "DEFINITIONS";
  required<HTMLElement>("#definitions-panel").hidden = filter !== "DEFINITIONS";
  if (filter === "DEFINITIONS") {
    void renderDefinitions();
    return;
  }
  if (filter === "RECENT" || !dashboard) return;
  notice.hidden = !dashboard.notice;
  notice.textContent = dashboard.notice ?? "";
  const works = dashboard.works.filter((work) => work.status === filter);
  const checkedIds = selectedDistillationIds;
  for (const id of checkedIds)
    if (!dashboard.works.some((work) => work.id === id)) checkedIds.delete(id);
  required("#distill-selected").textContent =
    `沉淀所选工作（${checkedIds.size}）`;
  list.innerHTML = works.length
    ? works
        .map(
          (
            work,
          ) => `<label class="distill-choice"><input type="checkbox" data-distill-work value="${escapeHtml(work.id)}">选择沉淀：${escapeHtml(work.title)}</label><button class="work-row ${work.id === dashboard.selectedWorkId ? "selected" : ""}" data-work-id="${work.id}">
        <h3>${escapeHtml(work.title)}</h3><span class="status ${work.captureStatus === "waiting" ? "status-waiting" : ""}">${work.status === "OPEN" ? CAPTURE_STATUS_LABELS[work.captureStatus] : work.status === "COMPLETED" ? "已完成" : "已归档"}</span>
        <span class="work-agent agent-label">${escapeHtml(work.agentName)}</span>
        ${work.captureStatus === "waiting" ? `<span class="capture-guidance">${CAPTURE_WAITING_GUIDANCE}</span>` : ""}
        <span class="counts">${work.eventCount} 条记录 · ${work.artifactCount} 份资料 · ${work.episodeCount} 段执行</span>
        <time>${formatDate(work.updatedAt)}</time>
      </button>`,
        )
        .join("")
    : `<div class="empty">${filter === "OPEN" ? "还没有正在记录的工作" : filter === "COMPLETED" ? "还没有已完成的工作" : "还没有已归档的工作"}</div>`;

  for (const input of list.querySelectorAll<HTMLInputElement>(
    "[data-distill-work]",
  )) {
    input.checked = checkedIds.has(input.value);
    input.addEventListener("change", () => {
      if (input.checked) checkedIds.add(input.value);
      else checkedIds.delete(input.value);
      required("#distill-selected").textContent =
        `沉淀所选工作（${checkedIds.size}）`;
    });
  }
  for (const row of list.querySelectorAll<HTMLElement>("[data-work-id]")) {
    row.addEventListener(
      "click",
      () => void selectWork(row.dataset.workId ?? ""),
    );
  }
  renderDetail(
    dashboard.selectedWork?.status === filter ? dashboard.selectedWork : null,
  );
}

function renderDetail(work: WorkDetailView | null): void {
  detail.hidden = !work;
  if (!work) {
    detail.innerHTML = "";
    return;
  }
  const actions =
    work.status === "OPEN"
      ? `<button data-action="refresh">刷新记录</button><button data-action="split">从消息新建</button><button data-action="handoff" class="handoff">交接</button><button data-action="complete">完成</button><details class="secondary-menu"><summary>更多</summary><button data-action="archive">归档</button></details>`
      : work.status === "COMPLETED"
        ? `<button data-action="resume">继续原工作</button><button data-action="split">从消息新建</button><details class="secondary-menu"><summary>更多</summary><button data-action="archive">归档</button></details>`
        : `<button data-action="resume">恢复为进行中</button>`;
  detail.innerHTML = `
    <div class="detail-head">${work.reusableDefinitionId ? `<p class="notice">${work.dispatchStatus === "NOT_DISPATCHED" ? "尚未交给执行者" : work.dispatchStatus === "FAILED" ? "启动失败，可重试" : work.dispatchStatus === "BOUND" && work.dispatchReadAt ? "已绑定本次对话，工作包已读取" : "等待执行端确认接手"}</p>` : ""}<span class="eyebrow">${escapeHtml(work.agentName)}</span><h2>${escapeHtml(work.title)}</h2><p class="detail-meta">${work.eventCount} 条来源记录 · ${work.episodeCount} 段执行</p>${work.captureStatus === "waiting" ? `<p class="capture-guidance">${CAPTURE_WAITING_GUIDANCE}</p>` : ""}</div>
    <div class="detail-actions">${actions}${work.bindings.some((binding) => binding.status === "ACTIVE" && binding.conversationId.startsWith("pending:")) || (work.reusableDefinitionId && !work.bindings.some((binding) => binding.status === "ACTIVE") && ["STARTING", "WAITING"].includes(work.dispatchStatus ?? "")) ? '<button data-action="cancel-handoff">取消未确认交接</button>' : ""}<button data-action="distill">沉淀</button><button data-action="copy">复制工作包</button><button data-action="export">导出工作包</button><button data-action="cancel-recording">取消记录</button></div>
    ${recordingNoticeRequired ? `<p class="notice">${RECORDING_UPLOAD_NOTICE}</p>` : ""}
    ${Object.entries(WORK_STATE_LABELS)
      .map(([field, label]) =>
        stateSection(work, field as WorkStateField, label),
      )
      .join("")}
    <section class="state-section"><h3>执行片段</h3>${work.episodes.map((episode) => `<div class="episode"><span>${escapeHtml(episode.environment)} · ${escapeHtml(episode.executor)}</span><strong>${episode.status}</strong></div>`).join("")}</section>`;

  for (const button of detail.querySelectorAll<HTMLButtonElement>(
    "button[data-action]",
  )) {
    button.addEventListener(
      "click",
      () => void runAction(work.id, button.dataset.action ?? ""),
    );
  }
}

function stateSection(
  work: WorkDetailView,
  field: WorkStateField,
  label: string,
): string {
  const items = work.state[field];
  return `<section class="state-section"><h3>${label}</h3>${
    items.length
      ? items
          .map(
            (item) => `<div class="state-item">
    <p>${escapeHtml(item.text)}</p>
    <span class="origin">只读提取 · ${item.sourceMessageIds.length} 个来源</span>
  </div>`,
          )
          .join("")
      : `<p class="empty-field">暂无</p>`
  }</section>`;
}

async function renderWithRecordingNotice(): Promise<void> {
  try {
    const state = await window.workpet.distillation("recordingNotice");
    recordingNoticeRequired = state.required;
  } catch {
    recordingNoticeRequired = true;
  }
  render();
}

async function selectWork(workId: string): Promise<void> {
  dashboard = await window.workpet.getDashboard(workId);
  render();
}

async function runAction(workId: string, action: string): Promise<void> {
  const selected = dashboard.selectedWork;
  if (action === "cancel-handoff") {
    if (
      !confirm(
        "请确认目标执行者尚未接手。取消后可恢复原来源记录并重新选择执行者；如果目标已经开始工作，取消会漏掉那里的后续记录。目标应用中的草稿仍需自行关闭。",
      )
    )
      return;
    try {
      dashboard = await window.workpet.cancelHandoff(workId, "已确认未接手");
      render();
    } catch (error) {
      notice.hidden = false;
      notice.textContent = String(error);
    }
    return;
  }
  if (action === "handoff") {
    const executorId = await chooseExecutor();
    if (!executorId) return;
    try {
      dashboard =
        selected?.reusableDefinitionId &&
        !selected.bindings.some((binding) => binding.status === "ACTIVE")
          ? await window.workpet.distillation("dispatch", {
              workId,
              executorId,
              commandId: crypto.randomUUID(),
            })
          : await window.workpet.handoff(workId, executorId);
      render();
    } catch (error) {
      notice.hidden = false;
      notice.textContent = String(error);
    }
    return;
  }
  if (selected && (await workDefinitionAction(selected, action))) return;
  if (action === "cancel-recording") {
    pendingCancelRecordingWorkId = workId;
    required<HTMLInputElement>("#cancel-recording-confirmation").value = "";
    required<HTMLElement>("#cancel-recording-error").hidden = true;
    cancelRecordingDialog.showModal();
    return;
  }
  if (action === "split") {
    await openSplit(workId);
    return;
  }
  const operation = {
    refresh: () => window.workpet.refreshWork(workId),
    complete: () => window.workpet.completeWork(workId),
    archive: () => window.workpet.archiveWork(workId),
    resume: () => window.workpet.resumeWork(workId),
  }[action];
  if (!operation) return;
  dashboard = await operation();
  filter = dashboard.selectedWork?.status ?? filter;
  await renderWithRecordingNotice();
}

async function openSplit(workId: string): Promise<void> {
  const points = await window.workpet.listSplitPoints(workId);
  const uploadNotice = required<HTMLElement>("#split-upload-notice");
  uploadNotice.textContent = RECORDING_UPLOAD_NOTICE;
  uploadNotice.hidden = !recordingNoticeRequired;
  splitPointSelect.innerHTML = points
    .map(
      (point) =>
        `<option value="${escapeHtml(point.externalId)}">${escapeHtml(point.label)}</option>`,
    )
    .join("");
  if (!points.length) throw new Error("没有可作为新工作起点的用户消息");
  pendingSplitWorkId = workId;
  splitDialog.showModal();
}

setupDistillation(
  (result) => {
    if (result) {
      dashboard = result;
      filter = result.selectedWork?.status ?? "OPEN";
    } else {
      filter = "DEFINITIONS";
    }
    render();
  },
  () => [...selectedDistillationIds],
);
required("#archive-records").addEventListener("click", () => {
  filter = "ARCHIVED";
  render();
});
required("#close-panel").addEventListener(
  "click",
  () => void window.workpet.closePanel(),
);
required<HTMLButtonElement>("#confirm-split").addEventListener(
  "click",
  async (event) => {
    event.preventDefault();
    if (!pendingSplitWorkId) return;
    dashboard = await window.workpet.createWorkFromMessage({
      sourceWorkId: pendingSplitWorkId,
      startExternalId: splitPointSelect.value,
    });
    pendingSplitWorkId = null;
    splitDialog.close();
    filter = "OPEN";
    await renderWithRecordingNotice();
  },
);
required<HTMLButtonElement>("#confirm-cancel-recording").addEventListener(
  "click",
  async (event) => {
    event.preventDefault();
    if (!pendingCancelRecordingWorkId) return;
    const confirmation = required<HTMLInputElement>(
      "#cancel-recording-confirmation",
    ).value;
    try {
      dashboard = await window.workpet.cancelRecording(
        pendingCancelRecordingWorkId,
        confirmation,
      );
      pendingCancelRecordingWorkId = null;
      cancelRecordingDialog.close();
      render();
    } catch (error) {
      const message = required<HTMLElement>("#cancel-recording-error");
      message.textContent = String(error);
      message.hidden = false;
    }
  },
);
for (const button of document.querySelectorAll<HTMLButtonElement>(".filter")) {
  button.addEventListener("click", () => {
    filter = button.dataset.filter as PanelTab;
    render();
  });
  button.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>(".filter")];
    const index = tabs.indexOf(button);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next]!.focus();
    tabs[next]!.click();
  });
}

const recordingSources = setupRecordingSources((result) => {
  dashboard = result;
  filter = result.selectedWork?.status ?? "OPEN";
  void renderWithRecordingNotice();
});
let refreshing = false;
async function refreshPanel(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const [result, disclosure] = await Promise.allSettled([
      window.workpet.getDashboard(),
      window.workpet.distillation("recordingNotice"),
      recordingSources.refresh(),
    ]);
    recordingNoticeRequired = disclosure.status === "fulfilled" ? disclosure.value.required : true;
    if (result.status === "fulfilled") {
      dashboard = result.value;
      render();
      const selection = await window.workpet.consumeSourceSelection();
      if (selection) await recordingSources.open(selection);
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
setInterval(() => {
  if (!document.hidden) void refreshPanel();
}, 5_000);
