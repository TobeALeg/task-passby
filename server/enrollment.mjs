import { ensure, ContractError } from "../dist/contracts/definition.js";

// An installation proves possession of a random secret, never an embedded shared key.
export function createEnrollmentHandler(store, { trustProxy = false } = {}) {
  const attempts = new Map();
  return async (req, res) => {
    if (req.url !== "/v1/installations") return false;
    ensure(req.method === "POST", "NOT_FOUND");
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const remote = req.socket.remoteAddress;
    const fromProxy = trustProxy && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
    const ip = fromProxy ? req.headers["x-worket-client-ip"] : remote;
    ensure(typeof ip === "string" && ip.length < 100, "INVALID_INPUT");
    for (const [key, limit] of [["global", 1000], [`ip:${ip}`, 60]]) {
      const bucket = attempts.get(key) ?? { count: 0, until: now + 3600000 };
      ensure(bucket.count < limit, "QUOTA_EXCEEDED");
      bucket.count++;
      attempts.set(key, bucket);
    }
    ensure(req.headers["content-type"]?.startsWith("application/json"), "INVALID_INPUT");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      ensure(size <= 1024, "INPUT_TOO_LARGE");
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks)); }
    catch { throw new ContractError("INVALID_INPUT"); }
    const result = store.enrollInstallation(input?.secret);
    res.end(JSON.stringify(result));
    return true;
  };
}
