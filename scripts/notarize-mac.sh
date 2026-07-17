#!/usr/bin/env bash
set -euo pipefail

release_dir="release"
version="$(node -p "require('./package.json').version")"
dmg_path="$release_dir/Attune-$version-mac-universal.dmg"
app_path="$(find "$release_dir" -maxdepth 2 -type d -name 'Attune.app' -print -quit)"

if [[ ! -f "$dmg_path" || -z "$app_path" ]]; then
  echo "No Attune $version universal DMG or app found in $release_dir." >&2
  exit 1
fi

xcrun notarytool submit "$dmg_path" --keychain-profile "attune-notary" --wait
xcrun stapler staple "$dmg_path"
xcrun stapler validate "$dmg_path"
spctl --assess --type execute --verbose=4 "$app_path"
