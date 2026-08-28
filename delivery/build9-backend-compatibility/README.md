# Build 9 compatible backend deployment

This package deploys backend `0.11.0` before either Build 9 mobile release. It
keeps the active Build 8 configuration and all Build 7 compatibility:

- `MIN_SUPPORTED_MOBILE_BUILD=7`
- `LATEST_MOBILE_BUILD=8` during backend predeployment
- `ENABLE_CUSTOM_DISORDERS=true`
- `ENABLE_INDEPENDENT_PROFILES=true`
- `MAX_BACKDATE_DAYS=7`
- Build 7 receives schema 1 and latest build 7
- Build 8 receives schema 3 and latest build 8
- Build 9 can exercise the diary contract but is not advertised until store
  release

The package adds optional unique BP Patient IDs, authenticated portal search,
patient-scoped diary history, and validated seven-day backdating. Existing
submission idempotency, one-entry-per-patient/date enforcement, identity
recovery, clinical profile revisions, and Build 7/8 payload contracts remain
intact.

It contains no `.env`, credentials, patient data, `node_modules`, or mobile
binary, and it requires no package downloads on the terminal server.

## 1. Create the package on the development PC

Run in an ordinary PowerShell window from the clean, committed repository:

```powershell
Set-Location C:\Projects\neurotrackerapp

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\delivery\build9-backend-compatibility\New-Build9BackendDeploymentPack.ps1
```

The command runs the backend and clinical-data verification suites, then writes
a ZIP and matching SHA-256 file under `delivery\release-packs`. Transfer both
with the clinic-approved method and compare the ZIP hash before extraction.

## 2. Deploy on the terminal server

Extract the ZIP beneath `C:\NeuroSolDeployment`. Open PowerShell as
Administrator and run from the exact extracted package directory:

```powershell
$Pack = 'C:\NeuroSolDeployment\NeuroSol-Build9-Compatible-Backend-REPLACE_WITH_COMMIT'
Set-Location $Pack

.\Deploy-Build9CompatibleBackend.ps1 `
  -BackendPath 'C:\Projects\neurotrackerapp\backend'
```

The live terminal-server Git checkout does not need to match the development
PC. The package is commit-bound and manifest-verified, and the deployment
script targets the service backend directory explicitly.

The deployment:

1. verifies every packaged file and the source commit;
2. checks installed Node dependencies and runs all backend tests in isolation;
3. stops `NeuroSolBackend` for a consistent source, `.env`, and clinical-data
   backup;
4. preserves production secrets and all unrelated environment settings;
5. installs backend `0.11.0` with latest build still set to 8;
6. verifies migrations did not change patient, device, profile-history, or CSV
   row counts;
7. verifies local and public Build 7, Build 8, and gated Build 9 responses;
8. automatically restores the prior backend, environment, and data if any
   guarded step fails.

Do not use `-SkipPublicVerification` for production unless the public URL is
independently known to be temporarily unavailable.

## 3. Verify the live backend

The verification is non-mutating and prints counts only:

```powershell
.\Verify-LiveBuild789Compatibility.ps1 `
  -BackendPath 'C:\Projects\neurotrackerapp\backend'
```

Complete the portal, Build 7, Build 8, and Build 9 acceptance checks in
`BUILD9_RELEASE_CHECKLIST.md` before store release.

## 4. Activate Build 9 after both stores are live

Only after Build 9 is publicly downloadable in App Store and Google Play:

```powershell
.\Activate-NeuroSolBuild9.ps1 `
  -BackendPath 'C:\Projects\neurotrackerapp\backend' `
  -Confirmation 'ACTIVATE BUILD 9 AFTER BOTH STORES ARE LIVE'
```

Activation creates another protected environment/data backup and changes only
the advertised latest build from 8 to 9. Minimum build stays 7, both Build 8
profile features remain enabled, and the seven-day backdating limit stays
fixed. The script verifies all three mobile contracts locally and publicly and
rolls back automatically on failure.

## Manual rollback

To deliberately restore the backend/data snapshot from deployment, use the
exact backup path printed by the deployment command:

```powershell
.\Restore-Build9CompatibleBackend.ps1 `
  -BackupPath 'C:\NeuroSolDeployment\Backups\Build9-Compatibility-REPLACE_ME'
```

Rollback moves newer data into a timestamped retained directory before
restoring the snapshot. It does not silently delete post-deployment clinical
data.
