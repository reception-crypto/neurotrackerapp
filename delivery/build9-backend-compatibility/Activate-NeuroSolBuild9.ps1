[CmdletBinding()]
param(
    [string]$ServiceName = 'NeuroSolBackend',
    [string]$BackendPath = '',
    [string]$BackupRoot = 'C:\NeuroSolDeployment\Backups',
    [string]$PublicBaseUrl = '',
    [string]$Confirmation = '',
    [ValidateRange(10, 600)][int]$StartupTimeoutSeconds = 90,
    [switch]$SkipPublicVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Build9Backend.Common.ps1')

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
Assert-Administrator
if ($Confirmation -cne 'ACTIVATE BUILD 9 AFTER BOTH STORES ARE LIVE') {
    throw "Supply -Confirmation 'ACTIVATE BUILD 9 AFTER BOTH STORES ARE LIVE' exactly."
}

$manifest = Assert-NeuroSolPackageManifest -PackRoot $PSScriptRoot
$releasePath = Join-Path $PSScriptRoot 'release.json'
$probePath = Join-Path $PSScriptRoot 'Verify-ClinicalData.js'
$payloadPath = Join-Path $PSScriptRoot 'payload\backend'
$release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
if (
    [string]$release.sourceCommit -ne [string]$manifest.sourceCommit -or
    [string]$release.backendVersion -ne '0.11.0' -or
    [string]$release.googlePlayUrl -ne $script:NeuroSolGooglePlayUrl -or
    [string]$release.appStoreUrl -ne $script:NeuroSolAppStoreUrl
) {
    throw 'The Build 9 activation package metadata is invalid.'
}

$runtime = Resolve-NeuroSolRuntime `
    -ServiceName $ServiceName `
    -BackendPath $BackendPath
$resolvedBackendPath = $runtime.BackendPath
$nodeExecutable = $runtime.NodeExecutable
$sourceFiles = @(
    'server.js',
    'identity_store.js',
    'clinical_profiles.js',
    'disorder_catalog.js',
    'portal_users.js',
    'package.json',
    'package-lock.json'
)
foreach ($relativePath in $sourceFiles) {
    $packagedPath = Join-Path $payloadPath $relativePath
    $livePath = Join-Path $resolvedBackendPath $relativePath
    if (
        -not (Test-Path -LiteralPath $packagedPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $livePath -PathType Leaf)
    ) {
        throw "Build 9 source verification is missing: $relativePath"
    }
    $packagedFileHash = Get-FileHash `
        -LiteralPath $packagedPath `
        -Algorithm SHA256
    $liveFileHash = Get-FileHash `
        -LiteralPath $livePath `
        -Algorithm SHA256
    $packagedHash = $packagedFileHash.Hash
    $liveHash = $liveFileHash.Hash
    if ($packagedHash -ne $liveHash) {
        throw (
            "The live backend does not match this package: $relativePath. " +
            'Deploy this exact compatibility package before activation.'
        )
    }
}
$environmentPath = Join-Path $resolvedBackendPath '.env'
$settings = Read-NeuroSolDotEnv -Path $environmentPath
foreach ($requiredSecret in @('IDENTITY_SECRET', 'ADMIN_PASSWORD')) {
    if (-not $settings.ContainsKey($requiredSecret)) {
        throw "Production .env does not contain $requiredSecret."
    }
}
if (
    ([string]$settings['IDENTITY_SECRET']).Length -lt 32 -or
    ([string]$settings['ADMIN_PASSWORD']).Length -lt 16
) {
    throw 'The production identity secret or administrator password is too short.'
}
$dataDirectory = Resolve-NeuroSolDataDirectory `
    -Settings $settings `
    -BackendPath $resolvedBackendPath
$resolvedBackupRoot = [IO.Path]::GetFullPath($BackupRoot)
if (Test-NeuroSolPathWithin `
    -Candidate $resolvedBackendPath `
    -Parent $dataDirectory) {
    throw 'The clinical data directory must not contain the backend root.'
}
if (
    (Test-NeuroSolPathWithin `
        -Candidate $resolvedBackupRoot `
        -Parent $dataDirectory) -or
    (Test-NeuroSolPathWithin `
        -Candidate $dataDirectory `
        -Parent $resolvedBackupRoot)
) {
    throw 'BackupRoot and the clinical data directory must not contain each other.'
}
foreach ($clinicalFile in @('identity_store.json', 'symptom_entries.csv')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory $clinicalFile))) {
        throw "A required clinical data file is missing: $clinicalFile"
    }
}
if (
    -not $settings.ContainsKey('ENROLMENT_INCIDENT_LOCKDOWN') -or
    [string]$settings['ENROLMENT_INCIDENT_LOCKDOWN'] -notmatch '^(0|false|no)$'
) {
    throw 'Build 9 cannot be activated while enrolment incident lockdown is active or undefined.'
}

$expectedPreactivation = @{
    MIN_SUPPORTED_MOBILE_BUILD = '7'
    LATEST_MOBILE_BUILD = '8'
    ENABLE_CUSTOM_DISORDERS = 'true'
    ENABLE_INDEPENDENT_PROFILES = 'true'
    MAX_BACKDATE_DAYS = '7'
}
$expectedActive = @{
    MIN_SUPPORTED_MOBILE_BUILD = '7'
    LATEST_MOBILE_BUILD = '9'
    ENABLE_CUSTOM_DISORDERS = 'true'
    ENABLE_INDEPENDENT_PROFILES = 'true'
    MAX_BACKDATE_DAYS = '7'
}
$alreadyActive = $true
foreach ($expected in $expectedActive.GetEnumerator()) {
    if (
        -not $settings.ContainsKey($expected.Key) -or
        [string]$settings[$expected.Key] -ne [string]$expected.Value
    ) {
        $alreadyActive = $false
    }
}

$port = 3000
if ($settings.ContainsKey('PORT')) {
    if (-not [int]::TryParse([string]$settings['PORT'], [ref]$port)) {
        throw 'The production PORT value is invalid.'
    }
}
if ($port -lt 1 -or $port -gt 65535) {
    throw 'The production PORT value is outside the valid range.'
}
$localBaseUri = "http://127.0.0.1:$port"
if (-not $PublicBaseUrl -and $settings.ContainsKey('PUBLIC_BASE_URL')) {
    $PublicBaseUrl = [string]$settings['PUBLIC_BASE_URL']
}
if (-not $PublicBaseUrl) {
    $PublicBaseUrl = 'https://tracker.melindapascoeneurology.com'
}

if ($alreadyActive) {
    Assert-NeuroSolBuild9ActiveResponses `
        -BaseUri $localBaseUri `
        -TimeoutSeconds $StartupTimeoutSeconds
    if (-not $SkipPublicVerification) {
        Assert-NeuroSolBuild9ActiveResponses `
            -BaseUri $PublicBaseUrl `
            -TimeoutSeconds $StartupTimeoutSeconds
    }
    Write-Host 'Build 9 is already active and passed verification.'
    return
}
foreach ($expected in $expectedPreactivation.GetEnumerator()) {
    if (
        -not $settings.ContainsKey($expected.Key) -or
        [string]$settings[$expected.Key] -ne [string]$expected.Value
    ) {
        throw (
            "Production $($expected.Key) must be $($expected.Value) before " +
            'guarded Build 9 activation.'
        )
    }
}

$service = Get-Service -Name $ServiceName -ErrorAction Stop
if ($service.Status -ne 'Running') {
    throw "Service '$ServiceName' must be running before Build 9 activation."
}
Assert-NeuroSolCompatibilityResponses `
    -BaseUri $localBaseUri `
    -TimeoutSeconds $StartupTimeoutSeconds
if (-not $SkipPublicVerification) {
    Assert-NeuroSolCompatibilityResponses `
        -BaseUri $PublicBaseUrl `
        -TimeoutSeconds $StartupTimeoutSeconds
}

$backupPath = Join-Path $resolvedBackupRoot (
    'Before-Build9-Activation-' +
    (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' +
    [Guid]::NewGuid().ToString('N').Substring(0, 8)
)
$backupReady = $false
$serviceStopped = $false

try {
    Stop-NeuroSolService -ServiceName $ServiceName
    $serviceStopped = $true

    New-Item -ItemType Directory -Path $backupPath | Out-Null
    Set-NeuroSolBackupAcl -Path $backupPath
    New-Item -ItemType Directory -Path (Join-Path $backupPath 'environment') |
        Out-Null
    Copy-Item -LiteralPath $environmentPath `
        -Destination (Join-Path $backupPath 'environment\.env')
    Copy-Item -LiteralPath $dataDirectory `
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
        -Description 'Pre-activation clinical-data snapshot'

    [ordered]@{
        activationBackupVersion = 1
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        sourceCommit = [string]$release.sourceCommit
        serviceName = $ServiceName
        backendPath = $resolvedBackendPath
        dataDirectory = $dataDirectory
        localBaseUri = $localBaseUri
    } | ConvertTo-Json -Depth 6 |
        Set-Content `
            -LiteralPath (Join-Path $backupPath 'activation.json') `
            -Encoding UTF8
    $backupReady = $true

    $identitySecretBefore = [string]$settings['IDENTITY_SECRET']
    $adminPasswordBefore = [string]$settings['ADMIN_PASSWORD']
    Set-NeuroSolDotEnvValues -Path $environmentPath -Updates @{
        MIN_SUPPORTED_MOBILE_BUILD = '7'
        LATEST_MOBILE_BUILD = '9'
        ENABLE_CUSTOM_DISORDERS = 'true'
        ENABLE_INDEPENDENT_PROFILES = 'true'
        MAX_BACKDATE_DAYS = '7'
        GOOGLE_PLAY_URL = [string]$release.googlePlayUrl
        APP_STORE_URL = [string]$release.appStoreUrl
    }
    $updatedSettings = Read-NeuroSolDotEnv -Path $environmentPath
    if (
        [string]$updatedSettings['IDENTITY_SECRET'] -ne $identitySecretBefore -or
        [string]$updatedSettings['ADMIN_PASSWORD'] -ne $adminPasswordBefore
    ) {
        throw 'A protected production secret changed during Build 9 activation.'
    }

    Start-NeuroSolService -ServiceName $ServiceName
    $serviceStopped = $false
    Assert-NeuroSolBuild9ActiveResponses `
        -BaseUri $localBaseUri `
        -TimeoutSeconds $StartupTimeoutSeconds

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
        -Description 'Post-activation clinical-data preservation check'
    if (-not $SkipPublicVerification) {
        Assert-NeuroSolBuild9ActiveResponses `
            -BaseUri $PublicBaseUrl `
            -TimeoutSeconds $StartupTimeoutSeconds
    }

    Write-Host ''
    Write-Host 'NEUROSOL BUILD 9 ACTIVATED' -ForegroundColor Green
    Write-Host 'Build 7 compatibility: ACTIVE'
    Write-Host 'Build 8 compatibility: ACTIVE'
    Write-Host 'Build 9 patient diary and seven-day backdating: ACTIVE'
    Write-Host 'Independent disorder/symptom profiles: ACTIVE'
    Write-Host 'Custom disorders and symptoms: ACTIVE'
    Write-Host "Activation backup: $backupPath"
} catch {
    $failure = $_.Exception.Message
    try {
        if ($backupReady) {
            Stop-NeuroSolService -ServiceName $ServiceName
            $environmentAcl = Get-Acl -LiteralPath $environmentPath
            Copy-Item `
                -LiteralPath (Join-Path $backupPath 'environment\.env') `
                -Destination $environmentPath `
                -Force
            Set-Acl -LiteralPath $environmentPath -AclObject $environmentAcl

            $failedDataPath = Join-Path $backupPath (
                'failed-data-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' +
                [Guid]::NewGuid().ToString('N').Substring(0, 8)
            )
            if (Test-Path -LiteralPath $dataDirectory -PathType Container) {
                Move-Item -LiteralPath $dataDirectory -Destination $failedDataPath
            }
            Copy-Item `
                -LiteralPath (Join-Path $backupPath 'data') `
                -Destination $dataDirectory `
                -Recurse
            Start-NeuroSolService -ServiceName $ServiceName
            Assert-NeuroSolCompatibilityResponses `
                -BaseUri $localBaseUri `
                -TimeoutSeconds $StartupTimeoutSeconds
            Write-Host (
                'Build 9 activation was rolled back; Build 7 and 8 remain active.'
            ) -ForegroundColor Yellow
        } elseif ($serviceStopped) {
            Start-NeuroSolService -ServiceName $ServiceName
        }
    } catch {
        Write-Host (
            "Automatic activation rollback failed: $($_.Exception.Message)"
        ) -ForegroundColor Red
    }
    throw $failure
}
