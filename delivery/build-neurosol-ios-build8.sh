#!/usr/bin/env bash

set -euo pipefail

skip_flutter_tests=false
force=false
while (($#)); do
  case "$1" in
    --skip-flutter-tests)
      skip_flutter_tests=true
      ;;
    --force)
      force=true
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_root=$(cd "$script_directory/.." && pwd)
cd "$project_root"

for command_name in flutter dart npm node git shasum unzip codesign; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is not available in this macOS shell." >&2
    exit 1
  fi
done
if [[ $(uname -s) != Darwin ]]; then
  echo 'The signed iOS Build 8 script must run on macOS.' >&2
  exit 1
fi
if [[ ! -x /usr/libexec/PlistBuddy ]]; then
  echo 'macOS PlistBuddy was not found.' >&2
  exit 1
fi

source_commit=$(git rev-parse HEAD)
if [[ ! $source_commit =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Could not determine the Build 8 source commit.' >&2
  exit 1
fi
required_ancestors=(
  1c9a365
  f2adba0
  fa351d7
  d9cb404
)
for required_commit in "${required_ancestors[@]}"; do
  if ! git merge-base --is-ancestor "$required_commit" "$source_commit"; then
    echo "Required reconciled source commit is missing: $required_commit" >&2
    exit 1
  fi
done

release_directory="$project_root/delivery/ios-build8"
release_ipa="$release_directory/NeuroSol-Symptom-Diary-1.0.0-build8.ipa"
metadata_path="$release_directory/release.json"
if [[ $force == false ]]; then
  for target in "$release_ipa" "$metadata_path"; do
    if [[ -e $target ]]; then
      echo "A Build 8 release artifact already exists: $target" >&2
      echo 'Re-run with --force only if replacing it is intentional.' >&2
      exit 1
    fi
  done
fi

source_status=$(git status --porcelain -- \
  android \
  ios \
  assets \
  lib \
  test \
  backend \
  pubspec.yaml \
  pubspec.lock \
  delivery/build-neurosol-android-build8.ps1 \
  delivery/build-neurosol-ios-build8.sh \
  delivery/build8-backend-compatibility)
if [[ -n $source_status ]]; then
  echo 'Build 8 source or release tooling is not committed:' >&2
  printf '%s\n' "$source_status" >&2
  exit 1
fi

grep -Eq '^version:[[:space:]]*1\.0\.0\+8[[:space:]]*$' pubspec.yaml
grep -Fq 'appBuildNumber = 8' lib/app_identity.dart
grep -Fq 'clinic-managed-v1' lib/app_identity.dart
grep -Fq 'canonical-v1' lib/app_identity.dart
grep -Fq 'independent-v1' lib/app_identity.dart
grep -Fq 'stageDailyEntry' lib/services/storage_service.dart
grep -Fq 'completePendingEntry' lib/services/storage_service.dart
grep -Fq 'neurosol-brand-banner' lib/widgets/brand_identity.dart
grep -Fq 'PRODUCT_BUNDLE_IDENTIFIER = au.com.pascoeneurology.neurosol;' \
  ios/Runner.xcodeproj/project.pbxproj
grep -Fq '<string>NeuroSol</string>' ios/Runner/Info.plist
if grep -R -n -E \
  'ProfileScreen|SymptomSelectionScreen|Edit patient profile' lib; then
  echo 'Obsolete patient self-configuration remains in mobile source.' >&2
  exit 1
fi
if [[ $(node -p "require('./backend/package.json').version") != 0.10.0 ]]; then
  echo 'The reconciled backend must be version 0.10.0.' >&2
  exit 1
fi
grep -Fq 'submission_id_conflict' backend/server.js
grep -Fq 'daily_submission_exists' backend/server.js
grep -Fq 'ENROLMENT_INCIDENT_LOCKDOWN' backend/server.js
grep -Fq 'quarantineReleasedAt' backend/identity_store.js

echo 'Cleaning previous Flutter output...'
flutter clean
echo 'Restoring Flutter packages...'
flutter pub get
echo 'Formatting source...'
dart format lib test
echo 'Analyzing Build 8...'
flutter analyze
echo 'Running backend 0.10.0 tests...'
(
  cd backend
  npm test
)
echo 'Running backend deployment-probe tests...'
node --test \
  delivery/build8-backend-compatibility/test/verify-clinical-data.test.js
if [[ $skip_flutter_tests == true ]]; then
  echo \
    'Flutter tests were skipped. Verification is diagnostic only; no signed release artifacts were created.' \
    >&2
  exit 0
fi
echo 'Running Flutter tests...'
flutter test --reporter expanded

post_verification_status=$(git status --porcelain -- \
  android \
  ios \
  assets \
  lib \
  test \
  backend \
  pubspec.yaml \
  pubspec.lock \
  delivery/build-neurosol-android-build8.ps1 \
  delivery/build-neurosol-ios-build8.sh \
  delivery/build8-backend-compatibility)
if [[ -n $post_verification_status ]]; then
  echo \
    'Formatting or verification changed the committed Build 8 source. Review and commit those changes before building.' \
    >&2
  printf '%s\n' "$post_verification_status" >&2
  exit 1
fi

echo 'Building signed Build 8 iOS archive and IPA...'
flutter build ipa \
  --release \
  --build-name=1.0.0 \
  --build-number=8 \
  --dart-define=NEUROTRACKER_API_URL=https://tracker.melindapascoeneurology.com

ipa_directory="$project_root/build/ios/ipa"
ipa_count=$(find "$ipa_directory" -maxdepth 1 -type f -name '*.ipa' | wc -l | tr -d '[:space:]')
if [[ $ipa_count != 1 ]]; then
  echo "Expected exactly one signed IPA, found $ipa_count." >&2
  exit 1
fi
source_ipa=$(find "$ipa_directory" -maxdepth 1 -type f -name '*.ipa' -print -quit)
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/neurosol-build8.XXXXXX")
trap 'rm -rf "$temporary_root"' EXIT
unzip -q "$source_ipa" -d "$temporary_root"
app_bundle=$(find "$temporary_root/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)
if [[ -z $app_bundle ]]; then
  echo 'The IPA does not contain an application bundle.' >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$app_bundle"
built_bundle_id=$(/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleIdentifier' "$app_bundle/Info.plist")
built_version=$(/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleShortVersionString' "$app_bundle/Info.plist")
built_number=$(/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleVersion' "$app_bundle/Info.plist")
if [[ $built_bundle_id != au.com.pascoeneurology.neurosol || \
      $built_version != 1.0.0 || $built_number != 8 ]]; then
  echo \
    "Unexpected signed IPA identity: $built_bundle_id $built_version ($built_number)" \
    >&2
  exit 1
fi

mkdir -p "$release_directory"
cp -p "$source_ipa" "$release_ipa"
ipa_hash=$(shasum -a 256 "$release_ipa" | awk '{print $1}')
ipa_length=$(stat -f '%z' "$release_ipa")
source_tree=$(git rev-parse 'HEAD^{tree}')
node - \
  "$metadata_path" \
  "$source_commit" \
  "$source_tree" \
  "$ipa_hash" \
  "$ipa_length" \
  "$(basename "$release_ipa")" <<'NODE'
const fs = require('node:fs');
const [
  metadataPath,
  sourceCommit,
  sourceTree,
  ipaHash,
  ipaLength,
  ipaName,
] = process.argv.slice(2);
const release = {
  releaseFormat: 1,
  product: 'NeuroSol Symptom Diary',
  versionName: '1.0.0',
  buildNumber: 8,
  bundleId: 'au.com.pascoeneurology.neurosol',
  backendVersion: '0.10.0',
  sourceCommit,
  sourceTree,
  apiUrl: 'https://tracker.melindapascoeneurology.com',
  flutterTestsSkipped: false,
  generatedAt: new Date().toISOString(),
  artifacts: [{
    name: ipaName,
    sha256: ipaHash,
    length: Number(ipaLength),
  }],
};
fs.writeFileSync(metadataPath, `${JSON.stringify(release, null, 2)}\n`);
NODE

echo
echo 'NEUROSOL IOS BUILD 8 COMPLETE'
echo "Source commit: $source_commit"
echo "IPA SHA256: $ipa_hash"
echo "Release metadata: $metadata_path"
