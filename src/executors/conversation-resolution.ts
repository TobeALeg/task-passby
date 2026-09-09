import type { ConversationSummary } from "./types.js";

function normalizeTitle(title: string): string {
  return title.replace(/\s+/gu, " ").trim().toLocaleLowerCase("zh-CN");
}

/**
 * 只接受唯一的精确标题匹配。最近更新不代表当前聊天，不能作为回退策略。
 */
export function resolveThreadFromWindowTitle(
  windowTitle: string | null,
  threads: ConversationSummary[],
): ConversationSummary | null {
  if (!windowTitle?.trim()) return null;
  const normalized = normalizeTitle(windowTitle);
  const matches = threads.filter(
    (thread) => thread.title && normalizeTitle(thread.title) === normalized,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * 某些桌面容器可能不暴露窗口标题。只有最近任务在短时间内有唯一活动信号时才使用它，
 * 避免把同时活跃的多个任务误认为当前聊天。
 */
export function resolveThreadFromRecentActivity(
  threads: ConversationSummary[],
  now = new Date(),
  maxAgeMs = 5 * 60_000,
  minimumLeadMs = 5_000,
): ConversationSummary | null {
  const newest = threads[0];
  if (!newest) return null;
  const newestTime = Date.parse(newest.updatedAt);
  if (!Number.isFinite(newestTime) || now.getTime() - newestTime > maxAgeMs)
    return null;
  const runnerUp = threads[1];
  if (runnerUp) {
    const runnerUpTime = Date.parse(runnerUp.updatedAt);
    if (
      Number.isFinite(runnerUpTime) &&
      newestTime - runnerUpTime < minimumLeadMs
    )
      return null;
  }
  return newest;
}
