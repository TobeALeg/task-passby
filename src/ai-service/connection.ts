import { randomBytes } from "node:crypto";
import { ContractError, ensure } from "../contracts/definition.js";

export const DEFAULT_SERVICE_URL = "https://124.223.223.215";
export type ServiceConfig = {
  url: string;
  token: string;
  development?: boolean;
  installationSecret?: string;
  subject?: string;
  expiresAt?: string;
};
export interface CredentialStore {
  read(): ServiceConfig;
  write(value: ServiceConfig): void;
}

export class AutomaticConnection {
  private pending: Promise<void> | undefined;
  constructor(readonly store: CredentialStore, readonly defaultUrl = DEFAULT_SERVICE_URL) {}
  initialize(): void {
    const current = this.store.read();
    if (!current.url) this.store.write({
      url: this.defaultUrl, token: "", installationSecret: randomBytes(32).toString("hex"),
    });
  }
  async ready(): Promise<void> {
    this.initialize();
    const current = this.store.read();
    if (!current.installationSecret) return; // Preserve manually configured services.
    if (current.token && Date.parse(current.expiresAt ?? "") > Date.now() + 86400000) return;
    if (!this.pending) this.pending = this.enroll(current).finally(() => { this.pending = undefined; });
    await this.pending;
  }
  private async enroll(current: ServiceConfig): Promise<void> {
    const url = new URL(current.url);
    ensure(url.protocol === "https:" || (current.development && url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)), "INVALID_SERVICE_URL");
    ensure(!url.username && !url.password && !url.search && !url.hash, "INVALID_SERVICE_URL");
    try {
      const response = await fetch(`${current.url.replace(/\/$/, "")}/v1/installations`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: current.installationSecret }),
      });
      const value = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new ContractError(
        typeof value.code === "string" ? value.code : "MODEL_UNAVAILABLE",
        value.code === "AUTH_REVOKED" ? "此安装的后台接入已被撤销" : "暂时无法连接 Worket 服务，请稍后重试",
      );
      ensure(typeof value.token === "string" && value.token.length > 0 &&
        typeof value.subject === "string" && typeof value.expiresAt === "string" &&
        Date.parse(value.expiresAt) > Date.now(), "AUTH_REQUIRED");
      const latest = this.store.read();
      // A manual service change while the request is in flight takes precedence.
      if (latest.url !== current.url || latest.installationSecret !== current.installationSecret) return;
      ensure(!current.subject || current.subject === value.subject, "AUTH_REQUIRED");
      this.store.write({ ...current, token: value.token as string, subject: value.subject as string, expiresAt: value.expiresAt as string });
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("MODEL_UNAVAILABLE", "暂时无法连接 Worket 服务；本地工作仍然保留", true);
    }
  }
}
