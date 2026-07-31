# NeuroSol Symptom Diary Build 7 release checklist

Build 7 changes patient enrolment from patient-selected symptoms to a
clinic-assigned, versioned profile. Complete every gate before open clinic use.

## 1. Source and backups

- [ ] Confirm the branch contains the complete Build 6 checkpoint plus Build 7
      changes.
- [ ] Confirm `pubspec.yaml` is `1.0.0+7`, backend is `0.7.0`, and both app IDs
      remain `au.com.pascoeneurology.neurosol`.
- [ ] Confirm no `.env`, keystore, `key.properties`, clinical CSV, identity
      store, real enrolment code, or patient screenshot is staged.
- [ ] Push source to GitHub and record the commit SHA.
- [ ] Back up production `.env`, `symptom_entries.csv`, and
      `identity_store.json` together before deployment.
- [ ] Record SHA-256 hashes for the two production data files and the backend
      source package.

## 2. Verify source

```powershell
cd C:\Projects\neurotrackerapp
flutter pub get
dart format lib test
flutter analyze
flutter test

Push-Location .\backend
npm ci
npm test
Pop-Location
```

- [ ] All Flutter analysis and tests pass.
- [ ] All backend tests pass.
- [ ] `git status --short` contains only intentional release files.

## 3. Deploy the compatible backend first

For the Play review window:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=6
PUBLIC_BASE_URL=https://tracker.melindapascoeneurology.com
GOOGLE_PLAY_URL=https://play.google.com/store/apps/details?id=au.com.pascoeneurology.neurosol
```

- [ ] Keep the existing production `IDENTITY_SECRET`, `ADMIN_USER`, and
      `ADMIN_PASSWORD`; do not regenerate them.
- [ ] Deploy backend `0.7.0`, install dependencies, restart the Windows service,
      and verify `/health`.
- [ ] Verify `/api/mobile-config` reports latest 7 and temporary minimum 6.
- [ ] Verify existing Build 6 submissions still work during this controlled
      window.
- [ ] Verify a newly generated clinic-managed code returns update-required in
      Build 6 and remains usable in Build 7.

## 4. Configure every existing patient

- [ ] Open `/admin/enrolments`.
- [ ] For every real PatientId with an active device, review the suggested
      profile from the latest accepted entry.
- [ ] Confirm the clinic display name, one or two disorders, and exactly three
      symptoms for each; save the profile.
- [ ] For Dysautonomia confirm the current catalogue includes **Pain** and
      **Weakness**, not **Shortness of breath** or **Sweating changes**.
- [ ] Do not create a second identity for an existing patient.
- [ ] Issue a new-device code only when a patient is reinstalling or replacing
      a phone.

## 5. Signed Android Build 7

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build7.ps1
```

- [ ] Record AAB and APK SHA-256 hashes.
- [ ] Confirm the AAB uses version code 7 and the existing Play signing
      identity.
- [ ] Upgrade a clinic test phone from Build 6 with `adb install -r`; do not
      uninstall first for the migration test.
- [ ] Confirm consent, PatientId, protected token, reminder, history, and queued
      entries survive the upgrade.
- [ ] Confirm the app opens Home, not the symptom screen.
- [ ] Confirm the profile shown in Settings is read-only and reminder time is
      editable.
- [ ] Confirm staff profile edits appear after app resume or refresh.
- [ ] Confirm one manual or notification-started check-in per day.
- [ ] Confirm exact assigned symptoms are submitted with `ProfileRevision`.
- [ ] Confirm offline save/retry and a matching queued Build 6 entry.
- [ ] Confirm invalid, used, expired, wrong-patient, and revoked enrolment
      behavior.

## 6. New patient acceptance test

Use synthetic data only:

- [ ] Create the profile in `/admin/enrolments`.
- [ ] Select exactly three symptoms per disorder.
- [ ] Generate the link/code.
- [ ] Open the HTTPS link and confirm it shows no name, disorder, or symptoms
      and does not consume the code.
- [ ] Enrol a clean Build 7 installation with the code.
- [ ] Confirm the clinic name and assigned symptoms appear on the phone.
- [ ] Confirm the same code cannot be used again.
- [ ] Update the profile in the portal and confirm phone synchronisation.
- [ ] Delete the synthetic patient in `/admin/patients` using the typed Support
      ID and confirm timestamped backups exist.

## 7. Google Play

- [ ] Upload `delivery\android-build7\NeuroSol-Symptom-Diary-1.0.0-build7.aab`.
- [ ] Keep reviewer access synthetic and include the reusable reviewer code.
- [ ] Explain that clinic patients receive one-time codes and reviewer access is
      a special synthetic credential.
- [ ] Complete Data safety, account deletion URL, privacy URL, support URL,
      screenshots, feature graphic, content rating, and organisation details.
- [ ] Release to internal testing first, then the intended open/production
      track after acceptance testing.
- [ ] Notify all clinic users that Build 7 is required.

## 8. Mandatory update switch

Only after Build 7 is available to every intended patient:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
```

- [ ] Change only these values in the protected production `.env`.
- [ ] Restart the backend service and verify it is Running.
- [ ] Verify `/health` and `/api/mobile-config`.
- [ ] Verify a request without `X-NeuroSol-Build: 7` receives HTTP 426.
- [ ] Verify Build 7 enrolment, profile sync, and a synthetic submission.
- [ ] Leave minimum build at 7. Any temporary rollback to 6 requires an
      incident decision and a documented reason.

## 9. Post-release

- [ ] Monitor service health, HTTP 401/409/426/5xx rates, pending-upload support
      reports, disk space, and backups.
- [ ] Confirm no real patient remains in `profile_not_configured`.
- [ ] Remove or rotate temporary Play reviewer access when review is complete.
- [ ] Retain the signed artifacts, hashes, commit SHA, store release record, and
      acceptance-test evidence in the clinic release record.
