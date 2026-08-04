[CmdletBinding()]
param(
    [string]$ServiceName = 'NeuroSolBackend',
    [string]$BackendPath = '',
    [string]$PublicBaseUrl = '',
    [switch]$SkipPublicVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Build8Backend.Common.ps1')

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
    LATEST_MOBILE_BUILD = '7'
    ENABLE_CUSTOM_DISORDERS = 'false'
}
foreach ($expected in $expectedSettings.GetEnumerator()) {
    if (
        -not $settings.ContainsKey($expected.Key) -or
        [string]($settings[$expected.Key]) -ne [string]($expected.Value)
    ) {
        throw "Production $($expected.Key) must be $($expected.Value)."
    }
}

$port = 3000
if ($settings.ContainsKey('PORT')) {
    if (-not [int]::TryParse([string]($settings['PORT']), [ref]$port)) {
        throw 'The production PORT value is invalid.'
    }
}
$localBaseUri = "http://127.0.0.1:$port"
Assert-NeuroSolCompatibilityResponses -BaseUri $localBaseUri

if (-not $PublicBaseUrl -and $settings.ContainsKey('PUBLIC_BASE_URL')) {
    $PublicBaseUrl = [string]($settings['PUBLIC_BASE_URL'])
}
if (-not $PublicBaseUrl) {
    $PublicBaseUrl = 'https://tracker.melindapascoeneurology.com'
}
if (-not $SkipPublicVerification) {
    Assert-NeuroSolCompatibilityResponses -BaseUri $PublicBaseUrl
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
        MinimumBuild = 7
        LatestBuild = 7
        Build7Supported = $true
        CustomDisordersEnabled = $false
        PatientCount = [int]$snapshot.patientCount
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
