# NeuroSol Symptom Diary

Flutter symptom and wellness diary for participating Pascoe Neurology patients,
with a CSV-backed clinician portal.

## Current release

- App version: `1.0.0+6`
- Android application ID: `au.com.pascoeneurology.neurosol`
- Apple bundle ID: `au.com.pascoeneurology.neurosol`
- Production API: `https://tracker.melindapascoeneurology.com`

## Build 6 safety and identity model

- The clinic creates a one-time enrolment code in the clinician portal.
- Redeeming the code gives the app a server-issued PatientId and a unique
  per-device access token.
- The access token is stored in protected operating-system storage and is
  never committed to source or compiled as a shared secret.
- A recovery or new-device code is linked to the existing PatientId so identity
  survives a reinstall or phone change.
- Clinic staff can revoke all active devices for a PatientId.
- The server verifies that every upload PatientId matches the enrolled device.
- At most one submission is accepted for each PatientId and local calendar
  date; exact retry requests remain idempotent.
- The portal groups and filters by PatientId and uses only the latest submitted
  name as its display label.
- Settings shows a shortened support ID, and local CSV exports include the full
  PatientId.

The app retains its once-per-day home-screen workflow, daily reminder,
offline queue, local history, editable symptom profile, HTTPS-only release
traffic, consent gate, and emergency/medical disclaimers.

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
npm start
```

For a local debug run, pass only the API URL:

```cmd
flutter run --dart-define=NEUROTRACKER_API_URL=http://YOUR-SERVER-IP:3000
```

No mobile API key is used by Build 6.

## Android Build 6

Release signing still uses the permanent `android/key.properties` and
keystore already configured for this application ID. Keep both outside source
control and maintain an offline backup.

From the project root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build6.ps1
```

The script restores packages, formats and verifies source, runs tests, builds
the signed AAB and APK, copies them to `delivery\android-build6`, and prints
SHA-256 hashes.

## Production backend

Copy `backend/.env.example` to the production `.env`. The two essential
secrets are:

- `IDENTITY_SECRET`: at least 32 cryptographically random characters; it
  protects enrolment-code and device-token hashes.
- `ADMIN_PASSWORD`: a unique clinician portal password of at least 16
  characters.

Build 6 has no shared mobile API-key path. Older builds cannot upload after the
Build 6 backend is deployed; they must be upgraded and enrolled.

Runtime clinical files are:

- `symptom_entries.csv`
- `identity_store.json`
- automatic CSV migration backups

Store them in the configured `DATA_DIR`, outside the repository. Back up the
CSV and identity store together. Keep the `.env`, especially
`IDENTITY_SECRET`, in the clinic's secret-management backup; changing or losing
that secret invalidates existing enrolment codes and device credentials.

Use the deployment instructions in
`deploy/WINDOWS_HTTPS_DEPLOYMENT.md`. Node binds to `127.0.0.1` and must be
exposed only through the existing HTTPS reverse proxy.

Portal pages:

```text
https://tracker.melindapascoeneurology.com/admin
https://tracker.melindapascoeneurology.com/admin/population
https://tracker.melindapascoeneurology.com/admin/enrolments
```

## Safe rollout order

1. Back up the current production data and `.env`.
2. Deploy the Build 6 backend and configure `IDENTITY_SECRET`.
3. Run `npm test` and verify `/health`, the portal, code issuance, enrolment,
   one check-in, CSV storage, and portal grouping.
4. For each existing Build 5 patient, issue a new-device code against their
   existing PatientId rather than creating a new identity.
5. Install Build 6 on a clinic test phone and complete the release acceptance
   tests.
6. Upload the Build 6 AAB to Google Play testing only after those gates pass.

This application handles identifiable health information. Never commit
production `.env`, `symptom_entries.csv`, `identity_store.json`, signing
material, or screenshots containing patient information.
