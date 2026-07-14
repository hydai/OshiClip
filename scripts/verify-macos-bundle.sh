#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_path="${1:-$repo_root/src-tauri/target/release/bundle/macos/OshiClip.app}"
binary_path="$app_path/Contents/MacOS/oshiclip"

if [[ ! -f "$binary_path" ]]; then
  echo "macOS app binary not found: $binary_path" >&2
  exit 1
fi

dependencies="$(otool -L "$binary_path")"
unexpected_dependencies="$(
  printf '%s\n' "$dependencies" | awk '
    NR > 1 && $1 !~ /^\/System\/Library\// && $1 !~ /^\/usr\/lib\// { print $1 }
  '
)"

if [[ -n "$unexpected_dependencies" ]]; then
  echo "macOS bundle links to non-system dynamic libraries:" >&2
  echo "$unexpected_dependencies" >&2
  exit 1
fi

if grep -Eq '^name = "(lzma-sys|xz2)"$' "$repo_root/src-tauri/Cargo.lock"; then
  echo "Cargo.lock still contains the native liblzma dependency chain." >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"
echo "macOS bundle uses only Apple system dynamic libraries and its code signature is valid."
