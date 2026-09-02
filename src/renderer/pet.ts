import type { DashboardView } from "../ui-contract.js";

const petElement = document.querySelector<HTMLButtonElement>("#pet");
if (!petElement) throw new Error("Pet element is missing");
const pet: HTMLButtonElement = petElement;

function render(state: DashboardView): void {
  pet.className = `pet ${state.petState}`;
  pet.title = state.selectedWork ? `${state.selectedWork.title} · ${state.selectedWork.status}` : "记录当前 Codex 工作";
}

pet.addEventListener("click", async () => {
  await window.workpet.togglePanel();
  render(await window.workpet.getDashboard());
});

setInterval(() => window.workpet.getDashboard().then(render).catch(() => undefined), 3_000);
void window.workpet.getDashboard().then(render);
