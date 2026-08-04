# NeuroSol Symptom Diary

Flutter symptom and wellness diary for participating Pascoe Neurology patients,
with a CSV-backed clinician portal.

## Current release

- Public mobile version: `1.0.0+7` (remains supported)
- Compatible backend source: `0.8.0` (deploy before Build 8 mobile)
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
backend `0.8.0` before releasing either Build 8 app with:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=false
```

Missing payload `schemaVersion` remains the Build 7/schema 1 contract. The
backend maps validated Build 7 labels to canonical disorder and symptom IDs
without changing `PatientId` or `ProfileRevision`. After Build 8 is
downloadable from both stores, `LATEST_MOBILE_BUILD` can become 8 and custom
disorders can be enabled; `MIN_SUPPORTED_MOBILE_BUILD` remains 7.

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

## Android Build 7

Release signing uses the permanent `android/key.properties` and keystore
already configured for this application ID. Keep both outside source control
and maintain an offline backup.

From the project root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build7.ps1
```

The script verifies the identity, version, clinic-managed workflow, Android
security settings, signing configuration, formatting, analysis, tests, AAB,
APK, and SHA-256 hashes. `-SkipFlutterTests` exists only for diagnosing a stuck
test process; output made with it must not be published until `flutter test`
passes separately.

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
