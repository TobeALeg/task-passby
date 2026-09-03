import { postToWorkPet } from "./config.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  await postToWorkPet("/hooks/workbuddy", payload);
  process.stdout.write(JSON.stringify({ continue: true }));
} catch (error) {
  process.stderr.write(`Worket hook 未写入：${error instanceof Error ? error.message : String(error)}\n`);
  process.stdout.write(JSON.stringify({ continue: true }));
}
