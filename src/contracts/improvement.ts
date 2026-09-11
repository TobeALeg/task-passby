import { ensure, object, string, validateRequest, LIMITS } from "./definition.js";
export const IMPROVEMENT_POLICY = {
  version: "worket-improvement-v1",
  recordingVersion: "worket-recording-v1",
  purpose: "WORKET_PRODUCT_IMPROVEMENT",
  retentionDays: 90,
} as const;
export const SAMPLE_EVENT_KINDS = ["RECORDING", "MESSAGE", "SOURCE", "REUSE", "CANDIDATE", "EDIT", "PUBLISH", "STATUS", "ACCEPTANCE"] as const;
export type SampleEvent = {
  id: string;
  kind: typeof SAMPLE_EVENT_KINDS[number];
  at: string;
  data: Record<string, unknown>;
};
export type SampleUpload = {
  schemaVersion: 1;
  sampleId: string;
  consent: { version: string; at: string; scope: "DISTILLATION" | "REUSE" | "RECORDING" };
  event: SampleEvent;
};
export function validateSample(value: unknown): asserts value is SampleUpload {
  object(value);
  ensure(value.schemaVersion === 1, "INVALID_INPUT");
  string(value.sampleId);
  ensure(/^[a-zA-Z0-9-]{1,100}$/.test(value.sampleId), "INVALID_INPUT");
  object(value.consent);
  ensure(value.consent.version === (value.consent.scope === "RECORDING" ? IMPROVEMENT_POLICY.recordingVersion : IMPROVEMENT_POLICY.version), "CONSENT_REQUIRED");
  ensure(["DISTILLATION", "REUSE", "RECORDING"].includes(String(value.consent.scope)), "CONSENT_REQUIRED");
  string(value.consent.at);
  const consentAt = Date.parse(value.consent.at);
  ensure(Number.isFinite(consentAt) && consentAt <= Date.now() + 60000 && consentAt > Date.now() - IMPROVEMENT_POLICY.retentionDays * 86400000, "CONSENT_EXPIRED");
  object(value.event);
  string(value.event.id);
  ensure(value.event.id.length <= 150, "INVALID_INPUT");
  ensure(SAMPLE_EVENT_KINDS.includes(value.event.kind as SampleEvent["kind"]), "INVALID_INPUT");
  string(value.event.at);
  ensure(Number.isFinite(Date.parse(value.event.at)), "INVALID_INPUT");
  object(value.event.data);
  ensure(new TextEncoder().encode(JSON.stringify(value)).length <= LIMITS.maxBytes * 2, "INPUT_TOO_LARGE");
  if (value.consent.scope === "RECORDING") {
    ensure(["RECORDING", "MESSAGE"].includes(String(value.event.kind)), "INVALID_INPUT");
    const data = value.event.data;
    if (value.event.kind === "RECORDING") {
      ensure(Object.keys(data).every(k => ["workId", "title"].includes(k)), "INVALID_INPUT");
      string(data.workId); string(data.title);
    } else {
      ensure(Object.keys(data).every(k => ["sourceEventId", "sequence", "kind", "timestamp", "content", "part", "parts"].includes(k)), "INVALID_INPUT");
      string(data.sourceEventId); string(data.timestamp); string(data.content);
      ensure(["user.prompt", "agent.response"].includes(String(data.kind)), "INVALID_INPUT");
      ensure(Number.isFinite(Date.parse(data.timestamp)) && data.content.length <= 16000, "INVALID_INPUT");
      ensure(Number.isSafeInteger(data.sequence) && Number(data.sequence) >= 0, "INVALID_INPUT");
      ensure(Number.isSafeInteger(data.part) && Number.isSafeInteger(data.parts) && Number(data.part) >= 0 && Number(data.part) < Number(data.parts), "INVALID_INPUT");
    }
  } else ensure(!["RECORDING", "MESSAGE"].includes(String(value.event.kind)), "INVALID_INPUT");
  if (value.event.kind === "SOURCE") {
    ensure(value.consent.scope === "DISTILLATION", "INVALID_INPUT");
    validateRequest(value.event.data.request);
    ensure(value.event.data.request.sources.every(s => s.events.every(e => e.kind !== "reasoning.summary")), "INVALID_INPUT");
  }
  if (value.event.kind === "REUSE") ensure(value.consent.scope === "REUSE", "INVALID_INPUT");
}
