#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_path="$HOME/Library/Application Support/Adobe/CEP/extensions/com.peerawat.vectorpanel"

if [[ -L "$target_path" && "$(readlink "$target_path")" == "$project_dir/extension" ]]; then
  rm "$target_path"
  printf 'Removed development link at %s\n' "$target_path"
else
  printf 'No matching development link found. Nothing removed.\n'
fi
