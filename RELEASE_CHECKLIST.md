# NeuroSol Build 8 reconciled release checklist

Build 7 is publicly available and remains supported. Build 8 combines the
independent disorder/symptom architecture, visual redesign, enrolment-identity
repairs, and end-to-end idempotency hardening. Complete every backend-first gate
before either Build 8 mobile app is released.

## 1. Source and backups

- [ ] Confirm the branch contains the public Build 7 source plus the additive
      Build 8 backend compatibility changes.
- [ ] Confirm `pubspec.yaml` is `1.0.0+8`, backend is `0.10.0`, and both app IDs
      remain `au.com.pascoeneurology.neurosol`.
- [ ] Confirm the source descends from independent architecture `1c9a365`,
      visual identity `f2adba0`, identity hotfix `fa351d7`, and restored bridge
      compatibility `d9cb404`.
- [ ] Confirm no `.env`, keystore, `key.properties`, clinical CSV, identity
      store, real enrolment code, or patient screenshot is staged.
- [ ] Push source to GitHub and record the commit SHA.
- [ ] Back up production `.env`, `symptom_entries.csv`, `identity_store.json`,
      and `disorder_catalog.json` when present, as one recovery set.
- [ ] Record the deployment-package SHA-256 and protected backup location.

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

For the backend-first Build 8 compatibility deployment:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=false
ENABLE_INDEPENDENT_PROFILES=false
PUBLIC_BASE_URL=https://tracker.melindapascoeneurology.com
GOOGLE_PLAY_URL=https://play.google.com/store/apps/details?id=au.com.pascoeneurology.neurosol
APP_STORE_URL=https://apps.apple.com/au/app/neurosol-symptom-diary/id6796575355
ENROLMENT_INCIDENT_LOCKDOWN=false
```

- [ ] Keep the existing production `IDENTITY_SECRET`, `ADMIN_USER`, and
      `ADMIN_PASSWORD`; do not regenerate them.
- [ ] Build and deploy the offline `0.10.0` package described in
      `delivery/build8-backend-compatibility/README.md`; do not download or
      replace dependencies on the terminal server.
- [ ] Verify `/health` reports disorder catalogue version 3 with custom
      disorders and independent profiles disabled, incident lockdown false,
      and backend version `0.10.0`.
- [ ] Verify a Build 7 `/api/mobile-config` request reports minimum/latest 7,
      schema 1, and `build7Supported=true`.
- [ ] Verify an existing Build 7 profile sync and synthetic submission retain
      the same PatientId and ProfileRevision.
- [ ] Confirm patient, device, profile-history, and CSV row counts did not fall
      during migration.

## 4. Configure every existing patient

- [ ] Open `/admin/enrolments`.
- [ ] For every real PatientId with an active device, review the suggested
      profile from the latest accepted entry.
- [ ] Confirm the clinic display name, one or two disorders, and exactly three
      symptoms for each; save the profile.
- [ ] For Dysautonomia confirm the current catalogue includes **Pain** and
      **Weakness**, not **Shortness of breath** or **Sweating changes**.
- [ ] For new or edited Migraine profiles confirm the active catalogue includes
      both **Vertigo** and **Dizziness**. **Visual aura** is historical-only:
      existing Build 7 profile revisions must remain readable and submittable,
      but it must not appear as a new profile choice.
- [ ] Do not create a second identity for an existing patient.
- [ ] Issue a new-device code only when a patient is reinstalling or replacing
      a phone.

## 5. Signed Android Build 8

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build8.ps1
```

- [ ] Record AAB, APK, source commit, source tree, and SHA-256 hashes from
      `delivery\android-build8\release.json`.
- [ ] Confirm the AAB uses version code 8 and the existing Play signing
      identity.
- [ ] Upgrade a clinic test phone from Build 7 with `adb install -r`; do not
      uninstall first for the migration test.
- [ ] Confirm consent, PatientId, protected token, reminder, history, and queued
      entries survive the upgrade.
- [ ] Confirm the app opens Home, not the symptom screen.
- [ ] Confirm the profile shown in Settings is read-only and reminder time is
      editable.
- [ ] Confirm staff profile edits appear after app resume or refresh.
- [ ] Confirm one manual or notification-started check-in per day.
- [ ] Confirm exact assigned symptoms are submitted with `ProfileRevision`.
- [ ] Confirm offline save/retry and a matching queued Build 7 entry.
- [ ] Interrupt an upload, reopen the app, and confirm the pending Build 8
      entry retries with its original SubmissionId and appears once only.
- [ ] Confirm invalid, used, expired, wrong-patient, and revoked enrolment
      behavior.

## 6. New Build 8 patient acceptance test

Use synthetic data only:

- [ ] Create the profile in `/admin/enrolments`.
- [ ] Select one or more disorders and between one and six symptoms from the
      separate controlled lists.
- [ ] Confirm each assigned symptom is rated once, irrespective of how many
      disorders are selected.
- [ ] Generate the link/code.
- [ ] Open the HTTPS link and confirm it shows no name, disorder, or symptoms
      and does not consume the code.
- [ ] Enrol a clean Build 8 installation with the code.
- [ ] Confirm the clinic name and assigned symptoms appear on the phone.
- [ ] Confirm the same code cannot be used again.
- [ ] Update the profile in the portal and confirm phone synchronisation.
- [ ] Create a second synthetic patient immediately from the returned blank
      form and confirm the two Support IDs and PatientIds are distinct.
- [ ] Confirm an edit-mode form cannot create a new-patient code and a stale
      legacy form cannot modify an identity.
- [ ] Submit an exact schema-3 retry and confirm no extra CSV row; change the
      score under the same SubmissionId and confirm HTTP 409; use a new
      SubmissionId on the same PatientId/date and confirm HTTP 409.
- [ ] Delete the synthetic patient in `/admin/patients` using the typed Support
      ID and confirm timestamped backups exist.

## 7. Google Play

- [ ] Upload `delivery\android-build8\NeuroSol-Symptom-Diary-1.0.0-build8.aab`.
- [ ] Keep reviewer access synthetic and include the reusable reviewer code.
- [ ] Explain that clinic patients receive one-time codes and reviewer access is
      a special synthetic credential.
- [ ] Complete Data safety, account deletion URL, privacy URL, support URL,
      screenshots, feature graphic, content rating, and organisation details.
- [ ] Release to internal testing first, then the intended open/production
      track after acceptance testing.
- [ ] Notify clinic users that Build 8 is available while Build 7 remains
      supported.

## 8. Apple App Store

CodeMagic is the signing and archive environment for Build 8. Push the exact
release commit to GitHub, select that branch in the existing CodeMagic iOS
workflow, and use this as its Build 8 build command:

```bash
./delivery/build-neurosol-ios-build8.sh
```

- [ ] Confirm CodeMagic checked out the exact recorded release commit with full
      Git history and no source modifications.
- [ ] Confirm it uses the existing Apple distribution certificate, provisioning
      profile, and App Store Connect integration for
      `au.com.pascoeneurology.neurosol`.
- [ ] Do not add a second `flutter build ipa` step; the guarded script builds
      and verifies the signed IPA after every test passes.
- [ ] Record the IPA, source commit, source tree, and SHA-256 from
      `delivery/ios-build8/release.json`.
- [ ] Confirm bundle ID `au.com.pascoeneurology.neurosol`, distribution
      certificate, provisioning profile, notification permission text, icons,
      and launch branding.
- [ ] Upload to App Store Connect and retain the archive/export logs and build
      number evidence.
- [ ] Reuse only the synthetic reviewer profile and provide a fresh recording
      if App Review requests the changed independent-profile flow.
- [ ] Confirm the released listing resolves at
      `https://apps.apple.com/au/app/neurosol-symptom-diary/id6796575355`.

## 9. Build 7 compatibility lock

Keep this configuration while Build 7 remains public:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=false
ENABLE_INDEPENDENT_PROFILES=false
```

- [ ] Verify the deployment script changed only these non-secret settings and
      the two recorded store URLs in the protected production `.env`.
- [ ] Verify `/health` and local/public `/api/mobile-config`.
- [ ] Verify Build 7 enrolment, profile sync, and a synthetic submission.
- [ ] Leave minimum build at 7. Do not retire Build 7 based on a date or mobile
      release alone; use observed production traffic and an approved decision.

## 10. Build 8 independent-profile activation

Only after Build 8 is downloadable from both stores:

Run the packaged guarded activation:

```powershell
.\Activate-NeuroSolBuild8.ps1 `
  -Confirmation 'ACTIVATE BUILD 8 AFTER BOTH STORES ARE LIVE'
```

It sets the following while retaining Build 7 support:

```env
LATEST_MOBILE_BUILD=8
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=true
ENABLE_INDEPENDENT_PROFILES=true
```

- [ ] Confirm `/admin/disorders` and `/admin/symptoms` are separate controlled
      lists.
- [ ] Confirm a new profile accepts one or more disorders and between one and
      six unique symptoms, with no symptom-to-disorder nesting.
- [ ] Confirm an active Build 7 or unconfirmed device blocks conversion to a
      schema-3 profile.
- [ ] Confirm **Maintain Build 7 profile** remains available for an existing
      nested profile that still needs a compatibility edit.
- [ ] Confirm a schema-3 submission creates one CSV row per symptom and stores
      the profile disorder IDs/names in the additive snapshot columns.
- [ ] Confirm Build 7 enrolment, profile sync, and schema-1 submission still
      pass after activation.
- [ ] Confirm Build 7 sees `latestBuild=7`, Build 8 sees `latestBuild=8`, and
      Build 8 with `independent-v1` sees preferred payload schema 3.

## 11. Post-release

- [ ] Monitor service health, HTTP 401/409/426/5xx rates, pending-upload support
      reports, disk space, and backups.
- [ ] Confirm no real patient remains in `profile_not_configured`.
- [ ] Remove or rotate temporary Play reviewer access when review is complete.
- [ ] Retain the signed artifacts, hashes, commit SHA, store release record, and
      acceptance-test evidence in the clinic release record.
