#!/usr/bin/env bash
set -euo pipefail

release_dir="release"
dmg_path="$(find "$release_dir" -maxdepth 1 -type f -name 'Attune-*-mac-universal.dmg' -print -quit)"
app_path="$(find "$release_dir" -maxdepth 2 -type d -name 'Attune.app' -print -quit)"

if [[ -z "$dmg_path" || -z "$app_path" ]]; then
  echo "No Attune universal DMG or app found in $release_dir." >&2
  exit 1
fi

xcrun notarytool submit "$dmg_path" --keychain-profile "attune-notary" --wait
xcrun stapler staple "$dmg_path"
xcrun stapler validate "$dmg_path"
spctl --assess --type execute --verbose=4 "$app_path"
