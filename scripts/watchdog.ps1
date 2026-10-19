$ErrorActionPreference = 'SilentlyContinue'
$RepoRoot = 'C:\pokemon-drop-bot'
$LogDir = Join-Path $RepoRoot 'logs'
if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir 'watchdog.log'

function Write-WatchdogLog([string]$msg) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $LogFile -Value "[$ts] $msg" -Encoding UTF8
}

$dashboardOk = $false
try {
  $resp = Invoke-WebRequest -Uri 'http://localhost:3000/api/status' -UseBasicParsing -TimeoutSec 4
  if ($resp.StatusCode -eq 200) {
    $dashboardOk = $true
  }
} catch {
  $dashboardOk = $false
}

$botOnline = $false
$dashPm2Online = $false
try {
  Set-Location $RepoRoot
  $jlistRaw = & npx.cmd pm2 jlist 2>$null
  if ($jlistRaw) {
    $jsonLine = ($jlistRaw | Where-Object { $_ -match '^\[.*\]$' } | Select-Object -Last 1)
    if (-not $jsonLine) { $jsonLine = ($jlistRaw -join '') }
    $procs = $jsonLine | ConvertFrom-Json
    foreach ($p in $procs) {
      if ($p.name -eq 'pokemon-drop-bot' -and $p.pm2_env.status -eq 'online') {
        $botOnline = $true
      }
      if ($p.name -eq 'drop-bot-dashboard' -and $p.pm2_env.status -eq 'online') {
        $dashPm2Online = $true
      }
    }
  }
} catch {
  $botOnline = $false
}

if (-not $dashboardOk -or -not $botOnline -or -not $dashPm2Online) {
  Write-WatchdogLog "RECOVERY TRIGGERED (dashboardHttp200=$dashboardOk, botOnline=$botOnline, dashPm2Online=$dashPm2Online). Restarting ecosystem.config.js..."
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
  $cmd = 'cmd.exe /c "cd /d C:\pokemon-drop-bot && npx pm2 startOrRestart ecosystem.config.js && npx pm2 save"'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = $RepoRoot
    ProcessStartupInformation = $startup
  } | Out-Null
  Write-WatchdogLog "Dispatched hidden Win32_Process recovery for ecosystem.config.js."
}
