import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { dirname } from "node:path";

import type { WorkBuddyHookIngestor } from "../adapters/workbuddy/hook-ingestor.js";
import type { WorkPetMcpHandler } from "./mcp-handler.js";

export interface WorkPetBridgeOptions {
  configPath: string;
  mcp: WorkPetMcpHandler;
  hooks: WorkBuddyHookIngestor;
  onCodexHook: (payload: Record<string, unknown>) => Promise<unknown>;
  port?: number;
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of request) {
    const chunk = Buffer.from(raw);
    total += chunk.length;
    if (total > 5 * 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export class WorkPetHttpBridge {
  readonly #options: WorkPetBridgeOptions;
  readonly #token = randomBytes(32).toString("hex");
  #server: Server | null = null;

  constructor(options: WorkPetBridgeOptions) {
    this.#options = options;
  }

  async start(): Promise<number> {
    if (this.#server) throw new Error("BRIDGE_ALREADY_STARTED");
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== "POST" || request.headers["x-workpet-token"] !== this.#token) {
          response.writeHead(401).end();
          return;
        }
        const payload = await jsonBody(request);
        if (request.url === "/mcp") {
          const result = this.#options.mcp.handle(payload);
          if (!result) response.writeHead(204).end();
          else response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          return;
        }
        if (request.url === "/hooks/workbuddy") {
          const result = await this.#options.hooks.ingest(payload);
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          return;
        }
        if (request.url === "/hooks/codex") {
          const result = await this.#options.onCodexHook(payload);
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
          return;
        }
        response.writeHead(404).end();
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#options.port ?? 0, "127.0.0.1", () => resolve());
    });
    this.#server = server;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("BRIDGE_ADDRESS_UNAVAILABLE");
    await mkdir(dirname(this.#options.configPath), { recursive: true });
    await writeFile(this.#options.configPath, JSON.stringify({ host: "127.0.0.1", port: address.port, token: this.#token }), { mode: 0o600 });
    await chmod(this.#options.configPath, 0o600);
    return address.port;
  }

  async close(): Promise<void> {
    if (!this.#server) return;
    const server = this.#server;
    this.#server = null;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
