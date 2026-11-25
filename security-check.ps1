# IMS security check (23 Nov 2026, SEC-09). Run from the repo root in PowerShell:  .\security-check.ps1
# Runs the backend tests, checks the locked Python packages and the frontend packages for known vulnerabilities,
# and builds the frontend. Stops at the first failure.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

Write-Host "1/4 Backend tests" -ForegroundColor Cyan
Push-Location (Join-Path $root "backend")
& $py -m pytest -q
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Backend tests failed" }

Write-Host "2/4 Python packages (pip-audit on requirements.lock)" -ForegroundColor Cyan
& $py -m pip install --quiet pip-audit
& $py -m pip_audit -r requirements.lock --require-hashes --progress-spinner off
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "pip-audit found a problem" }
Pop-Location

Push-Location (Join-Path $root "frontend")
Write-Host "3/4 Frontend packages (npm audit) and tests" -ForegroundColor Cyan
npm audit --omit=dev
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm audit found a problem" }
npm test
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Frontend tests failed" }

Write-Host "4/4 Frontend build" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Frontend build failed" }
Pop-Location

Write-Host "All security checks passed." -ForegroundColor Green
