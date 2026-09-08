import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ModelProvider, extractDefinition } from "./workflow.mjs";
const out = join(process.cwd(), "output", "distillation");
mkdirSync(out, { recursive: true });
const corpus = JSON.parse(
  readFileSync(
    new URL("../test/fixtures/distillation-corpus.json", import.meta.url),
    "utf8",
  ),
);
if (
  !process.env.WORKET_PROVIDER_URL ||
  !process.env.WORKET_PROVIDER_KEY ||
  !process.env.WORKET_PROVIDER_MODEL
) {
  const report = {
    status: "BLOCKED",
    reason: "未配置真实服务端模型；未调用模型，不能认定质量验收通过。",
    cases: corpus.length,
    realModelCalls: 0,
  };
  writeFileSync(
    join(out, "model-evaluation.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} else {
  const provider = new ModelProvider({
    baseUrl: process.env.WORKET_PROVIDER_URL,
    apiKey: process.env.WORKET_PROVIDER_KEY,
    model: process.env.WORKET_PROVIDER_MODEL,
  });
  const reports = [];
  for (const sample of corpus) {
    const sources = sample.sources.map((messages, i) => ({
      key: `work-${i + 1}`,
      events: messages
        .flatMap((m) =>
          typeof m === "string"
            ? [{ kind: "user.prompt", text: m }]
            : m.repeat
              ? Array.from({ length: m.repeat }, (_, j) => ({
                  kind: "user.prompt",
                  text: `${j + 1} ${m.text.repeat(20)}`,
                }))
              : [m],
        )
        .map((m, j) => ({
          key: `event-${j + 1}`,
          sequence: j + 1,
          kind: m.kind ?? "user.prompt",
          content: m.text,
          hash: createHash("sha256").update(m.text).digest("hex"),
        })),
    }));
    const request = {
      schemaVersion: 1,
      snapshotHash: createHash("sha256")
        .update(JSON.stringify(sources))
        .digest("hex"),
      sources,
    };
    const usage = [],
      start = Date.now();
    try {
      const result = await extractDefinition(
        request,
        provider,
        AbortSignal.timeout(600000),
        (u) => usage.push(u),
      );
      reports.push({
        id: sample.id,
        durationMs: Date.now() - start,
        calls: usage.length,
        usage,
        result,
        humanReviewRequired: sample.review,
      });
    } catch (error) {
      reports.push({
        id: sample.id,
        durationMs: Date.now() - start,
        calls: usage.length,
        usage,
        error: error.code ?? "MODEL_UNAVAILABLE",
      });
    }
  }
  writeFileSync(
    join(out, "model-evaluation.json"),
    JSON.stringify(
      {
        status: "AWAITING_HUMAN_REVIEW",
        model: provider.model,
        cases: reports,
      },
      null,
      2,
    ),
  );
  console.log(
    "真实模型结果已保存；须按人工标注检查关键约束和零容忍项，脚本不宣称自动质量通过。",
  );
}
