# NeuroTracker Clinical

Minimal Flutter application for patients to record three symptoms per disorder and a daily wellness percentage. The project includes a CSV-backed clinician portal with individual and cohort analytics.

## Version

`1.0.0+1`

## Mobile features

- Migraine, dysautonomia, CIDP and myasthenia gravis
- Optional second disorder
- Three selected symptoms per disorder
- Daily symptom scores from 0–10 (`10 = worst`)
- Wellness score from 10%–100% (`100% = best`)
- Daily local reminder
- Reminder taps open the daily check-in
- Offline-first local storage
- Automatic retry queue for failed uploads
- Visible synced/pending status with actionable failure messages
- Editable profile and tracked symptom selections
- Local expandable check-in history
- Required deliberate selection for every symptom and wellness score
- Stable patient and submission identifiers
- Idempotent retry handling to prevent duplicate clinical records

## Run on the clinic network

```cmd
flutter pub get
flutter run --dart-define=NEUROTRACKER_API_URL=http://YOUR-SERVER-IP:3000 --dart-define=NEUROTRACKER_API_KEY=YOUR_API_KEY
```

## Android release build

Patient release builds should use an HTTPS backend:

```cmd
flutter build apk --release --dart-define=NEUROTRACKER_API_URL=https://YOUR-SERVER --dart-define=NEUROTRACKER_API_KEY=YOUR_API_KEY
```

The APK is created at:

```text
build/app/outputs/flutter-apk/app-release.apk
```

The current Android release build is configured with the debug signing key for internal testing. Configure a permanent release keystore before broader distribution.

Android debug/profile builds permit cleartext HTTP for clinic-LAN testing.
Release builds reject cleartext traffic and therefore require an HTTPS API URL.

## iOS cloud build

The iOS bundle identifier is:

```text
au.com.pascoeneurology.neurotracker
```

A signed iOS build still requires Apple-authorised signing and distribution. Cloud macOS services can compile the project, but they cannot bypass Apple signing requirements.

## Backend

```cmd
cd backend
npm install
npm test
npm start
```

Set `API_KEY`, `ADMIN_PASSWORD`, and preferably `ADMIN_USER` in
`backend/.env`. Production mode refuses to start with the placeholder
credentials.

Portal:

```text
http://localhost:3000/admin
```

Population analytics:

```text
http://localhost:3000/admin/population
```

## Privacy and deployment

This application handles identifiable health information. Do not release it to patients over public networks until the backend is protected by HTTPS, appropriate access controls, secure backups and clinic-approved privacy documentation.

CSV files under `backend/data` are runtime clinical data and must not be
committed to source control. Existing installations are migrated in place to
retain legacy records while adding stable submission and patient identifiers.
