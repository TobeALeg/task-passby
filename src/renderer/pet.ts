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
    petBody.title = "打开 WorkPet";
    paperLabel.textContent = "记录";
    paperAction.removeAttribute("data-action");
    paperAction.setAttribute("aria-label", "当前没有可记录的对话");
    return;
  }
  const hasWork = Boolean(currentConversation.workId);
  const contextState = currentConversation.isRecording
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
  contextLabel.textContent = `${contextState} · ${currentConversation.applicationName}`;
  contextTitle.textContent = currentConversation.title;
  paperLabel.textContent = hasWork ? "打开" : "记录";
  paperAction.dataset.action = hasWork ? "open" : "record";
  paperAction.setAttribute("aria-label", `${hasWork ? "打开" : "记录"}当前工作：${currentConversation.title}`);
  petBody.title = `打开 WorkPet · ${currentConversation.title}`;
}

async function refresh(): Promise<void> {
  if (busy) return;
  render(await window.workpet.getPetView());
}

petBody.addEventListener("click", () => void window.workpet.togglePanelFromPet());

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
  const target = event.target instanceof Element ? event.target : null;
  window.workpet.setPetMousePassthrough(!target?.closest("#pet"));
});
document.addEventListener("mouseleave", () => window.workpet.setPetMousePassthrough(true));

setInterval(() => void refresh().catch(() => undefined), 2_000);
void refresh();
