# π-Bench cross-model handoff experiment

This directory is the portable execution package for
[`docs/design/pi-bench-cross-model-handoff-evaluation-v1.md`](../../docs/design/pi-bench-cross-model-handoff-evaluation-v1.md).
It supports a clean Windows device without committing credentials, provider
payloads, or AppWorld protected state.

## What is frozen in Git

- the experiment protocol, selection amendment, and runtime amendments;
- PI-Bench repository URL and commit;
- Windows CPython 3.14.3 dependency versions;
- Worket's npm lock plus required build paths;
- portable setup, offline verification, preflight, calibration, and summary entry points;
- the sanitized 2026-09-13 case-level result snapshot and complete exclusion index.

Raw upstream downloads, provider responses, AppWorld state, credentials, and
A/B/C trajectories remain below Git-ignored `output/`. AppWorld marks protected
assets as requiring encrypted form for public redistribution, so a fresh device
downloads them from the frozen upstream setup flow instead of receiving them
through this repository.

## Clean Windows device

Required versions are recorded in `reproducibility-manifest.json`:

- Windows x64;
- Git;
- CPython 3.14.3;
- Node.js 24.14.1 and npm 11.11.0;
- PowerShell 5.1 or newer.

Checkout the experiment branch, then inspect the setup plan:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  experiments\pi-bench-handoff\bootstrap.ps1 -Plan
```

Run the bootstrap once on a clean device:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  experiments\pi-bench-handoff\bootstrap.ps1
```

The script clones PI-Bench at commit
`383910b1698758a198b86037c63a111c8edc32ad`, installs Worket with `npm ci`,
builds the real Worket MCP implementation, creates the native venv, installs
the locked Python packages and three editable packages from that commit,
installs/downloads AppWorld assets, and runs the offline verifier. It makes no
model call and does not open a credential file.

If AppWorld data was restored separately and already matches version `0.2.0`,
use `-SkipAppWorldDownload`. If `node_modules` and `dist` were restored from a
trusted identical checkout, `-SkipNodeInstall` is also available; the verifier
still requires the real MCP build artifact.

## Local credential-path configuration

Copy `experiment.config.example.json` to
`experiment.config.local.json`. The latter is Git-ignored. Populate only paths
to files outside the repository and the zero-based line indexes of the keys:

```powershell
Copy-Item `
  experiments\pi-bench-handoff\experiment.config.example.json `
  experiments\pi-bench-handoff\experiment.config.local.json
```

Never put a key value in this JSON. Both Python and Node loaders reject inline
secret fields and values. `PI_BENCH_CONFIG`, `PI_BENCH_DEEPSEEK_KEY_FILE`, and
`PI_BENCH_QWEN_KEY_FILE` may be used as path-only environment overrides.

The primary Qwen bundle is the Alibaba Cloud Token Plan endpoint with request
model `qwen3.8-max`. The logical experiment label remains
`qwen3.8-max-0902`. The old DashScope URL, credential index, and dated request
model remain an explicit `dashscope-fallback`; outputs from the two cohorts must
not be silently combined.

## Offline verification

This checks the OS/toolchain, file hashes, upstream commit, all selected task
hashes, AppWorld data version, installed Python distribution versions, Worket
build, and credential-file **path existence only**. It reads no key and makes
no model call:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  experiments\pi-bench-handoff\reproduce.ps1 -Mode verify
```

The sanitized report is written to
`output/pi-bench-handoff/reproducibility-check.json`.

## Preflight on a new device

Preflight includes provider calls and the real Qwen → Worket MCP read test, so
it requires an explicit safety switch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  experiments\pi-bench-handoff\reproduce.ps1 `
  -Mode preflight -AllowModelCalls
```

This runs preregistration, the local snapshot-clone check, model text/function
checks, the real Worket MCP preflight, and the final environment gate. On the
original machine, already-passed installation and preflight steps do not need
to be rerun.

## Calibration

Review the exact resume plan without credentials or model calls:

```powershell
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\run_calibration.py --dry-run
```

Launching models always requires an explicit switch. The safe default is two
workers per model (four total); the implementation allows at most five per
model, corresponding to the recorded total-concurrency-10 diagnostic:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  experiments\pi-bench-handoff\reproduce.ps1 `
  -Mode calibration -AllowModelCalls -WorkersPerModel 2 -Limit 2
```

Use `-Model deepseek-flash` or `-Model qwen3.8-max-0902` to constrain a run.
Use `-QwenEndpoint dashscope-fallback` only when explicitly choosing the old
cohort. Completed valid samples are reused. Directories with `exclusion.json`
are never scored or copied into the safe result snapshot; retries always use a
fresh suffix and never reuse partial state.

The user paused new calibration launches on 2026-09-13. Merely checking out
this branch or running bootstrap/verify/summary cannot resume them.

## Existing results and summary

Regenerate the report from local raw outputs without launching models:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  experiments\pi-bench-handoff\reproduce.ps1 -Mode summary
```

The reviewed partial report is
[`docs/design/pi-bench-calibration-existing-results-2026-09-13.md`](../../docs/design/pi-bench-calibration-existing-results-2026-09-13.md).
The repository-safe snapshot is `calibration-existing-data-2026-09-13.json`.
It contains the frozen manifest, sanitized preflight summaries, 57 case-level
scores, the unscored attempt, and 91 excluded-run index records, but no raw
conversation, tool payload, workspace, AppWorld state, request credential, or
credential-file content.

Exact re-scoring of the old trajectories therefore requires the original
private `output/pi-bench-handoff` directory. Repeating the experiment from
scratch does not: bootstrap re-acquires frozen upstream/AppWorld inputs and new
runs create new raw trajectories locally.

To move the old raw trajectories between your own devices, create a private
bundle at an absolute destination **outside** the Git checkout:

```powershell
output\pi-bench-native\.venv\Scripts\python.exe `
  experiments\pi-bench-handoff\export_private_runs.py `
  --destination D:\private-transfer\pi-bench-runs.tar.gz `
  --acknowledge-private-sensitive-data
```

The archive includes a per-file SHA-256 manifest and never includes the
external credential files. It is not encrypted by the script: keep it on an
encrypted private drive or encrypt it before cloud transfer. Never commit it or
publish it, because it can contain provider responses, workspace contents, and
AppWorld-derived protected state.

## Reproducibility boundary

Code, inputs, package versions, task hashes, runtime parameters, requested
model IDs, and server-returned model IDs are recorded. Hosted aliases are not
immutable model-weight snapshots; a future provider may change or retire an
alias. A later repeat can therefore establish procedural reproducibility and
detect endpoint/model-ID drift, but cannot force a provider to serve the same
unpublished weights.

The full A/B/C pilot still must not start until both protocol blockers are
cleared: identical AppWorld/common-prefix state cloning and freezing/restoring
the common DeepSeek prefix into all three conditions. An offline prompt-only
rendering of a Worket package is never accepted as condition C.
