import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { shell, systemPreferences } from "electron";

const execFileAsync = promisify(execFile);

export interface WorkBuddyLauncher {
  openNewConversation(deepLink: string): Promise<"sent" | "draft">;
}

export class ElectronWorkBuddyLauncher implements WorkBuddyLauncher {
  async openNewConversation(deepLink: string): Promise<"sent" | "draft"> {
    await shell.openExternal(deepLink);
    if (process.platform !== "darwin" || process.env.WORKPET_AUTO_SEND === "0") return "draft";
    if (!systemPreferences.isTrustedAccessibilityClient(true)) return "draft";
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    try {
      await execFileAsync("/usr/bin/osascript", [
        "-e",
        'tell application "WorkBuddy" to activate',
        "-e",
        'tell application "System Events" to keystroke return'
      ]);
      return "sent";
    } catch {
      // Deep link draft remains visible; the user can send it without losing the handoff.
      return "draft";
    }
  }
}
