import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { ModelProvider } from "../workflow.mjs";
import { ensure, ContractError } from "../../dist/contracts/definition.js";
const assets = new Map([
  ["/admin/", ["index.html", "text/html; charset=utf-8"]],
  ["/admin/admin.css", ["admin.css", "text/css; charset=utf-8"]],
  ["/admin/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function body(req) {
  ensure(
    req.headers["content-type"]?.startsWith("application/json"),
    "INVALID_INPUT",
  );
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    ensure(bytes <= 32768, "INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new ContractError("INVALID_INPUT");
  }
}
const reply = (res, value, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};
export function createAdminHandler({
  store,
  improvement,
  getRuntime,
  providerFactory = (config) => new ModelProvider(config),
}) {
  const sessions = new Map(),
    failures = new Map();
  let testing = false;
  const handler = async (req, res) => {
    if (!req.url?.startsWith("/admin")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    try {
      // Admin stays loopback-only, including on remotely deployed servers (use an SSH tunnel).
      const address = req.socket.remoteAddress;
      ensure(
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address),
        "AUTH_REQUIRED",
      );
      const host = req.headers.host;
      ensure(
        host &&
          ["127.0.0.1", "localhost", "[::1]"].includes(
            new URL(`http://${host}`).hostname,
          ),
        "AUTH_REQUIRED",
      );
      ensure(
        !req.headers["x-forwarded-for"] && !req.headers["forwarded"],
        "AUTH_REQUIRED",
      );
      if (req.headers.origin)
        ensure(
          req.headers.origin === `http://${host}` ||
            req.headers.origin === `https://${host}`,
          "AUTH_REQUIRED",
        );
      ensure(
        !req.headers["sec-fetch-site"] ||
          ["same-origin", "none"].includes(req.headers["sec-fetch-site"]),
        "AUTH_REQUIRED",
      );
      const path = req.url.split("?")[0];
      if (req.method === "GET" && (path === "/admin" || assets.has(path))) {
        if (path === "/admin") {
          res.statusCode = 302;
          res.setHeader("Location", "/admin/");
          res.end();
          return true;
        }
        const [name, mime] = assets.get(path);
        res.setHeader("Content-Type", mime);
        res.end(readFileSync(new URL(name, import.meta.url)));
        return true;
      }
      if (path === "/admin/api/session" && req.method === "GET") {
        const token = req.headers.cookie
          ?.split("; ")
          .find((c) => c.startsWith("worket_admin="))
          ?.slice(13);
        const session = token ? sessions.get(digest(token)) : null;
        reply(res, {
          initialized: store.initialized(),
          authenticated: !!session && session.expires > Date.now(),
          ...(session && session.expires > Date.now()
            ? { csrf: session.csrf }
            : {}),
        });
        return true;
      }
      if (
        ["/admin/api/setup", "/admin/api/login"].includes(path) &&
        req.method === "POST"
      ) {
        const attempts = failures.get(address) ?? {
          count: 0,
          since: Date.now(),
        };
        if (Date.now() - attempts.since > 60000) {
          attempts.count = 0;
          attempts.since = Date.now();
        }
        ensure(attempts.count < 10, "RATE_LIMITED", "尝试过多，请一分钟后重试");
        attempts.count++;
        failures.set(address, attempts);
        const input = await body(req);
        if (path.endsWith("/setup")) store.setup(input.password);
        else
          ensure(
            store.verify(input.password),
            "AUTH_REQUIRED",
            "管理员密码不正确",
          );
        failures.delete(address);
        for (const [key, s] of sessions)
          if (s.expires < Date.now()) sessions.delete(key);
        ensure(sessions.size < 50, "RATE_LIMITED");
        const token = randomBytes(32).toString("base64url"),
          csrf = randomBytes(24).toString("base64url");
        sessions.set(digest(token), {
          csrf,
          expires: Date.now() + 8 * 3600000,
        });
        res.setHeader(
          "Set-Cookie",
          `worket_admin=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=28800`,
        );
        reply(res, { authenticated: true, csrf });
        return true;
      }
      const token = req.headers.cookie
          ?.split("; ")
          .find((c) => c.startsWith("worket_admin="))
          ?.slice(13),
        session = token ? sessions.get(digest(token)) : null;
      ensure(
        session && session.expires > Date.now(),
        "AUTH_REQUIRED",
        "请先登录后台",
      );
      if (req.method !== "GET") {
        const csrf = Buffer.from(req.headers["x-worket-csrf"] ?? ""),
          expected = Buffer.from(session.csrf);
        ensure(
          csrf.length === expected.length && timingSafeEqual(csrf, expected),
          "AUTH_REQUIRED",
        );
      }
      if (path === "/admin/api/samples" && req.method === "GET") {
        reply(res, { policy: improvement.policy(), items: improvement.list() });
        return true;
      }
      if (path === "/admin/api/samples-policy" && req.method === "PUT") {
        reply(res, improvement.setEnabled((await body(req)).enabled));
        return true;
      }
      const sample = path.match(/^\/admin\/api\/samples\/([a-f0-9]{64})$/);
      if (sample) {
        if (req.method === "GET") reply(res, improvement.get(sample[1]));
        else if (req.method === "DELETE") reply(res, improvement.delete(sample[1]));
        else if (req.method === "PUT") reply(res, improvement.review(sample[1], await body(req)));
        else throw new ContractError("NOT_FOUND");
        return true;
      }
      const runtime = getRuntime();
      if (path === "/admin/api/config" && req.method === "GET") {
        reply(res, {
          ...store.view(),
          status: runtime.status(),
          localUrl: `http://${host}`,
        });
        return true;
      }
      if (path === "/admin/api/config" && req.method === "PUT") {
        ensure(
          !testing && runtime.status().running === 0,
          "CONFIG_BUSY",
          "请等待当前分析或连接测试结束",
        );
        const input = await body(req);
        store.candidate(input);
        ensure(!testing && runtime.status().running === 0, "CONFIG_BUSY");
        const saved = store.save(input);
        runtime.configure(runtimeConfig(store, providerFactory));
        reply(res, { ...saved, status: runtime.status() });
        return true;
      }
      if (path === "/admin/api/test" && req.method === "POST") {
        ensure(
          !testing && runtime.status().running === 0,
          "CONFIG_BUSY",
          "已有模型调用在运行",
        );
        testing = true;
        try {
          const input = await body(req),
            candidate = store.candidate(input);
          const key = input.provider.apiKey?.trim() || store.apiKey();
          const provider = providerFactory({
            baseUrl: candidate.provider.baseUrl,
            model: candidate.provider.model,
            apiKey: key,
          });
          const start = Date.now();
          const { result, usage } = await provider.call(
            [
              {
                role: "system",
                content:
                  "Return exactly a JSON object with key worket and value ok. This is a connection test.",
              },
              { role: "user", content: "Check connection." },
            ],
            AbortSignal.timeout(20000),
          );
          ensure(
            result?.worket === "ok",
            "INVALID_MODEL_OUTPUT",
            "模型未返回要求的 JSON",
          );
          reply(res, {
            ok: true,
            model: candidate.provider.model,
            elapsedMs: Date.now() - start,
            usage: usage
              ? {
                  inputTokens: usage.prompt_tokens ?? null,
                  outputTokens: usage.completion_tokens ?? null,
                }
              : null,
            saved: false,
          });
        } catch (error) {
          reply(
            res,
            {
              code:
                error instanceof ContractError
                  ? error.code
                  : "CONNECTION_FAILED",
              message:
                "连接测试未通过，请检查地址、模型、密钥及供应商是否支持 JSON 输出。",
            },
            400,
          );
        } finally {
          testing = false;
        }
        return true;
      }
      if (path === "/admin/api/clients" && req.method === "POST") {
        reply(res, store.issue(await body(req)));
        return true;
      }
      const revoke = path.match(
        /^\/admin\/api\/clients\/([a-zA-Z0-9-]+)\/revoke$/,
      );
      if (revoke && req.method === "POST") {
        store.revoke(revoke[1]);
        runtime.revokeSubject(revoke[1]);
        reply(res, { ok: true });
        return true;
      }
      if (path === "/admin/api/logout" && req.method === "POST") {
        sessions.delete(digest(token));
        res.setHeader(
          "Set-Cookie",
          "worket_admin=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0",
        );
        reply(res, { ok: true });
        return true;
      }
      if (path === "/admin/api/activity" && req.method === "GET") {
        reply(res, runtime.activity());
        return true;
      }
      throw new ContractError("NOT_FOUND");
    } catch (error) {
      const code =
        error instanceof ContractError ? error.code : "INVALID_INPUT";
      reply(
        res,
        {
          code,
          message:
            error instanceof ContractError
              ? error.message
              : "配置无效，请检查输入。",
        },
        code === "AUTH_REQUIRED"
          ? 401
          : code === "RATE_LIMITED"
            ? 429
            : code === "NOT_FOUND"
              ? 404
              : 400,
      );
    }
    return true;
  };
  handler.isTesting = () => testing;
  return handler;
}
export function runtimeConfig(
  store,
  providerFactory = (config) => new ModelProvider(config),
) {
  const p = store.data.provider;
  return {
    provider: p.encryptedKey
      ? providerFactory({
          baseUrl: p.baseUrl,
          model: p.model,
          apiKey: store.apiKey(),
        })
      : {
          model: "未配置",
          async call() {
            throw new ContractError("MODEL_UNAVAILABLE", "管理员尚未配置模型");
          },
        },
    configured: !!p.encryptedKey,
    providerName: p.name || "未填写数据处理方",
    providerPolicyUrl: p.policyUrl || null,
    limits: store.data.limits,
  };
}
