#!/usr/bin/env python3
"""Native (non-Docker) runner for the PI-Bench handoff experiment.

This keeps PI-Bench's UserAgent, BenchmarkRunner, trace hook, evaluation, and
AppWorld MCP implementation.  Only the container/process orchestration is
replaced with a local, isolated runtime under ``output/``.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
import socket
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_UPSTREAM = ROOT / "output" / "pi-bench-upstream"
DEFAULT_OUTPUT = ROOT / "output" / "pi-bench-handoff"
DEFAULT_KEY_FILE = Path(r"C:\Users\Dandi\Desktop\aliapikey.txt")
DEFAULT_DEEPSEEK_KEY_FILE = Path(r"C:\Users\Dandi\Desktop\dskey.txt")
BAILIAN_BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
BAILIAN_FALLBACK_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
BAILIAN_MODEL = "qwen3.8-max"
BAILIAN_FALLBACK_MODEL = "qwen3.8-max-0902"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# The native venv installs PI-Bench editable, but explicitly prefer the frozen
# checkout so imports never resolve to an unrelated local ``src`` directory.
sys.path.insert(0, str(DEFAULT_UPSTREAM))

from src.channels.base import BaseChannel


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read_key(path: Path, index: int = 0) -> str:
    keys = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("sk-") and not any(character.isspace() for character in line.strip())
    ]
    if index < 0 or index >= len(keys) or len(keys[index]) < 20:
        raise ValueError("invalid model key file")
    return keys[index]


def discard_dead_loopback_proxy() -> str | None:
    """Drop the tool sandbox's stale loopback proxy from child HTTP clients."""
    # AppWorld's MCP server calls its sibling API server through requests.
    # Never send those localhost calls through the external-model proxy.
    local_bypass = "127.0.0.1,localhost"
    os.environ["NO_PROXY"] = local_bypass
    os.environ["no_proxy"] = local_bypass
    proxy = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY")
    if not proxy:
        return None
    parsed = urlparse(proxy)
    if parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.port is None:
        return None
    try:
        with socket.create_connection((parsed.hostname, parsed.port), timeout=0.5):
            return None
    except OSError:
        for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "all_proxy"):
            os.environ.pop(name, None)
        return proxy


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


async def wait_port(port: int, process: subprocess.Popen[Any], timeout: float = 300.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"service exited before port {port} was ready (exit={process.returncode})")
        try:
            def probe() -> None:
                with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                    return None

            await asyncio.to_thread(probe)
            return
        except OSError:
            await asyncio.sleep(0.25)
    raise TimeoutError(f"service port {port} was not ready after {timeout:.0f}s")


def stop_process(process: subprocess.Popen[Any] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def task_yaml(upstream: Path, persona: str, task_id: str) -> Path:
    path = upstream / "data" / persona / "tasks" / task_id / "task.yaml"
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def infer_appworld_apps(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    names = set()
    for match in re.finditer(r"^\s+-\s+(?:mcp_appworld_)?([a-z][a-z0-9_]*)__[a-z][a-z0-9_]*\s*:", text, re.MULTILINE):
        names.add(match.group(1))
    return sorted(names)


def strip_tags(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", "", value, flags=re.IGNORECASE)
    value = re.sub(r"<style[\s\S]*?</style>", "", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    return " ".join(html.unescape(value).split())


def unwrap_duckduckgo_url(value: str) -> str:
    parsed = urlparse(html.unescape(value))
    if parsed.netloc.endswith("duckduckgo.com"):
        target = parse_qs(parsed.query).get("uddg", [])
        if target:
            return unquote(target[0])
    return html.unescape(value)


def build_public_search_tool():
    from nanobot.agent.tools.base import Tool

    class PublicWebSearchTool(Tool):
        name = "web_search"
        description = "Search the public web. Returns result titles, URLs, and snippets."
        parameters = {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "count": {"type": "integer", "minimum": 1, "maximum": 10},
            },
            "required": ["query"],
        }

        async def execute(self, query: str, count: int = 5, **_: Any) -> str:
            limit = min(max(int(count or 5), 1), 10)
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            headers = {"User-Agent": "Mozilla/5.0 (compatible; PI-Bench-Native/1.0)"}
            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0, trust_env=False) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
            anchors = list(re.finditer(
                r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>',
                response.text,
                flags=re.IGNORECASE,
            ))
            snippets = re.findall(
                r'<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)</(?:a|div)>',
                response.text,
                flags=re.IGNORECASE,
            )
            lines = [f"Results for: {query}"]
            for index, anchor in enumerate(anchors[:limit], start=1):
                href, title = anchor.groups()
                lines.append(f"{index}. {strip_tags(title)}")
                lines.append(f"   {unwrap_duckduckgo_url(href)}")
                if index <= len(snippets):
                    lines.append(f"   {strip_tags(snippets[index - 1])}")
            if len(lines) == 1:
                return f"No results for: {query}"
            return "\n".join(lines)

    return PublicWebSearchTool()


@asynccontextmanager
async def appworld_services(
    *,
    python: Path,
    appworld_root: Path,
    app_names: list[str] | None,
    run_dir: Path,
    api_port: int | None = None,
    mcp_port: int | None = None,
) -> AsyncIterator[dict[str, str]]:
    services_dir = run_dir / "services"
    services_dir.mkdir(parents=True, exist_ok=True)
    api_port = api_port or free_port()
    mcp_port = mcp_port or free_port()
    if api_port == mcp_port:
        raise ValueError("AppWorld API and MCP ports must differ")
    api_url = f"http://127.0.0.1:{api_port}"
    mcp_url = f"http://127.0.0.1:{mcp_port}/mcp"
    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    environment = dict(os.environ)
    environment["PYTHONUTF8"] = "1"
    api_log = (services_dir / "appworld-apis.log").open("w", encoding="utf-8")
    mcp_log = (services_dir / "appworld-mcp.log").open("w", encoding="utf-8")
    api_process: subprocess.Popen[Any] | None = None
    mcp_process: subprocess.Popen[Any] | None = None
    try:
        api_process = subprocess.Popen(
            [str(python), "-m", "appworld.cli", "serve", "apis", "--root", str(appworld_root), "--port", str(api_port)],
            cwd=appworld_root,
            env=environment,
            stdout=api_log,
            stderr=subprocess.STDOUT,
            creationflags=creation_flags,
        )
        await wait_port(api_port, api_process)
        mcp_command = [
            str(python), "-m", "appworld.cli", "serve", "mcp", "http",
            "--root", str(appworld_root),
            "--remote-apis-url", api_url,
            "--port", str(mcp_port),
        ]
        if app_names:
            mcp_command.extend(["--app-names", ",".join(app_names)])
        mcp_process = subprocess.Popen(
            mcp_command,
            cwd=appworld_root,
            env=environment,
            stdout=mcp_log,
            stderr=subprocess.STDOUT,
            creationflags=creation_flags,
        )
        await wait_port(mcp_port, mcp_process)
        yield {"api_url": api_url, "mcp_url": mcp_url}
    finally:
        stop_process(mcp_process)
        stop_process(api_process)
        mcp_log.close()
        api_log.close()


class DirectAgentChannel(BaseChannel):
    """PI-Bench channel backed directly by NanoBot's in-process agent loop."""

    def __init__(self, agent: Any):
        super().__init__({"reset_timeout": 60.0})
        self.agent = agent
        self.sender_id = "unknown_user"
        self.chat_id = "unknown_task"
        self._running = False
        self._outbound_task: asyncio.Task[None] | None = None
        self._agent_tasks: set[asyncio.Task[None]] = set()

    async def connect(self) -> None:
        # AgentLoop.run() normally performs this initialization.  The native
        # channel intentionally avoids that inbound-loop wrapper, so it must
        # connect the configured MCP servers itself before accepting messages.
        await self.agent._connect_mcp()
        self._running = True
        self._outbound_task = asyncio.create_task(self._dispatch_outbound())

    async def disconnect(self) -> None:
        # A message-tool reply can reach the benchmark before the same agent
        # turn has finished its remaining actions.  Preserve those actions and
        # their traces before tearing down AppWorld/MCP.
        if self._agent_tasks:
            await asyncio.gather(*tuple(self._agent_tasks), return_exceptions=True)
        self._running = False
        if self._outbound_task is not None:
            self._outbound_task.cancel()
            try:
                await self._outbound_task
            except asyncio.CancelledError:
                pass
        await self.agent.close_mcp()

    def set_runtime_identity(self, *, sender_id: str, chat_id: str) -> None:
        self.sender_id = sender_id
        self.chat_id = chat_id

    async def send(self, message: str) -> None:
        from nanobot.bus.events import InboundMessage

        inbound = InboundMessage(
            channel="test_bench",
            sender_id=self.sender_id,
            chat_id=self.chat_id,
            content=message,
        )
        # Match the official test-server topology: injection returns
        # immediately, agent processing happens asynchronously, and outbound
        # messages are consumed by a separate dispatcher.  AgentLoop._dispatch
        # also preserves its global turn lock and publishes normal responses.
        task = asyncio.create_task(self.agent._dispatch(inbound))
        self._agent_tasks.add(task)
        task.add_done_callback(self._agent_tasks.discard)

    async def _dispatch_outbound(self) -> None:
        while self._running:
            message = await self.agent.bus.consume_outbound()
            if message.channel != "test_bench" or message.chat_id != self.chat_id:
                continue
            if message.metadata.get("_progress"):
                channels = self.agent.channels_config
                is_tool_hint = bool(message.metadata.get("_tool_hint"))
                if is_tool_hint and not getattr(channels, "send_tool_hints", False):
                    continue
                if not is_tool_hint and not getattr(channels, "send_progress", False):
                    continue
            await self._recv(message.content or "")

    def build_reset_response_policies(self):
        from src.channels.reset_policy import ExactMatchResetPolicy, RegexResetPolicy

        return [
            ExactMatchResetPolicy(target="New session started.", max_absorb=1),
            RegexResetPolicy(pattern=r"(?i)\bnew session started\b[.!]?", max_absorb=1),
        ]


async def run_task(args: argparse.Namespace) -> dict[str, Any]:
    upstream = args.upstream.resolve()
    python = args.python.resolve()
    model_key = read_key(args.model_key_file, args.model_key_index)
    user_key = read_key(args.user_key_file, args.user_key_index)
    judge_key = read_key(args.judge_key_file, args.judge_key_index)
    request_model = args.request_model or args.model
    discarded_proxy = discard_dead_loopback_proxy()
    task_path = task_yaml(upstream, args.persona, args.task_id)
    evaluator_app_names = infer_appworld_apps(task_path)
    run_id = args.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = (
        args.output.resolve()
        / "native-runs"
        / args.phase
        / args.model
        / args.persona
        / args.task_id
        / run_id
    )
    workspace = run_dir / "workspace"
    traces = run_dir / "traces"
    benchmark_output = run_dir / "benchmark-output"
    for directory in (workspace, traces, benchmark_output):
        directory.mkdir(parents=True, exist_ok=True)

    os.chdir(upstream)
    sys.path.insert(0, str(upstream))

    from nanobot.agent.hooks import JsonStorageHook, LogHook
    from nanobot.agent.loop import AgentLoop
    from nanobot.bus.queue import MessageBus
    from nanobot.config.schema import ChannelsConfig, ExecToolConfig, MCPServerConfig
    from nanobot.providers.custom_provider import CustomProvider
    from nanobot.utils.helpers import sync_workspace_templates
    from src.evaluation import TraceEvaluationRunner
    from src.llm import LLMClient
    from src.runner.runner import BenchmarkRunner
    from src.user_agent.user_agent import UserAgent
    from src.utils import configure_logging

    configure_logging(level="INFO")
    sync_workspace_templates(workspace)
    started = utc_now()
    metadata: dict[str, Any] = {
        "schemaVersion": 1,
        "startedAt": started,
        "phase": args.phase,
        "model": args.model,
        "requestedModel": request_model,
        "modelBaseUrl": args.model_base_url,
        "userSimulatorModel": args.user_model,
        "userBaseUrl": args.user_base_url,
        "judgerModel": args.judge_model,
        "judgeBaseUrl": args.judge_base_url,
        "persona": args.persona,
        "taskId": args.task_id,
        "appworldApps": evaluator_app_names,
        "appworldToolScope": "official-default-all",
        "appworldApiPort": args.appworld_api_port,
        "appworldMcpPort": args.appworld_mcp_port,
        "native": True,
        "docker": False,
        "publicSearchProvider": "DuckDuckGo HTML (unkeyed)",
        "discardedDeadLoopbackProxy": discarded_proxy,
        "runDir": str(run_dir),
    }
    atomic_json(run_dir / "run-metadata.json", metadata)

    async with appworld_services(
        python=python,
        appworld_root=upstream / "third_party" / "appworld",
        app_names=None,
        run_dir=run_dir,
        api_port=args.appworld_api_port,
        mcp_port=args.appworld_mcp_port,
    ) as services:
        mcp_servers: dict[str, MCPServerConfig] = {}
        if services:
            mcp_servers["appworld"] = MCPServerConfig(
                url=services["mcp_url"],
                headers={"Accept": "application/json"},
                trust_env=False,
                tool_timeout=90,
            )

        class RecordingCustomProvider(CustomProvider):
            def __init__(self, **kwargs: Any):
                super().__init__(**kwargs)
                self.response_models: list[str] = []

            def _parse(self, response: Any):
                response_model = (
                    response.get("model") if isinstance(response, dict)
                    else getattr(response, "model", None)
                )
                if response_model:
                    self.response_models.append(str(response_model))
                return super()._parse(response)

        provider = RecordingCustomProvider(
            api_key=model_key,
            api_base=args.model_base_url,
            default_model=request_model,
        )
        # Protocol section 8 permits the initial request plus at most two
        # retries for transient API/tool failures.
        provider._max_attempts = 3
        agent = AgentLoop(
            bus=MessageBus(),
            provider=provider,
            workspace=workspace,
            model=request_model,
            temperature=0.0,
            max_tokens=args.max_tokens,
            max_iterations=args.max_tool_iterations,
            memory_window=100,
            exec_config=ExecToolConfig(timeout=60, path_append=""),
            restrict_to_workspace=False,
            mcp_servers=mcp_servers,
            channels_config=ChannelsConfig(send_progress=False, send_tool_hints=False),
            hooks=[LogHook(level="INFO"), JsonStorageHook(storage_dir=traces)],
        )
        agent.tools.register(build_public_search_tool())
        channel = DirectAgentChannel(agent)
        user_llm = LLMClient(
            model=args.user_model,
            base_url=args.user_base_url,
            api_key=user_key,
            temperature=0.0,
            request_timeout=args.llm_timeout,
            max_concurrency=1,
            max_retries=3,
        )
        user_agent = UserAgent(
            user_root=str(upstream / "data" / args.persona),
            llm_client=user_llm,
            task_ids=[args.task_id],
            model_id=args.model,
            output_root=str(benchmark_output),
            workspace_dir=workspace,
            copy_task_assets_to_workspace=True,
            history_config_path=upstream / "config" / "bench" / "evaluation" / "trace_history.yaml",
        )
        runner = BenchmarkRunner(
            channel=channel,
            user_agent=user_agent,
            max_turns=args.max_turns,
            turn_timeout=args.turn_timeout,
        )
        async with channel:
            benchmark_result = await runner.run()

    benchmark_payload = {
        "status": benchmark_result.status,
        "tasks": [asdict(item) for item in benchmark_result.tasks],
    }
    atomic_json(run_dir / "benchmark-result.json", benchmark_payload)

    evaluation_error = None
    if not args.skip_evaluation:
        try:
            judge_llm = LLMClient(
                model=args.judge_model,
                base_url=args.judge_base_url,
                api_key=judge_key,
                temperature=0.0,
                request_timeout=args.llm_timeout,
                max_concurrency=1,
                max_retries=3,
            )
            evaluator = TraceEvaluationRunner(
                model_id=args.model,
                user_id=args.persona,
                logs_dir=traces,
                workspace_dir=workspace,
                config_path=upstream / "config" / "bench" / "evaluation" / "trace_history.yaml",
                output_dir=benchmark_output,
                scoring="both",
                llm_client=judge_llm,
                task_ids=[args.task_id],
            )
            await evaluator.run()
        except Exception as error:  # Preserve the trajectory even if scoring fails.
            evaluation_error = f"{type(error).__name__}: {error}"

    metadata.update({
        "completedAt": utc_now(),
        "modelResponseIds": sorted(set(provider.response_models)),
        "modelResponseCount": len(provider.response_models),
        "maxModelAttemptsPerCall": 3,
        "benchmark": benchmark_payload,
        "evaluationError": evaluation_error,
        "complete": benchmark_result.status == "COMPLETED" and evaluation_error is None,
    })
    atomic_json(run_dir / "run-metadata.json", metadata)
    print(json.dumps({
        "type": "native-task-run",
        "runDir": str(run_dir),
        "benchmarkStatus": benchmark_result.status,
        "taskStatuses": [item.status for item in benchmark_result.tasks],
        "evaluationError": evaluation_error,
    }, ensure_ascii=False))
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run-task",))
    parser.add_argument("--persona", required=True)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--phase", default="calibration")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--request-model", default=None)
    parser.add_argument("--user-model", default=BAILIAN_MODEL)
    parser.add_argument("--judge-model", default=BAILIAN_MODEL)
    parser.add_argument("--model-base-url", default=DEEPSEEK_BASE_URL)
    parser.add_argument("--model-key-file", type=Path, default=DEFAULT_DEEPSEEK_KEY_FILE)
    parser.add_argument("--model-key-index", type=int, default=0)
    parser.add_argument("--user-base-url", default=BAILIAN_BASE_URL)
    parser.add_argument("--user-key-file", type=Path, default=DEFAULT_KEY_FILE)
    parser.add_argument("--user-key-index", type=int, default=1)
    parser.add_argument("--judge-base-url", default=BAILIAN_BASE_URL)
    parser.add_argument("--judge-key-file", type=Path, default=DEFAULT_KEY_FILE)
    parser.add_argument("--judge-key-index", type=int, default=1)
    parser.add_argument("--upstream", type=Path, default=DEFAULT_UPSTREAM)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--python",
        type=Path,
        default=ROOT / "output" / "pi-bench-native" / ".venv" / "Scripts" / "python.exe",
    )
    parser.add_argument("--max-tokens", type=int, default=16384)
    parser.add_argument("--max-tool-iterations", type=int, default=120)
    parser.add_argument("--max-turns", type=int, default=30)
    parser.add_argument("--turn-timeout", type=float, default=900.0)
    parser.add_argument("--llm-timeout", type=float, default=360.0)
    parser.add_argument("--appworld-api-port", type=int, default=None)
    parser.add_argument("--appworld-mcp-port", type=int, default=None)
    parser.add_argument("--skip-evaluation", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.python.is_file():
        raise FileNotFoundError(args.python)
    asyncio.run(run_task(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
