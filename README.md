# NeuroSol Symptom Diary

Flutter symptom and wellness diary for participating Pascoe Neurology patients,
with a CSV-backed clinician portal.

## Current release

- Supported public mobile versions: Build 7 `1.0.0+7` and Build 8 `1.1.0+8`
- Build 9 release candidate: `1.2.0+9`
- Build 9 backend source: `0.11.0` (deploy before Build 9 mobile)
- Android application ID: `au.com.pascoeneurology.neurosol`
- Apple bundle ID: `au.com.pascoeneurology.neurosol`
- Production API: `https://tracker.melindapascoeneurology.com`

## Build 7 clinic-managed workflow

1. Dr Pascoe or authorised clinic staff create the patient in
   `/admin/enrolments`.
2. Staff select one or two disorders and exactly three symptoms for each.
3. The portal produces a seven-day, one-time enrolment link and code. The
   clinic sends either through its existing email or SMS process.
4. The patient installs the newest app and enters the code. The link itself
   displays no patient information and does not consume the code.
5. The app receives the versioned clinic profile. Patients may change only the
   daily reminder time.
6. Later staff changes synchronise to the app on launch, resume, or refresh.
   Pending entries retain the profile revision under which they were recorded.

The app retains its once-per-day home-screen workflow, notification entry
point, offline queue, local history, HTTPS-only release traffic, consent gate,
support ID, and emergency/medical disclaimers.

## Build 9 compatibility contract

Every mobile API request identifies its build. Build 7 and Build 8 remain
supported, and the global support floor remains locked at 7. Predeploy backend
`0.11.0` before releasing either Build 9 app with:

```env
LATEST_MOBILE_BUILD=8
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=true
ENABLE_INDEPENDENT_PROFILES=true
MAX_BACKDATE_DAYS=7
ENROLMENT_INCIDENT_LOCKDOWN=false
GOOGLE_PLAY_URL=https://play.google.com/store/apps/details?id=au.com.pascoeneurology.neurosol
APP_STORE_URL=https://apps.apple.com/app/id6796575355
```

After Build 9 is downloadable from both stores, change only
`LATEST_MOBILE_BUILD` to `9`. Build-specific configuration advertising keeps
Build 7 on latest 7 and Build 8 on latest 8, so neither supported release is
forced to update.

Build 9 adds an optional unique BP Patient ID and authenticated patient search
to the clinician portal. The mobile app receives only its own clinic-held diary
history and displays 30, 60, and 90-day wellness and symptom line graphs.
Patients can submit today or one of the previous seven calendar days; the
existing exact-retry and one-patient/date protections remain in force.

Missing payload `schemaVersion` still follows the Build 7/schema 1 contract,
including genuine queued Build 7/8 entries uploaded after an app upgrade.

Build 8 schema 3 replaces disorder-nested symptom selection for new profile
revisions. Staff select one or more disorders and then independently select
between one and six unique symptoms. Each symptom is rated once. Existing
Build 7 nested profiles, profile revisions, payloads, and check-ins remain
supported unchanged.

Backend `0.11.0` also contains the enrolment-identity prevention and recovery
work: explicit create/edit modes, a blank new-patient form after code issue,
quarantined collision recovery, restored disentangled source identities, and
preserved recovered-device bridges. Mobile submissions are idempotent at both
ends: exact network retries do not add rows, changed reuse of a SubmissionId is
rejected, one PatientId/date is accepted once, and a locally staged entry can
be reconstructed safely after an interrupted save or upload.

Use [BUILD9_RELEASE_CHECKLIST.md](BUILD9_RELEASE_CHECKLIST.md) as the
authoritative Build 9 rollout and global-availability checklist.

## Development checks

```cmd
flutter pub get
dart format lib test
flutter analyze
flutter test
```

Backend:

```cmd
cd backend
npm ci
npm test
```

For a local debug run:

```cmd
flutter run --dart-define=NEUROTRACKER_API_URL=http://YOUR-SERVER-IP:3000
```

## Build 9 release tooling

After the final Build 9 source is committed, create the signed Android AAB and
upgrade-test APK on the development PC with:

```powershell
.\delivery\build-neurosol-android-build9.ps1
```

Create the commit-bound terminal-server backend package with:

```powershell
.\delivery\build9-backend-compatibility\New-Build9BackendDeploymentPack.ps1
```

CodeMagic creates the signed iOS IPA from the same commit with:

```bash
./delivery/build-neurosol-ios-build9.sh
```

See [delivery/CODEMAGIC_BUILD9.md](delivery/CODEMAGIC_BUILD9.md) and the
[Build 9 backend deployment guide](delivery/build9-backend-compatibility/README.md).

## Historical Build 8 Android tooling

The following script is retained for reproducibility of the signed Build 8
source and intentionally rejects the current Build 9 identity.

Release signing uses the permanent `android/key.properties` and keystore
already configured for this application ID. Keep both outside source control
and maintain an offline backup.

From the project root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build8.ps1
```

The script verifies the independent symptom/disorder architecture, visual
identity, enrolment-management safeguards, local/server idempotency, Android
security settings, signing configuration, formatting, analysis, backend and
Flutter tests, AAB, APK, source commit, and SHA-256 hashes.
`-SkipFlutterTests` exists only for diagnosing a stuck test process; output
from that diagnostic run is not built or packaged.

## Historical Build 8 iOS tooling

CodeMagic is the authoritative iOS signing environment. After pushing the
exact release commit to GitHub, configure the existing CodeMagic workflow to
use the Apple distribution signing integration already used for Build 7. Its
single Build 8 build command, from the repository root, is:

```bash
./delivery/build-neurosol-ios-build8.sh
```

The script applies the same reconciled-source and test gates, creates the
signed archive/IPA as version `1.1.0` build `8`, verifies the signed bundle ID,
and records the source commit, source tree, size, and SHA-256 in
`delivery/ios-build8/release.json`. `--skip-flutter-tests` is diagnostic only
and stops before any signed release artifact is built.

CodeMagic should collect `delivery/ios-build8/*.ipa` and
`delivery/ios-build8/release.json` as artifacts. Do not also run a separate
`flutter build ipa` step. See
[delivery/CODEMAGIC_BUILD8.md](delivery/CODEMAGIC_BUILD8.md).

## Production data

The backend runtime directory contains:

- `symptom_entries.csv`
- `identity_store.json`
- `disorder_catalog.json`
- automatic migration/deletion backups

Back up the CSV, identity store, and disorder catalogue together. Keep the production `.env`,
`IDENTITY_SECRET`, signing material, clinical exports, and patient screenshots
out of Git.

Use the
[Build 9 compatible backend pack](delivery/build9-backend-compatibility/README.md)
for the protected migration and live Build 7/8/9 verification, and
[deploy/WINDOWS_HTTPS_DEPLOYMENT.md](deploy/WINDOWS_HTTPS_DEPLOYMENT.md) for the
Windows service topology.
