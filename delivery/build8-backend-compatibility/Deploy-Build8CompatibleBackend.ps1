[CmdletBinding()]
param(
    [string]$ServiceName = 'NeuroSolBackend',
    [string]$BackendPath = '',
    [string]$BackupRoot = 'C:\NeuroSolDeployment\Backups',
    [string]$PublicBaseUrl = '',
    [int]$StartupTimeoutSeconds = 90,
    [switch]$SkipPublicVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Build8Backend.Common.ps1')

[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor
    [Net.SecurityProtocolType]::Tls12

function Invoke-NodeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$NodeExecutable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Description
    )

    & $NodeExecutable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $candidatePath = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    return $candidatePath.Equals(
        $parentPath,
        [StringComparison]::OrdinalIgnoreCase
    ) -or $candidatePath.StartsWith(
        $parentPath + '\',
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Invoke-IsolatedPackageTests {
    param(
        [Parameter(Mandatory = $true)][string]$NodeExecutable,
        [Parameter(Mandatory = $true)][string]$PayloadPath,
        [Parameter(Mandatory = $true)][string]$InstalledModulesPath
    )

    $environmentNames = @(
        'NODE_ENV',
        'NODE_PATH',
        'DATA_DIR',
        'MIN_SUPPORTED_MOBILE_BUILD',
        'LATEST_MOBILE_BUILD',
        'ENABLE_CUSTOM_DISORDERS'
    )
    $savedEnvironment = @{}
    foreach ($name in $environmentNames) {
        $savedEnvironment[$name] =
            [Environment]::GetEnvironmentVariable($name, 'Process')
    }

    try {
        $env:NODE_ENV = 'test'
        $env:NODE_PATH = $InstalledModulesPath
        foreach ($name in @(
            'DATA_DIR',
            'MIN_SUPPORTED_MOBILE_BUILD',
            'LATEST_MOBILE_BUILD',
            'ENABLE_CUSTOM_DISORDERS'
        )) {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        $testFiles = @(
            Get-ChildItem `
                -LiteralPath (Join-Path $PayloadPath 'test') `
                -Filter '*.test.js' `
                -File |
                Sort-Object Name |
                ForEach-Object { $_.FullName }
        )
        if ($testFiles.Count -eq 0) {
            throw 'The deployment package contains no backend tests.'
        }
        Push-Location $PayloadPath
        try {
            Invoke-NodeCommand `
                -NodeExecutable $NodeExecutable `
                -Arguments (@('--test') + $testFiles) `
                -Description 'Isolated Build 7/Build 8 backend test suite'
        } finally {
            Pop-Location
        }
    } finally {
        foreach ($name in $environmentNames) {
            [Environment]::SetEnvironmentVariable(
                $name,
                $savedEnvironment[$name],
                'Process'
            )
        }
    }
}

Assert-Administrator
$manifest = Assert-NeuroSolPackageManifest -PackRoot $PSScriptRoot
$releasePath = Join-Path $PSScriptRoot 'release.json'
$payloadPath = Join-Path $PSScriptRoot 'payload\backend'
$probePath = Join-Path $PSScriptRoot 'Verify-ClinicalData.js'
if (
    -not (Test-Path -LiteralPath $releasePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $payloadPath -PathType Container) -or
    -not (Test-Path -LiteralPath $probePath -PathType Leaf)
) {
    throw 'The deployment package is incomplete.'
}
$release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
if ($release.backendVersion -ne '0.8.3') {
    throw "Expected backend version 0.8.3, found $($release.backendVersion)."
}
if (
    [string]($release.sourceCommit) -notmatch '^[0-9a-f]{40}$' -or
    [string]($release.sourceCommit) -ne [string]($manifest.sourceCommit)
) {
    throw 'The release and package-manifest source commits do not match.'
}

$runtime = Resolve-NeuroSolRuntime `
    -ServiceName $ServiceName `
    -BackendPath $BackendPath
$resolvedBackendPath = $runtime.BackendPath
$nodeExecutable = $runtime.NodeExecutable
$environmentPath = Join-Path $resolvedBackendPath '.env'
$settings = Read-NeuroSolDotEnv -Path $environmentPath

foreach ($requiredSecret in @('IDENTITY_SECRET', 'ADMIN_PASSWORD')) {
    if (-not $settings.ContainsKey($requiredSecret)) {
        throw "Production .env does not contain $requiredSecret."
    }
}
if (([string]$settings['IDENTITY_SECRET']).Length -lt 32) {
    throw 'The existing IDENTITY_SECRET is too short for production.'
}
if (([string]$settings['ADMIN_PASSWORD']).Length -lt 16) {
    throw 'The existing ADMIN_PASSWORD is too short for production.'
}

$port = 3000
if ($settings.ContainsKey('PORT')) {
    if (-not [int]::TryParse([string]($settings['PORT']), [ref]$port)) {
        throw 'The production PORT value is invalid.'
    }
}
if ($port -lt 1 -or $port -gt 65535) {
    throw 'The production PORT value is outside the valid range.'
}
$localBaseUri = "http://127.0.0.1:$port"
$dataDirectory = Resolve-NeuroSolDataDirectory `
    -Settings $settings `
    -BackendPath $resolvedBackendPath
if (-not (Test-Path -LiteralPath $dataDirectory -PathType Container)) {
    throw "The production data directory does not exist: $dataDirectory"
}
foreach ($clinicalFile in @('identity_store.json', 'symptom_entries.csv')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory $clinicalFile))) {
        throw "Production clinical file is missing: $clinicalFile"
    }
}

$resolvedBackupRoot = [IO.Path]::GetFullPath($BackupRoot)
if (
    (Test-PathWithin -Candidate $resolvedBackupRoot -Parent $dataDirectory) -or
    (Test-PathWithin -Candidate $dataDirectory -Parent $resolvedBackupRoot)
) {
    throw 'BackupRoot and the clinical data directory must not contain each other.'
}

$service = Get-Service -Name $ServiceName -ErrorAction Stop
if ($service.Status -ne 'Running') {
    throw "Service '$ServiceName' must be running before deployment preflight."
}
Write-Host "Preflight: current backend at $resolvedBackendPath"
Wait-NeuroSolHealth -BaseUri $localBaseUri -TimeoutSeconds 30 | Out-Null

$dependencyScript = @'
const root = process.argv[1];
for (const name of ['express', 'dotenv', 'basic-auth', 'pdfkit']) {
  require.resolve(name, { paths: [root] });
}
'@
Invoke-NodeCommand `
    -NodeExecutable $nodeExecutable `
    -Arguments @('-e', $dependencyScript, $resolvedBackendPath) `
    -Description 'Installed backend dependency check'

foreach ($sourceFile in @(
    'server.js',
    'identity_store.js',
    'clinical_profiles.js',
    'disorder_catalog.js'
)) {
    $sourcePath = Join-Path $payloadPath $sourceFile
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required backend payload file is missing: $sourceFile"
    }
    Invoke-NodeCommand `
        -NodeExecutable $nodeExecutable `
        -Arguments @('--check', $sourcePath) `
        -Description "Syntax check for $sourceFile"
}

Write-Host 'Preflight: running the isolated compatibility test suite...'
Invoke-IsolatedPackageTests `
    -NodeExecutable $nodeExecutable `
    -PayloadPath $payloadPath `
    -InstalledModulesPath (Join-Path $resolvedBackendPath 'node_modules')

$managedFiles = @(
    'server.js',
    'identity_store.js',
    'clinical_profiles.js',
    'disorder_catalog.js',
    'package.json',
    'package-lock.json',
    'README.md',
    '.env.example',
    'start-neurosol.cmd'
)
$backupPath = Join-Path $resolvedBackupRoot (
    'Build8-Compatibility-' +
    (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' +
    [Guid]::NewGuid().ToString('N').Substring(0, 8)
)
$backupReady = $false
$serviceStopped = $false

try {
    Write-Host 'Stopping the backend for a consistent clinical-data backup...'
    Stop-NeuroSolService -ServiceName $ServiceName
    $serviceStopped = $true

    New-Item -ItemType Directory -Path $backupPath | Out-Null
    Set-NeuroSolBackupAcl -Path $backupPath
    New-Item -ItemType Directory -Path (Join-Path $backupPath 'source') |
        Out-Null
    New-Item -ItemType Directory -Path (Join-Path $backupPath 'environment') |
        Out-Null

    $managedState = @()
    foreach ($relativePath in $managedFiles) {
        $currentPath = Join-Path $resolvedBackendPath $relativePath
        $existed = Test-Path -LiteralPath $currentPath -PathType Leaf
        $managedState += [pscustomobject]@{
            path = $relativePath
            existed = $existed
        }
        if ($existed) {
            $backupFile = Join-Path (Join-Path $backupPath 'source') $relativePath
            $backupParent = Split-Path -Parent $backupFile
            if (-not (Test-Path -LiteralPath $backupParent -PathType Container)) {
                New-Item -ItemType Directory -Path $backupParent | Out-Null
            }
            Copy-Item -LiteralPath $currentPath -Destination $backupFile
        }
    }
    Copy-Item `
        -LiteralPath $environmentPath `
        -Destination (Join-Path $backupPath 'environment\.env')
    Copy-Item `
        -LiteralPath $dataDirectory `
        -Destination (Join-Path $backupPath 'data') `
        -Recurse

    $beforeSnapshotPath = Join-Path $backupPath 'before-data.json'
    Invoke-NodeCommand `
        -NodeExecutable $nodeExecutable `
        -Arguments @(
            $probePath,
            'snapshot',
            $dataDirectory,
            $beforeSnapshotPath
        ) `
        -Description 'Pre-deployment clinical-data snapshot'

    $metadata = [ordered]@{
        backupVersion = 1
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        sourceCommit = [string]$release.sourceCommit
        serviceName = $ServiceName
        backendPath = $resolvedBackendPath
        dataDirectory = $dataDirectory
        nodeExecutable = $nodeExecutable
        localBaseUri = $localBaseUri
        managedFiles = $managedState
    }
    $metadata | ConvertTo-Json -Depth 8 |
        Set-Content `
            -LiteralPath (Join-Path $backupPath 'deployment.json') `
            -Encoding UTF8
    $backupReady = $true

    Write-Host 'Deploying the Build 8 compatibility backend...'
    foreach ($relativePath in $managedFiles) {
        $sourcePath = Join-Path $payloadPath $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Payload file is missing: $relativePath"
        }
        Copy-Item `
            -LiteralPath $sourcePath `
            -Destination (Join-Path $resolvedBackendPath $relativePath) `
            -Force
    }

    $identitySecretBefore = [string]($settings['IDENTITY_SECRET'])
    $adminPasswordBefore = [string]($settings['ADMIN_PASSWORD'])
    Set-NeuroSolDotEnvValues -Path $environmentPath -Updates @{
        NODE_ENV = 'production'
        HOST = '127.0.0.1'
        MIN_SUPPORTED_MOBILE_BUILD = '7'
        LATEST_MOBILE_BUILD = '7'
        ENABLE_CUSTOM_DISORDERS = 'false'
    }
    $updatedSettings = Read-NeuroSolDotEnv -Path $environmentPath
    if (
        [string]($updatedSettings['IDENTITY_SECRET']) -ne $identitySecretBefore -or
        [string]($updatedSettings['ADMIN_PASSWORD']) -ne $adminPasswordBefore
    ) {
        throw 'A protected production secret changed during .env update.'
    }

    Start-NeuroSolService -ServiceName $ServiceName
    $serviceStopped = $false
    Wait-NeuroSolHealth `
        -BaseUri $localBaseUri `
        -TimeoutSeconds $StartupTimeoutSeconds | Out-Null

    $afterSnapshotPath = Join-Path $backupPath 'after-data.json'
    Invoke-NodeCommand `
        -NodeExecutable $nodeExecutable `
        -Arguments @(
            $probePath,
            'compare',
            $beforeSnapshotPath,
            $dataDirectory,
            $afterSnapshotPath
        ) `
        -Description 'Post-migration clinical-data verification'

    Write-Host 'Verifying local Build 7 and Build 8 compatibility responses...'
    Assert-NeuroSolCompatibilityResponses -BaseUri $localBaseUri

    if (-not $PublicBaseUrl) {
        if ($updatedSettings.ContainsKey('PUBLIC_BASE_URL')) {
            $PublicBaseUrl = [string]($updatedSettings['PUBLIC_BASE_URL'])
        }
    }
    if (-not $PublicBaseUrl) {
        $PublicBaseUrl = 'https://tracker.melindapascoeneurology.com'
    }
    if (-not $SkipPublicVerification) {
        Write-Host 'Verifying the public HTTPS Build 7 compatibility path...'
        Assert-NeuroSolCompatibilityResponses -BaseUri $PublicBaseUrl
    }

    $result = [ordered]@{
        completedAt = (Get-Date).ToUniversalTime().ToString('o')
        sourceCommit = [string]$release.sourceCommit
        backendVersion = [string]$release.backendVersion
        serviceName = $ServiceName
        backendPath = $resolvedBackendPath
        dataDirectory = $dataDirectory
        backupPath = $backupPath
        minimumMobileBuild = 7
        latestMobileBuild = 7
        customDisordersEnabled = $false
        localVerification = $true
        publicVerification = (-not $SkipPublicVerification)
    }
    $result | ConvertTo-Json -Depth 5 |
        Set-Content `
            -LiteralPath (Join-Path $backupPath 'deployment-result.json') `
            -Encoding UTF8

    Write-Host ''
    Write-Host 'Build 8 compatibility backend deployed successfully.'
    Write-Host "Source commit: $($release.sourceCommit)"
    Write-Host 'Build 7 support: ACTIVE'
    Write-Host 'Custom disorders: DISABLED until both Build 8 stores are live'
    Write-Host "Recovery backup: $backupPath"
} catch {
    $deploymentError = $_
    $restoreMessage = ''
    try {
        if ($backupReady) {
            Write-Warning 'Deployment failed. Restoring the previous backend and data...'
            Restore-NeuroSolBackendBackup `
                -BackupPath $backupPath `
                -StartupTimeoutSeconds $StartupTimeoutSeconds
            $restoreMessage = ' The previous backend was restored and is healthy.'
        } elseif ($serviceStopped) {
            Start-NeuroSolService -ServiceName $ServiceName
            Wait-NeuroSolHealth `
                -BaseUri $localBaseUri `
                -TimeoutSeconds $StartupTimeoutSeconds | Out-Null
            $restoreMessage = ' The unchanged previous backend was restarted.'
        }
    } catch {
        $restoreMessage =
            " Automatic recovery also failed: $($_.Exception.Message)"
    }
    throw "Build 8 compatibility deployment failed: $($deploymentError.Exception.Message)$restoreMessage"
}
