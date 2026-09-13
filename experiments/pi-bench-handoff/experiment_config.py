#!/usr/bin/env python3
"""Portable, credential-safe configuration for the PI-Bench experiment.

Configuration files contain paths to credential files, never credential values.
Relative paths are resolved from the Worket repository root so a checked-out
configuration template behaves consistently on every Windows device.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_DIR = ROOT / "experiments" / "pi-bench-handoff"
DEFAULT_CONFIG_PATH = EXPERIMENT_DIR / "experiment.config.local.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "schemaVersion": 1,
    "credentials": {
        "deepseekKeyFile": None,
        "deepseekKeyIndex": 0,
        "qwenKeyFile": None,
        "qwenTokenPlanKeyIndex": 1,
        "qwenDashscopeKeyIndex": 0,
    },
    "models": {
        "deepseek": {
            "logicalModel": "deepseek-flash",
            "requestModel": "deepseek-flash",
            "baseUrl": "https://api.deepseek.com",
        },
        "qwenTokenPlan": {
            "logicalModel": "qwen3.8-max-0902",
            "requestModel": "qwen3.8-max",
            "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        },
        "qwenDashscopeFallback": {
            "logicalModel": "qwen3.8-max-0902",
            "requestModel": "qwen3.8-max-0902",
            "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
    },
    "runtime": {
        "python": "output/pi-bench-native/.venv/Scripts/python.exe",
        "upstream": "output/pi-bench-upstream",
        "output": "output/pi-bench-handoff",
        "workersPerModel": 2,
    },
}

ENV_PATH_OVERRIDES = {
    "deepseekKeyFile": "PI_BENCH_DEEPSEEK_KEY_FILE",
    "qwenKeyFile": "PI_BENCH_QWEN_KEY_FILE",
}


def _merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        else:
            base[key] = value
    return base


def _validate_no_inline_secrets(value: Any, location: str = "config") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.lower().replace("_", "").replace("-", "")
            if normalized in {"apikey", "token", "secret", "password"}:
                raise ValueError(f"INLINE_SECRET_FIELD_FORBIDDEN_{location}.{key}")
            _validate_no_inline_secrets(child, f"{location}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_no_inline_secrets(child, f"{location}[{index}]")
    elif isinstance(value, str) and value.strip().startswith("sk-"):
        raise ValueError(f"INLINE_SECRET_VALUE_FORBIDDEN_{location}")


def resolve_repo_path(value: str | Path) -> Path:
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (ROOT / path).resolve()


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    selected = path or os.environ.get("PI_BENCH_CONFIG")
    config_path = resolve_repo_path(selected) if selected else DEFAULT_CONFIG_PATH
    config = copy.deepcopy(DEFAULT_CONFIG)
    if config_path.is_file():
        overlay = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(overlay, dict):
            raise ValueError("EXPERIMENT_CONFIG_MUST_BE_AN_OBJECT")
        _validate_no_inline_secrets(overlay)
        _merge(config, overlay)
    elif selected:
        raise FileNotFoundError(config_path)

    if config.get("schemaVersion") != 1:
        raise ValueError("UNSUPPORTED_EXPERIMENT_CONFIG_SCHEMA")
    credentials = config["credentials"]
    for field, environment_name in ENV_PATH_OVERRIDES.items():
        if os.environ.get(environment_name):
            credentials[field] = os.environ[environment_name]
    config["_configPath"] = str(config_path)
    return config


def credential_path(config: dict[str, Any], provider: str, *, required: bool = True) -> Path | None:
    field = {"deepseek": "deepseekKeyFile", "qwen": "qwenKeyFile"}[provider]
    raw_path = config["credentials"].get(field)
    if not raw_path:
        if required:
            raise ValueError(f"MISSING_{field.upper()}")
        return None
    path = resolve_repo_path(raw_path)
    if required and not path.is_file():
        raise FileNotFoundError(f"CREDENTIAL_FILE_NOT_FOUND_{field}: {path}")
    return path


def runtime_path(config: dict[str, Any], field: str) -> Path:
    return resolve_repo_path(config["runtime"][field])


def model_bundle(config: dict[str, Any], provider: str, qwen_endpoint: str = "token-plan") -> dict[str, Any]:
    if provider == "deepseek":
        model = config["models"]["deepseek"]
        key_index = int(config["credentials"]["deepseekKeyIndex"])
    elif provider == "qwen":
        if qwen_endpoint == "token-plan":
            model = config["models"]["qwenTokenPlan"]
            key_index = int(config["credentials"]["qwenTokenPlanKeyIndex"])
        elif qwen_endpoint == "dashscope-fallback":
            model = config["models"]["qwenDashscopeFallback"]
            key_index = int(config["credentials"]["qwenDashscopeKeyIndex"])
        else:
            raise ValueError(f"UNKNOWN_QWEN_ENDPOINT_{qwen_endpoint}")
    else:
        raise ValueError(f"UNKNOWN_PROVIDER_{provider}")

    base_url = str(model["baseUrl"]).rstrip("/")
    if not base_url.startswith("https://"):
        raise ValueError(f"MODEL_BASE_URL_MUST_USE_HTTPS_{provider}")
    return {
        "logical_model": str(model["logicalModel"]),
        "request_model": str(model["requestModel"]),
        "base_url": base_url,
        "key_index": key_index,
    }
