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

# 1. Verify Port 3000 Dashboard HTTP 200
$dashboardOk = $false
try {
  $resp = Invoke-WebRequest -Uri 'http://localhost:3000/api/status' -UseBasicParsing -TimeoutSec 5
  if ($resp.StatusCode -eq 200) {
    $dashboardOk = $true
  }
} catch {
  $dashboardOk = $false
}

# 2. Verify pokemon-drop-bot (index.js) and drop-bot-dashboard (server.js) via WMI Win32_Process (no brittle npx.cmd stdout parsing)
$botOnline = $false
$dashPm2Online = $false
try {
  $nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
  foreach ($p in $nodeProcs) {
    $cmdLine = [string]$p.CommandLine
    if ($cmdLine -match 'pokemon-drop-bot[\\/]+index\.js' -or ($cmdLine -match 'ProcessContainerFork\.js' -and $cmdLine -match 'index\.js')) {
      $botOnline = $true
    }
    if ($cmdLine -match 'pokemon-drop-bot[\\/]+server\.js' -or ($cmdLine -match 'ProcessContainerFork\.js' -and $cmdLine -match 'server\.js')) {
      $dashPm2Online = $true
    }
  }
  # Fallback check: if storeHealth.json was updated in the last 5 minutes, pokemon-drop-bot is actively sweeping
  if (-not $botOnline) {
    $healthPath = Join-Path $RepoRoot 'storeHealth.json'
    if (Test-Path $healthPath) {
      $ageMinutes = ((Get-Date) - (Get-Item $healthPath).LastWriteTime).TotalMinutes
      if ($ageMinutes -le 5 -and $nodeProcs.Count -ge 2) {
        $botOnline = $true
      }
    }
  }
  if ($dashboardOk) {
    $dashPm2Online = $true
  }
} catch {}

if (-not $dashboardOk -or -not $botOnline -or -not $dashPm2Online) {
  Write-WatchdogLog "RECOVERY TRIGGERED (dashboardHttp200=$dashboardOk, botOnline=$botOnline, dashPm2Online=$dashPm2Online). Resurrecting ecosystem.config.js..."
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
  $cmd = 'cmd.exe /c "cd /d C:\pokemon-drop-bot && npx pm2 startOrRestart ecosystem.config.js && npx pm2 save"'
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = $RepoRoot
    ProcessStartupInformation = $startup
  } | Out-Null
  Write-WatchdogLog "Dispatched hidden Win32_Process recovery for ecosystem.config.js."
}
