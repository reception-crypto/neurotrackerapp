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
- [ ] Submit while backend is available: status becomes Synced
- [ ] Submit while backend is stopped: status becomes Pending
- [ ] Restart backend and tap pending status/retry: entry uploads once
- [ ] Verify duplicate submission IDs are not duplicated in CSV
- [ ] Confirm app icon and launch screen on Android
- [ ] Confirm app icon and launch screen on iOS cloud build

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

## Patient beta release

- [ ] Use synthetic data only during final rehearsal
- [ ] Provide patient privacy notice and support contact
- [ ] Explain the app is not for emergencies
- [ ] Enrol a small initial cohort
- [ ] Record device type and app version for troubleshooting
