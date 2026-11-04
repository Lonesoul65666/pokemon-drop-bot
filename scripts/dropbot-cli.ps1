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

$Reason = ($ReasonArgs -join ' ').Trim()

function Clean-StaleTmpFiles {
  Get-ChildItem -Path $RepoRoot -Filter '*.tmp*' -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Invoke-DropBotNext {
  $prompt = 'Read all 6 files in C:\pokemon-drop-bot\_nyx_state\ (01 through 06) to load full project context, Frozen Files, and the Failure Graveyard. Summarize current build state and wait for instructions.'
  Write-Host "`n================================================================================" -ForegroundColor Cyan
  Write-Host " COPY & PASTE THIS STARTUP PROMPT INTO ANY NEW CLI SESSION:" -ForegroundColor Yellow
  Write-Host "================================================================================" -ForegroundColor Cyan
  Write-Host $prompt -ForegroundColor Green
  Write-Host "================================================================================`n" -ForegroundColor Cyan
  try {
    Set-Clipboard -Value $prompt
    Write-Host "[dropbot next] Startup prompt also copied directly to your Windows Clipboard!" -ForegroundColor DarkGray
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
    $prevHash = (git rev-parse --short HEAD 2>$null).Trim()

    if (Test-Path $State03Path) {
      $c03 = Get-Content -Path $State03Path -Raw -Encoding UTF8
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Last Checkpoint Timestamp:\*\* .*$', "- **Last Checkpoint Timestamp:** ``$ts``")
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Parent Baseline Commit:\*\* .*$', "- **Parent Baseline Commit:** ``$prevHash`` (``$SaveReason``)")
      Set-Content -Path $State03Path -Value $c03 -Encoding UTF8 -NoNewline
    }

    if (Test-Path $State05Path) {
      $entry = "- ``$ts`` | **SAVE** (from ``$prevHash``) | $SaveReason`r`n"
      Add-Content -Path $State05Path -Value $entry -Encoding UTF8
    }

    git add -A
    $status = (git status --porcelain)
    if ([string]::IsNullOrWhiteSpace($status)) {
      Write-Host "[dropbot save] Working tree clean — pushing latest main to origin..." -ForegroundColor Yellow
      git push origin main
      return
    }

    $commitMsg = "checkpoint(dropbot): $SaveReason"
    git commit -m $commitMsg
    $newHash = (git rev-parse --short HEAD).Trim()
    git push origin main
    Write-Host "[dropbot save] Committed ($newHash) & pushed to origin/main: $commitMsg" -ForegroundColor Green
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
    $badHash = (git rev-parse --short HEAD).Trim()
    $goodHash = (git rev-parse --short HEAD~1).Trim()

    # Preserve current Failure Graveyard file content before hard reset
    $graveyardContent = ''
    if (Test-Path $State02Path) {
      $graveyardContent = Get-Content -Path $State02Path -Raw -Encoding UTF8
    }
    $chatContent = ''
    if (Test-Path $State05Path) {
      $chatContent = Get-Content -Path $State05Path -Raw -Encoding UTF8
    }

    Write-Host "[dropbot undo] Reverting from $badHash back to $goodHash..." -ForegroundColor Yellow
    git reset --hard HEAD~1

    if (-not (Test-Path $NyxStateDir)) {
      New-Item -ItemType Directory -Path $NyxStateDir -Force | Out-Null
    }

    $graveyardLine = "- **`[FAILED & REVERTED - $ts ($badHash -> $goodHash)`]:** $UndoReason"
    if (-not [string]::IsNullOrWhiteSpace($graveyardContent)) {
      if ($graveyardContent -match '<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->') {
        $graveyardContent = $graveyardContent.Replace('<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->', "$graveyardLine`r`n<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->")
      } else {
        $graveyardContent = $graveyardContent.TrimEnd() + "`r`n$graveyardLine`r`n"
      }
      Set-Content -Path $State02Path -Value $graveyardContent -Encoding UTF8 -NoNewline
    }

    if (-not [string]::IsNullOrWhiteSpace($chatContent)) {
      $chatContent = $chatContent.TrimEnd() + "`r`n- ``$ts CST`` | **UNDO / REVERT** (``$badHash -> $goodHash``) | $UndoReason`r`n"
      Set-Content -Path $State05Path -Value $chatContent -Encoding UTF8 -NoNewline
    }

    if (Test-Path $State03Path) {
      $c03 = Get-Content -Path $State03Path -Raw -Encoding UTF8
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Last Checkpoint Timestamp:\*\* .*$', "- **Last Checkpoint Timestamp:** ``$ts CST (REVERTED $badHash -> $goodHash)``")
      $c03 = [regex]::Replace($c03, '(?m)^- \*\*Parent Baseline Commit:\*\* .*$', "- **Parent Baseline Commit:** ``$goodHash`` (Reverted ``$badHash``: ``$UndoReason``)")
      Set-Content -Path $State03Path -Value $c03 -Encoding UTF8 -NoNewline
    }

    git add $NyxStateDir
    git commit -m "revert(dropbot-undo): reverted $badHash -> $goodHash ($UndoReason)"
    git push origin main --force-with-lease
    Write-Host "[dropbot undo] Reverted to $goodHash and permanently logged failure in 02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md!" -ForegroundColor Green
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

  # 1. Run dropbot save first so _nyx_state and GitHub are 100% synced
  Invoke-DropBotSave -SaveReason $BackupReason

  # 2. Build fast zip archive excluding node_modules, .git, and .tmp files
  $stamp = (Get-Date).ToString('yyyyMMdd_HHmm')
  $zipPath = Join-Path $BackupDir "DropBot_Backup_$stamp.zip"
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
      $rel -notmatch '^(node_modules|\.git|\.pm2|dist)[\\/]' -and
      $_.Name -notmatch '\.tmp(\.|$)' -and
      $_.Name -notmatch '\.log$'
    }

    foreach ($file in $files) {
      $relPath = $file.FullName.Substring($RepoRoot.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relPath, [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null
    }

    # Embed a backup manifest note inside the zip
    $commitHash = (git -C $RepoRoot rev-parse --short HEAD 2>$null).Trim()
    $manifestEntry = $zip.CreateEntry('_BACKUP_MANIFEST.txt')
    $writer = New-Object System.IO.StreamWriter($manifestEntry.Open())
    try {
      $writer.WriteLine("DropBot Portable Backup Archive")
      $writer.WriteLine("Timestamp : $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss CST'))")
      $writer.WriteLine("Commit    : $commitHash")
      $writer.WriteLine("Reason    : $BackupReason")
    } finally {
      $writer.Dispose()
    }
  } finally {
    $zip.Dispose()
  }
  $sw.Stop()
  $sizeMb = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
  Write-Host "[dropbot backup] Created $zipPath ($sizeMb MB in $($sw.ElapsedMilliseconds)ms) & synced GitHub!" -ForegroundColor Green
}

switch ($Command.ToLower()) {
  'save'   { Invoke-DropBotSave -SaveReason $Reason }
  'undo'   { Invoke-DropBotUndo -UndoReason $Reason }
  'backup' { Invoke-DropBotBackup -BackupReason $Reason }
  'next'   { Invoke-DropBotNext }
  default  {
    Write-Host "Unknown dropbot command: '$Command'. Available commands: save, undo, backup, next" -ForegroundColor Red
    Invoke-DropBotNext
  }
}
