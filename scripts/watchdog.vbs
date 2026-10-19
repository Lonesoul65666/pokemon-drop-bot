' Silent PM2 & Port 3000 Watchdog Wrapper (Zero Console Window Flash)
Option Explicit
Dim objShell
Set objShell = CreateObject("WScript.Shell")
objShell.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\pokemon-drop-bot\scripts\watchdog.ps1""", 0, False
Set objShell = Nothing
