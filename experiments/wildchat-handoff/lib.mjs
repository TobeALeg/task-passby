import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const PROMPT_VERSION = "wildchat-handoff-v1.0";
export const DATASET = "allenai/WildChat-4.8M";
export const DATASET_API = "https://datasets-server.huggingface.co";
export const DATASET_REPO_API = "https://huggingface.co/api/datasets/allenai/WildChat-4.8M";
export const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function parseJsonText(text) {
  const cleaned = String(text ?? "").trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw firstError;
  }
}

export function seededRandom(seed) {
  let state = Number.parseInt(sha256(String(seed)).slice(0, 8), 16) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function shuffled(values, seed) {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  return Math.ceil(cjk * 0.85 + (text.length - cjk) / 4);
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function mapLimit(values, limit, worker) {
  const result = new Array(values.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      result[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, consume));
  return result;
}

export class BailianClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, cacheDirectory, concurrency = 4, onProgress = () => {} }) {
    if (!apiKey) throw new Error("DASHSCOPE_API_KEY_REQUIRED");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.cacheDirectory = cacheDirectory;
    this.concurrency = concurrency;
    this.onProgress = onProgress;
    this.active = 0;
    this.waiters = [];
  }

  async #acquire() {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  #release() {
    this.active -= 1;
    this.waiters.shift()?.();
  }

  async call({ model, messages, temperature = 0.2, maxTokens = 2048, json = false, tag }) {
    const request = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    };
    const key = sha256(stableJson({ promptVersion: PROMPT_VERSION, request }));
    const cachePath = join(this.cacheDirectory, `${key}.json`);
    const cached = readJson(cachePath);
    if (cached?.ok) return { ...cached, cached: true };

    await this.#acquire();
    const startedAt = Date.now();
    try {
      let lastError;
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        try {
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            redirect: "error",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(240_000),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            const code = body?.error?.code ?? `HTTP_${response.status}`;
            const error = new Error(`BAILIAN_${code}`);
            error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            throw error;
          }
          const choice = body.choices?.[0];
          if (!choice?.message?.content) throw new Error("BAILIAN_EMPTY_RESPONSE");
          const record = {
            ok: true,
            tag,
            requestHash: key,
            requestedModel: model,
            responseModel: body.model ?? null,
            responseId: body.id ?? null,
            finishReason: choice.finish_reason ?? null,
            content: choice.message.content,
            usage: body.usage ?? null,
            latencyMs: Date.now() - startedAt,
            completedAt: new Date().toISOString(),
          };
          atomicJson(cachePath, record);
          this.onProgress({ tag, model, cached: false, usage: record.usage });
          return record;
        } catch (error) {
          lastError = error;
          if (!error.retryable || attempt === 6) break;
          await sleep(Math.min(30_000, 900 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500));
        }
      }
      throw lastError;
    } finally {
      this.#release();
    }
  }

  async callJson(options) {
    const response = await this.call({ ...options, json: true });
    return { ...response, value: parseJsonText(response.content) };
  }
}

export async function fetchJson(url, { attempts = 6 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": `Worket/${PROMPT_VERSION}` },
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`FETCH_${response.status}_${body?.error ?? "UNKNOWN"}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return body;
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === attempts) break;
      await sleep(Math.min(20_000, 750 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

const SENSITIVE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:\d[ -]*?){13,19}\b/u,
  /\b(?:\+?\d[\d ().-]{7,}\d)\b/u,
  /\b(?:sk|ak|pk)[-_][A-Za-z0-9_-]{16,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
];

const HIGH_RISK_PATTERNS = [
  /\b(?:suicide|kill myself|self[- ]harm|overdose)\b/iu,
  /(?:自杀|自残|轻生|服毒)/u,
  /\b(?:diagnose|prescription|lawsuit|legal advice)\b/iu,
  /(?:诊断|处方|诉讼|法律意见)/u,
];

export function sanitizeRow(row) {
  const source = row?.row ?? row;
  if (!source || !String(source.model ?? "").toLowerCase().startsWith("gpt-4o")) return null;
  if (source.toxic || source.redacted || source.turn < 9 || source.turn > 20) return null;
  const conversation = Array.isArray(source.conversation) ? source.conversation.map((turn) => ({
    role: turn.role,
    content: typeof turn.content === "string" ? turn.content.trim() : "",
    language: turn.language ?? null,
    turnIdentifier: turn.turn_identifier ?? null,
    toxic: Boolean(turn.toxic),
    redacted: Boolean(turn.redacted),
  })) : [];
  if (conversation.length < 18 || conversation.some((turn) =>
    !["user", "assistant"].includes(turn.role) || !turn.content || turn.toxic || turn.redacted
  )) return null;
  if (conversation.some((turn, index) => turn.role !== (index % 2 === 0 ? "user" : "assistant"))) return null;
  const text = conversation.map((turn) => turn.content).join("\n");
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) return null;
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text))) return null;
  if (estimateTokens(text) > 52_000) return null;
  const languageValue = String(source.language ?? "").toLowerCase();
  const language = languageValue.includes("chinese") || languageValue.includes("中文") ? "zh"
    : languageValue.includes("english") ? "en"
      : null;
  if (!language) return null;
  return {
    conversationHash: source.conversation_hash,
    model: source.model,
    turnCount: source.turn,
    language,
    conversation,
  };
}

export function compactConversation(conversation, throughRound = undefined) {
  const maximum = throughRound ? throughRound * 2 : conversation.length;
  return conversation.slice(0, maximum).map((turn, index) => ({
    id: `${turn.role === "user" ? "U" : "A"}${Math.floor(index / 2) + 1}`,
    role: turn.role,
    content: turn.content,
  }));
}

export function chooseDefaultCut(turnCount) {
  return Math.max(7, Math.min(turnCount - 2, Math.round(turnCount * 0.78)));
}

export function bootstrapDifference(leftByCase, rightByCase, { iterations = 10_000, seed = "bootstrap" } = {}) {
  const keys = [...leftByCase.keys()].filter((key) => rightByCase.has(key));
  if (!keys.length) return { n: 0, mean: null, median: null, ci95: [null, null] };
  const differences = keys.map((key) => leftByCase.get(key) - rightByCase.get(key));
  const sorted = [...differences].sort((a, b) => a - b);
  const random = seededRandom(seed);
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < keys.length; index += 1) total += differences[Math.floor(random() * differences.length)];
    samples.push(total / keys.length);
  }
  samples.sort((a, b) => a - b);
  return {
    n: keys.length,
    mean: differences.reduce((sum, value) => sum + value, 0) / differences.length,
    median: sorted[Math.floor(sorted.length / 2)],
    ci95: [samples[Math.floor(samples.length * 0.025)], samples[Math.floor(samples.length * 0.975)]],
  };
}

export function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}
