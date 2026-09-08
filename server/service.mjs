import { createServer } from "node:http";
import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  LIMITS,
  validateRequest,
  ensure,
  ContractError,
} from "../dist/contracts/definition.js";
import { canonical } from "../dist/definitions/storage.js";
import { chunksFor, extractDefinition } from "./workflow.mjs";
export function authenticate(token, config) {
  ensure(token, "AUTH_REQUIRED");
  const parts = token.split(".");
  ensure(parts.length === 3, "AUTH_REQUIRED");
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url"));
  } catch {
    throw new ContractError("AUTH_REQUIRED");
  }
  const message = `${parts[0]}.${parts[1]}`,
    signature = Buffer.from(parts[2], "base64url");
  if (config.mode === "development" && config.devSecret) {
    ensure(header.alg === "HS256", "AUTH_REQUIRED");
    const expected = createHmac("sha256", config.devSecret)
      .update(message)
      .digest();
    ensure(
      signature.length === expected.length &&
        timingSafeEqual(signature, expected),
      "AUTH_REQUIRED",
    );
  } else {
    ensure(config.publicKey && header.alg === "RS256", "AUTH_REQUIRED");
    ensure(
      verify("RSA-SHA256", Buffer.from(message), config.publicKey, signature),
      "AUTH_REQUIRED",
    );
  }
  const now = Date.now() / 1000;
  ensure(Number.isFinite(claims.exp) && claims.exp > now, "AUTH_EXPIRED");
  ensure(!claims.nbf || claims.nbf <= now, "AUTH_REQUIRED");
  ensure(
    claims.aud === config.audience &&
      claims.iss === config.issuer &&
      typeof claims.sub === "string" &&
      claims.sub.length > 0,
    "AUTH_REQUIRED",
  );
  ensure(!config.revokedSubjects?.includes(claims.sub), "AUTH_EXPIRED");
  return claims.sub;
}
export function createAIService(config) {
  ensure(
    config.mode === "development" || !config.devSecret,
    "AUTH_REQUIRED",
    "生产环境拒绝开发身份",
  );
  const db = new DatabaseSync(config.databasePath ?? ":memory:");
  db.exec(
    `CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, subject TEXT NOT NULL, command_key TEXT NOT NULL, hash TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, calls INTEGER NOT NULL, usage_json TEXT NOT NULL, error TEXT, UNIQUE(subject,command_key)) STRICT;`,
  );
  db.prepare(
    "UPDATE requests SET status='INTERRUPTED',error='SERVICE_INTERRUPTED' WHERE status IN ('RUNNING','SUCCEEDED')",
  ).run();
  const running = new Map(),
    results = new Map();
  const limits = { ...LIMITS, ...config.limits };
  function rowFor(id, subject) {
    const row = db
      .prepare("SELECT * FROM requests WHERE id=? AND subject=?")
      .get(id, subject);
    ensure(row, "NOT_FOUND");
    return row;
  }
  function expire() {
    const now = Date.now();
    for (const [id, value] of results)
      if (value.expires <= now) {
        results.delete(id);
        db.prepare(
          "UPDATE requests SET status='EXPIRED',error='RESULT_EXPIRED',updated=? WHERE id=?",
        ).run(now, id);
      }
    db.prepare(
      "DELETE FROM requests WHERE updated<? AND status NOT IN ('RUNNING')",
    ).run(now - limits.metadataTtlMs);
  }
  function view(row) {
    return {
      requestId: row.id,
      status: row.status,
      ...(results.has(row.id) ? { result: results.get(row.id).result } : {}),
      ...(row.error
        ? {
            error: {
              code: row.error,
              message: row.error,
              retryable: [
                "MODEL_TIMEOUT",
                "MODEL_UNAVAILABLE",
                "SERVICE_INTERRUPTED",
                "RESULT_EXPIRED",
              ].includes(row.error),
            },
          }
        : {}),
    };
  }
  async function run(id, request, controller) {
    let used = 0;
    const usage = [];
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    try {
      const provider = {
        model: config.provider.model,
        call: async (...args) => {
          ensure(++used <= limits.maxCalls, "QUOTA_EXCEEDED");
          return config.provider.call(...args);
        },
      };
      const result = await extractDefinition(
        request,
        provider,
        controller.signal,
        (value) => usage.push(value),
      );
      if (controller.signal.aborted) throw new ContractError("MODEL_TIMEOUT");
      if (
        db.prepare("SELECT status FROM requests WHERE id=?").get(id)?.status ===
        "RUNNING"
      ) {
        results.set(id, { result, expires: Date.now() + limits.resultTtlMs });
        db.prepare(
          "UPDATE requests SET status='SUCCEEDED',updated=? WHERE id=?",
        ).run(Date.now(), id);
      }
    } catch (error) {
      if (
        db.prepare("SELECT status FROM requests WHERE id=?").get(id)?.status ===
        "RUNNING"
      )
        db.prepare(
          "UPDATE requests SET status='FAILED',error=?,updated=? WHERE id=?",
        ).run(
          controller.signal.aborted
            ? "MODEL_TIMEOUT"
            : error instanceof ContractError
              ? error.code
              : "MODEL_UNAVAILABLE",
          Date.now(),
          id,
        );
    } finally {
      clearTimeout(timer);
      running.delete(id);
      db.prepare("UPDATE requests SET calls=?,usage_json=? WHERE id=?").run(
        used,
        JSON.stringify({
          calls: usage.map((u) =>
            u
              ? {
                  prompt_tokens: u.prompt_tokens,
                  completion_tokens: u.completion_tokens,
                  total_tokens: u.total_tokens,
                }
              : null,
          ),
          unknown: usage.length < used,
        }),
        id,
      );
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    try {
      expire();
      const subject = authenticate(
        req.headers.authorization?.replace(/^Bearer /, ""),
        config,
      );
      if (req.method === "GET" && req.url === "/v1/capabilities") {
        res.end(
          JSON.stringify({
            schemaVersions: [1],
            limits,
            fileTypes: ["UTF-8 text"],
            dataPolicy: {
              resultTtlMs: limits.resultTtlMs,
              metadataTtlMs: limits.metadataTtlMs,
              provider: config.providerName ?? "尚未配置供应商数据政策",
              providerPolicyUrl: config.providerPolicyUrl ?? null,
            },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/definition-extractions") {
        const key = req.headers["idempotency-key"];
        ensure(
          typeof key === "string" && key.length > 0 && key.length < 200,
          "INVALID_INPUT",
        );
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          ensure(size <= limits.maxBytes, "INPUT_TOO_LARGE");
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks));
        } catch {
          throw new ContractError("INVALID_INPUT");
        }
        validateRequest(input);
        ensure(input.sources.length <= limits.maxSources, "INPUT_TOO_LARGE");
        const budget = chunksFor(input).length + 1;
        ensure(budget <= limits.maxCalls, "INPUT_TOO_LARGE");
        const digest = createHash("sha256")
          .update(canonical(input))
          .digest("hex");
        const old = db
          .prepare("SELECT * FROM requests WHERE subject=? AND command_key=?")
          .get(subject, key);
        if (old) {
          ensure(old.hash === digest, "IDEMPOTENCY_CONFLICT");
          res.statusCode = 202;
          res.end(JSON.stringify(view(old)));
          return;
        }
        ensure(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM requests WHERE subject=? AND status='RUNNING'",
            )
            .get(subject).count < limits.maxConcurrency,
          "CONCURRENCY_LIMIT",
        );
        ensure(running.size < limits.maxGlobalConcurrency, "CONCURRENCY_LIMIT");
        const day = Date.now() - 86400_000;
        const total = db
          .prepare(
            "SELECT COALESCE(SUM(calls),0) AS total FROM requests WHERE subject=? AND created>?",
          )
          .get(subject, day).total;
        ensure(total + budget <= limits.dailyCalls, "QUOTA_EXCEEDED");
        const id = randomUUID(),
          now = Date.now();
        db.prepare(
          "INSERT INTO requests VALUES (?,?,?,?,'RUNNING',?,?,?,'{}',NULL)",
        ).run(id, subject, key, digest, now, now, budget);
        const controller = new AbortController();
        running.set(id, controller);
        void run(id, input, controller);
        res.statusCode = 202;
        res.end(JSON.stringify({ requestId: id, status: "RUNNING" }));
        return;
      }
      const match = req.url?.match(
        /^\/v1\/definition-extractions\/([a-zA-Z0-9-]+)(\/ack)?$/,
      );
      ensure(match, "NOT_FOUND");
      const id = match[1],
        row = rowFor(id, subject);
      if (req.method === "GET" && !match[2]) {
        res.end(JSON.stringify(view(row)));
        return;
      }
      if (req.method === "DELETE" && !match[2]) {
        running.get(id)?.abort();
        results.delete(id);
        db.prepare(
          "UPDATE requests SET status='CANCELLED',updated=? WHERE id=?",
        ).run(Date.now(), id);
        res.end(JSON.stringify({ requestId: id, status: "CANCELLED" }));
        return;
      }
      if (req.method === "POST" && match[2]) {
        ensure(
          ["SUCCEEDED", "ACKNOWLEDGED", "EXPIRED", "INTERRUPTED"].includes(
            row.status,
          ),
          "INVALID_STATE",
        );
        results.delete(id);
        db.prepare(
          "UPDATE requests SET status='ACKNOWLEDGED',updated=? WHERE id=?",
        ).run(Date.now(), id);
        res.end(JSON.stringify({ requestId: id, status: "ACKNOWLEDGED" }));
        return;
      }
      throw new ContractError("NOT_FOUND");
    } catch (error) {
      const code =
        error instanceof ContractError ? error.code : "INVALID_INPUT";
      res.statusCode = code.startsWith("AUTH")
        ? 401
        : code === "NOT_FOUND"
          ? 404
          : ["QUOTA_EXCEEDED", "CONCURRENCY_LIMIT"].includes(code)
            ? 429
            : code === "IDEMPOTENCY_CONFLICT"
              ? 409
              : 400;
      res.end(
        JSON.stringify({
          code,
          message: code,
          retryable: res.statusCode === 429,
        }),
      );
    }
  });
  const cleanup = setInterval(expire, Math.min(limits.resultTtlMs, 60_000));
  cleanup.unref();
  return {
    server,
    db,
    async close() {
      clearInterval(cleanup);
      for (const controller of running.values()) controller.abort();
      await new Promise((resolve) => server.close(resolve));
      while (running.size)
        await new Promise((resolve) => setTimeout(resolve, 10));
      db.close();
    },
  };
}
