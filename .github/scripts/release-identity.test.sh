#!/usr/bin/env bash
# Smoke tests for .github/scripts/release-identity.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/release-identity.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_kv() {
  local blob="$1" key="$2" want="$3"
  local got
  got="$(printf '%s\n' "$blob" | awk -F= -v k="$key" '$1==k{print substr($0,index($0,"=")+1); exit}')"
  [ "$got" = "$want" ] || fail "$key: want '$want' got '$got'"
}

out="$(
  PRODUCT=sdk CHANNEL=nightly BASE_VERSION=0.0.66 RUN_ID=99 SHA=abcdef0123456789 REPO=acme/repo \
    bash "$SCRIPT"
)"
expect_kv "$out" version "0.0.66-nightly.99"
expect_kv "$out" git_tag "sdk-nightly/v0.0.66-nightly.99"
expect_kv "$out" short_sha "abcdef012345"
expect_kv "$out" build_id "sdk@0.0.66-nightly.99+abcdef012345.run99"

out="$(
  PRODUCT=vscode CHANNEL=nightly BASE_VERSION=4.1.2 RUN_ID=42 SHA=ffffffffffffffff \
    bash "$SCRIPT"
)"
expect_kv "$out" version "4.1.42"
expect_kv "$out" git_tag "vscode-nightly/v4.1.42-ffffffffffff"

out="$(
  PRODUCT=cli CHANNEL=latest BASE_VERSION=3.0.1 VERSION_OVERRIDE=3.0.1 RUN_ID=1 SHA=1234567890ab \
    bash "$SCRIPT"
)"
expect_kv "$out" version "3.0.1"
expect_kv "$out" git_tag "cli-v3.0.1"

echo "release-identity.sh smoke tests passed"
