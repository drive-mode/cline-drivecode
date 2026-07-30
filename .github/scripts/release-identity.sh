#!/usr/bin/env bash
# Compute durable CI release identity.
#
# Prefer github.run_id over unix timestamps so cancelled/retried runs stay
# greppable in Actions and do not mint colliding nightly versions.
#
# Usage (env in, stdout key=value for GITHUB_OUTPUT / callers):
#   PRODUCT=sdk CHANNEL=nightly BASE_VERSION=0.0.66 RUN_ID=123 SHA=abc... \
#     bash .github/scripts/release-identity.sh
#
# Outputs:
#   product, channel, base_version, version, sha, short_sha, run_id, run_url,
#   build_id, git_tag, attempt_tag
set -euo pipefail

PRODUCT="${PRODUCT:?PRODUCT is required (sdk|cli|ui|vscode|desktop)}"
CHANNEL="${CHANNEL:?CHANNEL is required (latest|nightly|next|stable)}"
RUN_ID="${RUN_ID:?RUN_ID is required}"
SHA="${SHA:?SHA is required}"
REPO="${REPO:-}"
SERVER_URL="${SERVER_URL:-https://github.com}"
BASE_VERSION="${BASE_VERSION:-}"
VERSION_OVERRIDE="${VERSION_OVERRIDE:-}"

SHORT_SHA="$(printf '%s' "$SHA" | cut -c1-12)"

if [ -n "$VERSION_OVERRIDE" ]; then
  VERSION="$VERSION_OVERRIDE"
elif [ -z "$BASE_VERSION" ]; then
  echo "BASE_VERSION or VERSION_OVERRIDE is required" >&2
  exit 1
else
  case "$CHANNEL" in
    nightly)
      case "$PRODUCT" in
        # Marketplace / VSIX requires major.minor.patch with numeric patch.
        vscode)
          MAJOR_MINOR="$(printf '%s' "$BASE_VERSION" | cut -d. -f1,2)"
          VERSION="${MAJOR_MINOR}.${RUN_ID}"
          ;;
        *)
          VERSION="${BASE_VERSION}-nightly.${RUN_ID}"
          ;;
      esac
      ;;
    latest|stable|next)
      VERSION="$BASE_VERSION"
      ;;
    *)
      echo "Unknown CHANNEL: $CHANNEL" >&2
      exit 1
      ;;
  esac
fi

BUILD_ID="${PRODUCT}@${VERSION}+${SHORT_SHA}.run${RUN_ID}"

case "$PRODUCT-$CHANNEL" in
  sdk-latest) GIT_TAG="sdk/sdk/v${VERSION}" ;;
  sdk-nightly) GIT_TAG="sdk-nightly/v${VERSION}" ;;
  cli-latest|cli-stable) GIT_TAG="cli-v${VERSION}" ;;
  cli-nightly) GIT_TAG="cli-nightly/v${VERSION}" ;;
  ui-latest|ui-next) GIT_TAG="ui/v${VERSION}" ;;
  vscode-nightly) GIT_TAG="vscode-nightly/v${VERSION}-${SHORT_SHA}" ;;
  vscode-stable|vscode-latest) GIT_TAG="v${VERSION}" ;;
  desktop-latest|desktop-stable) GIT_TAG="desktop-v${VERSION}" ;;
  *) GIT_TAG="${PRODUCT}/${CHANNEL}/v${VERSION}-${SHORT_SHA}" ;;
esac

ATTEMPT_TAG="ci/${PRODUCT}/attempt/${RUN_ID}"

if [ -n "$REPO" ]; then
  RUN_URL="${SERVER_URL}/${REPO}/actions/runs/${RUN_ID}"
else
  RUN_URL=""
fi

emit() {
  printf '%s=%s\n' "$1" "$2"
}

emit product "$PRODUCT"
emit channel "$CHANNEL"
emit base_version "${BASE_VERSION:-}"
emit version "$VERSION"
emit sha "$SHA"
emit short_sha "$SHORT_SHA"
emit run_id "$RUN_ID"
emit run_url "$RUN_URL"
emit build_id "$BUILD_ID"
emit git_tag "$GIT_TAG"
emit attempt_tag "$ATTEMPT_TAG"
