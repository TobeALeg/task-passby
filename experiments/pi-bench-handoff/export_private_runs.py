#!/usr/bin/env python3
"""Create a private raw-run transfer bundle outside the Git checkout.

The archive is intentionally not committed. It can contain provider responses,
workspaces, and AppWorld-derived state. Store it only on private/encrypted media.
Credential files are outside the source tree and are never included.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from experiment_config import ROOT, load_config, runtime_path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_value(*arguments: str) -> str | None:
    result = subprocess.run(
        ["git", *arguments], cwd=ROOT, check=False, capture_output=True, text=True
    )
    return result.stdout.strip() if result.returncode == 0 else None


def export(args: argparse.Namespace) -> dict[str, Any]:
    if not args.acknowledge_private_sensitive_data:
        raise ValueError("--acknowledge-private-sensitive-data is required")
    config = load_config(args.config)
    source = runtime_path(config, "output")
    if not source.is_dir():
        raise FileNotFoundError(source)

    destination = args.destination.expanduser().resolve()
    try:
        destination.relative_to(ROOT)
    except ValueError:
        pass
    else:
        raise ValueError("PRIVATE_BUNDLE_DESTINATION_MUST_BE_OUTSIDE_GIT_CHECKOUT")
    if destination.suffixes[-2:] != [".tar", ".gz"]:
        raise ValueError("PRIVATE_BUNDLE_MUST_END_IN_.tar.gz")
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    files = sorted(path for path in source.rglob("*") if path.is_file())
    records = []
    for path in files:
        relative = path.relative_to(source).as_posix()
        records.append({"path": relative, "size": path.stat().st_size, "sha256": sha256_file(path)})
    manifest = {
        "schemaVersion": 1,
        "type": "pi-bench-private-run-bundle",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "worketBranch": git_value("branch", "--show-current"),
        "worketCommit": git_value("rev-parse", "HEAD"),
        "source": "output/pi-bench-handoff",
        "credentialFilesIncluded": False,
        "publicRedistributionAllowed": False,
        "files": records,
    }

    with tarfile.open(destination, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        info = tarfile.TarInfo("pi-bench-handoff/private-bundle-manifest.json")
        info.size = len(manifest_bytes)
        info.mtime = int(datetime.now(timezone.utc).timestamp())
        archive.addfile(info, io.BytesIO(manifest_bytes))
        for path in files:
            relative = path.relative_to(source).as_posix()
            archive.add(path, arcname=f"pi-bench-handoff/{relative}", recursive=False)

    result = {
        "type": "pi-bench-private-run-export",
        "archive": str(destination),
        "files": len(files),
        "sha256": sha256_file(destination),
        "credentialFilesIncluded": False,
        "modelCallsMade": False,
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--acknowledge-private-sensitive-data", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    export(parse_args())
