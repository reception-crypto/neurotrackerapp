# NeuroSol 1.1.1 Build 9 accessibility hotfix

This mobile-only hotfix keeps backend `0.10.0` and the existing Build 7/8
compatibility contract unchanged. It fixes the Wellness Percentage page when
iPhone accessibility text is enlarged.

## 1. Source approval

- [ ] Build only branch `codex/hotfix-1.1.1-build9`.
- [ ] Confirm `pubspec.yaml` is `1.1.1+9`.
- [ ] Confirm `lib/app_identity.dart` reports version `1.1.1`, build `9`.
- [ ] Confirm the GitHub Verify workflow passes on the exact release commit.
- [ ] Confirm the release commit descends from Large Text fix `c9e8b28`.
- [ ] Do not deploy or alter the production backend for this hotfix.

## 2. Acceptance testing

- [ ] On a compact iPhone, set Settings > Display & Brightness > Text Size to
      the largest standard size and submit a complete daily check-in.
- [ ] Repeat with Settings > Accessibility > Display & Text Size > Larger Text
      enabled at the maximum accessibility size.
- [ ] Confirm the Submit button remains visible above the home indicator,
      becomes enabled after selecting a wellness percentage, and submits once.
- [ ] Confirm the wellness choices can scroll independently without covering
      the Submit button.
- [ ] Test an ordinary-text iPhone and Android device for regression.
- [ ] Upgrade an existing Build 8 installation and confirm enrolment, local
      history, pending entries, reminder settings, and support ID are retained.

## 3. Signed Android artifacts

From the release worktree on the signing PC:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\delivery\build-neurosol-android-build9-hotfix.ps1
```

- [ ] Confirm `delivery\android-build9-hotfix\release.json` records version
      `1.1.1`, build `9`, `flutterTestsSkipped: false`, and the approved commit.
- [ ] Retain the AAB/APK SHA-256 hashes and install the APK with `adb install -r`
      for the upgrade test.
- [ ] Upload `NeuroSol-Symptom-Diary-1.1.1-build9.aab` to Google Play production.
- [ ] Use a staged rollout if required by the current Play Console policy.

## 4. Signed iOS artifact

In CodeMagic, select the exact hotfix branch and run:

```bash
./delivery/build-neurosol-ios-build9-hotfix.sh
```

- [ ] Confirm `delivery/ios-build9-hotfix/release.json` records version `1.1.1`,
      build `9`, `flutterTestsSkipped: false`, and the approved commit.
- [ ] Confirm the IPA signature and bundle ID checks pass.
- [ ] Upload the IPA to App Store Connect and attach build `9` to version `1.1.1`.

## 5. Store submission

Release notes:

> Fixed an accessibility issue that could hide the Submit button on the
> Wellness Percentage page when larger text was enabled on iPhone.

- [ ] Reuse the existing screenshots unless either store specifically requests
      updated images; the visual design and advertised functionality are
      otherwise unchanged.
- [ ] Preserve the existing privacy, medical, encryption, and reviewer-access
      declarations.
- [ ] Submit version `1.1.1` for expedited review if Apple offers that option.
- [ ] After approval, verify the public store pages show the new version and
      complete one production check-in on each platform.

The larger feature bundle previously called Build 9 must use build number `10`
or greater after this hotfix.
