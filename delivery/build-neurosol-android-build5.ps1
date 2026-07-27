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

$pubspecPath = Join-Path $projectRoot 'pubspec.yaml'
$gradlePath = Join-Path $projectRoot 'android\app\build.gradle.kts'
$keyPropertiesPath = Join-Path $projectRoot 'android\key.properties'

if ((Get-Content $pubspecPath -Raw) -notmatch '(?m)^version:\s*1\.0\.0\+5\s*$') {
    throw 'pubspec.yaml is not set to version 1.0.0+5.'
}

if ((Get-Content $gradlePath -Raw) -notmatch 'applicationId\s*=\s*"au\.com\.pascoeneurology\.neurosol"') {
    throw 'The Android application ID is not au.com.pascoeneurology.neurosol.'
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

$secureApiKey = Read-Host 'Enter the production mobile API key' -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new(
    'unused',
    $secureApiKey
)
$apiKey = $credential.GetNetworkCredential().Password

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'The production mobile API key cannot be blank.'
}

$apiUrlDefine = '--dart-define=NEUROTRACKER_API_URL=https://tracker.melindapascoeneurology.com'
$apiKeyDefine = "--dart-define=NEUROTRACKER_API_KEY=$apiKey"

try {
    Write-Host ''
    Write-Host 'Cleaning previous build output...'
    Invoke-Flutter -Arguments @('clean')

    Write-Host ''
    Write-Host 'Restoring Flutter packages...'
    Invoke-Flutter -Arguments @('pub', 'get')

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
        '--build-number=5',
        $apiUrlDefine,
        $apiKeyDefine
    )

    Write-Host ''
    Write-Host 'Building signed Android APK...'
    Invoke-Flutter -Arguments @(
        'build',
        'apk',
        '--release',
        '--build-name=1.0.0',
        '--build-number=5',
        $apiUrlDefine,
        $apiKeyDefine
    )
}
finally {
    $apiKey = $null
    $apiKeyDefine = $null
    $credential = $null
    $secureApiKey = $null
}

$sourceAab = Join-Path $projectRoot 'build\app\outputs\bundle\release\app-release.aab'
$sourceApk = Join-Path $projectRoot 'build\app\outputs\flutter-apk\app-release.apk'

if (-not (Test-Path $sourceAab)) {
    throw "Expected App Bundle was not created: $sourceAab"
}

if (-not (Test-Path $sourceApk)) {
    throw "Expected APK was not created: $sourceApk"
}

$releaseDirectory = Join-Path $projectRoot 'delivery\android-build5'
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null

$releaseAab = Join-Path $releaseDirectory 'NeuroSol-Symptom-Diary-1.0.0-build5.aab'
$releaseApk = Join-Path $releaseDirectory 'NeuroSol-Symptom-Diary-1.0.0-build5.apk'

Copy-Item $sourceAab $releaseAab -Force
Copy-Item $sourceApk $releaseApk -Force

Write-Host ''
Write-Host 'Build 5 completed successfully.'
Get-Item $releaseAab, $releaseApk |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize

Get-FileHash $releaseAab, $releaseApk -Algorithm SHA256 |
    Select-Object Path, Hash |
    Format-List

Write-Host 'Install the APK with:'
Write-Host '$Apk = (Resolve-Path ".\delivery\android-build5\NeuroSol-Symptom-Diary-1.0.0-build5.apk").Path'
Write-Host 'adb install -r "$Apk"'
