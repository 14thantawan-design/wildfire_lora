$ErrorActionPreference = 'Stop'
$taskName = 'ForestGuard-Oracle-Retry'
$runner = Join-Path $PSScriptRoot 'oracle-retry-task.ps1'
$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $windowsPowerShell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $PSScriptRoot
# A repetition with no end duration runs indefinitely. Catch up on missed runs
# once the user is logged in and the machine is awake; never queue overlaps.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(15) -RepetitionInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Retry the existing ForestGuard Oracle stack every 15 minutes using Python directly. No Codex or AI calls. Stop on success or unexpected errors.' -Force | Select-Object TaskName, State
