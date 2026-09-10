import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  generateKeyPairSync,
  createPublicKey,
  sign,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { LIMITS, ensure } from "../../dist/contracts/definition.js";
const ISSUER = "worket-managed-service",
  AUDIENCE = "worket-ai";
const blank = () => ({
  schemaVersion: 1,
  revision: 0,
  password: null,
  provider: {
    baseUrl: "",
    model: "",
    name: "",
    policyUrl: "",
    encryptedKey: null,
  },
  serviceUrl: "",
  limits: {
    dailyCalls: 100,
    maxConcurrency: 1,
    maxGlobalConcurrency: 4,
    maxSources: 5,
    timeoutMs: 600000,
  },
  clients: [],
});
function text(value, max = 500) {
  ensure(typeof value === "string" && value.length <= max, "INVALID_INPUT");
  return value.trim();
}
function serviceURL(value, optional = false) {
  const raw = text(value, 2048);
  if (!raw && optional) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入完整服务地址");
  }
  ensure(
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "INVALID_INPUT",
    "地址需为 HTTPS，或本机 HTTP 地址",
  );
  return url.href.replace(/\/$/, "");
}
export class AdminStore {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.path = join(directory, "settings.json");
    this.masterPath = join(directory, "encryption.key");
    ensure(
      existsSync(this.masterPath) || !existsSync(this.path),
      "CONFIG_INVALID",
      "加密密钥缺失，请恢复后台数据备份",
    );
    if (!existsSync(this.masterPath))
      writeFileSync(this.masterPath, randomBytes(32), {
        mode: 0o600,
        flag: "wx",
      });
    this.master = readFileSync(this.masterPath);
    ensure(this.master.length === 32, "CONFIG_INVALID");
    this.data = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, "utf8"))
      : blank();
    ensure(this.data.schemaVersion === 1, "CONFIG_INVALID");
    const keyPath = join(directory, "identity-private.pem");
    ensure(
      existsSync(keyPath) || !this.data.clients.length,
      "CONFIG_INVALID",
      "身份签名密钥缺失，请恢复后台数据备份",
    );
    if (!existsSync(keyPath)) {
      const pair = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      writeFileSync(keyPath, pair.privateKey, { mode: 0o600, flag: "wx" });
      writeFileSync(join(directory, "identity-public.pem"), pair.publicKey, {
        mode: 0o600,
      });
    }
    this.privateKey = readFileSync(keyPath, "utf8");
    this.publicKey = createPublicKey(this.privateKey).export({
      type: "spki",
      format: "pem",
    });
  }
  write(next) {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, this.path);
    this.data = next;
  }
  initialized() {
    return !!this.data.password;
  }
  setup(password) {
    ensure(!this.initialized(), "ALREADY_INITIALIZED");
    ensure(
      typeof password === "string" &&
        password.length >= 6 &&
        password.length <= 200,
      "INVALID_INPUT",
      "管理员密码至少 6 个字符",
    );
    const salt = randomBytes(16).toString("hex");
    this.write({
      ...this.data,
      password: { salt, hash: scryptSync(password, salt, 64).toString("hex") },
    });
  }
  verify(password) {
    if (
      !this.initialized() ||
      typeof password !== "string" ||
      password.length > 200
    )
      return false;
    const expected = Buffer.from(this.data.password.hash, "hex");
    const actual = scryptSync(password, this.data.password.salt, 64);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  encrypt(secret) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.master, iv);
    return {
      iv: iv.toString("base64"),
      ciphertext: Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
      ]).toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }
  apiKey() {
    const stored = this.data.provider.encryptedKey;
    if (!stored) return "";
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.master,
      Buffer.from(stored.iv, "base64"),
    );
    cipher.setAuthTag(Buffer.from(stored.tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(stored.ciphertext, "base64")),
      cipher.final(),
    ]).toString("utf8");
  }
  view() {
    const { provider, ...data } = this.data;
    const { encryptedKey, ...fields } = provider;
    delete data.password;
    return {
      ...data,
      provider: { ...fields, hasKey: !!encryptedKey },
      clients: data.clients.map(
        ({ id, name, createdAt, expiresAt, revokedAt }) => ({
          id,
          name,
          createdAt,
          expiresAt,
          revokedAt,
        }),
      ),
    };
  }
  candidate(input) {
    ensure(input && typeof input === "object", "INVALID_INPUT");
    ensure(
      input.revision === this.data.revision,
      "REVISION_CONFLICT",
      "配置已被另一页面更新，请刷新",
    );
    ensure(input.provider && input.limits, "INVALID_INPUT");
    const p = input.provider,
      key = text(p.apiKey ?? "", 8192),
      baseUrl = serviceURL(p.baseUrl),
      model = text(p.model, 200);
    ensure(model, "INVALID_INPUT", "请填写模型名称");
    ensure(
      !/\/chat\/completions\/?$/.test(baseUrl),
      "INVALID_INPUT",
      "请填写 API 基地址，不要包含 /chat/completions",
    );
    ensure(
      key || this.data.provider.encryptedKey,
      "INPUT_REQUIRED",
      "请填写供应商 API Key",
    );
    ensure(
      baseUrl === this.data.provider.baseUrl ||
        !this.data.provider.encryptedKey ||
        key,
      "INPUT_REQUIRED",
      "更换供应商地址时请重新填写密钥",
    );
    const limits = {};
    for (const [field, min, max] of [
      ["dailyCalls", 1, 100000],
      ["maxConcurrency", 1, 10],
      ["maxGlobalConcurrency", 1, 32],
      ["maxSources", 1, LIMITS.maxSources],
      ["timeoutMs", 10000, LIMITS.timeoutMs],
    ]) {
      const value = input.limits[field];
      ensure(
        Number.isInteger(value) && value >= min && value <= max,
        "INVALID_INPUT",
        `${field} 超出范围`,
      );
      limits[field] = value;
    }
    ensure(
      limits.maxConcurrency <= limits.maxGlobalConcurrency,
      "INVALID_INPUT",
      "单用户并发不能大于后台总并发",
    );
    return {
      ...this.data,
      revision: this.data.revision + 1,
      provider: {
        baseUrl,
        model,
        name: text(p.name, 120),
        policyUrl: serviceURL(p.policyUrl ?? "", true),
        encryptedKey: key ? this.encrypt(key) : this.data.provider.encryptedKey,
      },
      serviceUrl: serviceURL(input.serviceUrl ?? "", true),
      limits,
    };
  }
  save(input) {
    const next = this.candidate(input);
    this.write(next);
    return this.view();
  }
  issue(input) {
    const name = text(input?.name, 100),
      days = input?.days ?? 30;
    ensure(
      name && Number.isInteger(days) && days >= 1 && days <= 90,
      "INVALID_INPUT",
      "填写接入名称，有效期为 1–90 天",
    );
    const now = Date.now(),
      client = {
        id: randomUUID(),
        name,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + days * 86400000).toISOString(),
        revokedAt: null,
      };
    this.write({ ...this.data, clients: [...this.data.clients, client] });
    return { ...client, token: this.tokenFor(client) };
  }
  tokenFor(client) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: client.id, iss: ISSUER, aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.parse(client.expiresAt) / 1000),
    })).toString("base64url");
    return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), this.privateKey).toString("base64url")}`;
  }
  enrollInstallation(secret) {
    ensure(this.initialized(), "MODEL_UNAVAILABLE");
    ensure(typeof secret === "string" && /^[a-f0-9]{64}$/.test(secret), "INVALID_INPUT");
    const secretHash = createHash("sha256").update(secret).digest("hex");
    let client = this.data.clients.find(c => c.installationHash === secretHash);
    ensure(!client?.revokedAt, "AUTH_REVOKED");
    if (!client) {
      ensure(this.data.clients.length < 1000, "QUOTA_EXCEEDED");
      const id = randomUUID();
      client = { id, name: `自动接入 ${id.slice(0, 8)}`, installationHash: secretHash,
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), revokedAt: null };
      this.write({ ...this.data, clients: [...this.data.clients, client] });
    } else if (Date.parse(client.expiresAt) < Date.now() + 86400000) {
      client = { ...client, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() };
      this.write({ ...this.data, clients: this.data.clients.map(c => c.id === client.id ? client : c) });
    }
    return { subject: client.id, expiresAt: client.expiresAt, token: this.tokenFor(client) };
  }
  revoke(id) {
    const client = this.data.clients.find((c) => c.id === id);
    ensure(client, "NOT_FOUND");
    this.write({
      ...this.data,
      clients: this.data.clients.map((c) =>
        c.id === id
          ? { ...c, revokedAt: c.revokedAt ?? new Date().toISOString() }
          : c,
      ),
    });
  }
  identity() {
    return {
      mode: "production",
      issuer: ISSUER,
      audience: AUDIENCE,
      publicKey: this.publicKey,
      authorizeSubject: (subject) =>
        this.data.clients.some(
          (c) =>
            c.id === subject &&
            !c.revokedAt &&
            Date.parse(c.expiresAt) > Date.now(),
        ),
    };
  }
}
