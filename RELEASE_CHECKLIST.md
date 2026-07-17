# NeuroTracker Clinical 1.0.0 release checklist

## Mobile verification

- [ ] `flutter clean`
- [ ] `flutter pub get`
- [ ] `flutter analyze`
- [ ] Test first-run consent and profile setup
- [ ] Test one-disorder and two-disorder profiles
- [ ] Edit an existing profile and confirm its patient ID is preserved
- [ ] Confirm a newly saved check-in appears in local history
- [ ] Confirm Next remains disabled until every symptom has been rated
- [ ] Confirm Submit remains disabled until wellness has been selected
- [ ] Verify notification permission and reminder delivery
- [ ] Tap a reminder while the app is open and backgrounded; confirm check-in opens
- [ ] Submit while backend is available: status becomes Synced
- [ ] Submit while backend is stopped: status becomes Pending
- [ ] Restart backend and tap pending status/retry: entry uploads once
- [ ] Verify network, authorization and server errors show distinct messages
- [ ] Verify duplicate submission IDs are not duplicated in CSV
- [ ] Confirm app icon and launch screen on Android
- [ ] Confirm app icon and launch screen on iOS cloud build
- [ ] Create and securely back up the permanent Android release keystore
- [ ] Build a signed release APK and record its SHA-256 checksum
- [ ] Confirm GitHub Verify workflow passes

## Backend verification

- [ ] Replace default API key and admin password
- [ ] Back up `backend/data/symptom_entries.csv`
- [ ] Confirm `/health`
- [ ] Run `npm test`
- [ ] Confirm patient portal graphs
- [ ] Confirm population graphs
- [ ] Confirm PDF report generation
- [ ] Confirm CSV export
- [ ] Configure HTTPS before off-site patient use
- [ ] Confirm Node binds to `127.0.0.1`, not the public server interface
- [ ] Confirm public port 3000 is closed
- [ ] Confirm the tracker hostname has a valid, automatically renewing certificate
- [ ] Confirm the release build cannot connect to a cleartext HTTP endpoint

## Patient beta release

- [ ] Use synthetic data only during final rehearsal
- [ ] Provide patient privacy notice and support contact
- [ ] Have the clinic approve the in-app privacy and consent wording
- [ ] Explain the app is not for emergencies
- [ ] Enrol a small initial cohort
- [ ] Record device type and app version for troubleshooting
