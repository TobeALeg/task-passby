// Only the fields rendered as user-visible conversation content cross into Worket.
const iso = (value) =>
  new Date(
    typeof value === "number"
      ? value < 1e12
        ? value * 1000
        : value
      : value || 0,
  ).toISOString();
function summary(info) {
  if (!info || typeof info.id !== "string")
    throw new Error("WORKBUDDY_INCOMPATIBLE: missing conversation identity");
  return {
    id: info.id,
    title: info.title || null,
    preview: "",
    cwd: info.space?.cwd || "",
    updatedAt: iso(info.updatedAt),
    status: info.state,
  };
}
function visibleThread(info, requests) {
  const events = [];
  let sequence = 0;
  const emit = (req, index, kind, content, metadata = {}) => {
    const externalId = `workbuddy:${info.id}:${req.id}:${index}`;
    events.push({
      id: externalId,
      externalId,
      sequence: ++sequence,
      kind,
      content,
      timestamp: iso(req.timestamp),
      executorType: kind === "user.prompt" ? "HUMAN" : "AGENT",
      environmentType: "WORKBUDDY_DESKTOP",
      metadata: { ...metadata, sessionId: info.id },
    });
  };
  for (const req of [...requests].sort(
    (a, b) => a.requestSeq - b.requestSeq || a.timestamp - b.timestamp,
  )) {
    if (typeof req.id !== "string")
      throw new Error("WORKBUDDY_INCOMPATIBLE: missing request identity");
    for (const [role, message] of [
      ["user", req.userMessage],
      ["assistant", req.assistantMessage],
    ]) {
      // Finalize replies once, avoiding archiving partial streaming text as a final reply.
      if (role === "assistant" && message?.state !== "completed") continue;
      for (const [i, block] of (message?.content || []).entries()) {
        const key = `${role}:${i}`;
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim()
        )
          emit(
            req,
            key,
            role === "user" ? "user.prompt" : "agent.response",
            block.text,
          );
        if (block.type === "tool") {
          const toolId =
            typeof block.toolCallId === "string" ? block.toolCallId : String(i);
          const toolName =
            typeof block.toolName === "string"
              ? block.toolName
              : typeof block.title === "string"
                ? block.title
                : "tool";
          emit(
            req,
            `tool:${toolId}:call`,
            "tool.call",
            JSON.stringify({ name: toolName, input: block.rawInput ?? null }),
            { toolName, toolCallId: toolId },
          );
          if (block.rawOutput !== undefined)
            emit(
              req,
              `tool:${toolId}:result`,
              "tool.result",
              JSON.stringify(block.rawOutput),
              { toolName, toolCallId: toolId, status: block.status },
            );
        }
        if (
          ["file", "image", "resource", "resource_link", "document"].includes(
            block.type,
          )
        ) {
          let path =
            block.path ||
            block.filePath ||
            block.file_path ||
            block.local_path ||
            block.uri ||
            block.resource?.uri;
          if (typeof path === "string" && path.startsWith("file://")) {
            try {
              path = decodeURIComponent(new URL(path).pathname);
            } catch {
              path = null;
            }
          }
          if (typeof path === "string" && path.startsWith("/"))
            emit(req, `${key}:artifact`, "artifact.added", path, {
              path,
              role: role === "user" ? "INPUT" : "OUTPUT",
            });
        }
      }
    }
  }
  return {
    threadId: info.id,
    title: info.title || "未命名工作",
    applicationTitle: info.title || null,
    cwd: info.space?.cwd || "",
    createdAt: iso(info.createdAt),
    updatedAt: iso(info.updatedAt),
    events,
  };
}
module.exports = { summary, visibleThread };
