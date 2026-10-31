# TABLE21 LAN host for Windows (PowerShell 5.1 or 7).
# Easiest: double-click START-LAN-WINDOWS.cmd in the project folder.
# Or:      powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-lan-windows.ps1"
# Stops at the first failing step and says what to do. No PostgreSQL install is needed.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
Write-Host "TABLE21 folder: $ProjectRoot"

function Stop-WithError([string]$Message) {
  Write-Host ""
  Write-Host "[TABLE21] $Message" -ForegroundColor Red
  exit 1
}

# Native commands do not throw on failure in Windows PowerShell 5.1, so check every exit code.
function Invoke-Step([string]$Label, [scriptblock]$Command) {
  Write-Host ""
  Write-Host "== $Label" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { Stop-WithError "$Label failed (exit code $LASTEXITCODE). See the messages above." }
}

# 1. Node.js 22.12 or newer (same requirement as package.json "engines").
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-WithError 'Node.js is not installed. Install Node.js 22 LTS (22.12 or newer) from https://nodejs.org, then run this again.' }
$ver = (& node -p "process.versions.node").Trim()
$parts = $ver.Split('.')
$major = [int]$parts[0]; $minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 12)) {
  Stop-WithError "Node.js $ver is too old. Install Node.js 22.12 or newer from https://nodejs.org."
}
Write-Host "Node.js $ver OK"

# 2. pnpm 10 (installed per user with npm if missing).
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Invoke-Step 'Installing pnpm 10' { npm install -g pnpm@10.28.0 }
  $env:Path = "$env:APPDATA\npm;$env:Path"
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Stop-WithError 'pnpm was installed but is not on PATH. Close this window, open a new PowerShell and run the script again.' }
}
Write-Host "pnpm $((& pnpm --version).Trim()) OK"

# 3. Project dependencies (exact versions from pnpm-lock.yaml).
Invoke-Step 'Installing project dependencies' { pnpm install --frozen-lockfile }

# 4. Network profile hint: on a Public network the firewall blocks phones.
try {
  $public = Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq 'Public' }
  if ($public) {
    Write-Host ""
    Write-Host 'Note: this Wi-Fi is set to Public, so phones may be blocked.' -ForegroundColor Yellow
    Write-Host 'Settings > Network & internet > Wi-Fi > your network > Network profile type: Private.' -ForegroundColor Yellow
  }
} catch {}

# 5. Build (first run) and start the LAN host. Embedded database in .data\lan, no PostgreSQL needed.
Write-Host ""
Write-Host 'When Windows asks whether Node.js may communicate on networks, allow Private networks.' -ForegroundColor Yellow
& node (Join-Path $ProjectRoot 'scripts\lan.mjs') @args
if ($LASTEXITCODE -ne 0) { Stop-WithError "The LAN host stopped with exit code $LASTEXITCODE. See the messages above." }
