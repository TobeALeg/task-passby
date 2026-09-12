import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { createManagedService } from "../../server/managed.mjs";
import { AdminStore } from "../../server/admin/store.mjs";
import { result } from "./fixtures.ts";
const password = "123456",
  secret = "synthetic-provider-secret";
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
const config = (revision = 0) => ({
  revision,
  provider: {
    baseUrl: "https://provider.example/v1",
    model: "test-model",
    apiKey: secret,
    name: "测试供应商",
    policyUrl: "https://provider.example/privacy",
  },
  serviceUrl: "",
  limits: {
    dailyCalls: 100,
    maxConcurrency: 1,
    maxGlobalConcurrency: 4,
    maxSources: 5,
    timeoutMs: 10000,
  },
});
async function fixture(options: any = {}) {
  const directory =
    options.directory ?? mkdtempSync(join(tmpdir(), "worket-admin-test-"));
  const calls: any[] = [];
  const providerFactory =
    options.providerFactory ??
    ((p: any) => ({
      model: p.model,
      async call(messages: any) {
        calls.push({ p, messages });
        if (messages[1].content === "Check connection.")
          return {
            result: { worket: "ok" },
            usage: { prompt_tokens: 5, completion_tokens: 4 },
          };
        const input = JSON.parse(messages[1].content);
        return input.phase === "extract"
          ? {
              result: {
                requirements: [],
                issues: [],
                eventKeys: input.events.map(
                  (e: any) => `${e.sourceKey}/${e.key}`,
                ),
              },
            }
          : { result: result(request) };
      },
    }));
  const service = createManagedService({ directory, providerFactory });
  await new Promise<void>((r) => service.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(service.server.address() as any).port}`;
  let cookie = "",
    csrf = "";
  async function send(
    path: string,
    method = "GET",
    input?: any,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(url + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-Worket-CSRF": csrf,
        ...headers,
      },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  }
  async function login(setup = true) {
    const r = await send(`/admin/api/${setup ? "setup" : "login"}`, "POST", {
      password,
    });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    csrf = r.body.csrf;
    return r;
  }
  return {
    directory,
    url,
    service,
    calls,
    send,
    login,
    close: () => service.close(),
  };
}
async function completed(f: any, id: string) {
  for (let i = 0; i < 100; i++) {
    const row = f.service.db
      .prepare("SELECT status FROM requests WHERE id=?")
      .get(id);
    if (row.status !== "RUNNING" && f.service.status().running === 0)
      return row.status;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("request did not finish");
}

test("admin: first setup, authentication, CSRF, loopback/Origin guard, logout and persistent password", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await f.send("/health")).body, {
      ok: true,
      configured: false,
    });
    assert.deepEqual((await f.send("/admin/api/session")).body, {
      initialized: false,
      authenticated: false,
    });
    assert.equal((await f.send("/admin/api/config")).status, 401);
    const page = await fetch(f.url + "/admin/");
    assert.match(await page.text(), /设置你的后台|login-panel/);
    assert.match(
      page.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal(
      (await f.send("/admin/api/setup", "POST", { password: "short" })).status,
      400,
    );
    const login = await f.login();
    assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
    assert.equal((await f.send("/admin/api/session")).body.authenticated, true);
    assert.equal(
      (await f.send("/admin/api/setup", "POST", { password })).body.code,
      "ALREADY_INITIALIZED",
    );
    assert.equal(
      (
        await f.send("/admin/api/config", "PUT", config(), {
          "X-Worket-CSRF": "",
        })
      ).status,
      401,
    );
    for (const headers of [
      { Origin: "https://untrusted.example" },
      { "X-Forwarded-For": "192.0.2.1" },
      { "Sec-Fetch-Site": "cross-site" },
    ])
      assert.equal(
        (await f.send("/admin/api/config", "GET", undefined, headers)).status,
        401,
        JSON.stringify(headers),
      );
    const hostileHost = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        f.url + "/admin/",
        { headers: { Host: "untrusted.example" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostileHost, 401);
    assert.equal((await f.send("/admin/api/logout", "POST", {})).status, 200);
    assert.equal((await f.send("/admin/api/config")).status, 401);
    assert.equal(
      (await f.send("/admin/api/login", "POST", { password: "wrong" })).status,
      401,
    );
    await f.login(false);
    assert.equal((await f.send("/admin/api/config")).status, 200);
    const persisted = new AdminStore(f.directory);
    assert.ok(persisted.verify(password));
    assert.ok(!persisted.verify("wrong"));
    assert.ok(
      !readFileSync(join(f.directory, "settings.json"), "utf8").includes(
        password,
      ),
    );
  } finally {
    await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("admin: encrypted configuration, revision control, unsaved connection test, hot update and restart", async () => {
  const f = await fixture();
  let g: any;
  try {
    await f.login();
    const test = await f.send("/admin/api/test", "POST", config());
    assert.equal(test.status, 200);
    assert.equal(test.body.saved, false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].messages[1].content, "Check connection.");
    assert.equal(f.service.store.apiKey(), "");
    const saved = await f.send("/admin/api/config", "PUT", config());
    assert.equal(saved.status, 200);
    assert.equal(saved.body.status.configured, true);
    assert.equal(saved.body.revision, 1);
    assert.equal(
      (await f.send("/admin/api/config", "PUT", config())).body.code,
      "REVISION_CONFLICT",
    );
    const next = config(1);
    next.provider.apiKey = "";
    next.provider.model = "updated-model";
    next.limits.dailyCalls = 9;
    assert.equal((await f.send("/admin/api/config", "PUT", next)).status, 200);
    assert.equal(f.service.store.apiKey(), secret);
    assert.equal(f.service.status().model, "updated-model");
    const moved = config(2);
    moved.provider.apiKey = "";
    moved.provider.baseUrl = "https://other.example/v1";
    assert.equal(
      (await f.send("/admin/api/config", "PUT", moved)).body.code,
      "INPUT_REQUIRED",
    );
    const serialized = JSON.stringify((await f.send("/admin/api/config")).body);
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes("encryptedKey"));
    assert.ok(!serialized.includes("password"));
    const disk = readFileSync(join(f.directory, "settings.json"), "utf8");
    assert.ok(!disk.includes(secret));
    assert.ok(!disk.includes(password));
    assert.ok(disk.includes("ciphertext"));
    for (const name of [
      "settings.json",
      "encryption.key",
      "identity-private.pem",
    ])
      assert.equal(
        statSync(join(f.directory, name)).mode & 0o777,
        process.platform === "win32" ? 0o666 : 0o600,
      );
    const client = (
      await f.send("/admin/api/clients", "POST", { name: "测试 Mac", days: 30 })
    ).body;
    await f.close();
    g = await fixture({ directory: f.directory });
    assert.equal(g.service.store.apiKey(), secret);
    assert.equal(g.service.status().model, "updated-model");
    await g.login(false);
    const capabilities = await g.send("/v1/capabilities", "GET", undefined, {
      Authorization: `Bearer ${client.token}`,
    });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.limits.dailyCalls, 9);
  } finally {
    if (g) await g.close();
    else if (f.service.server.listening) await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("admin: managed credentials enforce unconfigured state, actual workflow, redacted activity and persistent revocation", async () => {
  const f = await fixture();
  try {
    await f.login();
    const client = (
      await f.send("/admin/api/clients", "POST", { name: "我的 Mac", days: 1 })
    ).body;
    const auth = {
      Authorization: `Bearer ${client.token}`,
      "Idempotency-Key": "managed-workflow",
    };
    assert.equal(
      (await f.send("/v1/definition-extractions", "POST", request, auth)).body
        .code,
      "MODEL_UNAVAILABLE",
    );
    await f.send("/admin/api/config", "PUT", config());
    const started = await f.send(
      "/v1/definition-extractions",
      "POST",
      request,
      auth,
    );
    assert.equal(started.status, 202);
    assert.equal(await completed(f, started.body.requestId), "SUCCEEDED");
    assert.equal(f.calls.length, 2);
    const activity = (await f.send("/admin/api/activity")).body;
    assert.equal(activity.requests.length, 1);
    assert.equal(activity.rolling24h.calls, 2);
    assert.ok(!JSON.stringify(activity).includes("每条事实"));
    assert.ok(
      !readFileSync(join(f.directory, "settings.json"), "utf8").includes(
        client.token,
      ),
    );
    assert.ok(
      !JSON.stringify((await f.send("/admin/api/config")).body).includes(
        client.token,
      ),
    );
    assert.equal(
      (await f.send(`/admin/api/clients/${client.id}/revoke`, "POST", {}))
        .status,
      200,
    );
    assert.equal(f.service.status().resultCount, 0);
    assert.equal(
      (await f.send("/v1/capabilities", "GET", undefined, auth)).status,
      401,
    );
    assert.equal(
      new AdminStore(f.directory).identity().authorizeSubject(client.id),
      false,
    );
  } finally {
    await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("admin: configuration cannot change during extraction and revocation cancels running provider", async () => {
  let aborted = false;
  const f = await fixture({
    providerFactory: (p: any) => ({
      model: p.model,
      call: (_m: any, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(Error("cancelled"));
            },
            { once: true },
          ),
        ),
    }),
  });
  try {
    await f.login();
    await f.send("/admin/api/config", "PUT", config());
    const client = (
      await f.send("/admin/api/clients", "POST", { name: "running", days: 1 })
    ).body;
    const started = await f.send(
      "/v1/definition-extractions",
      "POST",
      request,
      { Authorization: `Bearer ${client.token}`, "Idempotency-Key": "running" },
    );
    assert.equal(
      (await f.send("/admin/api/config", "PUT", config(1))).body.code,
      "CONFIG_BUSY",
    );
    assert.equal(
      (await f.send("/admin/api/test", "POST", config(1))).body.code,
      "CONFIG_BUSY",
    );
    await f.send(`/admin/api/clients/${client.id}/revoke`, "POST", {});
    assert.equal(await completed(f, started.body.requestId), "CANCELLED");
    assert.ok(aborted);
    assert.equal(f.service.store.data.revision, 1);
  } finally {
    await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("admin: actual HTTP provider receives fixed probe, failures never expose secrets or upstream text", async () => {
  let received: any,
    fail = false;
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received = {
      path: req.url,
      key: req.headers.authorization,
      input: JSON.parse(raw),
    };
    res.setHeader("Content-Type", "application/json");
    if (fail) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: `upstream ${secret}` }));
    } else
      res.end(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: '{"worket":"ok"}' } },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      );
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  // Explicit undefined selects the real ModelProvider in createManagedService.
  const directory = mkdtempSync(join(tmpdir(), "worket-admin-http-"));
  const service = createManagedService({ directory });
  await new Promise<void>((r) => service.server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(service.server.address() as any).port}`;
    const login = await fetch(url + "/admin/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const { csrf } = await login.json();
    const headers = {
      "Content-Type": "application/json",
      Cookie: login.headers.get("set-cookie")!.split(";")[0],
      "X-Worket-CSRF": csrf,
    };
    const input = config();
    input.provider.baseUrl = `http://127.0.0.1:${(provider.address() as any).port}/v1`;
    const probe = () =>
      fetch(url + "/admin/api/test", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
    assert.equal((await probe()).status, 200);
    assert.equal(received.path, "/v1/chat/completions");
    assert.equal(received.key, `Bearer ${secret}`);
    assert.deepEqual(received.input.response_format, { type: "json_object" });
    assert.equal(received.input.messages[1].content, "Check connection.");
    fail = true;
    const response = await probe();
    assert.equal(response.status, 400);
    const error = await response.text();
    assert.ok(!error.includes(secret));
    assert.ok(!error.includes("upstream"));
    assert.equal(service.store.apiKey(), "");
  } finally {
    await service.close();
    await new Promise<void>((r) => provider.close(() => r()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("admin: a revoked client cannot finish uploading and create a new model request", async () => {
  const f = await fixture();
  try {
    await f.login();
    await f.send("/admin/api/config", "PUT", config());
    const client = (
      await f.send("/admin/api/clients", "POST", {
        name: "slow-upload",
        days: 1,
      })
    ).body;
    const raw = JSON.stringify(request);
    let complete!: (value: number) => void;
    const response = new Promise<number>((r) => (complete = r));
    const req = httpRequest(
      f.url + "/v1/definition-extractions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(raw),
          Authorization: `Bearer ${client.token}`,
          "Idempotency-Key": "slow",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => complete(res.statusCode!));
      },
    );
    req.write(raw.slice(0, 10));
    await f.send(`/admin/api/clients/${client.id}/revoke`, "POST", {});
    req.end(raw.slice(10));
    assert.equal(await response, 401);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("admin: login attempts are bounded and missing encryption key requires recovery", async () => {
  const f = await fixture();
  try {
    await f.login();
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await f.send("/admin/api/login", "POST", { password: "wrong" }))
          .status,
        401,
      );
    assert.equal(
      (await f.send("/admin/api/login", "POST", { password })).status,
      429,
    );
    rmSync(join(f.directory, "encryption.key"));
    assert.throws(() => new AdminStore(f.directory), /加密密钥缺失/);
  } finally {
    await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("admin: connection probe exclusively holds model configuration and blocks new extraction", async () => {
  let release!: () => void;
  let started!: () => void;
  const probing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await fixture({
    providerFactory: (p: any) => ({
      model: p.model,
      async call() {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { result: { worket: "ok" } };
      },
    }),
  });
  try {
    await f.login();
    await f.send("/admin/api/config", "PUT", config());
    const client = (
      await f.send("/admin/api/clients", "POST", {
        name: "probe-race",
        days: 1,
      })
    ).body;
    const probe = f.send("/admin/api/test", "POST", config(1));
    await probing;
    assert.equal(
      (await f.send("/admin/api/config", "PUT", config(1))).body.code,
      "CONFIG_BUSY",
    );
    assert.equal(
      (
        await f.send("/v1/definition-extractions", "POST", request, {
          Authorization: `Bearer ${client.token}`,
          "Idempotency-Key": "probe-race",
        })
      ).body.code,
      "CONCURRENCY_LIMIT",
    );
    release();
    assert.equal((await probe).status, 200);
    assert.equal(f.service.status().running, 0);
  } finally {
    release?.();
    await f.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
