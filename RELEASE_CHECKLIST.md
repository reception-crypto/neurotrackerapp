# NeuroSol Symptom Diary Build 6 release checklist

Build 6 is the first clinic-release candidate using clinic-issued PatientId
enrolment. Do not deploy the mobile app before the matching backend.

## Source and automated verification

- [ ] Confirm the branch is `codex/build6-patient-identity` and based on the
      protected Build 5 baseline.
- [ ] Review `git status` and confirm no `.env`, CSV, identity store, keystore,
      patient screenshot, token, or enrolment code is present.
- [ ] Run `npm ci` and `npm test` in `backend`.
- [ ] Run `flutter pub get` so `pubspec.lock` records
      `flutter_secure_storage`.
- [ ] Run `dart format lib test`.
- [ ] Run `flutter analyze`.
- [ ] Run `flutter test`.
- [ ] Push the completed Build 6 source and confirm the GitHub Verify workflow
      passes.

## Backend deployment

- [ ] Back up the current production `.env` and data directory.
- [ ] Generate and securely record a random `IDENTITY_SECRET` of at least
      32 characters.
- [ ] Set a unique `ADMIN_PASSWORD` of at least 16 characters.
- [ ] Confirm no legacy shared mobile API-key path is present or enabled.
- [ ] Set `DATA_DIR` outside the repository.
- [ ] Confirm only the Node service account and authorised administrators can
      read `.env`, `symptom_entries.csv`, `identity_store.json`, and backups.
- [ ] Deploy canonical `backend/server.js`, `backend/identity_store.js`,
      `package.json`, and `package-lock.json`.
- [ ] Confirm Node binds to `127.0.0.1`, public port 3000 is closed, and HTTPS
      reverse proxying remains valid.
- [ ] Confirm `/health`, `/admin`, `/admin/population`,
      `/admin/enrolments`, CSV export, and PDF reports.
- [ ] Back up and restore `symptom_entries.csv` and `identity_store.json`
      together in a rehearsal.

## Enrolment and integrity acceptance

- [ ] Create a synthetic new-patient code and enrol a clean Android device.
- [ ] Confirm the code works once and cannot be reused.
- [ ] Confirm Settings support ID matches the portal support ID.
- [ ] Submit one check-in and confirm PatientId is present in server CSV and
      local CSV.
- [ ] Retry the exact SubmissionId and confirm no duplicate rows are added.
- [ ] Attempt a second distinct submission for the same PatientId/date and
      confirm HTTP 409 / `daily_submission_exists`.
- [ ] Confirm another PatientId can submit on that date.
- [ ] Change the profile name, submit on a later date, and confirm the portal
      remains one patient group with only the latest name as its label.
- [ ] Issue a new-device code for the existing PatientId and enrol a second
      device.
- [ ] Try that recovery code on a phone holding a different PatientId; confirm
      it is rejected without consuming the code, then use it successfully for
      the intended PatientId.
- [ ] Revoke that patient's devices and confirm further uploads are rejected.
- [ ] Confirm an access token cannot upload another PatientId.

## Mobile acceptance

- [ ] Test new privacy consent, enrolment, profile, and one-disorder setup.
- [ ] Test two-disorder setup.
- [ ] Confirm an ordinary launch opens Home, not the rating form.
- [ ] Confirm manual check-in is available once per local day.
- [ ] Confirm reminder taps open the form only when today's check-in is
      incomplete.
- [ ] Confirm the home screen and reminder stay locked after completion.
- [ ] Confirm all symptom and wellness selections are required.
- [ ] Test a successful upload and last-sync status.
- [ ] Test offline save, pending status, later retry, and one server record.
- [ ] Test invalid/revoked enrolment messaging and the replacement-code path.
- [ ] Confirm Reset removes local history and the protected device credential
      and requires a new code.
- [ ] Confirm consent is requested again for policy version `2026-07-27`.
- [ ] Test notification permission, reminder delivery, app foreground,
      background, reboot, and timezone/date rollover on a physical Android
      device.
- [ ] Confirm no real patient data appears in screenshots or logs.

## Signed Android Build 6

- [ ] Run:

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build6.ps1
  ```

- [ ] Confirm AAB and APK are version `1.0.0` / code `6`.
- [ ] Record the SHA-256 hashes.
- [ ] Install the APK with `adb install -r` on the clinic test device.
- [ ] Repeat the enrolment, online check-in, offline retry, history, Settings,
      and notification smoke tests against production.

## Google Play open testing

- [ ] Upload only
      `delivery\android-build6\NeuroSol-Symptom-Diary-1.0.0-build6.aab`.
- [ ] Confirm Play App Signing and the organisation developer profile.
- [ ] Complete the Health apps declaration for the applicable disease/condition
      management and healthcare service categories.
- [ ] Complete Data safety for name, health information, PatientId,
      device/security credential, submission ID, and check-in timing.
- [ ] Confirm encryption in transit, retention/deletion contact process, no
      advertising, no sale, and actual infrastructure/provider disclosures.
- [ ] Enter the public privacy and support URLs.
- [ ] Complete App access instructions using a dedicated synthetic reviewer
      identity and a fresh one-time enrolment code.
- [ ] Complete content rating, target audience, ads declaration, country
      availability, and store listing.
- [ ] Upload current Build 6 screenshots and feature graphic.
- [ ] Add only approved clinic testers or distribute the testing link according
      to the clinic rollout plan.
- [ ] Do not create real enrolment codes until backend backup, staff procedure,
      privacy approval, and incident response are signed off.

## Existing Build 5 patients

- [ ] Identify the patient's existing PatientId in the portal.
- [ ] Issue **New device code** against that PatientId.
- [ ] Do not use the new-patient form, which would split their history.
- [ ] Resolve any pending Build 5 uploads before using a code for a different
      identity.
- [ ] Confirm historical and new records appear under one support ID.

## iOS follow-up

- [ ] Confirm Apple organisation enrolment.
- [ ] Confirm Keychain Sharing entitlements and protected credential
      read/write on a physical iPhone.
- [ ] Build and test `1.0.0+6` on TestFlight.
- [ ] Complete App Privacy and restricted-app access details consistently with
      Google Play.
