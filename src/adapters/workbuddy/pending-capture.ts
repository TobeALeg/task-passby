import { createHash, randomUUID } from "node:crypto";

const WAITING_PREFIX = "waiting:";

interface PendingWorkBuddyCapture {
  expiresAt: number;
  windowFingerprint: string | null;
}

export type WorkBuddyPendingCaptureState = "ACTIVE" | "EXPIRED" | "NOT_PENDING";

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

export function workBuddyPendingCaptureState(
  conversationId: string,
  now = Date.now()
): WorkBuddyPendingCaptureState {
  const pending = parsePendingWorkBuddyCapture(conversationId);
  if (!pending) return "NOT_PENDING";
  return pending.expiresAt > now ? "ACTIVE" : "EXPIRED";
}

export function matchesPendingWorkBuddyWindow(
  conversationId: string,
  windowTitle: string | null,
  now = Date.now()
): boolean {
  const pending = parsePendingWorkBuddyCapture(conversationId);
  if (!pending || pending.expiresAt <= now) return false;
  if (!pending.windowFingerprint || !windowTitle?.trim()) return true;
  return pending.windowFingerprint === fingerprint(windowTitle);
}

function parsePendingWorkBuddyCapture(conversationId: string): PendingWorkBuddyCapture | null {
  if (!conversationId.startsWith(WAITING_PREFIX)) return null;
  const parts = conversationId.split(":");
  if ((parts.length !== 3 && parts.length !== 4) || !parts[2]) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt)) return null;
  return { expiresAt, windowFingerprint: parts[3] || null };
}
