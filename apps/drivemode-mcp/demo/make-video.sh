#!/usr/bin/env bash
# Join the recorded segments into one MP4.
#
# Playwright ships a VP8-only ffmpeg, so this needs a full ffmpeg on PATH.
set -euo pipefail

DIR="${1:-/tmp/drivemode-demo/recording}"
OUT="${2:-$DIR/drive-mode-demo.mp4}"

ffmpeg -y -loglevel error \
	-i "$DIR/01-clients.webm" \
	-i "$DIR/02-hub.webm" \
	-filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" \
	-map "[v]" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart \
	"$OUT"

echo "wrote $OUT"
