#!/bin/bash
set -euo pipefail

output_path="${1:?output path is required}"
source_path="$(cd "$(dirname "$0")/.." && pwd)/electron/helpers/window-region-stream.swift"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT

mkdir -p "$(dirname "$output_path")"
xcrun --sdk macosx swiftc -parse-as-library -O -target arm64-apple-macosx13.0 "$source_path" -o "$build_dir/window-region-stream-arm64"
xcrun --sdk macosx swiftc -parse-as-library -O -target x86_64-apple-macosx13.0 "$source_path" -o "$build_dir/window-region-stream-x86_64"
lipo -create "$build_dir/window-region-stream-arm64" "$build_dir/window-region-stream-x86_64" -output "$output_path"
chmod 755 "$output_path"
