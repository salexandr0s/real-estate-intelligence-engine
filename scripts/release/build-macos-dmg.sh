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
SIGNING_KEYCHAIN_PATH="${IMMORADAR_SIGNING_KEYCHAIN_PATH:-}"
SIGNING_KEYCHAIN_PASSWORD="${IMMORADAR_SIGNING_KEYCHAIN_PASSWORD:-}"
NOTARIZE="${IMMORADAR_NOTARIZE:-0}"

APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION/$APP_NAME.app"
STAGING_DIR="$RELEASE_ROOT/dmg-root"
DMG_PATH="$RELEASE_ROOT/$DMG_NAME"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command xcodebuild
require_command xcodegen
require_command hdiutil

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
  IMMORADAR_ENABLE_RUNTIME_CODESIGN=YES xcodebuild \
    -scheme "$SCHEME" \
    -project "$PROJECT_PATH" \
    -configuration "$CONFIGURATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    CODE_SIGNING_ALLOWED="$CODE_SIGNING_ALLOWED" \
    build
)

if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found at $APP_PATH" >&2
  exit 1
fi

mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

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
