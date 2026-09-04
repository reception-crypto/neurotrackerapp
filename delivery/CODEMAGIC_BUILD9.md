# CodeMagic iOS Build 9

CodeMagic remains the authoritative signing environment for NeuroSol iOS.
Continue using the Apple distribution certificate, provisioning profile,
keychain setup, and App Store Connect integration that signed Build 8. Apple
signing material must not be committed to Git.

## Source gate

Push the final Build 9 release branch before starting CodeMagic. Select that
exact branch and confirm its commit matches the Build 9 backend package. The
checkout needs full Git history because the release script verifies the
reconciled Build 8 ancestry before producing an IPA.

Do not merge, edit, or commit source in CodeMagic.

## Build command

After CodeMagic installs the configured signing identities and profile, run
from the repository root:

```bash
chmod +x ./delivery/build-neurosol-ios-build9.sh
./delivery/build-neurosol-ios-build9.sh
```

The script restores dependencies, formats and analyzes Dart, runs all Flutter
and backend tests plus the clinical-data probes, and then builds and verifies:

- version `1.2.0`
- build number `9`
- bundle ID `au.com.pascoeneurology.neurosol`
- backend contract `0.11.0`
- production API `https://tracker.melindapascoeneurology.com`

The optional `--skip-flutter-tests` mode stops before creating an IPA and must
not be used for an App Store release.

## Artifacts

Collect:

```text
delivery/ios-build9/NeuroSol-Symptom-Diary-1.2.0-build9.ipa
delivery/ios-build9/release.json
```

Retain the CodeMagic log and App Store Connect upload record. Publish only when
`release.json` records `flutterTestsSkipped: false` and the same source commit
as the deployed Build 9 backend package.
