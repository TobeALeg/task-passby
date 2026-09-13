#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_UPSTREAM = join(ROOT, "output", "pi-bench-upstream");
const DEFAULT_OUTPUT = join(ROOT, "output", "pi-bench-handoff");
const DEFAULT_KEY_FILE = "C:\\Users\\Dandi\\Desktop\\aliapikey.txt";
const DEFAULT_DEEPSEEK_KEY_FILE = "C:\\Users\\Dandi\\Desktop\\dskey.txt";
const BAILIAN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const CHAINS = [
  ["marketer", ["marketer_task_005"], "marketer_task_006", "apple-issey-campaign"],
  ["marketer", ["marketer_task_007", "marketer_task_008"], "marketer_task_009", "bootcamp-launch"],
  ["marketer", ["marketer_task_015", "marketer_task_016"], "marketer_task_017", "rog-btrt-campaign"],
  ["marketer", ["marketer_task_018"], "marketer_task_019", "meowconnect-crisis"],
  ["Financier", ["Financier_task_003"], "Financier_task_006", "pd-model-route"],
  ["Financier", ["Financier_task_001"], "Financier_task_010", "pd-validation"],
  ["Financier", ["Financier_task_004"], "Financier_task_014", "var-validation"],
  ["researcher", ["researcher_task_001", "researcher_task_004"], "researcher_task_006", "think-with-image-survey"],
  ["researcher", ["researcher_task_003"], "researcher_task_009", "internship-search"],
  ["researcher", ["researcher_task_005", "researcher_task_007"], "researcher_task_011", "multimodal-experiment-review"],
  ["researcher", ["researcher_task_018", "researcher_task_019"], "researcher_task_020", "openclaw-tracking"],
].map(([persona, prefix, target, thread]) => ({ persona, prefix, target, thread }));

// The frozen upstream revision has no eligible hard tasks after excluding every
// formal chain and its dependency closure. These IDs are selected before any
// benchmark task output and maximize text/file/tool coverage at available
// easy/medium difficulty.
const CALIBRATION = {
  marketer: [
    ["marketer_task_002", "easy", "text"],
    ["marketer_task_011", "medium", "web"],
    ["marketer_task_012", "medium", "file"],
    ["marketer_task_010", "medium", "tool"],
  ],
  Financier: [
    ["Financier_task_013", "medium", "text"],
    ["Financier_task_007", "medium", "file"],
    ["Financier_task_002", "medium", "tool"],
    ["Financier_task_005", "medium", "tool"],
  ],
  researcher: [
    ["researcher_task_002", "easy", "text"],
    ["researcher_task_010", "easy", "file"],
    ["researcher_task_014", "medium", "tool"],
    ["researcher_task_015", "medium", "tool"],
  ],
};

const MODEL_CANDIDATES = [
  {
    role: "source",
    provider: "DeepSeek official API",
    baseUrl: DEEPSEEK_BASE_URL,
    requestedModel: "deepseek-flash",
    note: "Official model-list alias returned by the experiment account on 2026-09-12.",
  },
  {
    role: "target-primary",
    provider: "Alibaba Cloud Model Studio (cn-beijing)",
    baseUrl: BAILIAN_BASE_URL,
    requestedModel: "qwen3.8-max-0902",
    note: "Frozen date snapshot requested by the preregistration.",
  },
  {
    role: "target-fallback",
    provider: "Alibaba Cloud Model Studio (cn-beijing)",
    baseUrl: BAILIAN_BASE_URL,
    requestedModel: "qwen3.8-flash",
    note: "Used only if the primary target fails the frozen calibration gate.",
  },
];

function parseArgs(argv) {
  const options = {
    command: argv[2] ?? "all",
    upstream: DEFAULT_UPSTREAM,
    output: DEFAULT_OUTPUT,
    keyFile: DEFAULT_KEY_FILE,
    deepseekKeyFile: DEFAULT_DEEPSEEK_KEY_FILE,
  };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`UNKNOWN_ARGUMENT_${argument}`);
    const [raw, inline] = argument.slice(2).split("=", 2);
    const key = raw.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Error(`MISSING_VALUE_${raw}`);
    options[key] = value;
  }
  options.upstream = resolve(options.upstream);
  options.output = resolve(options.output);
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function git(path, args) {
  const result = run("git", args, path);
  return result.ok ? result.stdout : null;
}

function taskPath(upstream, persona, taskId) {
  return join(upstream, "data", persona, "tasks", taskId, "task.yaml");
}

function taskMetadata(path) {
  const text = readFileSync(path, "utf8");
  const field = (name) => text.match(new RegExp(`^${name}:\\s*[\"']?([^\\r\\n\"']*)`, "mu"))?.[1]?.trim() ?? "";
  return {
    title: field("title"),
    taskType: field("task_type"),
    difficulty: text.match(/^\s+difficulty:\s*(\w+)/mu)?.[1] ?? "unknown",
    sha256: sha256(text),
  };
}

function episodeDependencies(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);
  const result = new Map();
  let current = null;
  for (const line of lines) {
    const task = line.match(/- task_id:\s*(\S+)/u)?.[1];
    if (task) current = task;
    const dependency = line.match(/depends_on:\s*\[([^\]]*)\]/u)?.[1];
    if (current && dependency !== undefined) {
      result.set(current, dependency.split(",").map((item) => item.trim()).filter(Boolean));
    }
  }
  return result;
}

function preregister(config) {
  if (!existsSync(config.upstream)) throw new Error("PI_BENCH_UPSTREAM_MISSING");
  const episodes = new Map();
  for (const persona of new Set(CHAINS.map((item) => item.persona))) {
    const path = join(config.upstream, "data", persona, "episode.yaml");
    episodes.set(persona, { path, dependencies: episodeDependencies(path) });
  }
  const chains = CHAINS.map((chain, index) => {
    const actual = episodes.get(chain.persona).dependencies.get(chain.target) ?? [];
    const dependencyMatch = JSON.stringify([...actual].sort()) === JSON.stringify([...chain.prefix].sort());
    if (!dependencyMatch) throw new Error(`DEPENDENCY_MISMATCH_${chain.target}`);
    const ids = [...chain.prefix, chain.target];
    return {
      caseId: `pi-${String(index + 1).padStart(2, "0")}`,
      ...chain,
      dependencyMatch,
      semanticReview: "KEEP_SAME_WORK_INSTANCE",
      tasks: Object.fromEntries(ids.map((id) => [id, taskMetadata(taskPath(config.upstream, chain.persona, id))])),
    };
  });
  const calibration = Object.entries(CALIBRATION).flatMap(([persona, tasks]) => tasks.map(([taskId, stratum, modality]) => {
    const metadata = taskMetadata(taskPath(config.upstream, persona, taskId));
    if (metadata.difficulty !== stratum) throw new Error(`CALIBRATION_DIFFICULTY_MISMATCH_${taskId}`);
    return { persona, taskId, difficulty: stratum, modality, ...metadata };
  }));
  const manifest = {
    schemaVersion: 1,
    experiment: "pi-bench-cross-model-handoff-v1",
    protocolRevision: "v1-preflight-amendment-2",
    frozenAt: new Date().toISOString(),
    upstream: {
      repository: "https://github.com/Simplified-Reasoning/Pi-Bench",
      commit: git(config.upstream, ["rev-parse", "HEAD"]),
      commitDate: git(config.upstream, ["show", "-s", "--format=%cI", "HEAD"]),
      license: "Apache-2.0",
      executionMode: "native-python-no-docker",
      episodeHashes: Object.fromEntries([...episodes.entries()].map(([persona, value]) => [persona, sha256File(value.path)])),
    },
    worket: {
      commit: git(ROOT, ["rev-parse", "HEAD"]),
      dirty: Boolean(git(ROOT, ["status", "--porcelain"])),
      packageVersion: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version,
      handoffImplementationHashes: Object.fromEntries([
        "src/bridge/mcp-handler.ts",
        "src/core/work-core.ts",
        "src/executors/work-bootstrap.ts",
      ].map((relative) => [relative, sha256File(join(ROOT, relative))])),
    },
    chains,
    calibration,
    deviationsFrozenBeforeTaskOutputs: [
      {
        id: "CALIBRATION_NO_ELIGIBLE_HARD_TASKS",
        finding: "After excluding all formal chains and their dependency closure, the frozen three-persona dataset contains no eligible hard tasks.",
        resolution: "Keep four tasks per persona and maximize text/file/tool coverage at the available easy/medium levels; do not borrow formal targets.",
      },
      {
        id: "DEEPSEEK_DIRECT_CREDENTIAL_ADDED",
        finding: "A DeepSeek-direct credential was added before any benchmark task output; the official model list exposes deepseek-flash and deepseek-v4-pro.",
        resolution: "Use official deepseek-flash as the source model. Treat the earlier Bailian-hosted deepseek-v4-flash call only as an engineering preflight, never as an experimental sample.",
      },
      {
        id: "USER_AND_JUDGER_MODEL_FREEZE",
        finding: "The v1 document did not freeze user-simulator and native-judger model IDs.",
        resolution: "Use qwen3.8-max-0902 for both roles with temperature 0, record this as a protocol amendment, and keep native evaluator output separate from continuity judging.",
      },
      {
        id: "NATIVE_HARNESS_NO_DOCKER",
        finding: "The user explicitly chose a native harness; Docker is packaging/isolation rather than a benchmark-semantic requirement.",
        resolution: "Reuse the frozen PI-Bench UserAgent, runner, evaluator, NanoBot agent loop, AppWorld APIs/MCP, task data, and workspace assets in a local venv. Replace image digest evidence with Python/package/data hashes and per-condition state snapshots.",
      },
      {
        id: "BRAVE_SEARCH_CREDENTIAL_UNAVAILABLE",
        finding: "No Brave Search credential is locally available.",
        resolution: "Use a frozen unkeyed DuckDuckGo HTML search adapter for every condition and model; retain web_fetch unchanged and report the provider deviation.",
      },
    ],
    models: MODEL_CANDIDATES,
    frozenParameters: {
      repeats: 3,
      pilotRepeats: 1,
      modelTemperature: 0,
      userSimulatorModel: "qwen3.8-max-0902",
      userSimulatorTemperature: 0,
      nativeJudgerModel: "qwen3.8-max-0902",
      nativeJudgerTemperature: 0,
      targetMaxTokens: 16384,
      maxToolIterations: 120,
      conditionOrderSeed: "worket-pi-bench-2026-09-12",
    },
  };
  atomicJson(join(config.output, "manifest.json"), manifest);
  process.stdout.write(`${JSON.stringify({ type: "preregistered", manifest: join(config.output, "manifest.json"), chains: chains.length, calibrationTasks: calibration.length })}\n`);
  return manifest;
}

function readKey(path) {
  const key = readFileSync(path, "utf8").trim();
  if (!key.startsWith("sk-") || key.length < 20 || /\s/u.test(key)) throw new Error("INVALID_MODEL_KEY_FILE");
  return key;
}

async function modelCall(apiKey, baseUrl, model, withTool) {
  const request = {
    model,
    messages: [{ role: "user", content: withTool ? "Call the probe tool exactly once with value OK." : "Reply with exactly OK." }],
    temperature: 0,
    max_tokens: 2048,
    ...(withTool ? {
      tools: [{ type: "function", function: { name: "probe", description: "Preflight probe", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } } }],
      tool_choice: "auto",
    } : {}),
  };
  const started = Date.now();
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const detail = String(body?.error?.message ?? "unknown").replace(/\s+/gu, " ").slice(0, 240);
    throw new Error(`MODEL_HTTP_${response.status}_${body?.error?.code ?? "UNKNOWN"}_${detail}`);
  }
  const choice = body.choices?.[0] ?? {};
  const message = choice.message ?? {};
  return {
    requestedModel: model,
    responseModel: body.model ?? null,
    requestId: body.id ?? null,
    finishReason: choice.finish_reason ?? null,
    textMatches: withTool ? null : /^OK[.!。！]?$/iu.test(String(message.content ?? "").trim()),
    contentCharacters: String(message.content ?? "").length,
    contentPreview: String(message.content ?? "").slice(0, 80),
    toolCalled: withTool ? message.tool_calls?.[0]?.function?.name === "probe" : null,
    reasoningCharacters: String(message.reasoning_content ?? "").length,
    usage: body.usage ?? null,
    latencyMs: Date.now() - started,
  };
}

async function modelPreflight(config) {
  const qwenKey = readKey(config.keyFile);
  const deepseekKey = readKey(config.deepseekKeyFile);
  const records = [];
  for (const candidate of MODEL_CANDIDATES) {
    const apiKey = candidate.role === "source" ? deepseekKey : qwenKey;
    let text;
    let tool;
    try { text = await modelCall(apiKey, candidate.baseUrl, candidate.requestedModel, false); }
    catch (error) { text = { error: error instanceof Error ? error.message : String(error) }; }
    try { tool = await modelCall(apiKey, candidate.baseUrl, candidate.requestedModel, true); }
    catch (error) { tool = { error: error instanceof Error ? error.message : String(error) }; }
    const pass = text.textMatches === true && tool.toolCalled === true;
    records.push({ ...candidate, text, tool, pass });
    atomicJson(join(config.output, "model-preflight.json"), {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      endpoints: Object.fromEntries(MODEL_CANDIDATES.map((item) => [item.role, item.baseUrl])),
      records,
      complete: false,
    });
    process.stdout.write(`${JSON.stringify({ type: "model-preflight", model: candidate.requestedModel, responseModel: text.responseModel ?? null, text: text.textMatches ?? false, tool: tool.toolCalled ?? false, textError: text.error ?? null, toolError: tool.error ?? null })}\n`);
  }
  const result = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    endpoints: Object.fromEntries(MODEL_CANDIDATES.map((item) => [item.role, item.baseUrl])),
    records,
    pass: records.every((item) => item.pass),
    complete: true,
  };
  atomicJson(join(config.output, "model-preflight.json"), result);
  return result;
}

function environmentPreflight(config) {
  const nativePythonPath = join(ROOT, "output", "pi-bench-native", ".venv", "Scripts", "python.exe");
  const python = existsSync(nativePythonPath)
    ? run(nativePythonPath, ["--version"])
    : { ok: false, stdout: "", stderr: "native venv missing" };
  const imports = existsSync(nativePythonPath)
    ? run(nativePythonPath, ["-c", "import appworld, nanobot, src; print('ok')"], config.upstream)
    : { ok: false, stdout: "", stderr: "native venv missing" };
  const appWorldRoot = join(config.upstream, "third_party", "appworld");
  const appWorldBaseDb = join(appWorldRoot, "data", "base_dbs", "api_docs.db");
  const nativeHarness = join(ROOT, "experiments", "pi-bench-handoff", "native_harness.py");
  const nativeReady = python.ok && imports.ok && existsSync(appWorldBaseDb) && existsSync(nativeHarness);
  const worketMcpResultPath = join(config.output, "worket-mcp-preflight", "result.json");
  let worketMcpResult = null;
  if (existsSync(worketMcpResultPath)) {
    try { worketMcpResult = JSON.parse(readFileSync(worketMcpResultPath, "utf8")); }
    catch { worketMcpResult = null; }
  }
  const qwenCanReachRealWorketMcp = worketMcpResult?.pass === true;
  const snapshotResultPath = join(config.output, "snapshot-preflight.json");
  let snapshotResult = null;
  if (existsSync(snapshotResultPath)) {
    try { snapshotResult = JSON.parse(readFileSync(snapshotResultPath, "utf8")); }
    catch { snapshotResult = null; }
  }
  const commonPrefixSnapshotValidated = snapshotResult?.pass === true;
  const result = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    upstreamPresent: existsSync(config.upstream),
    upstreamCommit: git(config.upstream, ["rev-parse", "HEAD"]),
    python: { ok: python.ok, version: python.stdout || python.stderr },
    imports: { ok: imports.ok, output: imports.stdout || imports.stderr },
    appWorldSourcePresent: existsSync(appWorldRoot),
    appWorldBaseDbPresent: existsSync(appWorldBaseDb),
    appWorldDataVersion: existsSync(join(appWorldRoot, "data", "version.txt"))
      ? readFileSync(join(appWorldRoot, "data", "version.txt"), "utf8").trim()
      : null,
    nativeHarnessPresent: existsSync(nativeHarness),
    dockerRequired: false,
    worketMcpImplementationPresent: existsSync(join(ROOT, "dist", "bridge", "mcp-handler.js")),
    qwenCanReachRealWorketMcp,
    worketMcpResultPath,
    commonPrefixSnapshotValidated,
    snapshotResultPath,
    nativePiBenchReady: nativeReady,
    pass: nativeReady
      && existsSync(join(ROOT, "dist", "bridge", "mcp-handler.js"))
      && qwenCanReachRealWorketMcp
      && commonPrefixSnapshotValidated,
    blockingReasons: [
      ...(!nativeReady ? ["NATIVE_PI_BENCH_RUNTIME_INCOMPLETE"] : []),
      ...(!qwenCanReachRealWorketMcp ? ["REAL_WORKET_MCP_NATIVE_BRIDGE_NOT_YET_VALIDATED"] : []),
      ...(!commonPrefixSnapshotValidated ? ["COMMON_PREFIX_SNAPSHOT_NOT_YET_VALIDATED"] : []),
    ],
  };
  atomicJson(join(config.output, "environment-preflight.json"), result);
  process.stdout.write(`${JSON.stringify({ type: "environment-preflight", pass: result.pass, blockingReasons: result.blockingReasons })}\n`);
  return result;
}

async function main() {
  const config = parseArgs(process.argv);
  if (!["all", "preregister", "model-preflight", "environment-preflight"].includes(config.command)) throw new Error(`UNKNOWN_COMMAND_${config.command}`);
  if (["all", "preregister"].includes(config.command)) preregister(config);
  if (["all", "environment-preflight"].includes(config.command)) environmentPreflight(config);
  if (["all", "model-preflight"].includes(config.command)) await modelPreflight(config);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ type: "fatal", at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
