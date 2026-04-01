#!/usr/bin/env bash
set -euo pipefail

KEYCHAIN_PATH="${1:-${IMMORADAR_SIGNING_KEYCHAIN_PATH:-}}"
KEYCHAIN_PASSWORD="${2:-${IMMORADAR_SIGNING_KEYCHAIN_PASSWORD:-}}"
KEYCHAIN_TIMEOUT_SECONDS="${IMMORADAR_SIGNING_KEYCHAIN_TIMEOUT:-21600}"

if [[ -z "$KEYCHAIN_PATH" || -z "$KEYCHAIN_PASSWORD" ]]; then
  echo "Usage: prepare-signing-keychain.sh <keychain-path> <keychain-password>" >&2
  exit 1
fi

if [[ ! -f "$KEYCHAIN_PATH" ]]; then
  echo "Signing keychain not found at $KEYCHAIN_PATH" >&2
  exit 1
fi

security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut "$KEYCHAIN_TIMEOUT_SECONDS" "$KEYCHAIN_PATH"

existing_keychains=()
while IFS= read -r line; do
  line="${line//\"/}"
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -n "$line" ]] && existing_keychains+=("$line")
done < <(security list-keychains -d user)

keychain_is_listed=0
for existing_keychain in "${existing_keychains[@]}"; do
  if [[ "$existing_keychain" == "$KEYCHAIN_PATH" ]]; then
    keychain_is_listed=1
    break
  fi
done

if [[ "$keychain_is_listed" -eq 0 ]]; then
  security list-keychains -d user -s "$KEYCHAIN_PATH" "${existing_keychains[@]}"
fi

security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$KEYCHAIN_PATH"

echo "Prepared signing keychain: $KEYCHAIN_PATH"
