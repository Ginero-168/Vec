#!/bin/sh
set -eu
log="${VECTOR_PANEL_SPAWN_LOG:-}"
now_ms() {
  date +%s%3N
}
if [ -n "$log" ]; then
  printf '%s\n' "$(now_ms) start" >> "$log"
fi
trap 'exit 143' TERM INT
delay="${VECTOR_PANEL_VTRACER_DELAY_MS:-0}"
rest="$delay"
while [ "$rest" -gt 0 ]; do
  sleep 0.05
  rest=$((rest - 50))
done
src="${VECTOR_PANEL_SVG_FIXTURE:?}"
cp "$src" "$2"
if [ -n "$log" ]; then
  printf '%s\n' "$(now_ms) end" >> "$log"
fi
