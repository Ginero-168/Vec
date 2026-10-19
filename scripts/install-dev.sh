#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$project_dir/extension"
target_dir="$HOME/Library/Application Support/Adobe/CEP/extensions"
target_path="$target_dir/com.peerawat.vectorpanel"

if [[ ! -f "$source_dir/js/panel.js" || ! -x "$source_dir/bin/vtracer" ]]; then
  printf 'Build the panel and worker first: npm run build; ./scripts/build-worker.sh\n' >&2
  exit 1
fi

mkdir -p "$target_dir"
if [[ -L "$target_path" ]]; then
  if [[ "$(readlink "$target_path")" != "$source_dir" ]]; then
    printf 'A different extension link already exists at %s\n' "$target_path" >&2
    exit 1
  fi
elif [[ -e "$target_path" ]]; then
  printf 'An extension already exists at %s\n' "$target_path" >&2
  exit 1
else
  ln -s "$source_dir" "$target_path"
fi

defaults write com.adobe.CSXS.12 PlayerDebugMode 1
printf 'Development extension linked at %s\n' "$target_path"
printf 'Open Illustrator > Window > Extensions (Legacy) > Vector Panel after restarting Illustrator.\n'
