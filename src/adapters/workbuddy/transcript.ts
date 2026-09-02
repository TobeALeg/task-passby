import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { SourceEventInput } from "../../core/types.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function stableId(sessionId: string, line: string, parsed: UnknownRecord): string {
  const candidate = parsed.id ?? parsed.uuid ?? record(parsed.message)?.id;
  if (typeof candidate === "string" && candidate) return `workbuddy:${sessionId}:${candidate}`;
  return `workbuddy:${sessionId}:${createHash("sha256").update(line).digest("hex").slice(0, 24)}`;
}

function contentBlocks(content: unknown): UnknownRecord[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.map(record).filter((block): block is UnknownRecord => block !== null);
}

function localPath(block: UnknownRecord): string | null {
  for (const key of ["path", "local_path", "file_path"]) {
    if (typeof block[key] === "string" && (block[key] as string).startsWith("/")) return block[key] as string;
  }
  if (typeof block.uri === "string" && block.uri.startsWith("file://")) {
    try { return decodeURIComponent(new URL(block.uri).pathname); } catch { return null; }
  }
  return null;
}

export async function parseWorkBuddyTranscript(path: string, sessionId: string): Promise<SourceEventInput[]> {
  const contents = await readFile(path, "utf8");
  const events: SourceEventInput[] = [];
  let sequence = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let parsed: UnknownRecord;
    try { parsed = JSON.parse(line) as UnknownRecord; } catch { continue; }
    const message = record(parsed.message) ?? parsed;
    const role = message.role ?? parsed.type;
    if (role !== "user" && role !== "assistant") continue;
    const baseId = stableId(sessionId, line, parsed);
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();
    const blocks = contentBlocks(message.content);
    for (const [index, block] of blocks.entries()) {
      const blockType = typeof block.type === "string" ? block.type : "text";
      if (blockType === "thinking" || blockType === "reasoning" || blockType === "tool_use" || blockType === "tool_result") continue;
      const text = typeof block.text === "string" ? block.text.trim() : "";
      if (text) {
        sequence += 1;
        events.push({
          externalId: `${baseId}:text:${index}`,
          sequence,
          kind: role === "user" ? "user.prompt" : "agent.response",
          content: text,
          timestamp,
          executorType: role === "user" ? "HUMAN" : "AGENT",
          environmentType: "WORKBUDDY_DESKTOP",
          metadata: {},
          artifactRefs: []
        });
      }
      const artifactPath = localPath(block);
      if (artifactPath) {
        sequence += 1;
        events.push({
          externalId: `${baseId}:artifact:${index}`,
          sequence,
          kind: "artifact.added",
          content: artifactPath,
          timestamp,
          executorType: role === "user" ? "HUMAN" : "AGENT",
          environmentType: "WORKBUDDY_DESKTOP",
          metadata: { path: artifactPath, role: role === "user" ? "INPUT" : "OUTPUT", blockType },
          artifactRefs: []
        });
      }
    }
  }
  return events;
}
