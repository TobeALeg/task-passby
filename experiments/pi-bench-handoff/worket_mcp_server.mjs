#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

import { WorkPetMcpHandler } from "../../dist/bridge/mcp-handler.js";
import { createWorkCore } from "../../dist/core/index.js";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing ${flag}`);
  }
  return process.argv[index + 1];
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function seed() {
  const databasePath = resolve(valueAfter("--database"));
  const inputPath = resolve(valueAfter("--input"));
  const outputPath = resolve(valueAfter("--output"));
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const core = createWorkCore({ databasePath });
  try {
    let work = core.createWork({
      definition: input.definition,
      objective: input.objective,
      objectiveSourceMessageIds: input.objectiveSourceMessageIds ?? [],
      executor: input.executor,
      environment: input.environment,
      source: input.source,
    });
    if (input.sourceEvents?.length) {
      work = core.appendSourceEvents(work.instance.id, input.sourceEvents).work;
    }
    if (input.statePatch) {
      work = core.applyExtractorPatch(
        work.instance.id,
        input.statePatch,
        input.throughSequence,
      );
    }
    for (const artifact of input.artifacts ?? []) {
      work = core.addArtifactRef(work.instance.id, artifact);
    }
    if (input.handoffTarget) {
      work = core.startExecutionEpisode(work.instance.id, {
        ...input.handoffTarget,
        endCurrentEpisode: true,
      });
    }
    const handoff = core.createHandoffPackage(work.instance.id);
    writeJson(outputPath, {
      workInstanceId: work.instance.id,
      handoffPackageId: handoff.id,
      databasePath,
      generatedAt: handoff.generatedAt,
    });
  } finally {
    core.close();
  }
}

function inspect() {
  const databasePath = resolve(valueAfter("--database"));
  const workId = valueAfter("--work-id");
  const outputPath = resolve(valueAfter("--output"));
  const core = createWorkCore({ databasePath });
  try {
    const work = core.getWork(workId);
    if (!work) throw new Error("WORK_NOT_FOUND");
    writeJson(outputPath, work);
  } finally {
    core.close();
  }
}

async function serve() {
  const databasePath = resolve(valueAfter("--database"));
  const core = createWorkCore({ databasePath });
  const handler = new WorkPetMcpHandler(core);
  const lines = createInterface({ input: process.stdin, terminal: false });

  const close = () => {
    lines.close();
    core.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.once("exit", () => {
    try { core.close(); } catch {}
  });

  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      const response = handler.handle(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      })}\n`);
    }
  }
  core.close();
}

const command = process.argv[2];
if (command === "seed") seed();
else if (command === "inspect") inspect();
else if (command === "serve") await serve();
else throw new Error("Expected command: seed | inspect | serve");
