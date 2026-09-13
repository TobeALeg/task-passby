[CmdletBinding()]
param(
    [string]$PythonExe,
    [switch]$Plan,
    [switch]$SkipNodeInstall,
    [switch]$SkipAppWorldDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExperimentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ExperimentDir "..\..")).Path
$Upstream = Join-Path $RepoRoot "output\pi-bench-upstream"
$Venv = Join-Path $RepoRoot "output\pi-bench-native\.venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$Requirements = Join-Path $ExperimentDir "requirements-win-py314.lock.txt"
$Verifier = Join-Path $ExperimentDir "verify_reproducibility.py"
$UpstreamUrl = "https://github.com/Simplified-Reasoning/Pi-Bench"
$UpstreamCommit = "383910b1698758a198b86037c63a111c8edc32ad"
$ExpectedPython = "3.14.3"
$ExpectedNode = "v24.14.1"
$ExpectedNpm = "11.11.0"

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )
    if ($Plan) {
        $rendered = @($FilePath) + ($Arguments | ForEach-Object {
            if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
        })
        Write-Host ("[plan] " + ($rendered -join " "))
        return
    }
    Push-Location $WorkingDirectory
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

function Resolve-PythonExecutable {
    if ($PythonExe) {
        if (Test-Path -LiteralPath $PythonExe -PathType Leaf) {
            return (Resolve-Path -LiteralPath $PythonExe).Path
        }
        $command = Get-Command $PythonExe -ErrorAction Stop
        return $command.Source
    }
    $py = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($py) {
        $candidate = & $py.Source -3.14 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $candidate) {
            return [string]$candidate
        }
    }
    $python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }
    throw "CPython $ExpectedPython was not found. Install it or pass -PythonExe."
}

if ($env:OS -ne "Windows_NT") {
    throw "This lock and bootstrap are frozen for Windows x64."
}

$ResolvedPython = Resolve-PythonExecutable
$ActualPython = & $ResolvedPython -c "import platform; print(platform.python_version())"
if ($LASTEXITCODE -ne 0 -or $ActualPython -ne $ExpectedPython) {
    throw "Expected CPython $ExpectedPython, found $ActualPython at $ResolvedPython."
}

$ActualNode = & node --version
$ActualNpm = & npm --version
if ($ActualNode -ne $ExpectedNode -or $ActualNpm -ne $ExpectedNpm) {
    throw "Expected Node $ExpectedNode and npm $ExpectedNpm; found Node $ActualNode and npm $ActualNpm."
}

if (-not (Test-Path -LiteralPath (Join-Path $Upstream ".git"))) {
    if (Test-Path -LiteralPath $Upstream) {
        throw "Upstream path exists but is not a Git checkout: $Upstream"
    }
    $outputRoot = Split-Path -Parent $Upstream
    if (-not $Plan) {
        New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    }
    Invoke-External "git" @("clone", $UpstreamUrl, $Upstream) $RepoRoot
    Invoke-External "git" @("checkout", "--detach", $UpstreamCommit) $Upstream
}
else {
    $ActualCommit = & git -C $Upstream rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $ActualCommit -ne $UpstreamCommit) {
        throw "Existing upstream checkout is not at frozen commit $UpstreamCommit. Use an empty output/pi-bench-upstream path."
    }
    Write-Host "[ok] frozen upstream checkout already present"
}

if (-not $SkipNodeInstall) {
    Invoke-External "npm" @("ci") $RepoRoot
    Invoke-External "npm" @("run", "build") $RepoRoot
}

if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    if (-not $Plan) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Venv) -Force | Out-Null
    }
    Invoke-External $ResolvedPython @("-m", "venv", $Venv) $RepoRoot
}
else {
    $VenvVersion = & $VenvPython -c "import platform; print(platform.python_version())"
    if ($LASTEXITCODE -ne 0 -or $VenvVersion -ne $ExpectedPython) {
        throw "Existing virtual environment uses Python $VenvVersion, expected $ExpectedPython."
    }
    Write-Host "[ok] frozen Python virtual environment already present"
}

Invoke-External $VenvPython @("-m", "pip", "install", "pip==25.3") $RepoRoot
Invoke-External $VenvPython @("-m", "pip", "install", "--requirement", $Requirements) $RepoRoot
Invoke-External $VenvPython @("-m", "pip", "install", "--no-deps", "--editable", $Upstream) $RepoRoot
Invoke-External $VenvPython @("-m", "pip", "install", "--no-deps", "--editable", (Join-Path $Upstream "third_party\nanobot")) $RepoRoot
Invoke-External $VenvPython @("-m", "pip", "install", "--no-deps", "--editable", (Join-Path $Upstream "third_party\appworld")) $RepoRoot

if (-not $SkipAppWorldDownload) {
    $AppWorldRoot = Join-Path $Upstream "third_party\appworld"
    Invoke-External $VenvPython @("-m", "appworld.cli", "install", "--repo") $AppWorldRoot
    Invoke-External $VenvPython @("-m", "appworld.cli", "download", "data", "--root", ".") $AppWorldRoot
}

Invoke-External $VenvPython @($Verifier, "--write-report") $RepoRoot
Write-Host "PI-Bench bootstrap complete. No credential file was opened and no model call was made."
