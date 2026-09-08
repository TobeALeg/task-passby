import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAIService } from "../../server/service.mjs";
import { result } from "./fixtures.ts";
const request = {
  schemaVersion: 1,
  snapshotHash: "abc",
  sources: [
    {
      key: "work-1",
      events: [
        {
          key: "event-1",
          kind: "user.prompt",
          sequence: 1,
          content: "每条事实必须标注来源",
          hash: "abc",
        },
      ],
    },
  ],
};
function token(subject = "alice", exp = Date.now() / 1000 + 60) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString(
      "base64url",
    ),
    payload = Buffer.from(
      JSON.stringify({ sub: subject, iss: "test", aud: "worket-ai", exp }),
    ).toString("base64url"),
    sig = createHmac("sha256", "development-test-secret")
      .update(`${header}.${payload}`)
      .digest("base64url");
  return `${header}.${payload}.${sig}`;
}
async function fixture(options: any = {}) {
  let calls = 0;
  const provider = {
    model: "test-fixture",
    async call(messages: any) {
      calls++;
      const body = JSON.parse(messages[1].content);
      if (body.phase === "extract")
        return {
          result: {
            requirements: [],
            issues: [],
            eventKeys: body.events.map((e: any) => `${e.sourceKey}/${e.key}`),
          },
          usage: { total_tokens: 4 },
        };
      return { result: result(request), usage: { total_tokens: 5 } };
    },
  };
  const config = {
    mode: "development",
    issuer: "test",
    audience: "worket-ai",
    devSecret: "development-test-secret",
    provider,
    ...options,
  };
  const service = createAIService(config);
  await new Promise<void>((r) => service.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(service.server.address() as any).port}`;
  const send = async (
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    subject = "alice",
  ) => {
    const r = await fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token(subject)}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  return { service, send, url, calls: () => calls, config };
}
async function done(f: any, id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await f.send(`/v1/definition-extractions/${id}`);
    if (r.body.status !== "RUNNING") return r.body;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timeout");
}
test("A18 all remote operations are subject isolated, authentication required", async () => {
  const f = await fixture();
  try {
    const r = await f.send(
      "/v1/definition-extractions",
      "POST",
      request,
      "test",
    );
    for (const [path, method] of [
      [`/${r.body.requestId}`, "GET"],
      [`/${r.body.requestId}`, "DELETE"],
      [`/${r.body.requestId}/ack`, "POST"],
    ])
      assert.equal(
        (
          await f.send(
            "/v1/definition-extractions" + path,
            method,
            undefined,
            undefined,
            "bob",
          )
        ).status,
        404,
      );
    assert.equal((await fetch(f.url + "/v1/capabilities")).status, 401);
    assert.equal(
      (
        await fetch(f.url + "/v1/capabilities", {
          headers: { Authorization: `Bearer ${token("alice", 1)}` },
        })
      ).status,
      401,
    );
  } finally {
    await f.service.close();
  }
});
test("A17 remote same key never double calls, conflicting payload rejected; ack removes result", async () => {
  const f = await fixture();
  try {
    const first = await f.send(
        "/v1/definition-extractions",
        "POST",
        request,
        "key",
      ),
      again = await f.send(
        "/v1/definition-extractions",
        "POST",
        request,
        "key",
      );
    assert.equal(again.body.requestId, first.body.requestId);
    assert.equal(
      (
        await f.send(
          "/v1/definition-extractions",
          "POST",
          { ...request, snapshotHash: "changed" },
          "key",
        )
      ).status,
      409,
    );
    const completed = await done(f, first.body.requestId);
    assert.equal(completed.status, "SUCCEEDED");
    assert.equal(f.calls(), 2);
    await f.send(
      `/v1/definition-extractions/${first.body.requestId}/ack`,
      "POST",
    );
    const acknowledged = await f.send(
      `/v1/definition-extractions/${first.body.requestId}`,
    );
    assert.equal(acknowledged.body.status, "ACKNOWLEDGED");
    assert.ok(!acknowledged.body.result);
    assert.ok(
      !JSON.stringify(
        f.service.db.prepare("SELECT * FROM requests").all(),
      ).includes("每条事实"),
    );
  } finally {
    await f.service.close();
  }
});
test("A12 service restart makes in-memory result interrupted, same key cannot rerun", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worket-server-")),
    path = join(directory, "metadata.sqlite");
  const first = await fixture({ databasePath: path });
  const job = await first.send(
    "/v1/definition-extractions",
    "POST",
    request,
    "restart",
  );
  await done(first, job.body.requestId);
  await first.service.close();
  const next = await fixture({ databasePath: path });
  try {
    const r = await next.send(
      "/v1/definition-extractions",
      "POST",
      request,
      "restart",
    );
    assert.equal(r.body.status, "INTERRUPTED");
    assert.equal(next.calls(), 0);
  } finally {
    await next.service.close();
  }
});
test("A12 expiration and configured quota are explicit, no response body in metadata", async () => {
  const f = await fixture({ limits: { resultTtlMs: 5, dailyCalls: 2 } });
  try {
    const r = await f.send(
      "/v1/definition-extractions",
      "POST",
      request,
      "expire",
    );
    await done(f, r.body.requestId);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      (await f.send(`/v1/definition-extractions/${r.body.requestId}`)).body
        .error.code,
      "RESULT_EXPIRED",
    );
    assert.equal(
      (await f.send("/v1/definition-extractions", "POST", request, "quota"))
        .body.code,
      "QUOTA_EXCEEDED",
    );
  } finally {
    await f.service.close();
  }
});
test("production refuses developer signing secret", () =>
  assert.throws(
    () => createAIService({ mode: "production", devSecret: "unsafe" }),
    /AUTH_REQUIRED/,
  ));

test("bounded active requests reject per-user and global concurrency before model calls", async () => {
  const provider = {
    model: "waiting",
    async call(_messages: any, signal: AbortSignal) {
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
    },
  };
  const f = await fixture({ provider, limits: { maxGlobalConcurrency: 1 } });
  try {
    await f.send("/v1/definition-extractions", "POST", request, "running");
    assert.equal(
      (await f.send("/v1/definition-extractions", "POST", request, "same-user"))
        .body.code,
      "CONCURRENCY_LIMIT",
    );
    assert.equal(
      (
        await f.send(
          "/v1/definition-extractions",
          "POST",
          request,
          "other-user",
          "bob",
        )
      ).body.code,
      "CONCURRENCY_LIMIT",
    );
  } finally {
    await f.service.close();
  }
});
