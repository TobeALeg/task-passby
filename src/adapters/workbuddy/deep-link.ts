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
