import { postToWorkPet } from "./config.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function currentWindowTitle() {
  const script = `
const events = Application('System Events');
const process = events.applicationProcesses.whose({ frontmost: true })[0];
console.log(process.windows[0].name());`;
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 3_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  payload.workpet_window_title = await currentWindowTitle();
  await postToWorkPet("/hooks/workbuddy", payload);
  process.stdout.write(JSON.stringify({ continue: true }));
} catch (error) {
  process.stderr.write(`WorkPet hook 未写入：${error instanceof Error ? error.message : String(error)}\n`);
  process.stdout.write(JSON.stringify({ continue: true }));
}
