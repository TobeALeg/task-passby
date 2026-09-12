import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bootstrapDifference,
  chooseDefaultCut,
  parseJsonText,
  sanitizeRow,
} from "../../experiments/wildchat-handoff/lib.mjs";

function row(overrides: Record<string, unknown> = {}) {
  return {
    row_idx: 42,
    row: {
      conversation_hash: "fixture",
      model: "gpt-4o-2024-08-06",
      turn: 9,
      language: "English",
      toxic: false,
      redacted: false,
      conversation: Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: index === 0 ? "Draft a safe product note." : `safe fixture ${index}`,
        toxic: false,
        redacted: false,
        turn_identifier: `turn-${index}`,
      })),
      ...overrides,
    },
  };
}

test("WildChat sanitizer retains only eligible GPT-4o work conversations", () => {
  assert.equal(sanitizeRow(row())?.language, "en");
  assert.equal(sanitizeRow(row({ model: "gpt-4.1-mini" })), null);
  assert.equal(sanitizeRow(row({ redacted: true })), null);
  assert.equal(sanitizeRow(row({ turn: 8 })), null);
  const sensitive = row();
  sensitive.row.conversation[0].content = "Contact me at private@example.com";
  assert.equal(sanitizeRow(sensitive), null);
});
test("handoff cut leaves seven completed and two unseen rounds", () => {
  assert.equal(chooseDefaultCut(9), 7);
  assert.equal(chooseDefaultCut(20), 16);
});

test("cluster bootstrap resamples cases, not repeated outputs", () => {
  const effect = bootstrapDifference(
    new Map([["a", 90], ["b", 70], ["c", 80]]),
    new Map([["a", 80], ["b", 60], ["c", 70]]),
    { iterations: 500, seed: "fixed" },
  );
  assert.equal(effect.n, 3);
  assert.equal(effect.mean, 10);
  assert.deepEqual(effect.ci95, [10, 10]);
});

test("JSON parser accepts provider markdown fences", () => {
  assert.deepEqual(parseJsonText("```json\n{\"ok\":true}\n```"), { ok: true });
});
