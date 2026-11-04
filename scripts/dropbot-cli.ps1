param(
  [Parameter(Position = 0)]
  [string]$Command = 'next',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$ReasonArgs
)

$ErrorActionPreference = 'Stop'
$RepoRoot = 'C:\pokemon-drop-bot'
$NyxStateDir = Join-Path $RepoRoot '_nyx_state'
$State02Path = Join-Path $NyxStateDir '02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md'
$State03Path = Join-Path $NyxStateDir '03_CURRENT_BUILD_STATE.md'
$State05Path = Join-Path $NyxStateDir '05_LAST_3_TURNS_AND_CHAT.md'
$BackupDir   = 'C:\DropBot_Backups'
$bt          = [char]96

$Reason = ($ReasonArgs -join ' ').Trim()

function Clean-StaleTmpFiles {
  Get-ChildItem -Path $RepoRoot -Filter '*.tmp*' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Invoke-DropBotNext {
  $prompt = 'Read all 6 files in C:\pokemon-drop-bot\_nyx_state\ (01 through 06) to load full project context, Frozen Files, and the Failure Graveyard. Summarize current build state and wait for instructions.'
  Write-Host ''
  Write-Host '================================================================================' -ForegroundColor Cyan
  Write-Host ' COPY & PASTE THIS STARTUP PROMPT INTO ANY NEW CLI SESSION:' -ForegroundColor Yellow
  Write-Host '================================================================================' -ForegroundColor Cyan
  Write-Host $prompt -ForegroundColor Green
  Write-Host '================================================================================' -ForegroundColor Cyan
  Write-Host ''
  try {
    Set-Clipboard -Value $prompt
    Write-Host '[dropbot next] Startup prompt also copied directly to your Windows Clipboard!' -ForegroundColor DarkGray
  } catch {}
}

function Invoke-DropBotSave([string]$SaveReason) {
  if ([string]::IsNullOrWhiteSpace($SaveReason)) {
    $SaveReason = 'Manual dropbot save checkpoint'
  }
  Push-Location $RepoRoot
  try {
    Clean-StaleTmpFiles
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm CST')
    $prevHash = (& git rev-parse --short HEAD 2>$null).Trim()

    if (Test-Path $State03Path) {
      $c03 = Get-Content -Path $State03Path -Raw -Encoding UTF8
      $repTs = '- **Last Checkpoint Timestamp:** {0}{1}{0}' -f $bt, $ts
      $repCommit = '- **Parent Baseline Commit:** {0}{1}{0} ({0}{2}{0})' -f $bt, $prevHash, $SaveReason
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Last Checkpoint Timestamp:\*\* .*$', $repTs)
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Parent Baseline Commit:\*\* .*$', $repCommit)
      Set-Content -Path $State03Path -Value $c03 -Encoding UTF8 -NoNewline
    }

    if (Test-Path $State05Path) {
      $entry = ("- {0}{1}{0} | **SAVE** (from {0}{2}{0}) | {3}`r`n" -f $bt, $ts, $prevHash, $SaveReason)
      Add-Content -Path $State05Path -Value $entry -Encoding UTF8 -NoNewline
    }

    & git add -A
    $status = (& git status --porcelain)
    if ([string]::IsNullOrWhiteSpace($status)) {
      Write-Host '[dropbot save] Working tree clean - pushing latest main to origin...' -ForegroundColor Yellow
      & git push origin main
      return
    }

    $commitMsg = 'checkpoint(dropbot): ' + $SaveReason
    & git commit -m $commitMsg
    $newHash = (& git rev-parse --short HEAD).Trim()
    & git push origin main
    Write-Host ('[dropbot save] Committed ({0}) and pushed to origin/main: {1}' -f $newHash, $commitMsg) -ForegroundColor Green
  } finally {
    Pop-Location
  }
}

function Invoke-DropBotUndo([string]$UndoReason) {
  if ([string]::IsNullOrWhiteSpace($UndoReason)) {
    throw 'Usage: dropbot undo "reason why the last change failed"'
  }
  Push-Location $RepoRoot
  try {
    Clean-StaleTmpFiles
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm')
    $badHash = (& git rev-parse --short HEAD).Trim()
    $goodHash = (& git rev-parse --short HEAD~1).Trim()

    $graveyardContent = ''
    if (Test-Path $State02Path) {
      $graveyardContent = Get-Content -Path $State02Path -Raw -Encoding UTF8
    }
    $chatContent = ''
    if (Test-Path $State05Path) {
      $chatContent = Get-Content -Path $State05Path -Raw -Encoding UTF8
    }

    Write-Host ('[dropbot undo] Reverting from {0} back to {1}...' -f $badHash, $goodHash) -ForegroundColor Yellow
    & git reset --hard HEAD~1

    if (-not (Test-Path $NyxStateDir)) {
      New-Item -ItemType Directory -Path $NyxStateDir -Force | Out-Null
    }

    $graveyardLine = ('- **{0}[FAILED & REVERTED - {1} ({2} -> {3})]{0}:** {4}' -f $bt, $ts, $badHash, $goodHash, $UndoReason)
    if (-not [string]::IsNullOrWhiteSpace($graveyardContent)) {
      if ($graveyardContent -match '<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->') {
        $graveyardContent = $graveyardContent.Replace('<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->', ($graveyardLine + "`r`n<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->"))
      } else {
        $graveyardContent = $graveyardContent.TrimEnd() + "`r`n" + $graveyardLine + "`r`n"
      }
      Set-Content -Path $State02Path -Value $graveyardContent -Encoding UTF8 -NoNewline
    }

    if (-not [string]::IsNullOrWhiteSpace($chatContent)) {
      $undoEntry = ('- {0}{1} CST{0} | **UNDO / REVERT** ({0}{2} -> {3}{0}) | {4}' -f $bt, $ts, $badHash, $goodHash, $UndoReason)
      $chatContent = $chatContent.TrimEnd() + "`r`n" + $undoEntry + "`r`n"
      Set-Content -Path $State05Path -Value $chatContent -Encoding UTF8 -NoNewline
    }

    if (Test-Path $State03Path) {
      $c03 = Get-Content -Path $State03Path -Raw -Encoding UTF8
      $repTs = '- **Last Checkpoint Timestamp:** {0}{1} CST (REVERTED {2} -> {3}){0}' -f $bt, $ts, $badHash, $goodHash
      $repCommit = '- **Parent Baseline Commit:** {0}{1}{0} (Reverted {0}{2}{0}: {0}{3}{0})' -f $bt, $goodHash, $badHash, $UndoReason
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Last Checkpoint Timestamp:\*\* .*$', $repTs)
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Parent Baseline Commit:\*\* .*$', $repCommit)
      Set-Content -Path $State03Path -Value $c03 -Encoding UTF8 -NoNewline
    }

    & git add $NyxStateDir
    $revertMsg = ('revert(dropbot-undo): reverted {0} -> {1} ({2})' -f $badHash, $goodHash, $UndoReason)
    & git commit -m $revertMsg
    & git push origin main --force-with-lease
    Write-Host ('[dropbot undo] Reverted to {0} and permanently logged failure in 02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md!' -f $goodHash) -ForegroundColor Green
  } finally {
    Pop-Location
  }
}

function Invoke-DropBotBackup([string]$BackupReason) {
  if ([string]::IsNullOrWhiteSpace($BackupReason)) {
    $BackupReason = 'Portable DropBot snapshot backup'
  }
  if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  }

  Invoke-DropBotSave -SaveReason $BackupReason

  $stamp = (Get-Date).ToString('yyyyMMdd_HHmm')
  $zipPath = Join-Path $BackupDir ('DropBot_Backup_' + $stamp + '.zip')
  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = Get-ChildItem -Path $RepoRoot -Recurse -File -Force | Where-Object {
      $rel = $_.FullName.Substring($RepoRoot.Length + 1)
      ($rel -notmatch '^(node_modules|\.git|\.pm2|dist)[\\/]') -and
      ($_.Name -notmatch '\.tmp(\.|$)') -and
      ($_.Name -notmatch '\.log$')
    }

    foreach ($file in $files) {
      $relPath = $file.FullName.Substring($RepoRoot.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null
    }

    $commitHash = (& git -C $RepoRoot rev-parse --short HEAD 2>$null).Trim()
    $manifestEntry = $zip.CreateEntry('_BACKUP_MANIFEST.txt')
    $writer = New-Object System.IO.StreamWriter($manifestEntry.Open())
    try {
      $writer.WriteLine('DropBot Portable Backup Archive')
      $writer.WriteLine(('Timestamp : {0}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss CST')))
      $writer.WriteLine(('Commit    : {0}' -f $commitHash))
      $writer.WriteLine(('Reason    : {0}' -f $BackupReason))
    } finally {
      $writer.Dispose()
    }
  } finally {
    $zip.Dispose()
  }
  $sw.Stop()
  $sizeMb = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
  Write-Host ('[dropbot backup] Created {0} ({1} MB in {2}ms) and synced GitHub!' -f $zipPath, $sizeMb, $sw.ElapsedMilliseconds) -ForegroundColor Green
}

switch ($Command.ToLower()) {
  'save'   { Invoke-DropBotSave -SaveReason $Reason }
  'undo'   { Invoke-DropBotUndo -UndoReason $Reason }
  'backup' { Invoke-DropBotBackup -BackupReason $Reason }
  'next'   { Invoke-DropBotNext }
  default  {
    Write-Host ('Unknown dropbot command: {0}. Available commands: save, undo, backup, next' -f $Command) -ForegroundColor Red
    Invoke-DropBotNext
  }
}
