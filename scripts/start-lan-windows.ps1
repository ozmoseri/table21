# TABLE21 LAN host for Windows.
# Run from the table21 folder:
#   powershell -ExecutionPolicy Bypass -File scripts\start-lan-windows.ps1
# Phones on the same Wi-Fi then open the http://<ip>:3021 address (and QR) printed below.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is missing. Install Node.js 22 LTS from https://nodejs.org and run this again.'
  exit 1
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) {
  Write-Host "Node.js $(node -v) is too old. Install Node.js 22 LTS or newer."
  exit 1
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing pnpm 10...'
  npm install -g pnpm@10.28.0
}

# Windows must treat the Wi-Fi as a Private network, otherwise the firewall blocks phones.
$profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -ne 'Private' }
if ($profiles) {
  Write-Host 'Note: this network is not marked Private. Phones may be blocked by the firewall.'
  Write-Host 'Settings > Network & internet > Wi-Fi > (your network) > Network profile type: Private.'
}

pnpm install
Write-Host 'When Windows asks whether Node.js may communicate on networks, allow Private networks.'
pnpm lan
