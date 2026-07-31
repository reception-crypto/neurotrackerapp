param(
    [switch] $SkipFlutterTests
)

$ErrorActionPreference = 'Stop'

function Resolve-ProjectRoot {
    $candidates = @($PSScriptRoot, (Split-Path -Parent $PSScriptRoot))
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'pubspec.yaml')) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw 'Place this script in the project root or its delivery folder.'
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed: $($Arguments -join ' ')"
    }
}

function Read-KeyProperties {
    param([Parameter(Mandatory = $true)][string] $Path)
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

foreach ($command in @('flutter', 'dart', 'npm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is not available in this PowerShell session."
    }
}

$pubspecPath = Join-Path $projectRoot 'pubspec.yaml'
$gradlePath = Join-Path $projectRoot 'android\app\build.gradle.kts'
$gradlePropertiesPath = Join-Path $projectRoot 'android\gradle.properties'
$manifestPath = Join-Path $projectRoot 'android\app\src\main\AndroidManifest.xml'
$identityPath = Join-Path $projectRoot 'lib\app_identity.dart'
$keyPropertiesPath = Join-Path $projectRoot 'android\key.properties'
$sourceText = (
    Get-ChildItem (Join-Path $projectRoot 'lib') -Recurse -File |
        Get-Content -Raw
) -join "`n"

if ((Get-Content $pubspecPath -Raw) -notmatch '(?m)^version:\s*1\.0\.0\+7\s*$') {
    throw 'pubspec.yaml is not set to version 1.0.0+7.'
}
if ((Get-Content $identityPath -Raw) -notmatch 'appBuildNumber\s*=\s*7') {
    throw 'The in-app build number is not 7.'
}
if ((Get-Content $gradlePath -Raw) -notmatch 'applicationId\s*=\s*"au\.com\.pascoeneurology\.neurosol"') {
    throw 'The Android application ID is not au.com.pascoeneurology.neurosol.'
}
if ((Get-Content $gradlePath -Raw) -notmatch 'minSdk\s*=\s*24') {
    throw 'Android minSdk must remain 24.'
}
if ((Get-Content $gradlePropertiesPath -Raw) -notmatch 'android\.builtInKotlin=false' -or
    (Get-Content $gradlePropertiesPath -Raw) -notmatch 'android\.newDsl=false') {
    throw 'The verified Flutter plugin compatibility settings are missing.'
}
if ((Get-Content $manifestPath -Raw) -notmatch 'android:allowBackup="false"') {
    throw 'Android backups must be disabled for protected local clinical data.'
}
if ($sourceText -match 'ProfileScreen|SymptomSelectionScreen|Edit patient profile') {
    throw 'Obsolete patient self-configuration code remains in lib.'
}
if ($sourceText -notmatch 'clinic-managed-v1' -or
    $sourceText -notmatch 'X-NeuroSol-Build') {
    throw 'The Build 7 clinic-profile protocol is missing.'
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

Write-Host 'Cleaning previous build output...'
Invoke-Checked -Command 'flutter' -Arguments @('clean')

Write-Host 'Restoring Flutter packages...'
Invoke-Checked -Command 'flutter' -Arguments @('pub', 'get')

Write-Host 'Formatting Flutter source...'
Invoke-Checked -Command 'dart' -Arguments @('format', 'lib', 'test')

Write-Host 'Analyzing Flutter source...'
Invoke-Checked -Command 'flutter' -Arguments @('analyze')

Write-Host 'Running backend tests...'
Push-Location (Join-Path $projectRoot 'backend')
try {
    Invoke-Checked -Command 'npm' -Arguments @('test')
}
finally {
    Pop-Location
}

if ($SkipFlutterTests) {
    Write-Warning 'Flutter tests were explicitly skipped. Do not publish this output until flutter test passes separately.'
} else {
    Write-Host 'Running Flutter tests...'
    Invoke-Checked -Command 'flutter' -Arguments @('test', '--reporter', 'expanded')
}

Write-Host 'Building signed Android App Bundle...'
Invoke-Checked -Command 'flutter' -Arguments @(
    'build', 'appbundle', '--release',
    '--build-name=1.0.0', '--build-number=7', $apiUrlDefine
)

Write-Host 'Building signed Android APK...'
Invoke-Checked -Command 'flutter' -Arguments @(
    'build', 'apk', '--release',
    '--build-name=1.0.0', '--build-number=7', $apiUrlDefine
)

$sourceAab = Join-Path $projectRoot 'build\app\outputs\bundle\release\app-release.aab'
$sourceApk = Join-Path $projectRoot 'build\app\outputs\flutter-apk\app-release.apk'
if (-not (Test-Path $sourceAab)) {
    throw "Expected App Bundle was not created: $sourceAab"
}
if (-not (Test-Path $sourceApk)) {
    throw "Expected APK was not created: $sourceApk"
}

$releaseDirectory = Join-Path $projectRoot 'delivery\android-build7'
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
$releaseAab = Join-Path $releaseDirectory 'NeuroSol-Symptom-Diary-1.0.0-build7.aab'
$releaseApk = Join-Path $releaseDirectory 'NeuroSol-Symptom-Diary-1.0.0-build7.apk'
Copy-Item $sourceAab $releaseAab -Force
Copy-Item $sourceApk $releaseApk -Force

Write-Host 'Build 7 completed successfully.'
Get-Item $releaseAab, $releaseApk |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize
Get-FileHash $releaseAab, $releaseApk -Algorithm SHA256 |
    Select-Object Path, Hash |
    Format-List

Write-Host 'Install the APK with:'
Write-Host '$Apk = (Resolve-Path ".\delivery\android-build7\NeuroSol-Symptom-Diary-1.0.0-build7.apk").Path'
Write-Host 'adb install -r "$Apk"'
