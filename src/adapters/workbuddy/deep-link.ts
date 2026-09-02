export interface WorkBuddyBootstrapInput {
  workId: string;
  title: string;
  currentTask: string;
  nextStep: string;
  artifactPaths: string[];
}

export function buildWorkBuddyBootstrap(input: WorkBuddyBootstrapInput): string {
  const artifacts = input.artifactPaths.length
    ? input.artifactPaths.map((path) => `- ${path}`).join("\n")
    : "- 无";
  return [
    `[WORKPET:${input.workId}]`,
    `你正在接手同一项工作：${input.title}`,
    "",
    `当前任务：${input.currentTask || "请先读取工作记录确认当前状态"}`,
    `下一步：${input.nextStep || "调用 WorkPet MCP 获取工作上下文"}`,
    "",
    `请先调用 WorkPet MCP 的 get_work_context，参数 work_id=${input.workId}。`,
    "不要仅根据这条启动指令猜测背景；需要核验时再调用 get_work_archive。",
    "",
    "当前可能需要的资料：",
    artifacts
  ].join("\n");
}

export function buildWorkBuddyDeepLink(prompt: string): string {
  if (prompt.length > 8_000) {
    throw new Error("WorkBuddy deep link prompt 不能超过 8000 字符");
  }
  const url = new URL("workbuddy://task");
  url.searchParams.set("action", "start");
  url.searchParams.set("prompt", prompt);
  url.searchParams.set("welcomeMode", "work");
  url.searchParams.set("permissionMode", "default");
  return url.toString();
}
