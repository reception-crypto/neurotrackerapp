[CmdletBinding()]
param(
    [string]$OutputDirectory = '',
    [switch]$SkipTests,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Command,
        [Parameter(Mandatory = $true)][string]$Description
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

$repositoryRoot = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..\..')
)
$backendRoot = Join-Path $repositoryRoot 'backend'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repositoryRoot 'delivery\release-packs'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) {
    $git = Get-Command git -ErrorAction SilentlyContinue
}
if (-not $git) {
    throw 'Git is required on the development PC to identify the release source.'
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    $node = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $node) {
    throw 'Node.js is required on the development PC.'
}
$gitExecutable = $git.Source
$nodeExecutable = $node.Source

$sourceCommit = (& $gitExecutable -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Could not determine the source commit.'
}
$publicBuild7Commit = 'e8e761733d73860c259d3486cf363487af35ff34'
& $gitExecutable -C $repositoryRoot merge-base --is-ancestor `
    $publicBuild7Commit $sourceCommit
if ($LASTEXITCODE -ne 0) {
    throw (
        'The source is not descended from the public Build 7 release ' +
        "$publicBuild7Commit."
    )
}

$sourceStatus = @(
    & $gitExecutable -C $repositoryRoot status --porcelain -- `
        backend `
        delivery/build8-backend-compatibility
)
if ($sourceStatus.Count -ne 0) {
    throw (
        'Backend or deployment-pack files are not committed. Commit them before ' +
        'building the production package.'
    )
}

$packageJson = Get-Content `
    -LiteralPath (Join-Path $backendRoot 'package.json') `
    -Raw | ConvertFrom-Json
if ($packageJson.version -ne '0.8.1') {
    throw "Expected backend version 0.8.1, found $($packageJson.version)."
}

if (-not $SkipTests) {
    Write-Host 'Running backend compatibility tests...'
    $backendTests = @(
        Get-ChildItem `
            -LiteralPath (Join-Path $backendRoot 'test') `
            -Filter '*.test.js' `
            -File |
            Sort-Object Name |
            ForEach-Object { $_.FullName }
    )
    Push-Location $backendRoot
    try {
        Invoke-CheckedCommand `
            -Command { & $nodeExecutable --test @backendTests } `
            -Description 'Backend compatibility tests'
    } finally {
        Pop-Location
    }

    $packTests = @(
        Get-ChildItem `
            -LiteralPath (Join-Path $PSScriptRoot 'test') `
            -Filter '*.test.js' `
            -File |
            Sort-Object Name |
            ForEach-Object { $_.FullName }
    )
    Invoke-CheckedCommand `
        -Command { & $nodeExecutable --test @packTests } `
        -Description 'Deployment data-verification tests'
}

$shortCommit = $sourceCommit.Substring(0, 12)
$packageName = "NeuroSol-Build8-Compatible-Backend-$shortCommit"
$zipPath = Join-Path $OutputDirectory "$packageName.zip"
$hashPath = "$zipPath.sha256.txt"
if ((Test-Path -LiteralPath $zipPath) -or (Test-Path -LiteralPath $hashPath)) {
    if (-not $Force) {
        throw "Release package already exists. Use -Force to replace: $zipPath"
    }
    foreach ($existingPath in @($zipPath, $hashPath)) {
        if (Test-Path -LiteralPath $existingPath) {
            Remove-Item -LiteralPath $existingPath -Force
        }
    }
}

if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}
$temporaryRoot = Join-Path `
    ([IO.Path]::GetTempPath()) `
    ("neurosol-pack-$([Guid]::NewGuid().ToString('N'))")
$packageRoot = Join-Path $temporaryRoot $packageName

$backendFiles = @(
    '.env.example',
    'README.md',
    'clinical_profiles.js',
    'disorder_catalog.js',
    'identity_store.js',
    'package-lock.json',
    'package.json',
    'server.js',
    'start-neurosol.cmd'
)
$packFiles = @(
    'Build8Backend.Common.ps1',
    'Deploy-Build8CompatibleBackend.ps1',
    'README.md',
    'Restore-Build8CompatibleBackend.ps1',
    'Verify-ClinicalData.js',
    'Verify-LiveBuild7Compatibility.ps1'
)

try {
    New-Item -ItemType Directory -Path $packageRoot | Out-Null
    $payloadRoot = Join-Path $packageRoot 'payload\backend'
    New-Item -ItemType Directory -Path $payloadRoot | Out-Null

    foreach ($relativePath in $backendFiles) {
        $sourcePath = Join-Path $backendRoot $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Backend release file is missing: $relativePath"
        }
        Copy-Item -LiteralPath $sourcePath -Destination $payloadRoot
    }
    Copy-Item `
        -LiteralPath (Join-Path $backendRoot 'test') `
        -Destination (Join-Path $payloadRoot 'test') `
        -Recurse

    foreach ($relativePath in $packFiles) {
        $sourcePath = Join-Path $PSScriptRoot $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Deployment utility is missing: $relativePath"
        }
        Copy-Item -LiteralPath $sourcePath -Destination $packageRoot
    }

    $release = [ordered]@{
        releaseFormat = 1
        product = 'NeuroSol Symptom Diary'
        backendVersion = '0.8.1'
        sourceCommit = $sourceCommit
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        minimumMobileBuild = 7
        latestMobileBuildDuringBackendPredeployment = 7
        customDisordersEnabledDuringBackendPredeployment = $false
    }
    $release | ConvertTo-Json -Depth 5 |
        Set-Content `
            -LiteralPath (Join-Path $packageRoot 'release.json') `
            -Encoding UTF8

    $manifestFiles = @()
    foreach ($file in @(
        Get-ChildItem -LiteralPath $packageRoot -File -Recurse |
            Sort-Object FullName
    )) {
        $relativePath = $file.FullName.Substring(
            $packageRoot.Length
        ).TrimStart('\')
        $manifestFiles += [ordered]@{
            path = $relativePath
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            length = $file.Length
        }
    }
    [ordered]@{
        manifestVersion = 1
        sourceCommit = $sourceCommit
        files = $manifestFiles
    } | ConvertTo-Json -Depth 8 |
        Set-Content `
            -LiteralPath (Join-Path $packageRoot 'manifest.json') `
            -Encoding UTF8

    Compress-Archive `
        -Path $packageRoot `
        -DestinationPath $zipPath `
        -CompressionLevel Optimal
    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    "$zipHash  $([IO.Path]::GetFileName($zipPath))" |
        Set-Content -LiteralPath $hashPath -Encoding ASCII

    Write-Host ''
    Write-Host 'Production deployment package created.'
    Write-Host "Package: $zipPath"
    Write-Host "SHA256: $zipHash"
    Write-Host "Source commit: $sourceCommit"
} finally {
    if (Test-Path -LiteralPath $temporaryRoot -PathType Container) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
