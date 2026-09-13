#!/usr/bin/env python3
"""Resumable native PI-Bench capability-calibration driver."""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import hashlib
import json
import socket
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from native_harness import (
    BAILIAN_BASE_URL,
    BAILIAN_FALLBACK_BASE_URL,
    BAILIAN_FALLBACK_MODEL,
    BAILIAN_MODEL,
    DEEPSEEK_BASE_URL,
    ROOT,
    atomic_json,
)


MANIFEST = ROOT / "output" / "pi-bench-handoff" / "manifest.json"
SELECTION_AMENDMENT = ROOT / "experiments" / "pi-bench-handoff" / "calibration-selection-amendment.json"
OUTPUT = ROOT / "output" / "pi-bench-handoff"
HARNESS = ROOT / "experiments" / "pi-bench-handoff" / "native_harness.py"
MODELS = {
    "deepseek-flash": {
        "slug": "deepseek",
        "base_url": DEEPSEEK_BASE_URL,
        "key_file": Path(r"C:\Users\Dandi\Desktop\dskey.txt"),
    },
    "qwen3.8-max-0902": {
        "slug": "qwen-max",
        "base_url": BAILIAN_BASE_URL,
        "key_file": Path(r"C:\Users\Dandi\Desktop\aliapikey.txt"),
        "key_index": 1,
        "request_model": BAILIAN_MODEL,
        "fallback_base_url": BAILIAN_FALLBACK_BASE_URL,
        "fallback_key_index": 0,
        "fallback_request_model": BAILIAN_FALLBACK_MODEL,
    },
}
_PORT_LOCK = threading.Lock()
_CLAIMED_PORTS: set[int] = set()


@contextlib.contextmanager
def prevent_system_sleep():
    """Keep Windows awake for this process's lifetime without changing its power plan."""
    if sys.platform != "win32":
        yield
        return

    es_continuous = 0x80000000
    es_system_required = 0x00000001
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    set_execution_state = kernel32.SetThreadExecutionState
    set_execution_state.argtypes = [ctypes.c_uint]
    set_execution_state.restype = ctypes.c_uint
    if not set_execution_state(es_continuous | es_system_required):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        if not set_execution_state(es_continuous):
            raise ctypes.WinError(ctypes.get_last_error())


def claim_batch_unique_port() -> int:
    with _PORT_LOCK:
        for _ in range(100):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(("127.0.0.1", 0))
                port = int(sock.getsockname()[1])
            if port not in _CLAIMED_PORTS:
                _CLAIMED_PORTS.add(port)
                return port
    raise RuntimeError("could not allocate a batch-unique local port")


def result_for(run_dir: Path) -> dict[str, Any] | None:
    metadata_path = run_dir / "run-metadata.json"
    if not metadata_path.is_file() or (run_dir / "exclusion.json").exists():
        return None
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if not metadata.get("complete"):
        return None
    score_files = sorted(run_dir.glob("benchmark-output/*/*/*/eval/results/*_result.json"))
    if not score_files:
        return None
    score = json.loads(score_files[-1].read_text(encoding="utf-8"))
    task_score = score.get("task") or {}
    checklist = task_score.get("checklist")
    proactiveness = task_score.get("proactiveness")
    if task_score.get("task_id") != metadata.get("taskId") or not isinstance(proactiveness, dict):
        return None
    task = metadata["benchmark"]["tasks"][0]
    if not metadata.get("modelResponseCount"):
        return None
    return {
        "status": task["status"],
        "turns": task["turns"],
        "comp": checklist.get("average_score") if isinstance(checklist, dict) else None,
        "proc": proactiveness.get("average_score"),
        "compAvailable": isinstance(checklist, dict),
        "scoreFile": str(score_files[-1]),
        "modelResponseIds": metadata.get("modelResponseIds", []),
        "modelResponseCount": metadata.get("modelResponseCount"),
        "runDir": str(run_dir),
    }


def run_id(model: str, repeat: int) -> str:
    return f"{MODELS[model]['slug']}-cal-valid-v2-r{repeat}"


def run_directory(model: str, persona: str, task_id: str, repeat: int) -> Path:
    return OUTPUT / "native-runs" / "calibration" / model / persona / task_id / run_id(model, repeat)


def run_directories(model: str, persona: str, task_id: str, repeat: int) -> list[Path]:
    primary = run_directory(model, persona, task_id, repeat)
    retries = sorted(primary.parent.glob(f"{primary.name}-retry*")) if primary.parent.is_dir() else []
    return [primary, *retries]


def result_for_job(job: dict[str, Any]) -> dict[str, Any] | None:
    for path in run_directories(job["model"], job["persona"], job["taskId"], job["repeat"]):
        result = result_for(path)
        if result is not None:
            return result
    return None


def next_run_directory(job: dict[str, Any]) -> Path:
    primary = run_directory(job["model"], job["persona"], job["taskId"], job["repeat"])
    if not primary.exists():
        return primary
    retry = 1
    while True:
        candidate = primary.with_name(f"{primary.name}-retry{retry}")
        if not candidate.exists():
            return candidate
        retry += 1


def planned_jobs(selected_models: set[str]) -> list[dict[str, Any]]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    calibration = manifest["calibration"]
    if SELECTION_AMENDMENT.is_file():
        calibration = json.loads(SELECTION_AMENDMENT.read_text(encoding="utf-8"))["tasks"]
    jobs = []
    for task in calibration:
        task_path = ROOT / "output" / "pi-bench-upstream" / "data" / task["persona"] / "tasks" / task["taskId"] / "task.yaml"
        actual_hash = hashlib.sha256(task_path.read_bytes()).hexdigest()
        if task.get("sha256") != actual_hash:
            raise RuntimeError(f"CALIBRATION_HASH_MISMATCH_{task['taskId']}")
        for repeat in (1, 2, 3):
            order = ["deepseek-flash", "qwen3.8-max-0902"]
            if repeat == 2:
                order.reverse()
            for model in order:
                if model in selected_models:
                    jobs.append({**task, "repeat": repeat, "model": model})
    return jobs


def write_progress(jobs: list[dict[str, Any]], failures: list[dict[str, Any]]) -> dict[str, Any]:
    records = []
    for job in jobs:
        result = result_for_job(job)
        records.append({**job, "complete": result is not None, "result": result})
    payload = {
        "schemaVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "planned": len(records),
        "complete": sum(record["complete"] for record in records),
        "failures": failures,
        "records": records,
    }
    atomic_json(OUTPUT / "calibration-progress.json", payload)
    return payload


def execute_job(job: dict[str, Any]) -> dict[str, Any] | None:
    destination = next_run_directory(job)
    destination.mkdir(parents=True, exist_ok=False)
    model = MODELS[job["model"]]
    api_port = claim_batch_unique_port()
    mcp_port = claim_batch_unique_port()
    command = [
        sys.executable,
        str(HARNESS),
        "run-task",
        "--persona", job["persona"],
        "--task-id", job["taskId"],
        "--model", job["model"],
        "--request-model", model.get("request_model", job["model"]),
        "--model-base-url", model["base_url"],
        "--model-key-file", str(model["key_file"]),
        "--model-key-index", str(model.get("key_index", 0)),
        "--phase", "calibration",
        "--run-id", destination.name,
        "--appworld-api-port", str(api_port),
        "--appworld-mcp-port", str(mcp_port),
    ]
    with (destination / "driver.log").open("w", encoding="utf-8") as log:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
    if completed.returncode == 0:
        return None
    return {**job, "returnCode": completed.returncode, "runDir": str(destination)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="Maximum new runs; 0 means all remaining.")
    parser.add_argument("--model", action="append", choices=sorted(MODELS), dest="models")
    parser.add_argument(
        "--qwen-endpoint",
        choices=("token-plan", "dashscope-fallback"),
        default="token-plan",
        help="Qwen endpoint/credential/model bundle; Token Plan is primary.",
    )
    parser.add_argument(
        "--workers-per-model",
        type=int,
        default=1,
        help="Concurrent isolated runs per model (1-8). Separate model pools run in parallel.",
    )
    args = parser.parse_args()
    if not 1 <= args.workers_per_model <= 8:
        parser.error("--workers-per-model must be between 1 and 8")
    if args.qwen_endpoint == "dashscope-fallback":
        qwen = MODELS["qwen3.8-max-0902"]
        qwen["base_url"] = qwen["fallback_base_url"]
        qwen["key_index"] = qwen["fallback_key_index"]
        qwen["request_model"] = qwen["fallback_request_model"]
    with prevent_system_sleep():
        selected_models = set(args.models or MODELS)
        jobs = planned_jobs(selected_models)
        failures: list[dict[str, Any]] = []
        write_progress(jobs, failures)

        pending = [job for job in jobs if result_for_job(job) is None]
        if args.limit:
            pending = pending[:args.limit]
        launched = len(pending)
        executors = {
            model: ThreadPoolExecutor(max_workers=args.workers_per_model, thread_name_prefix=MODELS[model]["slug"])
            for model in selected_models
        }
        try:
            futures = {
                executors[job["model"]].submit(execute_job, job): job
                for job in pending
            }
            for future in as_completed(futures):
                job = futures[future]
                try:
                    failure = future.result()
                except Exception as error:
                    failure = {**job, "driverError": f"{type(error).__name__}: {error}"}
                if failure is not None:
                    failures.append(failure)
                write_progress(jobs, failures)
        finally:
            for executor in executors.values():
                executor.shutdown(wait=True, cancel_futures=False)

        progress = write_progress(jobs, failures)
        print(json.dumps({
            "type": "calibration-driver",
            "launched": launched,
            "planned": progress["planned"],
            "complete": progress["complete"],
            "failures": len(failures),
            "workersPerModel": args.workers_per_model,
            "progress": str(OUTPUT / "calibration-progress.json"),
        }, ensure_ascii=False))
        return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
