$ErrorActionPreference = 'Stop'

function Resolve-ProjectRoot {
    $candidates = @(
        $PSScriptRoot,
        (Split-Path -Parent $PSScriptRoot)
    )

    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'pubspec.yaml')) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw 'Place this script in the project root or its delivery folder.'
}

function Invoke-Flutter {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    & flutter @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Flutter command failed: flutter $($Arguments -join ' ')"
    }
}

function Invoke-Dart {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    & dart @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Dart command failed: dart $($Arguments -join ' ')"
    }
}

function Read-KeyProperties {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    $properties = @{}
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*([^#!][^=]*)=(.*)$') {
            $properties[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $properties
}

$projectRoot = Resolve-ProjectRoot
Set-Location $projectRoot

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
    throw 'Flutter is not available in this PowerShell session.'
}
if (-not (Get-Command dart -ErrorAction SilentlyContinue)) {
    throw 'Dart is not available in this PowerShell session.'
}

$pubspecPath = Join-Path $projectRoot 'pubspec.yaml'
$gradlePath = Join-Path $projectRoot 'android\app\build.gradle.kts'
$manifestPath = Join-Path $projectRoot 'android\app\src\main\AndroidManifest.xml'
$apiConfigPath = Join-Path $projectRoot 'lib\services\api_config.dart'
$uploadServicePath = Join-Path $projectRoot 'lib\services\upload_service.dart'
$keyPropertiesPath = Join-Path $projectRoot 'android\key.properties'

if ((Get-Content $pubspecPath -Raw) -notmatch '(?m)^version:\s*1\.0\.0\+6\s*$') {
    throw 'pubspec.yaml is not set to version 1.0.0+6.'
}

if ((Get-Content $pubspecPath -Raw) -notmatch 'flutter_secure_storage:\s*\^10\.3\.1') {
    throw 'The secure credential storage dependency is missing.'
}

if ((Get-Content $gradlePath -Raw) -notmatch 'applicationId\s*=\s*"au\.com\.pascoeneurology\.neurosol"') {
    throw 'The Android application ID is not au.com.pascoeneurology.neurosol.'
}

if ((Get-Content $gradlePath -Raw) -notmatch 'minSdk\s*=\s*23') {
    throw 'Android minSdk must be 23 for protected credential storage.'
}

if ((Get-Content $manifestPath -Raw) -notmatch 'android:allowBackup="false"') {
    throw 'Android backups must be disabled for the protected local clinical data.'
}

if ((Get-Content $apiConfigPath -Raw) -match 'NEUROTRACKER_API_KEY' -or
    (Get-Content $uploadServicePath -Raw) -match 'x-api-key') {
    throw 'A legacy shared mobile API key remains in the Build 6 source.'
}

if (-not (Test-Path $keyPropertiesPath)) {
    throw 'android\key.properties was not found.'
}

$keyProperties = Read-KeyProperties -Path $keyPropertiesPath
foreach ($requiredKey in @('storePassword', 'keyPassword', 'keyAlias', 'storeFile')) {
    if (-not $keyProperties.ContainsKey($requiredKey) -or
        [string]::IsNullOrWhiteSpace($keyProperties[$requiredKey])) {
        throw "android\key.properties is missing $requiredKey."
    }
}

$storeFile = $keyProperties['storeFile'] -replace '\\\\', '\'
if (-not [System.IO.Path]::IsPathRooted($storeFile)) {
    $storeFile = Join-Path (Join-Path $projectRoot 'android') $storeFile
}

if (-not (Test-Path $storeFile)) {
    throw "Keystore file not found: $storeFile"
}

$apiUrlDefine = '--dart-define=NEUROTRACKER_API_URL=https://tracker.melindapascoeneurology.com'

Write-Host ''
Write-Host 'Cleaning previous build output...'
Invoke-Flutter -Arguments @('clean')

Write-Host ''
Write-Host 'Restoring Flutter packages...'
Invoke-Flutter -Arguments @('pub', 'get')

Write-Host ''
Write-Host 'Formatting Flutter source...'
Invoke-Dart -Arguments @('format', 'lib', 'test')

Write-Host ''
Write-Host 'Analyzing Flutter source...'
Invoke-Flutter -Arguments @('analyze')

Write-Host ''
Write-Host 'Running Flutter tests...'
Invoke-Flutter -Arguments @('test')

Write-Host ''
Write-Host 'Building signed Android App Bundle...'
Invoke-Flutter -Arguments @(
    'build',
    'appbundle',
    '--release',
    '--build-name=1.0.0',
    '--build-number=6',
    $apiUrlDefine
)

Write-Host ''
Write-Host 'Building signed Android APK...'
Invoke-Flutter -Arguments @(
    'build',
    'apk',
    '--release',
    '--build-name=1.0.0',
    '--build-number=6',
    $apiUrlDefine
)

$sourceAab = Join-Path $projectRoot 'build\app\outputs\bundle\release\app-release.aab'
$sourceApk = Join-Path $projectRoot 'build\app\outputs\flutter-apk\app-release.apk'

if (-not (Test-Path $sourceAab)) {
    throw "Expected App Bundle was not created: $sourceAab"
}

if (-not (Test-Path $sourceApk)) {
    throw "Expected APK was not created: $sourceApk"
}

$releaseDirectory = Join-Path $projectRoot 'delivery\android-build6'
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null

$releaseAab = Join-Path $releaseDirectory 'NeuroSol-Symptom-Diary-1.0.0-build6.aab'
$releaseApk = Join-Path $releaseDirectory 'NeuroSol-Symptom-Diary-1.0.0-build6.apk'

Copy-Item $sourceAab $releaseAab -Force
Copy-Item $sourceApk $releaseApk -Force

Write-Host ''
Write-Host 'Build 6 completed successfully.'
Get-Item $releaseAab, $releaseApk |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize

Get-FileHash $releaseAab, $releaseApk -Algorithm SHA256 |
    Select-Object Path, Hash |
    Format-List

Write-Host 'Install the APK with:'
Write-Host '$Apk = (Resolve-Path ".\delivery\android-build6\NeuroSol-Symptom-Diary-1.0.0-build6.apk").Path'
Write-Host 'adb install -r "$Apk"'
