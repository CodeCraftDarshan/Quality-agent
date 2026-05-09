$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Virtual environment not found at '$python'. Create it first, then install backend requirements."
}

Push-Location $repoRoot
try {
    & $python -m uvicorn backend.main:app `
        --reload `
        --reload-dir backend `
        --reload-exclude .venv `
        --reload-exclude logs `
        --reload-exclude frontend `
        --host 127.0.0.1 `
        --port 8000
}
finally {
    Pop-Location
}
