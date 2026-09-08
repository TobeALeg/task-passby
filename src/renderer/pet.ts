import type { CurrentConversationView, PetView } from "../ui-contract.js";

const root = required<HTMLElement>("#pet-root");
const pet = required<HTMLElement>("#pet");
const petBody = required<HTMLButtonElement>("#pet-body");
const bubble = required<HTMLElement>("#context-bubble");
const applicationMark = required<HTMLElement>("#application-mark");
const contextLabel = required<HTMLElement>("#context-label");
const contextTitle = required<HTMLElement>("#context-title");
const paperAction = required<HTMLButtonElement>("#paper-action");
const paperLabel = required<HTMLElement>("#paper-label");
let currentConversation: CurrentConversationView | null = null;
let busy = false;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function render(state: PetView): void {
  pet.className = `pet ${state.petState}`;
  currentConversation = state.currentConversation;
  const hasConversation = Boolean(currentConversation);
  root.classList.toggle("has-context", hasConversation);
  root.classList.toggle("recording-context", Boolean(currentConversation?.isRecording));
  bubble.hidden = !currentConversation;
  paperAction.disabled = !currentConversation || busy;
  if (!currentConversation) {
    petBody.title = "打开 Worket";
    paperLabel.textContent = "记录";
    paperAction.removeAttribute("data-action");
    paperAction.setAttribute("aria-label", "当前没有可记录的对话");
    return;
  }
  const hasWork = Boolean(currentConversation.workId);
  const contextState = currentConversation.captureStatus === "waiting"
    ? "等待发送消息"
    : currentConversation.isRecording
    ? "正在记录"
    : currentConversation.workStatus === "COMPLETED"
      ? "已完成"
      : currentConversation.workStatus === "ARCHIVED"
        ? "已归档"
        : hasWork
          ? "已记录"
          : "当前聚焦";
  applicationMark.textContent = currentConversation.adapter === "codex" ? "⌘" : "W";
  applicationMark.className = `application-mark ${currentConversation.adapter}`;
  contextLabel.textContent = currentConversation.captureStatus === "waiting"
    ? "请在 WorkBuddy 发送消息"
    : `${contextState} · ${currentConversation.applicationName}`;
  contextTitle.textContent = currentConversation.title;
  paperLabel.textContent = hasWork ? "打开" : "记录";
  paperAction.dataset.action = hasWork ? "open" : "record";
  paperAction.setAttribute("aria-label", `${hasWork ? "打开" : "记录"}当前工作：${currentConversation.title}`);
  petBody.title = `打开 Worket · ${currentConversation.title}`;
}

async function refresh(): Promise<void> {
  if (busy) return;
  render(await window.workpet.getPetView());
}

let gesture: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
let suppressClick = false;
petBody.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || gesture) return;
  suppressClick = false;
  gesture = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  petBody.setPointerCapture(event.pointerId);
  window.workpet.dragPet("start", { x: event.screenX, y: event.screenY });
});
document.addEventListener("pointermove", (event) => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) >= 5) gesture.moved = true;
  if (gesture.moved) {
    root.classList.add("dragging");
    window.workpet.dragPet("move", { x: event.screenX, y: event.screenY });
  }
});
function finishDrag(): void {
  if (!gesture) return;
  suppressClick = gesture.moved;
  gesture = null;
  root.classList.remove("dragging");
  window.workpet.dragPet("end");
}
document.addEventListener("pointerup", finishDrag);
document.addEventListener("pointercancel", finishDrag);
petBody.addEventListener("lostpointercapture", finishDrag);
window.addEventListener("blur", finishDrag);
petBody.addEventListener("click", (event) => {
  if (suppressClick && event.detail !== 0) {
    suppressClick = false;
    return;
  }
  void window.workpet.togglePanelFromPet();
});

paperAction.addEventListener("click", async () => {
  if (!currentConversation || busy) return;
  busy = true;
  paperAction.disabled = true;
  try {
    await window.workpet.recordCurrentContextFromPet();
  } finally {
    busy = false;
    await refresh();
  }
});

document.addEventListener("mousemove", (event) => {
  if (gesture) return;
  const target = event.target instanceof Element ? event.target : null;
  window.workpet.setPetMousePassthrough(!target?.closest("#pet"));
});
document.addEventListener("mouseleave", () => { if (!gesture) window.workpet.setPetMousePassthrough(true); });

setInterval(() => void refresh().catch(() => undefined), 2_000);
void refresh();
