import type { NormalizedSourceEvent, NormalizedThread } from "../types.js";

type UnknownRecord = Record<string, unknown>;

export interface CodexThreadPayload extends UnknownRecord {
  id: string;
  name?: string | null;
  preview?: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  turns: CodexTurnPayload[];
}

interface CodexTurnPayload extends UnknownRecord {
  id: string;
  startedAt?: number | null;
  completedAt?: number | null;
  items: CodexItemPayload[];
}

type CodexItemPayload = UnknownRecord & { id: string; type: string };

function isoTime(seconds: number | null | undefined, fallback: number): string {
  return new Date((seconds ?? fallback) * 1_000).toISOString();
}

function textInputs(item: CodexItemPayload): Array<{ kind: "text" | "artifact"; value: string }> {
  if (!Array.isArray(item.content)) return [];
  const output: Array<{ kind: "text" | "artifact"; value: string }> = [];
  for (const raw of item.content) {
    if (!raw || typeof raw !== "object") continue;
    const input = raw as UnknownRecord;
    if (input.type === "text" && typeof input.text === "string" && input.text.trim()) {
      output.push({ kind: "text", value: input.text });
      for (const path of referencedArtifactPaths(input.text)) {
        output.push({ kind: "artifact", value: path });
      }
    } else if (
      (input.type === "localImage" || input.type === "image") &&
      typeof input.path === "string"
    ) {
      output.push({ kind: "artifact", value: input.path });
    }
  }
  return output;
}

function referencedArtifactPaths(text: string): string[] {
  const marker = text.match(/# Files (?:pasted|mentioned) by the user:/u);
  if (marker?.index === undefined) return [];
  const afterMarker = text.slice(marker.index + marker[0].length);
  const requestIndex = afterMarker.search(/\n##\s+My request:/u);
  const section = requestIndex === -1 ? afterMarker : afterMarker.slice(0, requestIndex);
  const paths = new Set<string>();
  for (const match of section.matchAll(/:\s*(\/(?:Users|private|tmp)\/[^\n\r]+)$/gmu)) {
    const path = match[1]?.trim().replace(/^<|>$/gu, "");
    if (path) paths.add(path);
  }
  return [...paths];
}

function event(
  thread: CodexThreadPayload,
  turn: CodexTurnPayload,
  item: CodexItemPayload,
  sequence: number,
  suffix: string,
  fields: Omit<NormalizedSourceEvent, "id" | "externalId" | "sequence" | "timestamp" | "environmentType">
): NormalizedSourceEvent {
  return {
    id: `codex:${thread.id}:${item.id}:${suffix}`,
    externalId: `${item.id}:${suffix}`,
    sequence,
    timestamp: isoTime(turn.startedAt, thread.createdAt),
    environmentType: "CODEX_DESKTOP",
    ...fields
  };
}

export function normalizeCodexThread(thread: CodexThreadPayload): NormalizedThread {
  const events: NormalizedSourceEvent[] = [];
  let sequence = 0;

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "userMessage") {
        for (const [index, input] of textInputs(item).entries()) {
          sequence += 1;
          events.push(
            input.kind === "text"
              ? event(thread, turn, item, sequence, `text-${index}`, {
                  kind: "user.prompt",
                  content: input.value,
                  executorType: "HUMAN"
                })
              : event(thread, turn, item, sequence, `artifact-${index}`, {
                  kind: "artifact.added",
                  content: input.value,
                  executorType: "HUMAN",
                  metadata: { path: input.value, role: "INPUT" }
                })
          );
        }
        continue;
      }

      if (item.type === "agentMessage" && typeof item.text === "string") {
        sequence += 1;
        events.push(
          event(thread, turn, item, sequence, "agent", {
            kind: "agent.response",
            content: item.text,
            executorType: "AGENT"
          })
        );
        continue;
      }

      if (item.type === "reasoning" && Array.isArray(item.summary)) {
        const visibleSummary = item.summary.filter((part): part is string => typeof part === "string").join("\n");
        if (visibleSummary) {
          sequence += 1;
          events.push(
            event(thread, turn, item, sequence, "summary", {
              kind: "reasoning.summary",
              content: visibleSummary,
              executorType: "AGENT"
            })
          );
        }
        continue;
      }

      if (item.type === "commandExecution") {
        sequence += 1;
        events.push(
          event(thread, turn, item, sequence, "command", {
            kind: "tool.call",
            content: typeof item.command === "string" ? item.command : "commandExecution",
            executorType: "TOOL",
            metadata: {
              cwd: item.cwd,
              status: item.status,
              exitCode: item.exitCode,
              output: item.aggregatedOutput
            }
          })
        );
        continue;
      }

      if (item.type === "functionCallOutput") {
        sequence += 1;
        events.push(
          event(thread, turn, item, sequence, "function-output", {
            kind: "tool.result",
            content: typeof item.name === "string" ? item.name : "functionCallOutput",
            executorType: "TOOL",
            metadata: { output: item.output }
          })
        );
        continue;
      }

      if (["mcpToolCall", "dynamicToolCall", "webSearch", "fileChange", "imageGeneration"].includes(item.type)) {
        sequence += 1;
        events.push(
          event(thread, turn, item, sequence, "tool", {
            kind: "tool.call",
            content:
              typeof item.tool === "string"
                ? item.tool
                : typeof item.query === "string"
                  ? item.query
                  : item.type,
            executorType: item.type === "webSearch" ? "SAAS" : "TOOL",
            metadata: Object.fromEntries(Object.entries(item).filter(([key]) => key !== "content"))
          })
        );
      }
    }
  }

  return {
    threadId: thread.id,
    title: thread.name?.trim() || thread.preview?.trim() || "未命名 Codex 工作",
    cwd: thread.cwd,
    createdAt: isoTime(thread.createdAt, thread.createdAt),
    updatedAt: isoTime(thread.updatedAt, thread.createdAt),
    events
  };
}
