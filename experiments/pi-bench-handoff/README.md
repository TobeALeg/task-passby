# π-Bench cross-model handoff experiment

This directory contains the executable pre-registration and preflight for
[`docs/design/pi-bench-cross-model-handoff-evaluation-v1.md`](../../docs/design/pi-bench-cross-model-handoff-evaluation-v1.md).

Raw upstream data, provider responses, credentials, AppWorld state, and later
A/B/C trajectories stay under Git-ignored `output/`. The runner never writes
the API key to a report.

The upstream repository is expected at `output/pi-bench-upstream` and is frozen
by commit in the generated manifest.

```powershell
node experiments/pi-bench-handoff/run.mjs preregister
node experiments/pi-bench-handoff/run.mjs environment-preflight
node experiments/pi-bench-handoff/run.mjs model-preflight
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\worket_mcp_preflight.py
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\snapshot_preflight.py
```

The default Model Studio credential document is
`C:\Users\Dandi\Desktop\aliapikey.txt`. The harness extracts standalone key
lines without writing them to output. As of 2026-09-13, credential slot 1 and
the Token Plan endpoint are primary; slot 0, the DashScope endpoint, and
`qwen3.8-max-0902` are retained as explicit fallback settings.

The frozen upstream revision has no eligible `hard` calibration task after the
formal 11 chains and their dependencies are excluded. The manifest records the
pre-output amendment: retain four tasks per persona and maximize text, file,
web, and application-tool coverage without borrowing formal targets.

Docker is not required for this experiment. The native harness keeps the
frozen PI-Bench user simulator, runner, trace evaluator, NanoBot loop,
AppWorld APIs/MCP, task data, and workspace semantics, while replacing only
container orchestration:

```powershell
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\native_harness.py run-task `
  --persona Financier --task-id Financier_task_002 `
  --model deepseek-flash
```

The source model reads `C:\Users\Dandi\Desktop\dskey.txt` and connects to
the official DeepSeek API. User simulation and native judging read
`C:\Users\Dandi\Desktop\aliapikey.txt` and use Token Plan-hosted Qwen. The
logical experiment label and the actual provider request model are recorded
separately because Token Plan exposes `qwen3.8-max`, while the frozen DashScope
cohort used `qwen3.8-max-0902`. Keys are never written to reports.

Capability calibration is resumable. The following command runs every missing
DeepSeek/Qwen task/repeat after applying the protocol's three-attempt ceiling;
use `--limit N` for a bounded batch:

```powershell
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\run_calibration.py --limit 2
```

Progress is written to `output/pi-bench-handoff/calibration-progress.json`.
Protocol-invalid engineering runs are retained with `exclusion.json` sidecars;
the reasons and fixes are listed in `runtime-amendments.json`.

The user paused new calibration runs on 2026-09-13. Regenerate the existing-data
summary without launching models with:

```powershell
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\summarize_calibration.py
```

The machine-readable result is written to
`output/pi-bench-handoff/calibration-summary-existing.json`; the reviewed
partial-calibration report is
`docs/design/pi-bench-calibration-existing-results-2026-09-13.md`.
The same command also regenerates the repository-safe snapshot
`experiments/pi-bench-handoff/calibration-existing-data-2026-09-13.json`, which
contains the frozen manifest, sanitized preflight summaries, case-level metrics,
the unscored attempt, and the complete exclusion index without raw conversations,
tool payloads, workspaces, AppWorld state, or credentials.

If the Token Plan endpoint is unavailable and the user authorizes resuming with
the old frozen cohort, select the retained bundle explicitly:

```powershell
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\run_calibration.py `
  --qwen-endpoint dashscope-fallback
```

The full pilot must not start until the remaining environment blockers are cleared:

- AppWorld state can be cloned with identical hashes;
- the common DeepSeek prefix can be frozen once and restored into A/B/C.

Qwen's real Worket MCP preflight is recorded at
`output/pi-bench-handoff/worket-mcp-preflight/result.json`. It must show all
three Worket reads in the Qwen trace and corresponding Worket audit events.

An offline prompt-only rendering of a Worket package is not accepted as C.
