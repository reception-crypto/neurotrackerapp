[CmdletBinding()]
param(
    [string]$ServiceName = 'NeuroSolBackend',
    [string]$BackendPath = '',
    [string]$PublicBaseUrl = '',
    [switch]$SkipPublicVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Build9Backend.Common.ps1')

[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor
    [Net.SecurityProtocolType]::Tls12

$runtime = Resolve-NeuroSolRuntime `
    -ServiceName $ServiceName `
    -BackendPath $BackendPath
$nodeExecutable = $runtime.NodeExecutable
$settings = Read-NeuroSolDotEnv `
    -Path (Join-Path $runtime.BackendPath '.env')
$dataDirectory = Resolve-NeuroSolDataDirectory `
    -Settings $settings `
    -BackendPath $runtime.BackendPath

$expectedSettings = @{
    MIN_SUPPORTED_MOBILE_BUILD = '7'
    ENABLE_CUSTOM_DISORDERS = 'true'
    ENABLE_INDEPENDENT_PROFILES = 'true'
    MAX_BACKDATE_DAYS = '7'
}
foreach ($expected in $expectedSettings.GetEnumerator()) {
    if (
        -not $settings.ContainsKey($expected.Key) -or
        [string]($settings[$expected.Key]) -ne [string]($expected.Value)
    ) {
        throw "Production $($expected.Key) must be $($expected.Value)."
    }
}
$latestBuild = [string]$settings['LATEST_MOBILE_BUILD']
if ($latestBuild -notin @('8', '9')) {
    throw 'Production LATEST_MOBILE_BUILD must be 8 or 9.'
}

$port = 3000
if ($settings.ContainsKey('PORT')) {
    if (-not [int]::TryParse([string]($settings['PORT']), [ref]$port)) {
        throw 'The production PORT value is invalid.'
    }
}
$localBaseUri = "http://127.0.0.1:$port"
if ($latestBuild -eq '9') {
    Assert-NeuroSolBuild9ActiveResponses -BaseUri $localBaseUri
} else {
    Assert-NeuroSolCompatibilityResponses -BaseUri $localBaseUri
}

if (-not $PublicBaseUrl -and $settings.ContainsKey('PUBLIC_BASE_URL')) {
    $PublicBaseUrl = [string]($settings['PUBLIC_BASE_URL'])
}
if (-not $PublicBaseUrl) {
    $PublicBaseUrl = 'https://tracker.melindapascoeneurology.com'
}
if (-not $SkipPublicVerification) {
    if ($latestBuild -eq '9') {
        Assert-NeuroSolBuild9ActiveResponses -BaseUri $PublicBaseUrl
    } else {
        Assert-NeuroSolCompatibilityResponses -BaseUri $PublicBaseUrl
    }
}

$probePath = Join-Path $PSScriptRoot 'Verify-ClinicalData.js'
$snapshotPath = Join-Path `
    ([IO.Path]::GetTempPath()) `
    ("neurosol-verify-$([Guid]::NewGuid().ToString('N')).json")
$verifiedPath = "$snapshotPath.verified.json"
try {
    & $nodeExecutable `
        $probePath `
        snapshot `
        $dataDirectory `
        $snapshotPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not inspect the live clinical data.'
    }
    & $nodeExecutable `
        $probePath `
        compare `
        $snapshotPath `
        $dataDirectory `
        $verifiedPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'The live clinical-data compatibility check failed.'
    }
    $snapshot = Get-Content -LiteralPath $verifiedPath -Raw |
        ConvertFrom-Json

    [pscustomobject]@{
        Service = $ServiceName
        State = (Get-Service -Name $ServiceName).Status
        BackendPath = $runtime.BackendPath
        LocalHealth = $true
        PublicHealth = (-not $SkipPublicVerification)
        BackendVersion = '0.11.0'
        MinimumBuild = 7
        LatestBuild = [int]$latestBuild
        Build7Supported = $true
        CustomDisordersEnabled = $true
        IndependentProfilesEnabled = $true
        PatientDiaryAvailable = $true
        MaximumBackdateDays = 7
        PatientCount = [int]$snapshot.patientCount
        BpPatientIdCount = [int]$snapshot.bpPatientIdCount
        ActiveDeviceCount = [int]$snapshot.activeDeviceCount
        SymptomCsvRows = [int]$snapshot.csvDataRowCount
        CanonicalProfiles = [int]$snapshot.canonicalCurrentProfileCount
    }
} finally {
    foreach ($temporaryFile in @($snapshotPath, $verifiedPath)) {
        if (Test-Path -LiteralPath $temporaryFile -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryFile -Force
        }
    }
}
