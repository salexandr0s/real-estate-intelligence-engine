#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_NAME="ImmoRadar"
SCHEME="ImmoRadar"
PROJECT_PATH="$REPO_ROOT/apps/macos/ImmoRadar.xcodeproj"
DERIVED_DATA_PATH="${IMMORADAR_DERIVED_DATA_PATH:-$REPO_ROOT/.build/macos-derived}"
RELEASE_ROOT="${IMMORADAR_RELEASE_ROOT:-$REPO_ROOT/.build/macos-release}"
CONFIGURATION="${IMMORADAR_CONFIGURATION:-Release}"
VOLNAME="${IMMORADAR_DMG_VOLUME_NAME:-ImmoRadar}"
DMG_NAME="${IMMORADAR_DMG_NAME:-ImmoRadar-macOS.dmg}"
CODE_SIGNING_ALLOWED="${IMMORADAR_CODE_SIGNING_ALLOWED:-YES}"
CODE_SIGN_IDENTITY_OVERRIDE="${IMMORADAR_CODE_SIGN_IDENTITY:-}"
SIGNING_KEYCHAIN_PATH="${IMMORADAR_SIGNING_KEYCHAIN_PATH:-}"
SIGNING_KEYCHAIN_PASSWORD="${IMMORADAR_SIGNING_KEYCHAIN_PASSWORD:-}"
NOTARIZE="${IMMORADAR_NOTARIZE:-0}"

APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION/$APP_NAME.app"
STAGING_DIR="$RELEASE_ROOT/dmg-root"
DMG_PATH="$RELEASE_ROOT/$DMG_NAME"
STAGED_APP_PATH="$STAGING_DIR/$APP_NAME.app"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command xcodebuild
require_command xcodegen
require_command hdiutil

if [[ "$CODE_SIGNING_ALLOWED" == "YES" ]]; then
  require_command codesign
  require_command security
fi

resolve_signing_identity() {
  if [[ -n "$CODE_SIGN_IDENTITY_OVERRIDE" ]]; then
    echo "$CODE_SIGN_IDENTITY_OVERRIDE"
    return 0
  fi

  local development_team
  development_team="$(
    xcodebuild \
      -scheme "$SCHEME" \
      -project "$PROJECT_PATH" \
      -configuration "$CONFIGURATION" \
      -showBuildSettings 2>/dev/null |
      awk -F ' = ' '/^[[:space:]]*DEVELOPMENT_TEAM = / { print $2; exit }'
  )"

  local identity
  identity="$(
    security find-identity -v -p codesigning |
      awk -v team="$development_team" '
        /Developer ID Application:/ {
          if (team == "" || $0 ~ "\\(" team "\\)") {
            print $2
            exit
          }
        }
      '
  )"

  if [[ -z "$identity" ]]; then
    echo "Unable to find a Developer ID Application identity${development_team:+ for team $development_team}" >&2
    exit 1
  fi

  echo "$identity"
}

verify_signed_app() {
  local target="$1"
  local details

  codesign --verify --deep --strict --verbose=2 "$target"

  if ! details="$(codesign -dvv "$target" 2>&1)"; then
    echo "Failed to inspect signature for $target" >&2
    echo "$details" >&2
    exit 1
  fi

  if grep -q '^Signature=adhoc$' <<<"$details"; then
    echo "Expected Developer ID signature for $target, but found ad-hoc signing" >&2
    echo "$details" >&2
    exit 1
  fi
}

sign_app_bundle() {
  local identity="$1"
  local max_attempts="${IMMORADAR_SIGN_MAX_ATTEMPTS:-3}"
  local retry_delay_seconds="${IMMORADAR_SIGN_RETRY_DELAY_SECONDS:-2}"
  local attempt
  local status=1

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if codesign \
      --force \
      --deep \
      --sign "$identity" \
      --options runtime \
      --timestamp=none \
      "$APP_PATH"; then
      return 0
    else
      status=$?
    fi

    if (( attempt < max_attempts )); then
      echo "App signing failed on attempt $attempt/$max_attempts; retrying in ${retry_delay_seconds}s..." >&2
      sleep "$retry_delay_seconds"
    fi
  done

  return "$status"
}

if [[ "$CODE_SIGNING_ALLOWED" == "YES" && ( -n "$SIGNING_KEYCHAIN_PATH" || -n "$SIGNING_KEYCHAIN_PASSWORD" ) ]]; then
  : "${IMMORADAR_SIGNING_KEYCHAIN_PATH:?IMMORADAR_SIGNING_KEYCHAIN_PATH is required when preparing a signing keychain}"
  : "${IMMORADAR_SIGNING_KEYCHAIN_PASSWORD:?IMMORADAR_SIGNING_KEYCHAIN_PASSWORD is required when preparing a signing keychain}"
  "$SCRIPT_DIR/prepare-signing-keychain.sh" "$SIGNING_KEYCHAIN_PATH" "$SIGNING_KEYCHAIN_PASSWORD"
fi

mkdir -p "$RELEASE_ROOT"
rm -rf "$STAGING_DIR" "$DMG_PATH" "$DERIVED_DATA_PATH"

(
  cd "$REPO_ROOT/apps/macos"
  xcodegen generate >/dev/null
  IMMORADAR_ENABLE_RUNTIME_CODESIGN=NO xcodebuild \
    -scheme "$SCHEME" \
    -project "$PROJECT_PATH" \
    -configuration "$CONFIGURATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    CODE_SIGNING_ALLOWED=NO \
    build
)

if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found at $APP_PATH" >&2
  exit 1
fi

if [[ "$CODE_SIGNING_ALLOWED" == "YES" ]]; then
  SIGNING_IDENTITY="$(resolve_signing_identity)"
  sign_app_bundle "$SIGNING_IDENTITY"
  verify_signed_app "$APP_PATH"
fi

mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

if [[ "$CODE_SIGNING_ALLOWED" == "YES" ]]; then
  verify_signed_app "$STAGED_APP_PATH"
fi

hdiutil create \
  -volname "$VOLNAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

if [[ "$NOTARIZE" == "1" ]]; then
  require_command xcrun
  : "${APPLE_ID:?APPLE_ID is required for notarization}"
  : "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD is required for notarization}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required for notarization}"

  xcrun notarytool submit \
    "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  xcrun stapler staple "$DMG_PATH"
fi

echo "Created DMG: $DMG_PATH"
