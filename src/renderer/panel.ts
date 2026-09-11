import { chooseExecutor } from "./executor-picker.js";
import {
  setupDistillation,
  renderDefinitions,
  workDefinitionAction,
} from "./distillation.js";
import {
  WORK_STATE_LABELS,
  CAPTURE_STATUS_LABELS,
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
let detailOpen = false;
let actionPending = false;

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
    if (selected && filter !== "RECENT" && filter !== "DEFINITIONS")
      required("#works-panel").setAttribute("aria-labelledby", button.id);
  });
  if (filter === "ARCHIVED") required<HTMLElement>("#tab-open").tabIndex = 0;
  required<HTMLElement>("#sources-panel").hidden = filter !== "RECENT";
  required<HTMLElement>("#works-panel").hidden =
    filter === "RECENT" || filter === "DEFINITIONS";
  required<HTMLElement>("#definitions-panel").hidden = filter !== "DEFINITIONS";
  if (filter === "DEFINITIONS") {
    void renderDefinitions().catch(showError);
    return;
  }
  if (filter === "RECENT" || !dashboard) return;
  notice.hidden = !dashboard.notice;
  notice.textContent = dashboard.notice ?? "";
  const works = dashboard.works.filter((work) => work.status === filter);
  const checkedIds = selectedDistillationIds;
  for (const id of checkedIds)
    if (!dashboard.works.some((work) => work.id === id)) checkedIds.delete(id);
  updateSelection();
  required("#list-title").textContent = filter === "ARCHIVED" ? "归档记录" : filter === "COMPLETED" ? "已完成" : "进行中";
  if (filter === "ARCHIVED") required("#works-panel").setAttribute("aria-labelledby", "list-title");
  list.innerHTML = works.length
    ? works
        .map(
          (
            work,
          ) => `<div class="work-entry"><label class="work-select"><input type="checkbox" data-distill-work value="${escapeHtml(work.id)}" aria-label="选择 ${escapeHtml(work.title)}"></label><button class="work-row" data-work-id="${escapeHtml(work.id)}">
        <h3>${escapeHtml(work.title)}</h3><span class="status ${work.captureStatus === "waiting" ? "status-waiting" : ""}">${work.status === "OPEN" ? CAPTURE_STATUS_LABELS[work.captureStatus] : work.status === "COMPLETED" ? "已完成" : "已归档"}</span>
        <span class="row-meta"><span class="agent-label">${escapeHtml(work.agentName)}</span><span>· ${work.eventCount} 条记录</span><time>· ${formatDate(work.updatedAt)}</time></span>
      </button></div>`,
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
      updateSelection();
    });
  }
  for (const row of list.querySelectorAll<HTMLElement>("[data-work-id]")) {
    row.addEventListener(
      "click",
      () => void selectWork(row.dataset.workId ?? "").catch(showError),
    );
  }
  renderDetail(
    detailOpen && dashboard.selectedWork?.status === filter ? dashboard.selectedWork : null,
  );
}

function renderDetail(work: WorkDetailView | null): void {
  detail.hidden = !work;
  list.hidden = Boolean(work);
  required<HTMLElement>("#list-toolbar").hidden = Boolean(work);
  if (!work) {
    detail.innerHTML = "";
    return;
  }
  const actions = work.status === "OPEN"
    ? '<button data-action="handoff" class="primary">交接</button><button data-action="complete">完成</button><button data-action="distill">沉淀</button>'
    : `<button data-action="resume" class="primary">${work.status === "COMPLETED" ? "继续工作" : "恢复工作"}</button><button data-action="distill">沉淀</button>`;
  const waiting = work.bindings.some((binding) => binding.status === "ACTIVE" && binding.conversationId.startsWith("pending:")) || (work.reusableDefinitionId && !work.bindings.some((binding) => binding.status === "ACTIVE") && ["STARTING", "WAITING"].includes(work.dispatchStatus ?? ""));
  detail.innerHTML = `
    <button id="back-to-list" class="back-button">‹ 返回列表</button>
    <div class="detail-head"><span class="eyebrow">${escapeHtml(work.agentName)}</span><h2>${escapeHtml(work.title)}</h2><p class="detail-meta">${work.eventCount} 条记录 · ${work.artifactCount} 份资料 · ${work.episodeCount} 段执行${work.reusableDefinitionId || work.captureStatus === "waiting" ? ` · <span class="capture-status">${work.dispatchStatus === "NOT_DISPATCHED" ? "尚未交接" : work.dispatchStatus === "FAILED" ? "交接失败" : work.dispatchStatus === "BOUND" && work.dispatchReadAt ? "已接手" : "等待接手"}</span>` : ""}</p></div>
    <div class="detail-actions">${actions}<details class="secondary-menu"><summary aria-label="工作操作">更多</summary><div class="menu-items">${work.status === "OPEN" ? '<button data-action="refresh">刷新记录</button>' : ""}${work.status !== "ARCHIVED" ? '<button data-action="split">从消息新建</button><button data-action="archive">归档</button>' : ""}${waiting ? '<button data-action="cancel-handoff">取消未确认交接</button>' : ""}<button data-action="copy">复制工作包</button><button data-action="export">导出工作包</button><div class="menu-divider"></div><button data-action="cancel-recording" class="destructive">取消记录</button></div></details></div>
    ${work.latestActivity ? `<section class="state-section"><h3>最近回复</h3><div class="state-item"><p class="latest-activity">${escapeHtml(work.latestActivity.text.trim().split(/\n\s*\n/u).slice(0, 3).join("\n\n").replace(/\*\*([^*]+)\*\*/gu, "$1"))}</p></div></section>` : ""}
    ${Object.entries(WORK_STATE_LABELS)
      .map(([field, label]) =>
        stateSection(work, field as WorkStateField, label),
      )
      .join("")}
    <section class="state-section"><h3>执行片段</h3>${work.episodes.map((episode) => `<div class="episode"><span>${escapeHtml(episode.environment)} · ${escapeHtml(episode.executor)}</span><strong>${episode.status === "ACTIVE" ? "进行中" : "已结束"}</strong></div>`).join("")}</section>`;

  for (const link of detail.querySelectorAll<HTMLAnchorElement>("[data-artifact-id]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void window.workpet.openArtifact(work.id, link.dataset.artifactId!).catch(showError);
    });
  }
  required("#back-to-list").addEventListener("click", () => {
    detailOpen = false;
    render();
    list.querySelector<HTMLButtonElement>(`[data-work-id="${CSS.escape(work.id)}"]`)?.focus();
  });
  for (const button of detail.querySelectorAll<HTMLButtonElement>(
    "button[data-action]",
  )) {
    button.addEventListener(
      "click",
      () => void performAction(work.id, button.dataset.action ?? "", button),
    );
  }
}

function stateSection(
  work: WorkDetailView,
  field: WorkStateField,
  label: string,
): string {
  const items = work.state[field];
  if (!items.length) return "";
  return `<section class="state-section"><h3>${label}</h3>${items.map((item) => {
    const file = field === "artifacts" ? item.file : undefined;
    return `<div class="state-item${file ? " artifact-item" : ""}">
      <p>${file ? `<a class="artifact-link" href="${escapeHtml(file.url)}" title="${escapeHtml(file.path)}" data-artifact-id="${escapeHtml(item.id)}">${escapeHtml(file.name)}</a>` : escapeHtml(item.text)}</p>
      <span class="origin">${item.sourceMessageIds.length} 个来源</span>
    </div>`;
  }).join("")}</section>`;
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
  detailOpen = true;
  dashboard = await window.workpet.getDashboard(workId);
  filter = dashboard.selectedWork?.status ?? filter;
  render();
  window.scrollTo(0, 0);
  required<HTMLButtonElement>("#back-to-list").focus();
}

function showError(error: unknown): void {
  notice.hidden = false;
  notice.setAttribute("role", "alert");
  notice.textContent = error instanceof Error ? error.message : String(error);
}

function updateSelection(): void {
  const button = required<HTMLButtonElement>("#distill-selected");
  button.disabled = selectedDistillationIds.size === 0;
  button.textContent = selectedDistillationIds.size ? `沉淀所选 (${selectedDistillationIds.size})` : "沉淀所选";
}

async function performAction(workId: string, action: string, button: HTMLButtonElement): Promise<void> {
  if (actionPending) return;
  actionPending = true;
  button.disabled = true;
  try {
    await runAction(workId, action);
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    actionPending = false;
  }
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
      detailOpen = true;
      filter = result.selectedWork?.status ?? "OPEN";
    } else {
      filter = "DEFINITIONS";
    }
    render();
  },
  () => [...selectedDistillationIds],
);
required("#archive-records").addEventListener("click", () => {
  detailOpen = false;
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
    const button = event.currentTarget as HTMLButtonElement;
    if (button.disabled) return;
    button.disabled = true;
    try {
      dashboard = await window.workpet.createWorkFromMessage({
        sourceWorkId: pendingSplitWorkId,
        startExternalId: splitPointSelect.value,
      });
      pendingSplitWorkId = null;
      splitDialog.close();
      filter = "OPEN";
      detailOpen = true;
      await renderWithRecordingNotice();
    } catch (error) {
      const message = required<HTMLElement>("#split-upload-notice");
      message.textContent = String(error);
      message.hidden = false;
    } finally { button.disabled = false; }
  },
);
required<HTMLButtonElement>("#confirm-cancel-recording").addEventListener(
  "click",
  async (event) => {
    event.preventDefault();
    if (!pendingCancelRecordingWorkId) return;
    const button = event.currentTarget as HTMLButtonElement;
    if (button.disabled) return;
    button.disabled = true;
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
    } finally {
      button.disabled = false;
    }
  },
);
for (const button of document.querySelectorAll<HTMLButtonElement>(".filter")) {
  button.addEventListener("click", () => {
    detailOpen = false;
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
  detailOpen = true;
  filter = result.selectedWork?.status ?? "OPEN";
  void renderWithRecordingNotice();
});
let refreshing = false;
async function refreshPanel(): Promise<void> {
  if (refreshing || actionPending || document.querySelector("dialog[open], .secondary-menu[open]") || document.activeElement?.matches("input, textarea, select")) return;
  refreshing = true;
  try {
    const [result, disclosure] = await Promise.allSettled([
      window.workpet.getDashboard(),
      window.workpet.distillation("recordingNotice"),
      recordingSources.refresh(),
    ]);
    const previousNoticeRequired = recordingNoticeRequired;
    recordingNoticeRequired = disclosure.status === "fulfilled" ? disclosure.value.required : true;
    if (result.status === "fulfilled") {
      const changed = JSON.stringify(dashboard) !== JSON.stringify(result.value);
      dashboard = result.value;
      if (changed || previousNoticeRequired !== recordingNoticeRequired || filter === "DEFINITIONS") render();
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
window.workpet.onPanelShown((workId) => {
  if (workId) void selectWork(workId).catch(showError);
  else void refreshPanel();
});
setInterval(() => {
  if (!document.hidden) void refreshPanel();
}, 5_000);

// Menus close after selection, outside clicks, or Escape; keyboard focus stays recoverable.
document.addEventListener("click", (event) => {
  const target = event.target as Element;
  document.querySelectorAll<HTMLDetailsElement>(".secondary-menu[open]").forEach((menu) => {
    if (!menu.contains(target) || target.closest("button")) menu.open = false;
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll<HTMLDetailsElement>(".secondary-menu[open]").forEach((menu) => {
    menu.open = false;
    menu.querySelector<HTMLElement>("summary")?.focus();
  });
});
window.addEventListener("worket-feedback", (event) => {
  notice.textContent = (event as CustomEvent<string>).detail;
  notice.setAttribute("role", "status");
  notice.hidden = false;
});

document.addEventListener("toggle", (event) => {
  const menu = event.target;
  if (!(menu instanceof HTMLDetailsElement) || !menu.matches(".secondary-menu") || !menu.open) return;
  const items = menu.querySelector<HTMLElement>(".menu-items");
  if (!items) return;
  items.style.transform = "";
  const rect = items.getBoundingClientRect();
  if (rect.bottom > innerHeight - 12) items.style.transform = `translateY(${innerHeight - 12 - rect.bottom}px)`;
}, true);
