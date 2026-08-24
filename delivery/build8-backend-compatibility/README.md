# Build 8 compatible backend deployment

This package deploys reconciled backend `0.10.0` before either Build 8 mobile
app is released. It keeps the public Build 7 app fully supported:

- `MIN_SUPPORTED_MOBILE_BUILD=7`
- `LATEST_MOBILE_BUILD=7`
- `ENABLE_CUSTOM_DISORDERS=false`
- `ENABLE_INDEPENDENT_PROFILES=false`
- custom symptoms may be prepared in the catalogue, but Build 8-only profile
  assignments remain gated
- new custom symptom IDs are readable, immutable slugs derived from the
  original approved name; unused UUID-style IDs from backend 0.8.1 are
  migrated with aliases and an audit event
- payloads without `schemaVersion` remain Build 7/schema 1
- `PatientId` and `ProfileRevision` remain authoritative
- the new schema-3 model supports independently selected disorders and between
  one and six unique symptoms, but cannot be assigned while its gate is off
- explicit new-patient/edit modes prevent the clinician portal from silently
  reusing a PatientId when consecutive enrolments are created
- identity-collision recovery, restored disentangled source identities, and
  recovered-device bridges remain intact
- exact schema-1/2/3 retries are idempotent; changed SubmissionId reuse and a
  second PatientId/date submission are rejected
- both mobile-store URLs are installed and verified, including the live App
  Store listing

It does not contain `.env`, credentials, patient data, `node_modules`, or any
mobile binary. It does not download packages on the terminal server.

## 1. Create the package on the development PC

Run from an ordinary PowerShell window in the clean, committed repository:

```powershell
Set-Location C:\Projects\neurotrackerapp

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\delivery\build8-backend-compatibility\New-Build8BackendDeploymentPack.ps1
```

The script runs both backend test suites and creates a ZIP plus SHA-256 file in
`delivery\release-packs`. Copy both files to the terminal server using the
clinic's approved transfer method. Compare the terminal-server ZIP hash with
the hash printed on the development PC before extraction; the
`.sha256.txt` file is a convenient second record.

## 2. Deploy on the terminal server

Extract the ZIP beneath `C:\NeuroSolDeployment`. Open **PowerShell as
Administrator**, then use the exact extracted folder printed by the build
script. For example:

```powershell
$Pack = 'C:\NeuroSolDeployment\NeuroSol-Build8-Compatible-Backend-REPLACE_WITH_COMMIT'

Set-Location $Pack

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\Deploy-Build8CompatibleBackend.ps1
```

The script discovers the NSSM service working directory. If discovery reports
more than one possible backend, rerun with the known live path:

```powershell
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\Deploy-Build8CompatibleBackend.ps1 `
  -BackendPath 'C:\Projects\neurotrackerapp\backend'
```

The deployment:

1. verifies every packaged file against `manifest.json`;
2. confirms the current service is healthy and its Node dependencies exist;
3. runs the complete backend and clinical-data verification suites with
   temporary synthetic data;
4. stops `NeuroSolBackend` for a consistent snapshot;
5. backs up source, `.env`, and the complete clinical data directory;
6. preserves `IDENTITY_SECRET`, `ADMIN_PASSWORD`, and all other settings;
7. locks minimum/latest mobile build to 7 and both Build 8-only profile gates
   off;
8. starts the new backend and runs the canonical migrations;
9. proves patient, device, profile-history, and CSV row counts did not change;
10. verifies local and public HTTPS responses for Build 7 and Build 8 headers.

If any step after backup fails, it automatically restores the previous source,
`.env`, and clinical data, restarts the old backend, and verifies health.

Do not use `-SkipPublicVerification` for the production rollout unless the
public URL is independently known to be temporarily unavailable. Local checks
always run.

## 3. Repeat the non-mutating verification

```powershell
Set-Location $Pack

powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\Verify-LiveBuild7Compatibility.ps1
```

This prints counts only; it never prints names, IDs, tokens, codes, or secrets.

## 4. Complete the clinic check with Build 7

Before any Build 8 mobile release:

1. Open the public Build 7 app on the clinic test phone.
2. Confirm its existing clinic-managed profile synchronises.
3. Submit one synthetic daily check-in and confirm it appears under the same
   Support ID and `ProfileRevision` in the portal.
4. Confirm an exact retry does not add CSV rows and a different second
   submission for the same PatientId/date is rejected.
5. Confirm built-in disorder filters, patient history, CSV export, and PDF
   output still work.
6. Leave Build 8-only custom disorder/symptom assignments and independent
   profiles disabled.

Record the backup path printed by deployment and keep it until Build 7 and
Build 8 traffic has been observed safely in production.

## 5. Activate Build 8 after both stores are live

Do not run this while either Build 8 store release is unavailable. Once both
listings are downloadable, run from an elevated PowerShell window:

```powershell
Set-Location $Pack

.\Activate-NeuroSolBuild8.ps1 `
  -Confirmation 'ACTIVATE BUILD 8 AFTER BOTH STORES ARE LIVE'
```

The activation creates an Administrator-only `.env` and clinical-data backup,
keeps `MIN_SUPPORTED_MOBILE_BUILD=7`, sets `LATEST_MOBILE_BUILD=8`, enables the
custom catalogue and independent profile model, restarts the service, proves
Build 7 still receives its compatible contract, proves Build 8 receives schema
3, and checks the public HTTPS path. Any failed check restores the
preactivation environment and data automatically.

## Manual rollback

Automatic rollback covers deployment failures. To deliberately restore a
successful deployment later, use the exact backup path printed by deployment:

```powershell
powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\Restore-Build8CompatibleBackend.ps1 `
  -BackupPath 'C:\NeuroSolDeployment\Backups\Build8-Compatibility-REPLACE_ME'
```

The rollback command asks for confirmation. Add `-Force` only when the target
backup path has already been checked. Rollback returns the live data to the
pre-deployment point in time. It first moves the newer data into a timestamped
`failed-data-*` directory inside the protected backup, so it is retained for
clinical reconciliation rather than deleted.
