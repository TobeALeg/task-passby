export const ROUNDTRIP_SENTINEL = "WORKBUDDY_ROUNDTRIP_OK";

export function qualificationIssues(preview) {
  const issues = [];
  if ((preview.userPromptCount ?? 0) < 20) issues.push(`用户轮次不足 20（当前 ${preview.userPromptCount ?? 0}）`);
  if ((preview.artifactCount ?? 0) < 2) issues.push(`附件不足 2 份（当前 ${preview.artifactCount ?? 0}）`);
  return issues;
}

export function containsExactString(value, expected) {
  if (typeof value === "string") return value.trim() === expected;
  if (Array.isArray(value)) return value.some((entry) => containsExactString(entry, expected));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((entry) => containsExactString(entry, expected));
}

export function parseArchiveEvents(response) {
  const text = response?.result?.content?.find((entry) => entry?.type === "text")?.text;
  if (typeof text !== "string") throw new Error("WorkPet archive MCP 响应缺少文本结果");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.events)) throw new Error("WorkPet archive MCP 响应缺少 events");
  return parsed.events;
}

export function desktopRoundtripIssues({ work, archiveEvents, beforeEventCount }) {
  const issues = [];
  const binding = work?.bindings?.find(
    (candidate) => candidate.adapter === "workbuddy" && candidate.status === "ACTIVE" && !candidate.conversationId.startsWith("pending:")
  );
  if (!binding) issues.push("WorkBuddy Hook 尚未绑定真实桌面会话");
  if (!work || work.eventCount <= beforeEventCount) issues.push("WorkBuddy 桌面对话尚未写回 WorkRecord");
  if (!work?.episodes?.some((episode) => episode.environment === "WorkBuddy Desktop")) {
    issues.push("同一 WorkInstance 下没有 WorkBuddy ExecutionEpisode");
  }
  if (!archiveEvents.some(
    (event) => event.kind === "tool.call"
      && event.environmentType === "WORKBUDDY_DESKTOP"
      && event.metadata?.toolName === "get_work_context"
  )) {
    issues.push("没有观察到 WorkBuddy 调用 get_work_context");
  }
  if (!archiveEvents.some((event) => event.kind === "agent.response" && event.environmentType === "WORKBUDDY_DESKTOP")) {
    issues.push("没有观察到 WorkBuddy 可见回复写回");
  }
  if (!archiveEvents.some((event) => event.kind === "user.prompt" && event.environmentType === "WORKBUDDY_DESKTOP")) {
    issues.push("没有观察到 WorkBuddy 用户 Prompt 写回");
  }
  return issues;
}
