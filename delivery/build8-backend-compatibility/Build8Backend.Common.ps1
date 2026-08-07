Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object `
        Security.Principal.WindowsPrincipal `
        -ArgumentList $identity
    if (-not $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )) {
        throw 'Run this script from an elevated PowerShell window.'
    }
}

function Get-NeuroSolServiceRecord {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $escapedName = $ServiceName.Replace("'", "''")
    $record = Get-CimInstance Win32_Service `
        -Filter "Name='$escapedName'" `
        -ErrorAction Stop
    if (-not $record) {
        throw "Windows service '$ServiceName' was not found."
    }
    return $record
}

function Get-NeuroSolServiceParameters {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $registryPath =
        "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
    if (-not (Test-Path -LiteralPath $registryPath -PathType Container)) {
        return @{}
    }
    $parameters = Get-ItemProperty -LiteralPath $registryPath
    $result = @{}
    foreach ($name in @('AppDirectory', 'Application', 'AppParameters')) {
        $property = $parameters.PSObject.Properties[$name]
        if ($property -and $null -ne $property.Value) {
            $result[$name] = [Environment]::ExpandEnvironmentVariables(
                [string]$property.Value
            ).Trim('"')
        }
    }
    return $result
}

function Resolve-NeuroSolRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [string]$BackendPath = ''
    )

    $service = Get-NeuroSolServiceRecord -ServiceName $ServiceName
    $parameters = Get-NeuroSolServiceParameters -ServiceName $ServiceName
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($BackendPath) {
        $candidates.Add($BackendPath)
    } elseif ($parameters.ContainsKey('AppDirectory')) {
        $candidates.Add($parameters['AppDirectory'])
    }

    if (-not $BackendPath) {
        $candidates.Add('C:\Projects\neurotrackerapp\backend')
        $servicePath = [string]$service.PathName
        if ($servicePath -match '^\s*"([^"]+)"') {
            $serviceExecutable = $Matches[1]
        } elseif ($servicePath -match '^\s*([^\s]+)') {
            $serviceExecutable = $Matches[1]
        } else {
            $serviceExecutable = ''
        }
        if ($serviceExecutable) {
            $candidates.Add((Split-Path -Parent $serviceExecutable))
        }
    }

    $validCandidates = @(
        $candidates |
            Where-Object { $_ } |
            ForEach-Object {
                try {
                    $resolved = (Resolve-Path -LiteralPath $_ -ErrorAction Stop).Path
                    if (
                        (Test-Path -LiteralPath (Join-Path $resolved 'server.js')) -and
                        (Test-Path -LiteralPath (Join-Path $resolved '.env'))
                    ) {
                        $resolved
                    }
                } catch {
                    # A discovery candidate that does not exist is ignored.
                }
            } |
            Select-Object -Unique
    )

    if ($validCandidates.Count -eq 0) {
        throw (
            'Could not discover the live backend directory. Re-run with ' +
            '-BackendPath followed by the directory containing server.js and .env.'
        )
    }
    if ($validCandidates.Count -gt 1 -and -not $BackendPath) {
        throw (
            'More than one live backend directory was found: ' +
            ($validCandidates -join ', ') +
            '. Re-run with the correct -BackendPath.'
        )
    }
    $resolvedBackendPath = $validCandidates[0]

    $nodeExecutable = ''
    if ($parameters.ContainsKey('Application')) {
        $application = $parameters['Application']
        if (
            $application -match '(?i)node\.exe$' -and
            (Test-Path -LiteralPath $application -PathType Leaf)
        ) {
            $nodeExecutable = (Resolve-Path -LiteralPath $application).Path
        }
    }
    if (-not $nodeExecutable) {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($nodeCommand) {
            $nodeExecutable = $nodeCommand.Source
        }
    }
    if (-not $nodeExecutable) {
        $defaultNode = 'C:\Program Files\nodejs\node.exe'
        if (Test-Path -LiteralPath $defaultNode -PathType Leaf) {
            $nodeExecutable = $defaultNode
        }
    }
    if (-not $nodeExecutable) {
        throw 'The Node.js executable used by the backend could not be found.'
    }

    return [pscustomobject]@{
        Service = $service
        ServiceParameters = $parameters
        BackendPath = $resolvedBackendPath
        NodeExecutable = $nodeExecutable
    }
}

function Read-NeuroSolDotEnv {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Environment file not found: $Path"
    }
    $settings = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*#' -or $line -match '^\s*$') {
            continue
        }
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            continue
        }
        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if (
            $value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($settings.ContainsKey($key)) {
            throw "Environment file contains duplicate '$key' entries."
        }
        $settings[$key] = $value
    }
    return $settings
}

function Resolve-NeuroSolDataDirectory {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Settings,
        [Parameter(Mandatory = $true)][string]$BackendPath
    )

    if ($Settings.ContainsKey('DATA_DIR') -and $Settings['DATA_DIR']) {
        $dataDirectory = [Environment]::ExpandEnvironmentVariables(
            [string]($Settings['DATA_DIR'])
        )
        if (-not [IO.Path]::IsPathRooted($dataDirectory)) {
            $dataDirectory = Join-Path $BackendPath $dataDirectory
        }
    } else {
        $dataDirectory = Join-Path $BackendPath 'data'
    }
    return [IO.Path]::GetFullPath($dataDirectory)
}

function Set-NeuroSolDotEnvValues {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Updates
    )

    $originalAcl = Get-Acl -LiteralPath $Path
    $raw = [IO.File]::ReadAllText($Path)
    $newLine = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($line in ($raw -split "`r?`n")) {
        $lines.Add($line)
    }
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') {
        $lines.RemoveAt($lines.Count - 1)
    }

    foreach ($key in ($Updates.Keys | Sort-Object)) {
        # Do not name this variable $matches. PowerShell variable names are
        # case-insensitive and every -match expression replaces the automatic
        # $Matches hash table.
        $matchingIndexes = New-Object System.Collections.Generic.List[int]
        for ($index = 0; $index -lt $lines.Count; $index++) {
            if ($lines[$index] -match "^\s*$([regex]::Escape($key))\s*=") {
                $matchingIndexes.Add($index)
            }
        }
        if ($matchingIndexes.Count -gt 1) {
            throw "Environment file contains duplicate '$key' entries."
        }
        $replacement = "$key=$($Updates[$key])"
        if ($matchingIndexes.Count -eq 1) {
            $lines[$matchingIndexes[0]] = $replacement
        } else {
            $lines.Add($replacement)
        }
    }

    $transactionId = [Guid]::NewGuid().ToString('N')
    $temporaryPath = "$Path.build8-$transactionId.tmp"
    $replacementBackupPath = "$Path.build8-$transactionId.bak"
    try {
        $encoding = New-Object Text.UTF8Encoding -ArgumentList $false
        [IO.File]::WriteAllText(
            $temporaryPath,
            (($lines -join $newLine) + $newLine),
            $encoding
        )
        Set-Acl -LiteralPath $temporaryPath -AclObject $originalAcl
        [IO.File]::Replace(
            $temporaryPath,
            $Path,
            $replacementBackupPath,
            $true
        )
    } finally {
        foreach ($cleanupPath in @($temporaryPath, $replacementBackupPath)) {
            if (Test-Path -LiteralPath $cleanupPath -PathType Leaf) {
                Remove-Item -LiteralPath $cleanupPath -Force
            }
        }
    }
}

function Assert-NeuroSolPackageManifest {
    param([Parameter(Mandatory = $true)][string]$PackRoot)

    $resolvedRoot = (Resolve-Path -LiteralPath $PackRoot).Path
    $manifestPath = Join-Path $resolvedRoot 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Package manifest not found: $manifestPath"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw |
        ConvertFrom-Json
    if ($manifest.manifestVersion -ne 1 -or -not $manifest.files) {
        throw 'The deployment package manifest is invalid.'
    }
    $rootPrefix = $resolvedRoot.TrimEnd('\') + '\'
    $listedFiles = @{}
    foreach ($entry in $manifest.files) {
        $relativePath = [string]$entry.path
        if ($listedFiles.ContainsKey($relativePath)) {
            throw "Duplicate deployment manifest path: $relativePath"
        }
        $listedFiles[$relativePath] = $true
        $candidate = [IO.Path]::GetFullPath(
            (Join-Path $resolvedRoot $relativePath)
        )
        if (-not $candidate.StartsWith(
            $rootPrefix,
            [StringComparison]::OrdinalIgnoreCase
        )) {
            throw "Manifest path leaves the package root: $($entry.path)"
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Deployment package file is missing: $relativePath"
        }
        $candidateFile = Get-Item -LiteralPath $candidate
        if ([long]$candidateFile.Length -ne [long]$entry.length) {
            throw "Deployment package length mismatch: $relativePath"
        }
        $actualHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
        if ($actualHash -ne [string]($entry.sha256)) {
            throw "Deployment package hash mismatch: $relativePath"
        }
    }
    foreach ($actualFile in Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse) {
        if ($actualFile.FullName -eq $manifestPath) {
            continue
        }
        $relativePath = $actualFile.FullName.Substring(
            $resolvedRoot.Length
        ).TrimStart('\')
        if (-not $listedFiles.ContainsKey($relativePath)) {
            throw "Deployment package contains an unlisted file: $relativePath"
        }
    }
    return $manifest
}

function Set-NeuroSolBackupAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    & icacls.exe $Path '/inheritance:r' `
        '/grant:r' '*S-1-5-18:(OI)(CI)F' `
        '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict the backup ACL: $Path"
    }
}

function Wait-NeuroSolServiceState {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Running', 'Stopped')][string]$State,
        [int]$TimeoutSeconds = 60
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        if ([string]$service.Status -eq $State) {
            return
        }
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Service '$ServiceName' did not reach state '$State'."
}

function Stop-NeuroSolService {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $service = Get-Service -Name $ServiceName -ErrorAction Stop
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -ErrorAction Stop
        Wait-NeuroSolServiceState -ServiceName $ServiceName -State Stopped
    }
}

function Start-NeuroSolService {
    param([Parameter(Mandatory = $true)][string]$ServiceName)

    $service = Get-Service -Name $ServiceName -ErrorAction Stop
    if ($service.Status -ne 'Running') {
        Start-Service -Name $ServiceName -ErrorAction Stop
    }
    Wait-NeuroSolServiceState -ServiceName $ServiceName -State Running
}

function Wait-NeuroSolHealth {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUri,
        [int]$TimeoutSeconds = 90
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastError = $null
    do {
        try {
            $response = Invoke-RestMethod `
                -Uri "$($BaseUri.TrimEnd('/'))/health" `
                -Method Get `
                -TimeoutSec 10 `
                -Headers @{ 'Cache-Control' = 'no-cache' }
            if ($response.ok -eq $true) {
                return $response
            }
            $lastError = 'The health response did not contain ok=true.'
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Backend health check failed at $BaseUri. Last error: $lastError"
}

function Get-NeuroSolMobileConfig {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUri,
        [Parameter(Mandatory = $true)][int]$Build,
        [switch]$Canonical
    )

    $headers = @{
        'Cache-Control' = 'no-cache'
        'X-NeuroSol-Build' = [string]$Build
        'X-NeuroSol-Profile' = 'clinic-managed-v1'
    }
    if ($Canonical) {
        $headers['X-NeuroSol-Disorders'] = 'canonical-v1'
    }
    return Invoke-RestMethod `
        -Uri "$($BaseUri.TrimEnd('/'))/api/mobile-config" `
        -Method Get `
        -TimeoutSec 15 `
        -Headers $headers
}

function Assert-NeuroSolCompatibilityResponses {
    param([Parameter(Mandatory = $true)][string]$BaseUri)

    $health = Wait-NeuroSolHealth -BaseUri $BaseUri -TimeoutSeconds 30
    if (
        [int]$health.disorderCatalogVersion -ne 2 -or
        $health.customDisordersEnabled -ne $false
    ) {
        throw "Unexpected Build 8 health configuration at $BaseUri."
    }

    $build7 = Get-NeuroSolMobileConfig -BaseUri $BaseUri -Build 7
    if (
        [int]$build7.minimumBuild -ne 7 -or
        [int]$build7.latestBuild -ne 7 -or
        $build7.build7Supported -ne $true -or
        $build7.clinicManagedProfiles -ne $true -or
        [int]$build7.disorderCatalogVersion -ne 2 -or
        [int]$build7.preferredPayloadSchemaVersion -ne 1 -or
        $build7.customDisordersEnabled -ne $false
    ) {
        throw "Build 7 compatibility verification failed at $BaseUri."
    }

    $build8 = Get-NeuroSolMobileConfig `
        -BaseUri $BaseUri `
        -Build 8 `
        -Canonical
    if (
        [int]$build8.minimumBuild -ne 7 -or
        [int]$build8.latestBuild -ne 7 -or
        [int]$build8.disorderCatalogVersion -ne 2 -or
        [int]$build8.preferredPayloadSchemaVersion -ne 2 -or
        $build8.canonicalDisorders -ne $true -or
        $build8.customDisordersEnabled -ne $false
    ) {
        throw "Build 8 compatibility-layer verification failed at $BaseUri."
    }
}

function Restore-NeuroSolBackendBackup {
    param(
        [Parameter(Mandatory = $true)][string]$BackupPath,
        [int]$StartupTimeoutSeconds = 90
    )

    $resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
    $metadataPath = Join-Path $resolvedBackup 'deployment.json'
    if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
        throw "Backup metadata not found: $metadataPath"
    }
    $metadata = Get-Content -LiteralPath $metadataPath -Raw |
        ConvertFrom-Json
    if ($metadata.backupVersion -ne 1) {
        throw 'The backup metadata version is unsupported.'
    }

    $serviceName = [string]$metadata.serviceName
    $backendPath = [string]$metadata.backendPath
    $dataDirectory = [string]$metadata.dataDirectory
    $localBaseUri = [string]$metadata.localBaseUri
    if (
        -not (Test-Path -LiteralPath $backendPath -PathType Container) -or
        -not $serviceName -or
        -not $dataDirectory
    ) {
        throw 'The backup metadata contains invalid restore targets.'
    }
    if ([IO.Path]::GetFullPath($dataDirectory).TrimEnd('\') -eq
        [IO.Path]::GetFullPath($backendPath).TrimEnd('\')) {
        throw 'Refusing to restore because the data directory is the backend root.'
    }

    Stop-NeuroSolService -ServiceName $serviceName

    foreach ($file in $metadata.managedFiles) {
        $relativePath = [string]$file.path
        if ($relativePath -match '(^|[\\/])\.\.([\\/]|$)') {
            throw "Unsafe managed-file path in backup: $relativePath"
        }
        $target = Join-Path $backendPath $relativePath
        $source = Join-Path (Join-Path $resolvedBackup 'source') $relativePath
        if ($file.existed -eq $true) {
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                throw "Backed-up source file is missing: $source"
            }
            $targetParent = Split-Path -Parent $target
            if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) {
                New-Item -ItemType Directory -Path $targetParent | Out-Null
            }
            Copy-Item -LiteralPath $source -Destination $target -Force
        } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
            Remove-Item -LiteralPath $target -Force
        }
    }

    $environmentBackup = Join-Path $resolvedBackup 'environment\.env'
    if (-not (Test-Path -LiteralPath $environmentBackup -PathType Leaf)) {
        throw 'The backed-up production .env file is missing.'
    }
    $environmentTarget = Join-Path $backendPath '.env'
    $environmentAcl = $null
    if (Test-Path -LiteralPath $environmentTarget -PathType Leaf) {
        $environmentAcl = Get-Acl -LiteralPath $environmentTarget
    }
    Copy-Item `
        -LiteralPath $environmentBackup `
        -Destination $environmentTarget `
        -Force
    if ($environmentAcl) {
        Set-Acl -LiteralPath $environmentTarget -AclObject $environmentAcl
    }

    $dataBackup = Join-Path $resolvedBackup 'data'
    if (-not (Test-Path -LiteralPath $dataBackup -PathType Container)) {
        throw 'The backed-up clinical data directory is missing.'
    }
    if (Test-Path -LiteralPath $dataDirectory -PathType Container) {
        $failedDataPath = Join-Path $resolvedBackup (
            'failed-data-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' +
            [Guid]::NewGuid().ToString('N').Substring(0, 8)
        )
        Move-Item -LiteralPath $dataDirectory -Destination $failedDataPath
    }
    $dataParent = Split-Path -Parent $dataDirectory
    if (-not (Test-Path -LiteralPath $dataParent -PathType Container)) {
        New-Item -ItemType Directory -Path $dataParent | Out-Null
    }
    Copy-Item -LiteralPath $dataBackup -Destination $dataDirectory -Recurse

    Start-NeuroSolService -ServiceName $serviceName
    Wait-NeuroSolHealth `
        -BaseUri $localBaseUri `
        -TimeoutSeconds $StartupTimeoutSeconds | Out-Null
}
