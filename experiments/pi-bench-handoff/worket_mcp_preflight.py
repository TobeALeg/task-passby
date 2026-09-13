#!/usr/bin/env python3
"""Verify Qwen can read a real Worket handoff through the standard MCP path."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from experiment_config import credential_path, load_config, model_bundle, runtime_path
from native_harness import (
    ROOT,
    atomic_json,
    discard_dead_loopback_proxy,
    read_key,
)


SERVER = ROOT / "experiments" / "pi-bench-handoff" / "worket_mcp_server.mjs"
REQUIRED_TOOLS = (
    "mcp_worket_get_work_context",
    "mcp_worket_get_artifact_refs",
    "mcp_worket_get_work_archive",
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_node(*arguments: str) -> None:
    subprocess.run(
        ["node", str(SERVER), *arguments],
        cwd=ROOT,
        check=True,
        text=True,
    )


async def preflight(args: argparse.Namespace) -> dict[str, Any]:
    config = load_config(args.config)
    qwen = model_bundle(config, "qwen", args.qwen_endpoint)
    qwen_key_file = credential_path(config, "qwen")
    upstream = runtime_path(config, "upstream")
    output = runtime_path(config, "output") / "worket-mcp-preflight"
    discarded_proxy = discard_dead_loopback_proxy()
    output.mkdir(parents=True, exist_ok=True)
    database = output / "worket.sqlite"
    artifact = output / "handoff-source.txt"
    seed_input = output / "seed-input.json"
    seed_output = output / "seed-output.json"
    inspection = output / "inspection.json"
    traces = output / "traces"
    workspace = output / "workspace"
    artifact.write_text(
        "Approved campaign: Qingyuan Reservoir. Budget ceiling: CNY 8,000.\n",
        encoding="utf-8",
    )
    artifact_bytes = artifact.read_bytes()
    source_time = now()
    run_tag = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    item = lambda identifier, text, source_ids: {
        "id": identifier,
        "text": text,
        "origin": "SYSTEM_INFERRED",
        "sourceMessageIds": source_ids,
    }
    atomic_json(seed_input, {
        "definition": {"key": "pi-bench-preflight", "name": "PI-Bench MCP preflight", "version": 1},
        "objective": "Continue the frozen Qingyuan Reservoir campaign handoff.",
        "objectiveSourceMessageIds": ["user-1"],
        "executor": {"type": "AGENT", "name": "DeepSeek"},
        "environment": {"type": "PI_BENCH_NATIVE", "name": "PI-Bench native"},
        "source": {"adapter": "pi-bench", "conversationId": f"preflight-source-{run_tag}"},
        "sourceEvents": [
            {
                "externalId": "user-1",
                "sequence": 1,
                "kind": "user.prompt",
                "content": "Prepare the Qingyuan Reservoir campaign within CNY 8,000.",
                "timestamp": source_time,
                "executorType": "HUMAN",
                "environmentType": "PI_BENCH_NATIVE",
                "metadata": {},
                "artifactRefs": [],
            },
            {
                "externalId": "agent-1",
                "sequence": 2,
                "kind": "agent.response",
                "content": "Draft completed; channel allocation remains pending.",
                "timestamp": source_time,
                "executorType": "AGENT",
                "environmentType": "PI_BENCH_NATIVE",
                "metadata": {"model": "deepseek-flash"},
                "artifactRefs": [],
            },
        ],
        "throughSequence": 2,
        "statePatch": {
            "successCriteria": [item("success-1", "Campaign remains within CNY 8,000.", ["user-1"])],
            "constraints": [item("constraint-1", "Do not exceed the approved budget.", ["user-1"])],
            "facts": [item("fact-1", "The approved campaign is Qingyuan Reservoir.", ["user-1"])],
            "decisions": [item("decision-1", "Use the completed draft as the baseline.", ["agent-1"])],
            "completedActions": [item("done-1", "DeepSeek completed the first draft.", ["agent-1"])],
            "pendingActions": [item("next-1", "Select the final channel allocation.", ["agent-1"])],
            "artifacts": [item("artifact-1", f"Read the source at {artifact} when needed.", ["agent-1"])],
        },
        "artifacts": [{
            "path": str(artifact),
            "role": "SOURCE",
            "filename": artifact.name,
            "mimeType": "text/plain",
            "size": len(artifact_bytes),
            "sha256": hashlib.sha256(artifact_bytes).hexdigest(),
            "lastModifiedAt": source_time,
            "availability": "AVAILABLE",
        }],
        "handoffTarget": {
            "executor": {"type": "AGENT", "name": "Qwen"},
            "environment": {"type": "PI_BENCH_NATIVE", "name": "PI-Bench native"},
            "source": {"adapter": "pi-bench", "conversationId": f"preflight-target-{run_tag}"},
        },
    })
    run_node(
        "seed", "--database", str(database), "--input", str(seed_input), "--output", str(seed_output),
    )
    seeded = json.loads(seed_output.read_text(encoding="utf-8"))
    work_id = seeded["workInstanceId"]

    sys.path.insert(0, str(upstream))
    from nanobot.agent.hooks import JsonStorageHook
    from nanobot.agent.loop import AgentLoop
    from nanobot.bus.queue import MessageBus
    from nanobot.config.schema import ChannelsConfig, ExecToolConfig, MCPServerConfig
    from nanobot.providers.custom_provider import CustomProvider
    from nanobot.utils.helpers import sync_workspace_templates

    sync_workspace_templates(workspace)
    provider = CustomProvider(
        api_key=read_key(qwen_key_file, qwen["key_index"]),
        api_base=qwen["base_url"],
        default_model=qwen["request_model"],
    )
    agent = AgentLoop(
        bus=MessageBus(),
        provider=provider,
        workspace=workspace,
        model=qwen["request_model"],
        temperature=0.0,
        max_tokens=2048,
        max_iterations=12,
        memory_window=20,
        exec_config=ExecToolConfig(timeout=30, path_append=""),
        restrict_to_workspace=False,
        mcp_servers={
            "worket": MCPServerConfig(
                command="node",
                args=[str(SERVER), "serve", "--database", str(database)],
                env={**os.environ},
                tool_timeout=30,
            ),
        },
        channels_config=ChannelsConfig(send_progress=False, send_tool_hints=False),
        hooks=[JsonStorageHook(storage_dir=traces)],
    )

    await agent._connect_mcp()
    registered = sorted(name for name in agent.tools.tool_names if name.startswith("mcp_worket_"))
    async def ignore_progress(_: str, **__: Any) -> None:
        return None
    response = await agent.process_direct(
        "\n".join([
            "This is a Worket MCP integration preflight.",
            f"WorkInstance ID: {work_id}",
            "Call these tools exactly once and in this order using that work_id:",
            "1. get_work_context",
            "2. get_artifact_refs",
            "3. get_work_archive with after_sequence 0",
            "Do not use shell or filesystem tools. After all three calls succeed, reply with MCP_PREFLIGHT_OK.",
        ]),
        session_key="preflight:worket",
        channel="preflight",
        chat_id="worket",
        on_progress=ignore_progress,
    )
    await agent.close_mcp()

    trace_files = sorted(traces.rglob("turn_*.json"), key=lambda path: path.stat().st_mtime_ns)
    if not trace_files:
        raise RuntimeError("No Qwen trace was written")
    trace = json.loads(trace_files[-1].read_text(encoding="utf-8"))
    tools_used = trace.get("tools_used", [])
    run_node(
        "inspect", "--database", str(database), "--work-id", work_id, "--output", str(inspection),
    )
    work = json.loads(inspection.read_text(encoding="utf-8"))
    audited_reads = [
        event.get("metadata", {}).get("toolName")
        for event in work.get("sourceArchive", [])
        if event.get("kind") == "tool.result"
    ]
    counts = {name: tools_used.count(name) for name in REQUIRED_TOOLS}
    passed = (
        set(REQUIRED_TOOLS).issubset(registered)
        and all(count == 1 for count in counts.values())
        and "MCP_PREFLIGHT_OK" in response
        and "get_work_context" in audited_reads
        and "get_artifact_refs" in audited_reads
        and len(work.get("handoffPackages", [])) >= 1
    )
    result = {
        "type": "worket-mcp-preflight",
        "pass": passed,
        "model": qwen["logical_model"],
        "logicalModel": qwen["logical_model"],
        "requestedModel": qwen["request_model"],
        "baseUrl": qwen["base_url"],
        "workInstanceId": work_id,
        "registeredTools": registered,
        "toolCallCounts": counts,
        "auditedReads": audited_reads,
        "packageReadAt": work.get("packageReadAt"),
        "handoffPackageCount": len(work.get("handoffPackages", [])),
        "response": response,
        "discardedDeadLoopbackProxy": discarded_proxy,
        "trace": str(trace_files[-1]),
    }
    atomic_json(output / "result.json", result)
    print(json.dumps(result, ensure_ascii=False))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument(
        "--qwen-endpoint",
        choices=("token-plan", "dashscope-fallback"),
        default="token-plan",
    )
    return parser.parse_args()


if __name__ == "__main__":
    outcome = asyncio.run(preflight(parse_args()))
    raise SystemExit(0 if outcome["pass"] else 1)
