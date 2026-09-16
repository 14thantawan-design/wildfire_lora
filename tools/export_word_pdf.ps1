[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

# File-format conversion through Word's document API, without UI input.
# The caller supplies a private temporary copy, never the original thesis.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$wordApp = $null
$wordDoc = $null
$wordDocuments = $null
$wordOptions = $null
$originalSecurity = $null
$originalUpdateLinks = $null

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
if ($resolvedInput -eq $resolvedOutput) { throw 'Input and output must be different.' }
if (Test-Path -LiteralPath $resolvedOutput) { throw 'Refusing to overwrite an existing PDF.' }
if ([IO.Path]::GetExtension($resolvedInput) -ne '.docx') { throw 'Only DOCX input is supported.' }
if ([IO.Path]::GetExtension($resolvedOutput) -ne '.pdf') { throw 'Output must be PDF.' }

# Do not attach to, change options in, or close a Word session owned by the user.
if (Get-Process -Name WINWORD -ErrorAction SilentlyContinue) {
    throw 'Word is already running. Save and close it before using this isolated renderer.'
}

try {
    Write-Output 'Starting a private, hidden Microsoft Word conversion session.'
    $wordApp = New-Object -ComObject Word.Application
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $originalSecurity = $wordApp.AutomationSecurity
    $wordApp.AutomationSecurity = 3 # ForceDisable macros for this conversion only.
    $wordOptions = $wordApp.Options
    $originalUpdateLinks = $wordOptions.UpdateLinksAtOpen
    $wordOptions.UpdateLinksAtOpen = $false
    $wordDocuments = $wordApp.Documents
    # ReadOnly=True, AddToRecentFiles=False. Omit optional COM arguments rather
    # than passing Type.Missing, which PowerShell 7's COM binder rejects here.
    $wordDoc = $wordDocuments.Open($resolvedInput, $false, $true, $false)
    $wordApp.Visible = $false
    $wordDoc.Repaginate()
    $pageCount = $wordDoc.ComputeStatistics(2) # wdStatisticPages
    Write-Output "Word pagination: $pageCount pages. Exporting PDF."
    $wordDoc.ExportAsFixedFormat($resolvedOutput, 17, $false) # wdExportFormatPDF
    if (-not (Test-Path -LiteralPath $resolvedOutput)) { throw 'Word did not produce a PDF.' }
    if ((Get-Item -LiteralPath $resolvedOutput).Length -eq 0) { throw 'Word produced an empty PDF.' }
    Write-Output "PDF export completed: $resolvedOutput"
}
finally {
    if ($null -ne $wordDoc) {
        try { $wordDoc.Close(0) } finally {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordDoc)
        }
    }
    if ($null -ne $wordApp) {
        try {
            if ($null -ne $originalSecurity) { $wordApp.AutomationSecurity = $originalSecurity }
            if ($null -ne $originalUpdateLinks) { $wordOptions.UpdateLinksAtOpen = $originalUpdateLinks }
        }
        finally {
            # Do not close a new document the user may have opened during conversion.
            if ($null -eq $wordDocuments -or $wordDocuments.Count -eq 0) {
                $wordApp.Quit(0)
            }
            else {
                Write-Warning 'Another document is open; leaving Word running.'
            }
            if ($null -ne $wordDocuments) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordDocuments)
            }
            if ($null -ne $wordOptions) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordOptions)
            }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp)
        }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
