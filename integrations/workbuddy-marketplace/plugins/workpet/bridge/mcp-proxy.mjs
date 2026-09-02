import { createInterface } from "node:readline";

import { postToWorkPet } from "./config.mjs";

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const message = JSON.parse(line);
    const response = await postToWorkPet("/mcp", message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
    })}\n`);
  }
}
