import { hash } from "../definitions/storage.js";
import type { SampleUpload } from "../contracts/improvement.js";
import {
  ContractError,
  ensure,
  type ExtractionRequest,
  type ExtractionResult,
} from "../contracts/definition.js";
export type RemoteJob = {
  requestId: string;
  status: string;
  result?: ExtractionResult;
  error?: { code: string; message: string; retryable: boolean };
};
export interface AIClient {
  capabilities(): Promise<unknown>;
  improvementIdentity?(): string;
  uploadSample?(input: SampleUpload): Promise<unknown>;
  deleteSample?(id: string): Promise<unknown>;
  submit(request: ExtractionRequest, key: string): Promise<RemoteJob>;
  get(id: string): Promise<RemoteJob>;
  cancel(id: string): Promise<unknown>;
  ack(id: string): Promise<unknown>;
}
export class WorketAIClient implements AIClient {
  constructor(
    readonly config: () => {
      url: string;
      token: string;
      development?: boolean;
    },
  ) {}
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<any> {
    const config = this.config();
    ensure(config.url, "MODEL_UNAVAILABLE", "请先配置 Worket 服务并登录");
    ensure(config.token, "AUTH_REQUIRED");
    const url = new URL(config.url);
    ensure(
      url.protocol === "https:" ||
        (config.development &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
      "INVALID_SERVICE_URL",
    );
    ensure(!url.username && !url.password, "INVALID_SERVICE_URL");
    try {
      const response = await fetch(`${config.url.replace(/\/$/, "")}${path}`, {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
      const value = (await response.json()) as Record<string, unknown>;
      if (!response.ok)
        throw new ContractError(
          typeof value.code === "string" ? value.code : "MODEL_UNAVAILABLE",
          typeof value.message === "string" ? value.message : "服务暂不可用",
          !!value.retryable,
        );
      return value;
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError(
        "MODEL_UNAVAILABLE",
        "网络不可用；已确认的本地材料仍然保留",
        true,
      );
    }
  }
  improvementIdentity() {
    const c = this.config();
    return hash([c.url.replace(/\/$/, ""), c.token]);
  }
  uploadSample(input: SampleUpload) {
    return this.request("/v1/improvement-samples", "POST", input);
  }
  deleteSample(id: string) {
    return this.request(`/v1/improvement-samples/${encodeURIComponent(id)}`, "DELETE");
  }
  capabilities() {
    return this.request("/v1/capabilities");
  }
  submit(request: ExtractionRequest, key: string): Promise<RemoteJob> {
    return this.request("/v1/definition-extractions", "POST", request, key);
  }
  get(id: string): Promise<RemoteJob> {
    return this.request(`/v1/definition-extractions/${encodeURIComponent(id)}`);
  }
  cancel(id: string) {
    return this.request(
      `/v1/definition-extractions/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
  ack(id: string) {
    return this.request(
      `/v1/definition-extractions/${encodeURIComponent(id)}/ack`,
      "POST",
    );
  }
}
