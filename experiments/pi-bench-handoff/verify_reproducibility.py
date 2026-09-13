#!/usr/bin/env python3
"""Verify the local PI-Bench runtime without reading credentials or calling models."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from experiment_config import ROOT, credential_path, load_config, runtime_path


EXPERIMENT_DIR = ROOT / "experiments" / "pi-bench-handoff"
REPRO_MANIFEST = EXPERIMENT_DIR / "reproducibility-manifest.json"
SELECTION = EXPERIMENT_DIR / "calibration-selection-amendment.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_output(arguments: list[str], cwd: Path = ROOT) -> str | None:
    try:
        result = subprocess.run(
            arguments,
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or result.stderr.strip()


def normalized_distribution(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def locked_distributions(path: Path) -> dict[str, str]:
    locked: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "==" not in line:
            raise ValueError(f"UNPINNED_REQUIREMENT_{line}")
        name, version = line.split("==", 1)
        locked[normalized_distribution(name)] = version
    return locked


def add_check(checks: list[dict[str, Any]], name: str, passed: bool, detail: Any = None) -> None:
    record: dict[str, Any] = {"name": name, "pass": bool(passed)}
    if detail is not None:
        record["detail"] = detail
    checks.append(record)


def verify(args: argparse.Namespace) -> dict[str, Any]:
    manifest = json.loads(REPRO_MANIFEST.read_text(encoding="utf-8"))
    config = load_config(args.config)
    upstream = runtime_path(config, "upstream")
    lock_path = EXPERIMENT_DIR / "requirements-win-py314.lock.txt"
    checks: list[dict[str, Any]] = []

    add_check(checks, "windows-platform", sys.platform == "win32", platform.platform())
    actual_python = platform.python_version()
    add_check(checks, "python-version", actual_python == manifest["platform"]["python"], actual_python)

    node_version = command_output(["node", "--version"])
    npm_command = "npm.cmd" if sys.platform == "win32" else "npm"
    npm_version = command_output([npm_command, "--version"])
    add_check(checks, "node-version", node_version == f"v{manifest['platform']['node']}", node_version)
    add_check(checks, "npm-version", npm_version == manifest["platform"]["npm"], npm_version)

    for relative, expected in manifest["files"].items():
        path = ROOT / relative
        actual = sha256_file(path) if path.is_file() else None
        add_check(checks, f"file-hash:{relative}", actual == expected, actual)

    actual_commit = command_output(["git", "rev-parse", "HEAD"], upstream) if upstream.is_dir() else None
    add_check(checks, "upstream-commit", actual_commit == manifest["upstream"]["commit"], actual_commit)

    version_path = upstream / "third_party" / "appworld" / "data" / "version.txt"
    appworld_version = version_path.read_text(encoding="utf-8").strip() if version_path.is_file() else None
    add_check(
        checks,
        "appworld-data-version",
        appworld_version == manifest["upstream"]["appWorldDataVersion"],
        appworld_version,
    )
    add_check(
        checks,
        "appworld-base-databases",
        (upstream / "third_party" / "appworld" / "data" / "base_dbs" / "api_docs.db").is_file(),
    )

    selection = json.loads(SELECTION.read_text(encoding="utf-8"))
    task_mismatches = []
    for task in selection["tasks"]:
        task_path = upstream / "data" / task["persona"] / "tasks" / task["taskId"] / "task.yaml"
        actual = sha256_file(task_path) if task_path.is_file() else None
        if actual != task["sha256"]:
            task_mismatches.append(task["taskId"])
    add_check(checks, "calibration-task-hashes", not task_mismatches, task_mismatches)

    locked = locked_distributions(lock_path)
    package_mismatches = []
    for name, expected in sorted(locked.items()):
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            actual = None
        if actual != expected:
            package_mismatches.append({"package": name, "expected": expected, "actual": actual})
    for name, expected in manifest["localEditablePackages"].items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            actual = None
        if actual != expected:
            package_mismatches.append({"package": name, "expected": expected, "actual": actual})
    add_check(checks, "python-distributions", not package_mismatches, package_mismatches)

    add_check(checks, "worket-build", (ROOT / "dist" / "bridge" / "mcp-handler.js").is_file())
    configured = {}
    for provider in ("deepseek", "qwen"):
        path = credential_path(config, provider, required=False)
        configured[provider] = bool(path and path.is_file())
    add_check(
        checks,
        "credential-file-paths",
        all(configured.values()) if args.check_credentials else True,
        configured,
    )

    result = {
        "schemaVersion": 1,
        "type": "pi-bench-reproducibility-check",
        "pass": all(item["pass"] for item in checks),
        "credentialsRead": False,
        "modelCallsMade": False,
        "checks": checks,
    }
    if args.write_report:
        report_path = runtime_path(config, "output") / "reproducibility-check.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = report_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(report_path)
    print(json.dumps(result, ensure_ascii=False))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--check-credentials", action="store_true", help="Check path existence only; never read key files.")
    parser.add_argument("--write-report", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(0 if verify(parse_args())["pass"] else 1)
