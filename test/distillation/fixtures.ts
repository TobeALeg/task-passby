import { randomUUID } from "node:crypto";
import type { WorkCore } from "../../dist/core/types.js";
export function source(
  core: WorkCore,
  text = "为客户甲在中国市场制作竞品报告。每条事实必须标注来源。",
) {
  const work = core.createWork({
    definition: { key: "general-work", name: "通用工作", version: 1 },
    executor: { type: "AGENT", name: "Codex" },
    environment: { type: "CODEX_DESKTOP", name: "Codex" },
    source: { adapter: "codex", conversationId: randomUUID() },
  });
  return core.appendSourceEvents(work.instance.id, [
    {
      externalId: randomUUID(),
      sequence: 1,
      kind: "user.prompt",
      content: text,
      timestamp: new Date().toISOString(),
      executorType: "HUMAN",
      environmentType: "CODEX_DESKTOP",
      metadata: {},
      artifactRefs: [],
    },
  ]).work;
}
export function result(request: any) {
  const source = request.sources[0],
    event = source.events[0];
  const basis = {
    type: "SOURCE",
    origin: "USER_STATED",
    refs: [{ snapshotId: "wire", workId: source.key, eventId: event.key }],
  };
  const inferred = {
    type: "INFERRED",
    refs: [],
    rationale: "实例差异参数化，需要用户检查",
  };
  const item = (key: string, text: string) => ({
    key,
    text,
    basis: structuredClone(basis),
  });
  return {
    schemaVersion: 1,
    compatibility: "COMPATIBLE",
    content: {
      schemaVersion: 1,
      name: "竞品报告",
      purpose: item("purpose", "为 {{customer}} 分析 {{market}} 市场"),
      inputs: [
        {
          key: "customer",
          text: "本次客户",
          basis: inferred,
          valueType: "TEXT",
          required: true,
        },
        {
          key: "market",
          text: "本次市场",
          basis: inferred,
          valueType: "TEXT",
          required: true,
        },
      ],
      deliverables: [item("report", "竞品对比表和建议")],
      constraints: [item("sources", "每条事实必须标注来源")],
      acceptanceCriteria: [item("traceable", "每条事实可追溯")],
      methods: [],
      materialRoles: [],
    },
    issues: [],
    groups: [],
    requirements: [
      {
        id: "r1",
        text: "每条事实必须标注来源",
        scope: "REUSABLE",
        sourceKeys: [`${source.key}/${event.key}`],
        replacedBy: null,
      },
    ],
    coverage: {
      inputEvents: request.sources.flatMap((s: any) => s.events).length,
      processedEvents: request.sources.flatMap((s: any) => s.events).length,
      processedChunks: 1,
      eventKeys: request.sources.flatMap((s: any) =>
        s.events.map((e: any) => `${s.key}/${e.key}`),
      ),
      exclusions: [],
    },
    versions: { schema: 1, prompt: "fixture", model: "fixture" },
  };
}
export class FixtureClient {
  calls = 0;
  request: any;
  latest: any;
  acknowledged = 0;
  async capabilities() {
    return {};
  }
  async submit(request: any, key: string) {
    this.calls++;
    this.request = request;
    this.latest = { requestId: key, status: "RUNNING" };
    return this.latest;
  }
  async get(id: string) {
    return { requestId: id, status: "SUCCEEDED", result: result(this.request) };
  }
  async ack() {
    this.acknowledged++;
    return {};
  }
  async cancel() {
    return {};
  }
}
