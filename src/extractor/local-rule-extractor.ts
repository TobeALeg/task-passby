import { createHash } from "node:crypto";

import type { WorkStateField, WorkStatePatch, ExtractedWorkStateItem } from "../core/types.js";
import type { WorkStateExtractionInput, WorkStateExtractor } from "./types.js";

function idFor(field: WorkStateField, sourceId: string, text: string): string {
  return `local-${createHash("sha256").update(`${field}\0${sourceId}\0${text}`).digest("hex").slice(0, 16)}`;
}

function item(
  field: WorkStateField,
  sourceId: string,
  text: string,
  origin: ExtractedWorkStateItem["origin"]
): ExtractedWorkStateItem {
  return { id: idFor(field, sourceId, text), text, origin, sourceMessageIds: [sourceId] };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstSentence(text: string): string {
  return sentences(text)[0]?.replace(/[。！？!?]+$/u, "") ?? text.trim();
}

function isAcknowledgement(text: string): boolean {
  return /^(好(?:的)?|确认|同意|可以|行|yes|ok|okay)[。.!！\s]*$/iu.test(text.trim());
}

function objectiveCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("# Files pasted by the user:")) return isAcknowledgement(trimmed) ? null : trimmed;
  const request = trimmed.match(/\n##\s+My request:\s*\n([\s\S]+)$/u)?.[1]?.trim();
  return request && !isAcknowledgement(request) ? request : null;
}

function compact(patch: WorkStatePatch): WorkStatePatch {
  for (const field of Object.keys(patch) as WorkStateField[]) {
    const unique = new Map<string, ExtractedWorkStateItem>();
    for (const candidate of patch[field] ?? []) {
      const key = candidate.text.replace(/[\s。.!！]+/gu, "").toLowerCase();
      if (!key || isAcknowledgement(candidate.text) || unique.has(key)) continue;
      unique.set(key, candidate);
    }
    patch[field] = [...unique.values()].slice(0, field === "artifacts" ? 12 : 8);
  }
  return patch;
}

export class LocalRuleExtractor implements WorkStateExtractor {
  async extract(input: WorkStateExtractionInput): Promise<WorkStatePatch> {
    const patch: WorkStatePatch = {
      objective: [],
      successCriteria: [],
      constraints: [],
      facts: [],
      decisions: [],
      completedActions: [],
      pendingActions: [],
      artifacts: []
    };
    const firstPrompt = input.events
      .filter((event) => event.kind === "user.prompt" && event.content?.trim())
      .map((event) => ({ event, candidate: objectiveCandidate(event.content ?? "") }))
      .find(({ candidate }) => candidate);
    if (!(input.previousState?.objective.length) && firstPrompt?.candidate) {
      patch.objective?.push(item("objective", firstPrompt.event.externalId, firstSentence(firstPrompt.candidate), "USER_STATED"));
    }

    for (const event of input.events) {
      const content = event.content?.trim();
      if (!content) continue;
      if (event.kind === "user.prompt") {
        for (const sentence of sentences(content)) {
          if (/(必须|只能|只使用|不得|不可|不要|不能|需要|希望|无需|不需要)/u.test(sentence)) {
            patch.constraints?.push(item("constraints", event.externalId, sentence, "USER_STATED"));
          }
          if (/(完成标准|算完成|验收|成功标准)/u.test(sentence)) {
            patch.successCriteria?.push(item("successCriteria", event.externalId, sentence, "USER_STATED"));
          }
          if (/(决定|确认|同意|采用|选择)/u.test(sentence)) {
            patch.decisions?.push(item("decisions", event.externalId, sentence, "USER_STATED"));
          }
        }
      } else if (event.kind === "agent.response") {
        for (const sentence of sentences(content)) {
          if (/(已完成|已经完成|完成了|已创建|已实现|已修复)/u.test(sentence)) {
            patch.completedActions?.push(item("completedActions", event.externalId, sentence, "AGENT_PROPOSED"));
          }
          const nextStep = sentence.match(/(?:下一步|接下来|待办|还需要|尚需)[：:，,\s]*(.+)/u);
          if (nextStep?.[1]) {
            patch.pendingActions?.push(item("pendingActions", event.externalId, nextStep[1].trim(), "AGENT_PROPOSED"));
          }
        }
      } else if (event.kind === "tool.result") {
        patch.facts?.push(item("facts", event.externalId, content, "SYSTEM_INFERRED"));
      } else if (event.kind === "artifact.added" || event.kind === "artifact.changed") {
        const path = typeof event.metadata?.path === "string" ? event.metadata.path : content;
        patch.artifacts?.push(item("artifacts", event.externalId, path, "SYSTEM_INFERRED"));
      }
    }
    return compact(patch);
  }
}
