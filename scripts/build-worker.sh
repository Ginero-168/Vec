#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cargo install vtracer-cli --version 1.0.0-alpha.4 --locked --root "$project_dir/.vendor-build"
cp "$project_dir/.vendor-build/bin/vtracer" "$project_dir/extension/bin/vtracer"
chmod 755 "$project_dir/extension/bin/vtracer"
printf 'Built %s\n' "$project_dir/extension/bin/vtracer"
