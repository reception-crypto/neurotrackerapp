[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [int]$StartupTimeoutSeconds = 90,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Build9Backend.Common.ps1')

Assert-Administrator
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
if (
    $Force -or
    $PSCmdlet.ShouldProcess(
        $resolvedBackup,
        'Stop NeuroSol, restore the backed-up source, .env and clinical data, and restart it'
    )
) {
    Restore-NeuroSolBackendBackup `
        -BackupPath $resolvedBackup `
        -StartupTimeoutSeconds $StartupTimeoutSeconds
    Write-Host "Previous NeuroSol backend restored from $resolvedBackup"
}
