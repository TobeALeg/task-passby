import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
const execute = promisify(execFile);
// macOS does not expose the Dock's icon frame without Accessibility permission.
// Reserve a conservative span from its icon preferences; no new permission prompt.
export async function readDockSpace(): Promise<{ width: number; bottom: boolean } | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(homedir(), "Library/Preferences/com.apple.dock.plist")], { timeout: 1500 });
    const prefs = JSON.parse(stdout);
    const count = (key: string) => Array.isArray(prefs[key]) ? prefs[key].length : 0;
    const slots = count("persistent-apps") + count("persistent-others") + Math.max(3, count("recent-apps")) + 4;
    const size = Math.max(16, Math.min(128, Number(prefs.tilesize) || 48));
    return { width: slots * (size + 10) + 24, bottom: !prefs.orientation || prefs.orientation === "bottom" };
  } catch { return null; }
}
