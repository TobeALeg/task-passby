#!/usr/bin/env python3
"""Prove one frozen workspace/AppWorld state restores identically into A/B/C."""

from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from native_harness import DEFAULT_UPSTREAM, ROOT, appworld_services, atomic_json, discard_dead_loopback_proxy


OUTPUT = ROOT / "output" / "pi-bench-handoff"


def tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


async def request(client: httpx.AsyncClient, method: str, url: str, **kwargs: Any) -> Any:
    response = await client.request(method, url, **kwargs)
    response.raise_for_status()
    return response.json()


async def verify() -> dict[str, Any]:
    discard_dead_loopback_proxy()
    run_tag = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    root = OUTPUT / "snapshot-preflight" / run_tag
    source_workspace = root / "source-workspace"
    source_workspace.mkdir(parents=True)
    (source_workspace / "brief.txt").write_text("Qingyuan Reservoir\nBudget: CNY 8,000\n", encoding="utf-8")
    (source_workspace / "evidence").mkdir()
    (source_workspace / "evidence" / "decision.json").write_text(
        '{"channel":"owned-first","approved":true}\n', encoding="utf-8"
    )
    frozen_dbs = root / "frozen-dbs"
    title = f"PI snapshot marker {run_tag}"
    note_id = None

    async with appworld_services(
        python=ROOT / "output" / "pi-bench-native" / ".venv" / "Scripts" / "python.exe",
        appworld_root=DEFAULT_UPSTREAM / "third_party" / "appworld",
        app_names=["simple_note"],
        run_dir=root / "source-services",
    ) as services:
        async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
            api = services["api_url"]
            dbs = await request(client, "GET", f"{api}/dbs")
            memory_home = next(iter(dbs.values()))
            login = await request(
                client,
                "POST",
                f"{api}/simple_note/auth/token",
                data={"username": "stmcco@gmail.com", "password": "i#vhWEQ"},
            )
            token = login["access_token"]
            created = await request(
                client,
                "POST",
                f"{api}/simple_note/notes",
                headers={"Authorization": f"Bearer {token}"},
                json={"title": title, "content": "Frozen before the A/B/C fork.", "tags": ["snapshot"]},
            )
            note_id = created["note_id"]
            await request(
                client,
                "POST",
                f"{api}/dbs/save",
                json={
                    "from_db_home_path": memory_home,
                    "to_db_home_path": str(frozen_dbs),
                    "format": "full",
                    "app_names": ["simple_note"],
                    "delete_if_exists": False,
                    "skip_mandatory_apps": False,
                    "save_model_hashes": True,
                    "vaccum": False,
                },
            )

    source_workspace_hash = tree_hash(source_workspace)
    frozen_database_hash = tree_hash(frozen_dbs)
    branches = []
    for condition in ("A", "B", "C"):
        branch_root = root / f"condition-{condition}"
        branch_workspace = branch_root / "workspace"
        branch_dbs = branch_root / "dbs"
        shutil.copytree(source_workspace, branch_workspace)
        shutil.copytree(frozen_dbs, branch_dbs)
        pre_load_database_hash = tree_hash(branch_dbs)
        async with appworld_services(
            python=ROOT / "output" / "pi-bench-native" / ".venv" / "Scripts" / "python.exe",
            appworld_root=DEFAULT_UPSTREAM / "third_party" / "appworld",
            app_names=["simple_note"],
            run_dir=branch_root / "services",
        ) as services:
            async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
                api = services["api_url"]
                await request(
                    client,
                    "POST",
                    f"{api}/dbs",
                    json={
                        "from_db_home_path": str(branch_dbs),
                        "to_db_home_path": f":memory:pi-bench-{run_tag}-{condition}",
                        "create": False,
                    },
                )
                login = await request(
                    client,
                    "POST",
                    f"{api}/simple_note/auth/token",
                    data={"username": "stmcco@gmail.com", "password": "i#vhWEQ"},
                )
                shown = await request(
                    client,
                    "GET",
                    f"{api}/simple_note/notes/{note_id}",
                    headers={"Authorization": f"Bearer {login['access_token']}"},
                )
        branches.append({
            "condition": condition,
            "workspaceHash": tree_hash(branch_workspace),
            "preLoadDatabaseHash": pre_load_database_hash,
            "postLoadDatabaseHash": tree_hash(branch_dbs),
            "noteId": shown["note_id"],
            "noteTitle": shown["title"],
            "noteContent": shown["content"],
        })

    passed = all(
        branch["workspaceHash"] == source_workspace_hash
        and branch["preLoadDatabaseHash"] == frozen_database_hash
        and branch["noteId"] == note_id
        and branch["noteTitle"] == title
        and branch["noteContent"] == "Frozen before the A/B/C fork."
        for branch in branches
    ) and len({branch["postLoadDatabaseHash"] for branch in branches}) == 1
    result = {
        "schemaVersion": 1,
        "type": "snapshot-preflight",
        "pass": passed,
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "sourceWorkspaceHash": source_workspace_hash,
        "frozenDatabaseHash": frozen_database_hash,
        "noteId": note_id,
        "branches": branches,
        "runRoot": str(root),
    }
    atomic_json(OUTPUT / "snapshot-preflight.json", result)
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    outcome = asyncio.run(verify())
    raise SystemExit(0 if outcome["pass"] else 1)
