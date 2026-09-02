import type { WorkCore } from "../core/index.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse = Record<string, unknown> | null;

function toolResult(value: unknown): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export class WorkPetMcpHandler {
  readonly #core: WorkCore;

  constructor(core: WorkCore) {
    this.#core = core;
  }

  handle(request: JsonRpcRequest): JsonRpcResponse {
    if (request.id === undefined || request.id === null) return null;
    const id = request.id;
    try {
      if (request.method === "initialize") {
        return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "workpet", version: "0.1.0" } } };
      }
      if (request.method === "tools/list") {
        return { jsonrpc: "2.0", id, result: { tools: [
          { name: "get_work_context", description: "读取可直接接力的结构化 Work State；不包含完整聊天历史。", inputSchema: { type: "object", properties: { work_id: { type: "string" } }, required: ["work_id"] } },
          { name: "get_work_archive", description: "需要核验来源时，显式读取 Work 的可见 Source Archive。", inputSchema: { type: "object", properties: { work_id: { type: "string" }, after_sequence: { type: "number" } }, required: ["work_id"] } },
          { name: "get_artifact_refs", description: "读取当前工作引用的本地资料路径和校验信息。", inputSchema: { type: "object", properties: { work_id: { type: "string" } }, required: ["work_id"] } }
        ] } };
      }
      if (request.method === "tools/call") {
        const name = request.params?.name;
        const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
        const workId = typeof args.work_id === "string" ? args.work_id : "";
        const work = this.#core.getWork(workId);
        if (!work) throw new Error("WORK_NOT_FOUND");
        if (name === "get_work_context") {
          this.#recordToolRead(workId, name, request.id);
          const handoff = this.#core.getLatestHandoffPackage(workId) ?? this.#core.createHandoffPackage(workId);
          return { jsonrpc: "2.0", id, result: toolResult({
            ...handoff,
            executionEpisodes: work.episodes,
            captureBindings: work.bindings
          }) };
        }
        if (name === "get_work_archive") {
          const after = typeof args.after_sequence === "number" ? args.after_sequence : 0;
          return { jsonrpc: "2.0", id, result: toolResult({
            workInstanceId: workId,
            events: work.sourceArchive.filter((event) => event.sequence > after)
          }) };
        }
        if (name === "get_artifact_refs") {
          this.#recordToolRead(workId, name, request.id);
          return { jsonrpc: "2.0", id, result: toolResult({ workInstanceId: workId, artifacts: work.artifactRefs }) };
        }
        throw new Error("UNKNOWN_TOOL");
      }
      throw new Error("METHOD_NOT_FOUND");
    } catch (error) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
    }
  }

  #recordToolRead(workId: string, toolName: string, requestId: string | number | null): void {
    const work = this.#core.getWork(workId);
    if (work?.instance.status !== "OPEN" || work.activeBinding?.adapter !== "workbuddy") return;
    const sequence = Math.max(0, ...work.sourceArchive.map((event) => event.sequence)) + 1;
    this.#core.appendSourceEvents(workId, [{
      externalId: `workpet:mcp:${work.activeBinding.id}:${toolName}:${String(requestId)}`,
      sequence,
      kind: "tool.call",
      content: `WorkBuddy MCP 调用 ${toolName}`,
      timestamp: new Date().toISOString(),
      executorType: "TOOL",
      environmentType: "WORKBUDDY_DESKTOP",
      metadata: { toolName, access: "read" },
      artifactRefs: []
    }]);
  }
}
