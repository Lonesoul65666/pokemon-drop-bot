$ErrorActionPreference = 'Stop'
$CliScriptPath = 'C:\pokemon-drop-bot\scripts\dropbot-cli.ps1'

$ProfilePaths = @(
  $PROFILE,
  (Join-Path $HOME 'Documents\PowerShell\Microsoft.PowerShell_profile.ps1'),
  (Join-Path $HOME 'Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1')
) | Select-Object -Unique

$FuncBlock = 'function dropbot { & "C:\pokemon-drop-bot\scripts\dropbot-cli.ps1" @args }'

foreach ($p in $ProfilePaths) {
  if ([string]::IsNullOrWhiteSpace($p)) { continue }
  $dir = Split-Path -Parent $p
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  if (-not (Test-Path $p)) {
    Set-Content -Path $p -Value "$FuncBlock`r`n" -Encoding UTF8
    Write-Host "[install-dropbot-cli] Created profile and registered 'dropbot' in: $p" -ForegroundColor Green
  } else {
    $existing = Get-Content -Path $p -Raw -Encoding UTF8
    if ($existing -notmatch 'function\s+dropbot\b') {
      Add-Content -Path $p -Value "`r`n$FuncBlock`r`n" -Encoding UTF8
      Write-Host "[install-dropbot-cli] Appended 'dropbot' function to: $p" -ForegroundColor Green
    } else {
      Write-Host "[install-dropbot-cli] 'dropbot' function already present in: $p" -ForegroundColor Cyan
    }
  }
}
