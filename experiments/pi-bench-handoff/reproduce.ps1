[CmdletBinding()]
param(
    [ValidateSet("verify", "preflight", "calibration", "summary")]
    [string]$Mode = "verify",
    [string]$Config = "experiments/pi-bench-handoff/experiment.config.local.json",
    [ValidateSet("token-plan", "dashscope-fallback")]
    [string]$QwenEndpoint = "token-plan",
    [string[]]$Model,
    [int]$Limit = 0,
    [int]$WorkersPerModel = 0,
    [switch]$Bootstrap,
    [switch]$AllowModelCalls
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExperimentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ExperimentDir "..\..")).Path
$Python = Join-Path $RepoRoot "output\pi-bench-native\.venv\Scripts\python.exe"
$ResolvedConfig = if ([System.IO.Path]::IsPathRooted($Config)) { $Config } else { Join-Path $RepoRoot $Config }

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    Push-Location $RepoRoot
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
        }
    }
    finally {
        Pop-Location
    }
}

if ($Bootstrap) {
    Invoke-Checked "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $ExperimentDir "bootstrap.ps1"))
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Native Python runtime is missing. Run with -Bootstrap first."
}

switch ($Mode) {
    "verify" {
        $arguments = @((Join-Path $ExperimentDir "verify_reproducibility.py"), "--write-report")
        if (Test-Path -LiteralPath $ResolvedConfig -PathType Leaf) {
            $arguments += @("--config", $ResolvedConfig, "--check-credentials")
        }
        Invoke-Checked $Python $arguments
    }
    "preflight" {
        if (-not $AllowModelCalls) {
            throw "Preflight calls configured model APIs. Re-run with -AllowModelCalls."
        }
        if (-not (Test-Path -LiteralPath $ResolvedConfig -PathType Leaf)) {
            throw "Create the ignored local config first: $ResolvedConfig"
        }
        Invoke-Checked "node" @((Join-Path $ExperimentDir "run.mjs"), "preregister", "--config", $ResolvedConfig)
        Invoke-Checked $Python @((Join-Path $ExperimentDir "snapshot_preflight.py"))
        Invoke-Checked "node" @((Join-Path $ExperimentDir "run.mjs"), "model-preflight", "--config", $ResolvedConfig)
        Invoke-Checked $Python @((Join-Path $ExperimentDir "worket_mcp_preflight.py"), "--config", $ResolvedConfig, "--qwen-endpoint", $QwenEndpoint)
        Invoke-Checked "node" @((Join-Path $ExperimentDir "run.mjs"), "environment-preflight", "--config", $ResolvedConfig)
    }
    "calibration" {
        if (-not $AllowModelCalls) {
            throw "Calibration calls configured model APIs. Re-run with -AllowModelCalls."
        }
        if (-not (Test-Path -LiteralPath $ResolvedConfig -PathType Leaf)) {
            throw "Create the ignored local config first: $ResolvedConfig"
        }
        $arguments = @(
            (Join-Path $ExperimentDir "run_calibration.py"),
            "--config", $ResolvedConfig,
            "--qwen-endpoint", $QwenEndpoint,
            "--allow-model-calls",
            "--limit", [string]$Limit
        )
        if ($WorkersPerModel -gt 0) {
            $arguments += @("--workers-per-model", [string]$WorkersPerModel)
        }
        foreach ($item in $Model) {
            $arguments += @("--model", $item)
        }
        Invoke-Checked $Python $arguments
    }
    "summary" {
        Invoke-Checked $Python @((Join-Path $ExperimentDir "summarize_calibration.py"))
    }
}
