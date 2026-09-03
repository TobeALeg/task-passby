import { createHash, randomUUID } from "node:crypto";

const WAITING_PREFIX = "waiting:";

function fingerprint(windowTitle: string): string {
  return createHash("sha256").update(windowTitle.trim().toLocaleLowerCase("zh-CN")).digest("hex").slice(0, 20);
}

export function createWorkBuddyWindowLocator(windowTitle: string): string {
  return `workbuddy-window:${fingerprint(windowTitle)}`;
}

export function createPendingWorkBuddyConversationId(windowTitle: string | null, now = Date.now()): string {
  const windowFingerprint = windowTitle?.trim() ? `:${fingerprint(windowTitle)}` : "";
  return `${WAITING_PREFIX}${now + 5 * 60_000}:${randomUUID()}${windowFingerprint}`;
}

export function isPendingWorkBuddyConversationId(conversationId: string, now = Date.now()): boolean {
  const [, expiresAt] = conversationId.split(":");
  return conversationId.startsWith(WAITING_PREFIX) && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > now;
}

export function matchesPendingWorkBuddyWindow(
  conversationId: string,
  windowTitle: string | null,
  now = Date.now()
): boolean {
  const parts = conversationId.split(":");
  if (!isPendingWorkBuddyConversationId(conversationId, now)) return false;
  if (parts.length === 3) return true;
  return typeof windowTitle === "string" && parts.length === 4 && parts[3] === fingerprint(windowTitle);
}
