#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${1:-}"
STAMP_FILE="${2:-}"

if [[ -z "$RUNTIME_DIR" || ! -d "$RUNTIME_DIR" ]]; then
  exit 0
fi

if [[ "${CODE_SIGNING_ALLOWED:-NO}" != "YES" ]]; then
  exit 0
fi

if [[ -z "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]]; then
  exit 0
fi

sign_if_macho() {
  local target="$1"
  if file "$target" | grep -q 'Mach-O'; then
    codesign \
      --force \
      --sign "$EXPANDED_CODE_SIGN_IDENTITY" \
      --timestamp=none \
      --options runtime \
      "$target"
  fi
}

while IFS= read -r -d '' file_path; do
  sign_if_macho "$file_path"
done < <(find "$RUNTIME_DIR" -type f -perm -111 -print0)

if [[ -n "$STAMP_FILE" ]]; then
  mkdir -p "$(dirname "$STAMP_FILE")"
  touch "$STAMP_FILE"
fi
