# NeuroSol Symptom Diary

Flutter symptom and wellness diary for participating Pascoe Neurology patients,
with a CSV-backed clinician portal.

## Current release

- App version: `1.0.0+7`
- Backend version: `0.7.0`
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

Every mobile API request identifies its build. The backend defaults
`MIN_SUPPORTED_MOBILE_BUILD` to `LATEST_MOBILE_BUILD`, and Build 7 also blocks
itself if `/api/mobile-config` reports a newer release. Unsupported apps receive
HTTP `426 app_update_required` for enrolment, profile sync, and submissions.

For Google Play review only, the server may temporarily use:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=6
```

As soon as Build 7 is available to patients, set
`MIN_SUPPORTED_MOBILE_BUILD=7` and restart the service. This final switch is
mandatory. Build 6 does not contain the new update screen, but after the switch
its enrolment and uploads are rejected by the server.

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
- automatic migration/deletion backups

Back up the CSV and identity store together. Keep the production `.env`,
`IDENTITY_SECRET`, signing material, clinical exports, and patient screenshots
out of Git.

Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for the controlled Build 7
rollout and [deploy/WINDOWS_HTTPS_DEPLOYMENT.md](deploy/WINDOWS_HTTPS_DEPLOYMENT.md)
for the Windows service.
