# NeuroSol Symptom Diary

Flutter symptom and wellness diary for participating Pascoe Neurology patients,
with a CSV-backed clinician portal.

## Current release

- Public mobile version: `1.0.0+7` (remains supported)
- Build 8 release candidate: `1.0.0+8`
- Reconciled backend source: `0.10.0` (deploy before Build 8 mobile)
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

## Required updates

Every mobile API request identifies its build. Build 7 is public and its
support floor must remain locked at 7 throughout the Build 8 rollout. Deploy
backend `0.10.0` before releasing either Build 8 app with:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=false
ENABLE_INDEPENDENT_PROFILES=false
ENROLMENT_INCIDENT_LOCKDOWN=false
GOOGLE_PLAY_URL=https://play.google.com/store/apps/details?id=au.com.pascoeneurology.neurosol
APP_STORE_URL=https://apps.apple.com/au/app/neurosol-symptom-diary/id6796575355
```

Missing payload `schemaVersion` remains the Build 7/schema 1 contract. The
backend maps validated Build 7 labels to canonical disorder and symptom IDs
without changing `PatientId` or `ProfileRevision`. After Build 8 is
downloadable from both stores, `LATEST_MOBILE_BUILD` can become 8 and the
custom-catalogue and independent-profile gates can be enabled;
`MIN_SUPPORTED_MOBILE_BUILD` remains 7.

Use the packaged `Activate-NeuroSolBuild8.ps1` for that transition. It backs up
the environment and clinical data, verifies Build 7 and Build 8 contracts
locally and over public HTTPS, and rolls back automatically if activation
fails.

Build 8 schema 3 replaces disorder-nested symptom selection for new profile
revisions. Staff select one or more disorders and then independently select
between one and six unique symptoms. Each symptom is rated once. Existing
Build 7 nested profiles, profile revisions, payloads, and check-ins remain
supported unchanged.

Backend `0.10.0` also contains the enrolment-identity prevention and recovery
work: explicit create/edit modes, a blank new-patient form after code issue,
quarantined collision recovery, restored disentangled source identities, and
preserved recovered-device bridges. Mobile submissions are idempotent at both
ends: exact network retries do not add rows, changed reuse of a SubmissionId is
rejected, one PatientId/date is accepted once, and a locally staged entry can
be reconstructed safely after an interrupted save or upload.

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

## Android Build 8 release candidate

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

## iOS Build 8 release candidate

CodeMagic is the authoritative iOS signing environment. After pushing the
exact release commit to GitHub, configure the existing CodeMagic workflow to
use the Apple distribution signing integration already used for Build 7. Its
single Build 8 build command, from the repository root, is:

```bash
./delivery/build-neurosol-ios-build8.sh
```

The script applies the same reconciled-source and test gates, creates the
signed archive/IPA as version `1.0.0` build `8`, verifies the signed bundle ID,
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
[Build 8 compatible backend pack](delivery/build8-backend-compatibility/README.md)
for the protected migration and live Build 7 verification, and
[deploy/WINDOWS_HTTPS_DEPLOYMENT.md](deploy/WINDOWS_HTTPS_DEPLOYMENT.md) for the
Windows service topology.
