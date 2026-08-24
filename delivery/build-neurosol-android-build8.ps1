[CmdletBinding()]
param(
    [switch]$SkipFlutterTests,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Description
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Read-KeyProperties {
    param([Parameter(Mandatory = $true)][string]$Path)

    $properties = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([^#!][^=]*)=(.*)$') {
            $properties[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $properties
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $projectRoot
foreach ($command in @('flutter', 'dart', 'npm', 'node', 'git')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is not available in this PowerShell session."
    }
}

$sourceCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Could not determine the Build 8 source commit.'
}
$requiredAncestors = @(
    '1c9a365', # independent symptom/disorder architecture
    'f2adba0', # Build 8 visual identity
    'fa351d7', # enrolment identity prevention and recovery
    'd9cb404'  # restored-source/recovered-device compatibility
)
foreach ($requiredCommit in $requiredAncestors) {
    & git -C $projectRoot merge-base --is-ancestor `
        $requiredCommit $sourceCommit
    if ($LASTEXITCODE -ne 0) {
        throw "Required reconciled source commit is missing: $requiredCommit"
    }
}

$sourceStatus = @(
    & git -C $projectRoot status --porcelain -- `
        android `
        ios `
        assets `
        lib `
        test `
        backend `
        pubspec.yaml `
        pubspec.lock `
        delivery/CODEMAGIC_BUILD8.md `
        delivery/build-neurosol-android-build8.ps1 `
        delivery/build-neurosol-ios-build8.sh `
        delivery/build8-backend-compatibility
)
if ($LASTEXITCODE -ne 0 -or $sourceStatus.Count -ne 0) {
    throw (
        'Build 8 source or release tooling is not committed. Commit the ' +
        'reported files before creating signed artifacts.'
    )
}

$pubspecPath = Join-Path $projectRoot 'pubspec.yaml'
$gradlePath = Join-Path $projectRoot 'android\app\build.gradle.kts'
$gradlePropertiesPath = Join-Path $projectRoot 'android\gradle.properties'
$manifestPath = Join-Path `
    $projectRoot `
    'android\app\src\main\AndroidManifest.xml'
$identityPath = Join-Path $projectRoot 'lib\app_identity.dart'
$backendServerPath = Join-Path $projectRoot 'backend\server.js'
$backendIdentityPath = Join-Path $projectRoot 'backend\identity_store.js'
$keyPropertiesPath = Join-Path $projectRoot 'android\key.properties'

if ((Get-Content -LiteralPath $pubspecPath -Raw) -notmatch
    '(?m)^version:\s*1\.0\.0\+8\s*$') {
    throw 'pubspec.yaml is not set to version 1.0.0+8.'
}
$identityText = Get-Content -LiteralPath $identityPath -Raw
foreach ($requiredIdentity in @(
    'appBuildNumber = 8',
    'clinic-managed-v1',
    'canonical-v1',
    'independent-v1'
)) {
    if ($identityText -notmatch [regex]::Escape($requiredIdentity)) {
        throw "The Build 8 mobile identity is missing: $requiredIdentity"
    }
}
$package = Get-Content `
    -LiteralPath (Join-Path $projectRoot 'backend\package.json') `
    -Raw | ConvertFrom-Json
if ([string]$package.version -ne '0.10.0') {
    throw "Expected backend 0.10.0, found $($package.version)."
}
if ((Get-Content -LiteralPath $gradlePath -Raw) -notmatch
    'applicationId\s*=\s*"au\.com\.pascoeneurology\.neurosol"') {
    throw 'The Android application ID is incorrect.'
}
if ((Get-Content -LiteralPath $gradlePath -Raw) -notmatch
    'minSdk\s*=\s*24') {
    throw 'Android minSdk must remain 24.'
}
$gradleProperties = Get-Content -LiteralPath $gradlePropertiesPath -Raw
if (
    $gradleProperties -notmatch 'android\.builtInKotlin=false' -or
    $gradleProperties -notmatch 'android\.newDsl=false'
) {
    throw 'The verified Flutter/Gradle compatibility settings are missing.'
}
if ((Get-Content -LiteralPath $manifestPath -Raw) -notmatch
    'android:allowBackup="false"') {
    throw 'Android backups must remain disabled for local clinical data.'
}
foreach ($requiredAsset in @(
    'assets\icon\app_icon.png',
    'assets\branding\neurosol_wordmark.png'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $requiredAsset))) {
        throw "A Build 8 visual-identity asset is missing: $requiredAsset"
    }
}
$mobileSource = @(
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'lib') -Recurse -File |
        Get-Content -Raw
) -join "`n"
foreach ($requiredMarker in @(
    'neurosol-brand-banner',
    'stageDailyEntry',
    'completePendingEntry',
    'schemaVersion',
    'profileDisorderIds'
)) {
    if ($mobileSource -notmatch [regex]::Escape($requiredMarker)) {
        throw "A reconciled Build 8 mobile feature is missing: $requiredMarker"
    }
}
if ($mobileSource -match
    'ProfileScreen|SymptomSelectionScreen|Edit patient profile') {
    throw 'Obsolete patient self-configuration remains in mobile source.'
}
$backendSource = (
    (Get-Content -LiteralPath $backendServerPath -Raw) + "`n" +
    (Get-Content -LiteralPath $backendIdentityPath -Raw)
)
foreach ($requiredMarker in @(
    'independent-v1',
    'submission_id_conflict',
    'daily_submission_exists',
    'formMode',
    'ENROLMENT_INCIDENT_LOCKDOWN',
    'quarantineReleasedAt'
)) {
    if ($backendSource -notmatch [regex]::Escape($requiredMarker)) {
        throw "A reconciled Build 8 backend feature is missing: $requiredMarker"
    }
}
if (-not (Test-Path -LiteralPath $keyPropertiesPath -PathType Leaf)) {
    throw 'android\key.properties was not found.'
}
$keyProperties = Read-KeyProperties -Path $keyPropertiesPath
foreach ($requiredKey in @(
    'storePassword',
    'keyPassword',
    'keyAlias',
    'storeFile'
)) {
    if (
        -not $keyProperties.ContainsKey($requiredKey) -or
        [string]::IsNullOrWhiteSpace($keyProperties[$requiredKey])
    ) {
        throw "android\key.properties is missing $requiredKey."
    }
}
$storeFile = $keyProperties['storeFile'] -replace '\\\\', '\'
if (-not [IO.Path]::IsPathRooted($storeFile)) {
    $storeFile = Join-Path (Join-Path $projectRoot 'android') $storeFile
}
if (-not (Test-Path -LiteralPath $storeFile -PathType Leaf)) {
    throw "The configured Android keystore was not found: $storeFile"
}

$apiUrl =
    '--dart-define=NEUROTRACKER_API_URL=https://tracker.melindapascoeneurology.com'
Write-Host 'Cleaning previous Flutter output...'
Invoke-Checked `
    -Command 'flutter' `
    -Arguments @('clean') `
    -Description 'Flutter clean'
Write-Host 'Restoring Flutter packages...'
Invoke-Checked `
    -Command 'flutter' `
    -Arguments @('pub', 'get') `
    -Description 'Flutter package restore'
Write-Host 'Formatting source...'
Invoke-Checked `
    -Command 'dart' `
    -Arguments @('format', 'lib', 'test') `
    -Description 'Dart formatting'
Write-Host 'Analyzing Build 8...'
Invoke-Checked `
    -Command 'flutter' `
    -Arguments @('analyze') `
    -Description 'Flutter analysis'
Write-Host 'Running backend 0.10.0 tests...'
Push-Location (Join-Path $projectRoot 'backend')
try {
    Invoke-Checked `
        -Command 'npm' `
        -Arguments @('ci') `
        -Description 'Backend dependency restore'
    Invoke-Checked `
        -Command 'npm' `
        -Arguments @('test') `
        -Description 'Backend tests'
} finally {
    Pop-Location
}
Write-Host 'Running backend deployment-probe tests...'
Invoke-Checked `
    -Command 'node' `
    -Arguments @(
        '--test',
        (Join-Path `
            $projectRoot `
            'delivery\build8-backend-compatibility\test\verify-clinical-data.test.js')
    ) `
    -Description 'Backend deployment-probe tests'
if ($SkipFlutterTests) {
    Write-Warning (
        'Flutter tests were skipped. Verification is diagnostic only; no ' +
        'signed release artifacts will be created.'
    )
    return
} else {
    Write-Host 'Running Flutter tests...'
    Invoke-Checked `
        -Command 'flutter' `
        -Arguments @('test', '--reporter', 'expanded') `
        -Description 'Flutter tests'
}

$postVerificationStatus = @(
    & git -C $projectRoot status --porcelain -- `
        android `
        ios `
        assets `
        lib `
        test `
        backend `
        pubspec.yaml `
        pubspec.lock `
        delivery/CODEMAGIC_BUILD8.md `
        delivery/build-neurosol-android-build8.ps1 `
        delivery/build-neurosol-ios-build8.sh `
        delivery/build8-backend-compatibility
)
if ($LASTEXITCODE -ne 0 -or $postVerificationStatus.Count -ne 0) {
    throw (
        'Formatting or verification changed the committed Build 8 source. ' +
        'Review and commit those changes before building signed artifacts.'
    )
}

Write-Host 'Building signed Build 8 Android App Bundle...'
Invoke-Checked `
    -Command 'flutter' `
    -Arguments @(
        'build',
        'appbundle',
        '--release',
        '--build-name=1.0.0',
        '--build-number=8',
        $apiUrl
    ) `
    -Description 'Signed Build 8 App Bundle'
Write-Host 'Building signed Build 8 Android APK...'
Invoke-Checked `
    -Command 'flutter' `
    -Arguments @(
        'build',
        'apk',
        '--release',
        '--build-name=1.0.0',
        '--build-number=8',
        $apiUrl
    ) `
    -Description 'Signed Build 8 APK'

$sourceAab = Join-Path `
    $projectRoot `
    'build\app\outputs\bundle\release\app-release.aab'
$sourceApk = Join-Path `
    $projectRoot `
    'build\app\outputs\flutter-apk\app-release.apk'
foreach ($artifact in @($sourceAab, $sourceApk)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Expected signed artifact was not created: $artifact"
    }
}

$releaseDirectory = Join-Path $projectRoot 'delivery\android-build8'
$releaseAab = Join-Path `
    $releaseDirectory `
    'NeuroSol-Symptom-Diary-1.0.0-build8.aab'
$releaseApk = Join-Path `
    $releaseDirectory `
    'NeuroSol-Symptom-Diary-1.0.0-build8.apk'
$metadataPath = Join-Path $releaseDirectory 'release.json'
if (-not (Test-Path -LiteralPath $releaseDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
}
foreach ($target in @($releaseAab, $releaseApk, $metadataPath)) {
    if ((Test-Path -LiteralPath $target) -and -not $Force) {
        throw "A Build 8 release artifact already exists: $target"
    }
}
Copy-Item -LiteralPath $sourceAab -Destination $releaseAab -Force
Copy-Item -LiteralPath $sourceApk -Destination $releaseApk -Force
$aabHash = (Get-FileHash -LiteralPath $releaseAab -Algorithm SHA256).Hash
$apkHash = (Get-FileHash -LiteralPath $releaseApk -Algorithm SHA256).Hash
$sourceTree = (& git -C $projectRoot rev-parse 'HEAD^{tree}').Trim()
[ordered]@{
    releaseFormat = 1
    product = 'NeuroSol Symptom Diary'
    versionName = '1.0.0'
    buildNumber = 8
    applicationId = 'au.com.pascoeneurology.neurosol'
    backendVersion = '0.10.0'
    sourceCommit = $sourceCommit
    sourceTree = $sourceTree
    apiUrl = 'https://tracker.melindapascoeneurology.com'
    flutterTestsSkipped = $false
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    artifacts = @(
        [ordered]@{
            name = [IO.Path]::GetFileName($releaseAab)
            sha256 = $aabHash
            length = (Get-Item -LiteralPath $releaseAab).Length
        },
        [ordered]@{
            name = [IO.Path]::GetFileName($releaseApk)
            sha256 = $apkHash
            length = (Get-Item -LiteralPath $releaseApk).Length
        }
    )
} | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $metadataPath -Encoding UTF8

Write-Host ''
Write-Host 'NEUROSOL ANDROID BUILD 8 COMPLETE' -ForegroundColor Green
Write-Host "Source commit: $sourceCommit"
Write-Host "AAB SHA256: $aabHash"
Write-Host "APK SHA256: $apkHash"
Write-Host "Release metadata: $metadataPath"
Write-Host 'Install the APK for upgrade testing with:'
Write-Host '$Apk = (Resolve-Path ''.\delivery\android-build8\NeuroSol-Symptom-Diary-1.0.0-build8.apk'').Path'
Write-Host 'adb install -r "$Apk"'
