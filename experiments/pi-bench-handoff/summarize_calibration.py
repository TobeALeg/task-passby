#!/usr/bin/env python3
"""Summarize the currently available PI-Bench calibration runs without rerunning them."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import fmean
from typing import Any

import run_calibration as calibration


OUTPUT = calibration.OUTPUT / "calibration-summary-existing.json"
TRACKED_OUTPUT = (
    calibration.ROOT
    / "experiments"
    / "pi-bench-handoff"
    / "calibration-existing-data-2026-09-13.json"
)


def rounded_mean(values: list[float]) -> float | None:
    return round(fmean(values), 6) if values else None


def result_and_metadata(job: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    for run_dir in calibration.run_directories(
        job["model"], job["persona"], job["taskId"], job["repeat"]
    ):
        result = calibration.result_for(run_dir)
        if result is not None:
            metadata = json.loads((run_dir / "run-metadata.json").read_text(encoding="utf-8"))
            return result, metadata
    return None


def summarize_model(records: list[dict[str, Any]]) -> dict[str, Any]:
    comp = [record["comp"] for record in records if record["compAvailable"]]
    proc = [record["proc"] for record in records if record["proc"] is not None]
    endpoint_cohorts: Counter[str] = Counter()
    request_model_cohorts: Counter[str] = Counter()
    response_ids: Counter[str] = Counter()
    for record in records:
        endpoint_cohorts[record["modelBaseUrl"]] += 1
        request_model_cohorts[record["requestedModel"]] += 1
        response_ids.update(record["modelResponseIds"])
    return {
        "scoredRuns": len(records),
        "compRuns": len(comp),
        "meanComp": rounded_mean(comp),
        "procRuns": len(proc),
        "meanProc": rounded_mean(proc),
        "statusCounts": dict(sorted(Counter(record["status"] for record in records).items())),
        "endpointCohorts": dict(sorted(endpoint_cohorts.items())),
        "requestModelCohorts": dict(sorted(request_model_cohorts.items())),
        "serverResponseIdCounts": dict(sorted(response_ids.items())),
    }


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sanitized_preflight_records() -> dict[str, Any]:
    environment = load_json(calibration.OUTPUT / "environment-preflight.json")
    model = load_json(calibration.OUTPUT / "model-preflight.json")
    snapshot = load_json(calibration.OUTPUT / "snapshot-preflight.json")
    worket = load_json(calibration.OUTPUT / "worket-mcp-preflight" / "result.json")

    call_fields = (
        "requestedModel",
        "responseModel",
        "finishReason",
        "textMatches",
        "contentCharacters",
        "toolCalled",
        "reasoningCharacters",
        "usage",
        "latencyMs",
    )
    model_records = []
    for record in model.get("records", []):
        model_records.append({
            "role": record.get("role"),
            "provider": record.get("provider"),
            "baseUrl": record.get("baseUrl"),
            "requestedModel": record.get("requestedModel"),
            "note": record.get("note"),
            "text": {field: (record.get("text") or {}).get(field) for field in call_fields},
            "tool": {field: (record.get("tool") or {}).get(field) for field in call_fields},
            "pass": record.get("pass"),
        })

    return {
        "environment": {
            field: environment.get(field)
            for field in (
                "schemaVersion",
                "completedAt",
                "upstreamPresent",
                "upstreamCommit",
                "imports",
                "appWorldSourcePresent",
                "appWorldBaseDbPresent",
                "appWorldDataVersion",
                "nativeHarnessPresent",
                "dockerRequired",
                "worketMcpImplementationPresent",
                "qwenCanReachRealWorketMcp",
                "commonPrefixSnapshotValidated",
                "nativePiBenchReady",
                "pass",
                "blockingReasons",
            )
        },
        "model": {
            "schemaVersion": model.get("schemaVersion"),
            "completedAt": model.get("completedAt"),
            "endpoints": model.get("endpoints"),
            "records": model_records,
            "pass": model.get("pass"),
            "complete": model.get("complete"),
        },
        "snapshot": {
            "schemaVersion": snapshot.get("schemaVersion"),
            "type": snapshot.get("type"),
            "pass": snapshot.get("pass"),
            "completedAt": snapshot.get("completedAt"),
            "sourceWorkspaceHash": snapshot.get("sourceWorkspaceHash"),
            "frozenDatabaseHash": snapshot.get("frozenDatabaseHash"),
            "noteId": snapshot.get("noteId"),
            "branches": [
                {
                    field: branch.get(field)
                    for field in (
                        "condition",
                        "workspaceHash",
                        "preLoadDatabaseHash",
                        "postLoadDatabaseHash",
                        "noteId",
                    )
                }
                for branch in snapshot.get("branches", [])
            ],
        },
        "worketMcp": {
            field: worket.get(field)
            for field in (
                "type",
                "pass",
                "model",
                "registeredTools",
                "toolCallCounts",
                "auditedReads",
                "packageReadAt",
                "handoffPackageCount",
                "discardedDeadLoopbackProxy",
            )
        },
    }


def main() -> int:
    jobs = calibration.planned_jobs(set(calibration.MODELS))
    records: list[dict[str, Any]] = []
    job_lookup = {
        (job["model"], job["persona"], job["taskId"], job["repeat"]): job
        for job in jobs
    }
    for job in jobs:
        found = result_and_metadata(job)
        if found is None:
            continue
        result, metadata = found
        records.append({
            "model": job["model"],
            "persona": job["persona"],
            "taskId": job["taskId"],
            "repeat": job["repeat"],
            "runId": Path(result["runDir"]).name,
            "status": result["status"],
            "turns": result["turns"],
            "comp": result["comp"],
            "compAvailable": result["compAvailable"],
            "proc": result["proc"],
            "modelResponseCount": result["modelResponseCount"],
            "modelBaseUrl": metadata.get("modelBaseUrl"),
            "requestedModel": metadata.get("requestedModel", metadata.get("model")),
            "modelResponseIds": result["modelResponseIds"],
        })

    by_model = {
        model: [record for record in records if record["model"] == model]
        for model in calibration.MODELS
    }
    keyed = {
        (record["model"], record["persona"], record["taskId"], record["repeat"]): record
        for record in records
    }
    model_names = list(calibration.MODELS)
    source_model, target_model = model_names[0], model_names[1]
    paired: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for job in jobs:
        if job["model"] != source_model:
            continue
        key = (job["persona"], job["taskId"], job["repeat"])
        source = keyed.get((source_model, *key))
        target = keyed.get((target_model, *key))
        if source and target:
            paired.append((source, target))

    comp_pairs = [(source, target) for source, target in paired if source["compAvailable"] and target["compAvailable"]]
    proc_pairs = [(source, target) for source, target in paired if source["proc"] is not None and target["proc"] is not None]
    source_comp = [source["comp"] for source, _ in comp_pairs]
    target_comp = [target["comp"] for _, target in comp_pairs]
    source_proc = [source["proc"] for source, _ in proc_pairs]
    target_proc = [target["proc"] for _, target in proc_pairs]

    persona_comp: dict[str, Any] = {}
    for persona in sorted({source["persona"] for source, _ in comp_pairs}):
        subset = [(source, target) for source, target in comp_pairs if source["persona"] == persona]
        source_values = [source["comp"] for source, _ in subset]
        target_values = [target["comp"] for _, target in subset]
        source_mean = rounded_mean(source_values)
        target_mean = rounded_mean(target_values)
        persona_comp[persona] = {
            "pairedRuns": len(subset),
            "sourceMean": source_mean,
            "targetMean": target_mean,
            "absoluteGapPp": round(abs(source_mean - target_mean) * 100, 3),
        }

    task_groups: dict[tuple[str, str], dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for record in records:
        task_groups[(record["persona"], record["taskId"])][record["model"]].append(record)
    task_blocks = []
    for (persona, task_id), groups in sorted(task_groups.items()):
        source_records = groups[source_model]
        target_records = groups[target_model]
        complete_block = len(source_records) == 3 and len(target_records) == 3
        task_blocks.append({
            "persona": persona,
            "taskId": task_id,
            "sourceRuns": len(source_records),
            "targetRuns": len(target_records),
            "completePairedBlock": complete_block,
            "sourceMeanComp": rounded_mean([record["comp"] for record in source_records if record["compAvailable"]]),
            "targetMeanComp": rounded_mean([record["comp"] for record in target_records if record["compAvailable"]]),
            "sourceMeanProc": rounded_mean([record["proc"] for record in source_records if record["proc"] is not None]),
            "targetMeanProc": rounded_mean([record["proc"] for record in target_records if record["proc"] is not None]),
        })

    unscored_attempts = []
    seen_dirs: set[Path] = set()
    for job in jobs:
        for run_dir in calibration.run_directories(
            job["model"], job["persona"], job["taskId"], job["repeat"]
        ):
            if run_dir in seen_dirs or not run_dir.exists() or (run_dir / "exclusion.json").exists():
                continue
            seen_dirs.add(run_dir)
            if calibration.result_for(run_dir) is not None:
                continue
            metadata_path = run_dir / "run-metadata.json"
            if not metadata_path.is_file():
                continue
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            benchmark_tasks = (metadata.get("benchmark") or {}).get("tasks") or []
            task_result = benchmark_tasks[0] if benchmark_tasks else {}
            error = metadata.get("evaluationError")
            key = (metadata.get("model"), metadata.get("persona"), metadata.get("taskId"), job_lookup.get((job["model"], job["persona"], job["taskId"], job["repeat"]), job).get("repeat"))
            unscored_attempts.append({
                "model": key[0],
                "persona": key[1],
                "taskId": key[2],
                "repeat": key[3],
                "requestedModel": metadata.get("requestedModel", metadata.get("model")),
                "modelBaseUrl": metadata.get("modelBaseUrl"),
                "taskStatus": task_result.get("status"),
                "turns": task_result.get("turns"),
                "modelResponseCount": metadata.get("modelResponseCount"),
                "serverResponseIds": metadata.get("modelResponseIds", []),
                "evaluationErrorType": str(error).split(":", 1)[0] if error else None,
                "scoreFileCount": len(list(run_dir.glob("benchmark-output/*/*/*/eval/results/*_result.json"))),
            })

    excluded_runs = []
    native_runs = calibration.OUTPUT / "native-runs"
    if native_runs.is_dir():
        for sidecar in sorted(native_runs.rglob("exclusion.json")):
            exclusion = json.loads(sidecar.read_text(encoding="utf-8"))
            excluded_runs.append({
                "runDir": sidecar.parent.relative_to(calibration.OUTPUT).as_posix(),
                "excludedAt": exclusion.get("excludedAt"),
                "reason": exclusion.get("reason"),
            })

    source_comp_mean = rounded_mean(source_comp)
    target_comp_mean = rounded_mean(target_comp)
    source_proc_mean = rounded_mean(source_proc)
    target_proc_mean = rounded_mean(target_proc)
    comp_gap = round(abs(source_comp_mean - target_comp_mean) * 100, 3) if source_comp_mean is not None and target_comp_mean is not None else None
    proc_gap = round(abs(source_proc_mean - target_proc_mean) * 100, 3) if source_proc_mean is not None and target_proc_mean is not None else None
    complete_blocks = sum(block["completePairedBlock"] for block in task_blocks)

    summary = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "existing-results-only-user-requested-pause",
        "plannedRuns": len(jobs),
        "scoredRuns": len(records),
        "missingScoredRuns": len(jobs) - len(records),
        "caseRecords": records,
        "models": {model: summarize_model(model_records) for model, model_records in by_model.items()},
        "pairedComparison": {
            "pairedRuns": len(paired),
            "pairedCompRuns": len(comp_pairs),
            "sourceMeanComp": source_comp_mean,
            "targetMeanComp": target_comp_mean,
            "absoluteCompGapPp": comp_gap,
            "observedCompThresholdMet": comp_gap is not None and comp_gap <= 5,
            "pairedProcRuns": len(proc_pairs),
            "sourceMeanProc": source_proc_mean,
            "targetMeanProc": target_proc_mean,
            "absoluteProcGapPp": proc_gap,
            "observedProcThresholdMet": proc_gap is not None and proc_gap <= 7,
            "personaComp": persona_comp,
            "observedPersonaCompThresholdMet": bool(persona_comp) and all(
                values["absoluteGapPp"] <= 10 for values in persona_comp.values()
            ),
            "completePairedTaskBlocks": complete_blocks,
            "plannedTaskBlocks": 12,
            "toolEnvironmentFailureGapPp": None,
            "stableDominanceAssessment": None,
        },
        "taskBlocks": task_blocks,
        "unscoredNonExcludedAttempts": unscored_attempts,
        "excludedRunCount": len(excluded_runs),
        "excludedRuns": excluded_runs,
        "frozenManifest": json.loads(calibration.MANIFEST.read_text(encoding="utf-8")),
        "preflightRecords": sanitized_preflight_records(),
        "entryGateDecision": "INCONCLUSIVE_PARTIAL_CALIBRATION",
        "entryGateReasons": [
            "Qwen has fewer than 36 scored runs, so the preregistered 72-run calibration is incomplete.",
            "Only complete paired subsets are compared; missingness is not assumed random.",
            "The Token Plan exposes qwen3.8-max rather than the frozen qwen3.8-max-0902 identifier.",
            "The first correctly authenticated Token Plan task timed out without a score file.",
            "Tool/environment failure-rate parity and stable dominance cannot be closed from the partial data.",
        ],
    }
    calibration.atomic_json(OUTPUT, summary)
    calibration.atomic_json(TRACKED_OUTPUT, summary)
    print(json.dumps({
        "type": "calibration-summary",
        "output": str(OUTPUT),
        "trackedOutput": str(TRACKED_OUTPUT),
        "scoredRuns": summary["scoredRuns"],
        "missingScoredRuns": summary["missingScoredRuns"],
        "entryGateDecision": summary["entryGateDecision"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
