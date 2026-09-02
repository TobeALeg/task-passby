import type { WorkStatePatch } from "../core/types.js";
import { WORK_STATE_FIELDS } from "../core/types.js";
import type { WorkStateExtractionInput, WorkStateExtractor } from "./types.js";

export interface OpenAICompatibleExtractorOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export class OpenAICompatibleExtractor implements WorkStateExtractor {
  readonly #options: OpenAICompatibleExtractorOptions;

  constructor(options: OpenAICompatibleExtractorOptions) {
    this.#options = options;
  }

  async extract(input: WorkStateExtractionInput): Promise<WorkStatePatch> {
    const response = await fetch(`${this.#options.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.#options.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是 Work State 提炼器。只提取明确可追溯的信息，不推断隐藏思维。",
              `输出 JSON，字段固定为 ${WORK_STATE_FIELDS.join(", ")}。`,
              "每一项必须包含 id、text、origin、sourceMessageIds。origin 只能是 USER_STATED、AGENT_PROPOSED、SYSTEM_INFERRED。",
              "原始文件内容未提供，不要猜测文件内容。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ previousState: input.previousState, newEvents: input.events })
          }
        ]
      })
    });
    if (!response.ok) throw new Error(`云端提炼失败：HTTP ${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("云端提炼没有返回 Work State");
    const parsed = JSON.parse(content) as WorkStatePatch;
    return Object.fromEntries(
      WORK_STATE_FIELDS.map((field) => [field, Array.isArray(parsed[field]) ? parsed[field] : []])
    ) as WorkStatePatch;
  }
}
