# CodeMagic iOS Build 8

CodeMagic is the authoritative signing environment for the NeuroSol iOS Build
8 release. Continue using the Apple distribution certificate, provisioning
profile, keychain setup, and App Store Connect integration that successfully
signed Build 7. Do not place Apple signing material in Git.

## Source gate

The release branch must be pushed to GitHub before starting CodeMagic. Select
that exact branch and confirm the commit shown in CodeMagic matches the final
release commit supplied with the backend package. The checkout must contain
full Git history because the release script proves that the independent-profile,
visual-identity, and enrolment-recovery commits are ancestors of the build.

If the existing workflow uses a shallow checkout, fetch the full branch history
before the build command. Do not merge or format source inside CodeMagic.

## Build command

From the repository root, after CodeMagic has installed the configured Apple
signing identities and provisioning profile:

```bash
chmod +x ./delivery/build-neurosol-ios-build8.sh
./delivery/build-neurosol-ios-build8.sh
```

This one command restores Flutter and backend dependencies, formats and checks
the source, runs Flutter analysis, all Flutter tests, all backend tests, and the
clinical-data deployment probes. It then builds the signed IPA with:

- version `1.0.0`
- build number `8`
- bundle ID `au.com.pascoeneurology.neurosol`
- production API `https://tracker.melindapascoeneurology.com`

It verifies the signed application bundle and writes immutable release evidence
to `delivery/ios-build8/release.json`. Do not configure another `flutter build
ipa` command after it.

The optional `--skip-flutter-tests` mode exits before building an IPA and must
not be used for an App Store release.

## CodeMagic artifacts

Collect at least:

```text
delivery/ios-build8/*.ipa
delivery/ios-build8/release.json
```

Retain the CodeMagic build log and App Store Connect upload record with the
release evidence. Publish only when `release.json` records
`flutterTestsSkipped: false` and its source commit matches the approved backend
package.
