export async function chooseExecutor(): Promise<string | null> {
  const dialog = document.createElement("dialog");
  dialog.innerHTML =
    '<form method="dialog" class="dialog-card"><h2 id="executor-picker-title">交接给执行者</h2><div class="executor-options"></div><p class="notice" hidden></p><div class="dialog-actions"><button class="secondary" value="cancel">取消</button></div></form>';
  dialog.setAttribute("aria-labelledby", "executor-picker-title");
  document.body.append(dialog);
  const list = dialog.querySelector(".executor-options")!;
  const message = dialog.querySelector<HTMLParagraphElement>(".notice")!;
  let selected: string | null = null;
  const result = new Promise<string | null>((resolve) =>
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        resolve(selected);
      },
      { once: true },
    ),
  );
  dialog.showModal();
  try {
    const executors = await window.workpet.listExecutors();
    if (!dialog.open) return result;
    for (const executor of executors) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = executor.name;
      button.disabled = !executor.available || !executor.canDeliver;
      button.addEventListener("click", () => {
        selected = executor.id;
        dialog.close();
      });
      list.append(button);
      if (executor.error) {
        const error = document.createElement("p");
        error.textContent = `${executor.name}：${executor.error}`;
        list.append(error);
      }
    }
    if (!executors.some((e) => e.available && e.canDeliver)) {
      message.hidden = false;
      message.textContent = "当前没有可接收工作的执行者。";
    }
  } catch (error) {
    message.hidden = false;
    message.textContent = String(error);
  }
  return result;
}
