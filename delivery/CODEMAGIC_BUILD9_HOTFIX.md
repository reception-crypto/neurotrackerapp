# CodeMagic iOS 1.1.1 Build 9 hotfix

CodeMagic is the authoritative signing environment for the NeuroSol iOS
accessibility hotfix. Continue using the Apple distribution certificate,
provisioning profile, keychain setup, and App Store Connect integration that
successfully signed the existing production app. Do not place Apple signing
material in Git.

## Source gate

Build only branch `codex/hotfix-1.1.1-build9`. Confirm that the CodeMagic source
commit matches the approved hotfix commit. The checkout must contain full Git
history because the release script proves that the reconciled Build 8 source
and the Large Text regression fix are ancestors of the build.

If the workflow uses a shallow checkout, fetch the full branch history before
the build command. Do not merge or format source inside CodeMagic.

## Build command

From the repository root, after CodeMagic has installed the configured Apple
signing identities and provisioning profile:

```bash
chmod +x ./delivery/build-neurosol-ios-build9-hotfix.sh
./delivery/build-neurosol-ios-build9-hotfix.sh
```

This one command restores Flutter and backend dependencies, checks formatting,
runs Flutter analysis, all Flutter tests, all backend tests, and the protected
clinical-data probes. It then builds the signed IPA with:

- version `1.1.1`
- build number `9`
- bundle ID `au.com.pascoeneurology.neurosol`
- production API `https://tracker.melindapascoeneurology.com`

It verifies the signed application bundle and writes immutable release evidence
to `delivery/ios-build9-hotfix/release.json`. Do not configure another
`flutter build ipa` command after it.

The optional `--skip-flutter-tests` mode exits before building an IPA and must
not be used for the App Store release.

## CodeMagic artifacts

Collect at least:

```text
delivery/ios-build9-hotfix/*.ipa
delivery/ios-build9-hotfix/release.json
```

Retain the CodeMagic build log and App Store Connect upload record with the
release evidence. Publish only when `release.json` records
`flutterTestsSkipped: false`, version `1.1.1`, build `9`, and the exact approved
source commit.
