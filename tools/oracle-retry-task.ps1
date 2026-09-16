param([switch]$TestNotification)
$ErrorActionPreference = 'Stop'
$taskName = 'ForestGuard-Oracle-Retry'
$retryDir = Join-Path $env:USERPROFILE '.oci\forestguard-retry'
$pythonPath = Join-Path $env:USERPROFILE '.oci\forestguard-venv\Scripts\python.exe'
$scriptPath = Join-Path $PSScriptRoot 'oracle_retry.py'

function Show-ForestGuardNotification([string]$message) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $escaped = [System.Security.SecurityElement]::Escape($message)
        $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>ForestGuard Oracle</text><text>$escaped</text></binding></visual></toast>")
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $toast.Tag = 'ForestGuardOracle'
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell')
        $notifier.Show($toast)
        return 'toast-requested'
    } catch {
        # Local visible fallback, only for completion/error/setup notification.
        $shell = New-Object -ComObject WScript.Shell
        $null = $shell.Popup($message, 15, 'ForestGuard Oracle', 64)
        return 'popup-requested'
    }
}

if ($TestNotification) {
    Show-ForestGuardNotification 'Automatic retry is ready. Windows will check every 30 minutes. Codex is not required.'
    exit 0
}

$result = $null
try {
    $raw = & $pythonPath $scriptPath --run
    $pythonExit = $LASTEXITCODE
    $result = ($raw -join "`n") | ConvertFrom-Json
    if (-not $result.status -or ($pythonExit -ne 0 -and $result.status -ne 'ERROR')) {
        throw 'Invalid script output'
    }
} catch {
    $result = [pscustomobject]@{status = 'ERROR'; reason = 'Local retry script could not finish. Review before resuming.'}
}

$record = [ordered]@{
    time = (Get-Date).ToString('o')
    status = $result.status
    details = $result
}
$continuing = @('IN_PROGRESS', 'COOLDOWN', 'SUBMITTED', 'TRANSIENT_ERROR')
if ($result.status -notin $continuing) {
    try {
        Disable-ScheduledTask -TaskName $taskName -ErrorAction Stop | Out-Null
        $record.taskDisabled = $true
    } catch {
        $record.taskDisabled = $false
    }
    $message = if ($result.status -eq 'SUCCEEDED') {
        'Oracle apply succeeded. Automatic retry has stopped. Open Oracle Compute > Instances to view forest-server.'
    } else {
        "Automatic retry stopped: $($result.status). Open the status file or return to your ForestGuard chat for help."
    }
    # Persist the result even if notification delivery fails.
    $message | Set-Content -LiteralPath (Join-Path $retryDir 'notice.txt') -Encoding UTF8
    try { $record.notification = Show-ForestGuardNotification $message }
    catch { $record.notification = 'unavailable-see-notice.txt' }
}
$json = $record | ConvertTo-Json -Depth 6
$json | Set-Content -LiteralPath (Join-Path $retryDir 'last-check.json') -Encoding UTF8
$historyPath = Join-Path $retryDir 'history.jsonl'
if ((Test-Path -LiteralPath $historyPath) -and (Get-Item -LiteralPath $historyPath).Length -gt 2MB) {
    Move-Item -LiteralPath $historyPath -Destination (Join-Path $retryDir 'history.previous.jsonl') -Force
}
($record | ConvertTo-Json -Depth 6 -Compress) | Add-Content -LiteralPath $historyPath -Encoding UTF8
Write-Output $json
