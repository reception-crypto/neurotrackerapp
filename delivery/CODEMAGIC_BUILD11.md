# CodeMagic iOS Build 11

CodeMagic remains the authoritative signing environment for NeuroSol iOS.
Continue using the Apple distribution certificate, provisioning profile,
keychain setup, and App Store Connect integration that signed previous release. Apple
signing material must not be committed to Git.

## Source gate

Push the final Build 11 release branch before starting CodeMagic. Select that
exact branch and confirm its commit matches the Build 11 backend package. The
checkout needs full Git history because the release script verifies the
reconciled previous release ancestry before producing an IPA.

Do not merge, edit, or commit source in CodeMagic.

## Build command

After CodeMagic installs the configured signing identities and profile, run
from the repository root:

```bash
chmod +x ./delivery/build-neurosol-ios-build11.sh
./delivery/build-neurosol-ios-build11.sh
```

The script restores dependencies, formats and analyzes Dart, runs all Flutter
and backend tests plus the clinical-data probes, and then builds and verifies:

- version `1.2.2`
- build number `11`
- bundle ID `au.com.pascoeneurology.neurosol`
- backend contract `0.11.0`
- production API `https://tracker.melindapascoeneurology.com`

The optional `--skip-flutter-tests` mode stops before creating an IPA and must
not be used for an App Store release.

## Artifacts

Collect:

```text
delivery/ios-build11/NeuroSol-Symptom-Diary-1.2.2-build11.ipa
delivery/ios-build11/release.json
```

Retain the CodeMagic log and App Store Connect upload record. Publish only when
`release.json` records `flutterTestsSkipped: false` and the same source commit
as the deployed Build 11 backend package.

Build from GitHub branch `codex/build11-events-availability`. This includes the
Events availability UI and preserves existing backend capability headers. The
backend package is separate; confirm it is deployed before patient acceptance
testing. Do not advertise Build 11 until both store releases are available.
