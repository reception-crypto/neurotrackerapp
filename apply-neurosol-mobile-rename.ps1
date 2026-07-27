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

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Set-TextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Content
    )

    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Replace-Literal {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $OldValue,

        [Parameter(Mandatory = $true)]
        [string] $NewValue
    )

    if (-not (Test-Path $Path)) {
        throw "Required file not found: $Path"
    }

    $content = [System.IO.File]::ReadAllText($Path)
    $updated = $content.Replace($OldValue, $NewValue)
    if ($updated -ne $content) {
        Set-TextFile -Path $Path -Content $updated
    }
}

function Backup-File {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $ProjectRoot,

        [Parameter(Mandatory = $true)]
        [string] $BackupRoot
    )

    if (-not (Test-Path $Path)) {
        return
    }

    $resolvedPath = (Resolve-Path $Path).Path
    $relativePath = $resolvedPath.Substring($ProjectRoot.Length).TrimStart(
        [System.IO.Path]::DirectorySeparatorChar
    )
    $destination = Join-Path $BackupRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item $resolvedPath $destination -Force
}

$projectRoot = Resolve-ProjectRoot
Set-Location $projectRoot

$pubspecPath = Join-Path $projectRoot 'pubspec.yaml'
if ((Get-Content $pubspecPath -Raw) -notmatch '(?m)^version:\s*1\.0\.0\+4\s*$') {
    throw 'pubspec.yaml must be set to version 1.0.0+4 before applying the rename.'
}

$dartFiles = @(
    Get-ChildItem (Join-Path $projectRoot 'lib') -Filter '*.dart' -File -Recurse
)

$widgetTestPath = Join-Path $projectRoot 'test\widget_test.dart'
if (Test-Path $widgetTestPath) {
    $dartFiles += Get-Item $widgetTestPath
}

$androidGradlePath = Join-Path $projectRoot 'android\app\build.gradle.kts'
$androidManifestPath = Join-Path $projectRoot 'android\app\src\main\AndroidManifest.xml'
$oldMainActivityPath = Join-Path $projectRoot 'android\app\src\main\kotlin\au\com\pascoeneurology\neurotracker\MainActivity.kt'
$newMainActivityPath = Join-Path $projectRoot 'android\app\src\main\kotlin\au\com\pascoeneurology\neurosol\MainActivity.kt'
$iosProjectPath = Join-Path $projectRoot 'ios\Runner.xcodeproj\project.pbxproj'
$iosInfoPath = Join-Path $projectRoot 'ios\Runner\Info.plist'

$backupRoot = Join-Path $projectRoot (
    'delivery\pre-neurosol-mobile-rename-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
)

foreach ($file in $dartFiles) {
    Backup-File -Path $file.FullName -ProjectRoot $projectRoot -BackupRoot $backupRoot
}

foreach ($path in @(
    $androidGradlePath,
    $androidManifestPath,
    $oldMainActivityPath,
    $newMainActivityPath,
    $iosProjectPath,
    $iosInfoPath
)) {
    Backup-File -Path $path -ProjectRoot $projectRoot -BackupRoot $backupRoot
}

foreach ($file in $dartFiles) {
    $content = [System.IO.File]::ReadAllText($file.FullName)
    $updated = $content.Replace(
        'NeuroTracker Clinical',
        'NeuroSol Symptom Diary'
    )
    $updated = $updated.Replace('NeuroTracker', 'NeuroSol')

    if ($updated -ne $content) {
        Set-TextFile -Path $file.FullName -Content $updated
    }
}

Replace-Literal `
    -Path $androidGradlePath `
    -OldValue 'au.com.pascoeneurology.neurotracker' `
    -NewValue 'au.com.pascoeneurology.neurosol'

Replace-Literal `
    -Path $androidManifestPath `
    -OldValue 'android:label="NeuroTracker Clinical"' `
    -NewValue 'android:label="NeuroSol"'

$oldMainActivityExists = Test-Path $oldMainActivityPath
$newMainActivityExists = Test-Path $newMainActivityPath

if ($oldMainActivityExists -and $newMainActivityExists) {
    throw 'Both old and new MainActivity files exist. Resolve this before continuing.'
}

if ($oldMainActivityExists) {
    Replace-Literal `
        -Path $oldMainActivityPath `
        -OldValue 'package au.com.pascoeneurology.neurotracker' `
        -NewValue 'package au.com.pascoeneurology.neurosol'

    $newMainActivityDirectory = Split-Path -Parent $newMainActivityPath
    New-Item -ItemType Directory -Path $newMainActivityDirectory -Force | Out-Null
    Move-Item $oldMainActivityPath $newMainActivityPath
}
elseif ($newMainActivityExists) {
    Replace-Literal `
        -Path $newMainActivityPath `
        -OldValue 'package au.com.pascoeneurology.neurotracker' `
        -NewValue 'package au.com.pascoeneurology.neurosol'
}
else {
    throw 'MainActivity.kt was not found in either the old or new package path.'
}

Replace-Literal `
    -Path $iosProjectPath `
    -OldValue 'au.com.pascoeneurology.neurotracker' `
    -NewValue 'au.com.pascoeneurology.neurosol'

Replace-Literal `
    -Path $iosInfoPath `
    -OldValue '<string>NeuroTracker Clinical</string>' `
    -NewValue '<string>NeuroSol</string>'

$gradleContent = Get-Content $androidGradlePath -Raw
if ($gradleContent -notmatch 'namespace\s*=\s*"au\.com\.pascoeneurology\.neurosol"' -or
    $gradleContent -notmatch 'applicationId\s*=\s*"au\.com\.pascoeneurology\.neurosol"') {
    throw 'Android namespace or application ID validation failed.'
}

if (-not (Test-Path $newMainActivityPath)) {
    throw 'The renamed MainActivity.kt was not created.'
}

$newMainActivityContent = Get-Content $newMainActivityPath -Raw
if ($newMainActivityContent -notmatch 'package\s+au\.com\.pascoeneurology\.neurosol') {
    throw 'The MainActivity package declaration was not renamed.'
}

$remainingOldMobileBrand = Select-String `
    -Path ($dartFiles.FullName) `
    -Pattern 'NeuroTracker' `
    -SimpleMatch

if ($remainingOldMobileBrand) {
    throw 'At least one old NeuroTracker reference remains in the Flutter source.'
}

Write-Host ''
Write-Host 'NeuroSol mobile rename completed successfully.'
Write-Host "Backup created at: $backupRoot"
Write-Host ''
Write-Host 'Android identity:'
Select-String $androidGradlePath -Pattern 'namespace|applicationId'
Write-Host ''
Write-Host 'Run next:'
Write-Host 'dart format lib test'
Write-Host 'flutter analyze'
Write-Host 'flutter test'
