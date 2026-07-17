#!/usr/bin/env bash
set -euo pipefail

iconset_dir="build/icon.iconset"
mkdir -p "$iconset_dir"

electron scripts/render-icon.cjs
sips -z 16 16 build/icon.png --out "$iconset_dir/icon_16x16.png" >/dev/null
sips -z 32 32 build/icon.png --out "$iconset_dir/icon_16x16@2x.png" >/dev/null
sips -z 32 32 build/icon.png --out "$iconset_dir/icon_32x32.png" >/dev/null
sips -z 64 64 build/icon.png --out "$iconset_dir/icon_32x32@2x.png" >/dev/null
sips -z 128 128 build/icon.png --out "$iconset_dir/icon_128x128.png" >/dev/null
sips -z 256 256 build/icon.png --out "$iconset_dir/icon_128x128@2x.png" >/dev/null
sips -z 256 256 build/icon.png --out "$iconset_dir/icon_256x256.png" >/dev/null
sips -z 512 512 build/icon.png --out "$iconset_dir/icon_256x256@2x.png" >/dev/null
sips -z 512 512 build/icon.png --out "$iconset_dir/icon_512x512.png" >/dev/null
sips -z 1024 1024 build/icon.png --out "$iconset_dir/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$iconset_dir" -o build/icon.icns
