# NeuroSol Symptom Diary Build 11

Version: 1.2.2+11. Base: merged codex/events-homepage (a80f9d1).

## Release changes

- Per-Event customisable minimum intervals in days.
- Patient buttons disable during an interval and show the next available date.
- Server enforcement prevents early or overlapping backdated occurrences.
- Existing Events remain unrestricted until the clinic configures an interval.

## Build and validate

- Run delivery/build-neurosol-android-build11.ps1 for signed Android AAB and APK.
- Use delivery/CODEMAGIC_BUILD11.md for the signed iOS IPA.
- All Flutter, backend, and deployment-probe tests must pass.
- Verify package ID au.com.pascoeneurology.neurosol and version 1.2.2 / build 11.
- Retain release.json and artifact SHA-256 checksums with the exact source commit.

## Acceptance before store release

- Confirm the merged Events backend has been deployed on the terminal server.
- Set Self-Injectable to the clinic-prescribed number of days and Botox to 84 days in Admin > Events.
- Verify assigned buttons become disabled after recording and show eligibility dates.
- Verify daily and unrestricted timed Events still work.
- Verify profile sync, daily entry, seven-day backdating, history, and reminders.
- Upgrade from the installed app without losing local profile or pending entries.
- Confirm clinic-assigned profile and enrolment behavior on Android and iOS.
- Upload the signed AAB and CodeMagic-signed IPA through the existing store accounts.
- Advertise Build 11 only after both store releases are available; retain older supported builds.

Backend deployment remains a separate guarded operation that preserves .env.
The backend is still version 0.11.0; do not change its live minimum/latest build
settings solely because these mobile artifacts have been created.
