# NeuroSol Build 9 release checklist

Build 9 is an additive release. Build 7 and Build 8 remain supported throughout
deployment and after Build 9 activation.

## Release identity

- Mobile version: `1.2.0+9`
- Backend version: `0.11.0`
- Android application ID: `au.com.pascoeneurology.neurosol`
- iOS bundle ID: `au.com.pascoeneurology.neurosol`
- Minimum supported mobile build: `7`
- Build 9 diary capability: `patient-diary-v1`
- Default backdating limit: previous `7` calendar days, plus today

## Approved Build 9 scope

- Optional BP Patient ID entered and edited by authenticated clinic staff.
- Case-insensitive BP Patient ID uniqueness without changing clinical profile
  revisions.
- Portal patient search by clinic name, BP Patient ID, Support ID, or internal
  PatientId.
- Patient-scoped mobile diary history loaded through the enrolled device
  credential.
- Wellness and symptom line graphs for 30, 60, and 90 days.
- One check-in per date for today or any unrecorded date in the previous seven
  days.
- Existing submission-ID idempotency and one-entry-per-patient-per-date rules.
- Global App Store and Google Play availability as a release-console action.

## 1. Source verification

- [ ] Confirm the release branch descends from the signed Build 8 source commit.
- [ ] Confirm all Build 9 source and release tooling is committed.
- [ ] Confirm `git status --short` contains no tracked changes.
- [ ] Run `dart format --output=none --set-exit-if-changed lib test`.
- [ ] Run `flutter analyze`.
- [ ] Run `flutter test --reporter expanded`.
- [ ] Run `npm ci` and `npm test` in `backend`.
- [ ] Confirm no runtime data under `backend/data` is tracked.

## 2. Backend-first deployment

Deploy backend `0.11.0` before submitting either Build 9 app. Preserve the live
`.env`, `IDENTITY_SECRET`, `ADMIN_PASSWORD`, clinical CSV, identity store,
disorder catalogue, and every existing backup.

Required pre-release configuration:

```env
MIN_SUPPORTED_MOBILE_BUILD=7
LATEST_MOBILE_BUILD=8
ENABLE_CUSTOM_DISORDERS=true
ENABLE_INDEPENDENT_PROFILES=true
MAX_BACKDATE_DAYS=7
ENROLMENT_INCIDENT_LOCKDOWN=false
```

- [ ] Stop the service for one consistent backup.
- [ ] Back up `.env`, `symptom_entries.csv`, `identity_store.json`, and
  `disorder_catalog.json` together.
- [ ] Snapshot row, patient, code, device, profile, catalogue, and BP-ID counts.
- [ ] Deploy only the verified backend package.
- [ ] Run the complete isolated backend test suite before replacing live files.
- [ ] Restart `NeuroSolBackend` and verify local and public `/health`.
- [ ] Confirm clinical counts and CSV columns are unchanged after migration.
- [ ] Confirm the identity store upgraded additively to version 4.

## 3. Compatibility checks before store submission

- [ ] Build 7 `/api/mobile-config` reports minimum/latest `7`, preferred schema
  `1`, and existing profile sync and submission still work.
- [ ] Build 8 `/api/mobile-config` reports minimum `7`, latest `8`, preferred
  schema `3`, and independent profiles still work.
- [ ] Build 9 `/api/mobile-config` may report latest `8` during predeployment but
  advertises `patientDiary=true` and `maximumBackdateDays=7`.
- [ ] Build 8 requests to `/api/diary` receive HTTP `426` requiring Build 9,
  without affecting any other Build 8 endpoint.
- [ ] Existing queued Build 7/8 entries upload unchanged after a Build 9 app
  upgrade.

## 4. Clinician portal acceptance

- [ ] Create a synthetic patient with a BP Patient ID.
- [ ] Find it using the display name, exact BP ID, punctuation-free BP ID, and
  Support ID.
- [ ] Confirm search requires portal authentication.
- [ ] Confirm the BP Patient ID appears in enrolments, patient review, patient
  management, and PDF report.
- [ ] Edit only the BP Patient ID and confirm the clinical profile revision does
  not change.
- [ ] Attempt a duplicate BP Patient ID and confirm it is rejected without
  changing either identity.

## 5. Mobile acceptance

- [ ] Upgrade an enrolled Build 8 phone to Build 9 with app data retained.
- [ ] Confirm existing profile, credential, local history, and pending queue are
  retained.
- [ ] Open Patient Diary and confirm clinic plus local history is patient-scoped.
- [ ] Verify wellness and every assigned symptom on 30, 60, and 90-day views.
- [ ] Verify the diary falls back to local history while offline.
- [ ] Submit today, yesterday, and seven days ago using separate synthetic
  dates.
- [ ] Confirm eight days ago is unavailable and rejected by the backend if
  crafted manually.
- [ ] Confirm a second submission for any recorded date is blocked locally and
  by the backend.
- [ ] Interrupt a backdated upload, reopen the app, and confirm an exact retry
  stores one clinic submission only.
- [ ] Verify behaviour across a local midnight and with a non-Australian device
  time-zone offset.
- [ ] Verify the diary’s earliest and latest dates in both a negative UTC
  offset and a positive UTC offset.

## 6. Signed artifacts

- [ ] Produce signed Android AAB and APK as version `1.2.0`, build `9`.
- [ ] Produce the signed iOS archive/IPA in CodeMagic as version `1.2.0`, build
  `9`.
- [ ] Record source commit, source tree, artifact lengths, and SHA-256 hashes.
- [ ] Install the APK over Build 8 and complete the mobile acceptance checks.
- [ ] Install the iOS TestFlight build over Build 8 and repeat the critical
  checks.

## 7. Store submission and global availability

- [ ] Use the approved Build 9 release notes.
- [ ] Retain the existing privacy disclosures for clinical identifiers, symptom
  data, wellness data, and protected device credentials.
- [ ] Update screenshots only where the Build 9 patient diary materially changes
  the current listing.
- [ ] In App Store Connect, review Pricing and Availability and select every
  intended eligible country or region before release; resolve every red or
  yellow country status and complete any territory-specific legal, tax, rating,
  trader, or regulatory fields that apply.
- [ ] In Google Play Console, review Production country/region availability and
  add every intended supported country or region before rollout.
- [ ] Confirm the backend advertises the country-neutral iOS update URL
  `https://apps.apple.com/app/id6796575355`.
- [ ] Do not claim global availability until both public listings have been
  checked from outside the Australian storefront context.

## 8. Activation after both stores are live

Change only:

```env
LATEST_MOBILE_BUILD=9
```

Keep:

```env
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=true
ENABLE_INDEPENDENT_PROFILES=true
MAX_BACKDATE_DAYS=7
```

- [ ] Verify Build 7 receives latest `7` and remains supported.
- [ ] Verify Build 8 receives latest `8` and remains supported.
- [ ] Verify Build 9 receives latest `9`, patient diary support, and seven-day
  backdating.
- [ ] Confirm local and public HTTPS health.
- [ ] Preserve the predeployment and preactivation backup paths in the release
  record.

## Approved release notes

NeuroSol Build 9 makes daily tracking and clinic administration easier. Patients
can now review 30, 60, or 90-day wellness and symptom trends in their diary and
record a missed check-in from the previous seven days. The clinician portal now
supports BP Patient IDs and faster patient search. This release also preserves
the existing enrolment, duplicate-prevention, and clinical-profile safeguards.
