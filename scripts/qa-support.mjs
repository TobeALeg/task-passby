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

export function desktopRoundtripIssues({ work, archiveEvents, beforeEventCount, proofToken }) {
  const issues = [];
  const binding = work?.bindings?.find(
    (candidate) => candidate.adapter === "workbuddy" && candidate.status === "ACTIVE" && !candidate.conversationId.startsWith("pending:")
  );
  if (!binding) issues.push("WorkBuddy Hook 尚未绑定真实桌面会话");
  if (!work || work.eventCount <= beforeEventCount) issues.push("WorkBuddy 桌面对话尚未写回 WorkRecord");
  const episode = binding
    ? work?.episodes?.find((candidate) => candidate.id === binding.episodeId && candidate.environment === "WorkBuddy Desktop")
    : null;
  if (!episode) {
    issues.push("同一 WorkInstance 下没有 WorkBuddy ExecutionEpisode");
  }
  const sameEpisodeEvents = binding
    ? archiveEvents.filter((event) => event.episodeId === binding.episodeId)
    : [];
  const successfulCall = sameEpisodeEvents.find(
    (event) => event.kind === "tool.call"
      && event.environmentType === "WORKBUDDY_DESKTOP"
      && event.metadata?.toolName === "get_work_context"
      && event.metadata?.outcome === "success"
      && event.metadata?.bindingId === binding?.id
      && event.metadata?.conversationId === binding?.conversationId
  );
  const successfulResult = successfulCall
    ? sameEpisodeEvents.find(
      (event) => event.kind === "tool.result"
        && event.metadata?.auditId === successfulCall.metadata?.auditId
        && event.metadata?.outcome === "success"
    )
    : null;
  if (!successfulCall || !successfulResult) {
    issues.push("没有观察到 WorkBuddy 调用 get_work_context");
  }
  const visibleResponses = sameEpisodeEvents.filter(
    (event) => event.kind === "agent.response"
      && event.environmentType === "WORKBUDDY_DESKTOP"
      && event.metadata?.sessionId === binding?.conversationId
  );
  if (!visibleResponses.length) {
    issues.push("没有观察到 WorkBuddy 可见回复写回");
  } else if (proofToken && !visibleResponses.some((event) => event.content?.includes(proofToken))) {
    issues.push("WorkBuddy 可见回复没有包含 MCP 返回的本次验收 proof token");
  }
  if (!sameEpisodeEvents.some(
    (event) => event.kind === "user.prompt"
      && event.environmentType === "WORKBUDDY_DESKTOP"
      && event.metadata?.sessionId === binding?.conversationId
  )) {
    issues.push("没有观察到 WorkBuddy 用户 Prompt 写回");
  }
  return issues;
}
