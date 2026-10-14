#!/usr/bin/env bash
# Detects — and optionally removes — the " 2" / " 3" conflict copies that
# periodically appear in this working tree.
#
# Java refuses to compile when two files declare the same class, and Spring Boot
# refuses to start when it finds several main classes, so these silently break
# the build.
#
#   ./scripts/check-duplicates.sh          report only (exit 1 if any found)
#   ./scripts/check-duplicates.sh --fix    delete build-output copies,
#                                          quarantine source copies
set -uo pipefail
cd "$(dirname "$0")/.."

FIX=false
[[ "${1:-}" == "--fix" ]] && FIX=true

# Regenerable build output: safe to delete outright.
BUILD_PATHS=(backend/target frontend/dist frontend/node_modules)
# Anything a human wrote: never deleted, only moved aside.
SOURCE_PATHS=(backend/src frontend/src services scripts docs)

pattern='* [0-9].*'
found=0

echo "Scanning for conflict copies..."

for path in "${BUILD_PATHS[@]}"; do
  [[ -d "$path" ]] || continue
  count=$(find "$path" -name "$pattern" 2>/dev/null | wc -l | tr -d ' ')
  [[ "$count" == "0" ]] && continue
  found=$((found + count))
  echo "  $path: $count (build output)"
  if $FIX; then
    find "$path" -name "$pattern" -delete 2>/dev/null
    echo "    deleted"
  fi
done

quarantine="../duplicates-quarantine-$(date +%Y%m%d-%H%M%S)"
source_found=0

for path in "${SOURCE_PATHS[@]}"; do
  [[ -d "$path" ]] || continue
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    source_found=$((source_found + 1))
    found=$((found + 1))
    echo "  $file (SOURCE)"
    if $FIX; then
      mkdir -p "$quarantine/$(dirname "$file")"
      mv "$file" "$quarantine/$file"
    fi
  done < <(find "$path" -name "$pattern" 2>/dev/null)
done

if $FIX && [[ "$source_found" -gt 0 ]]; then
  echo "  moved $source_found source file(s) to $quarantine (not deleted)"
fi

if [[ "$found" == "0" ]]; then
  echo "Clean — no conflict copies."
  exit 0
fi

if $FIX; then
  echo "Fixed $found file(s)."
  exit 0
fi

cat <<MSG

Found $found conflict copy/copies. Run:

  ./scripts/check-duplicates.sh --fix

Build output is deleted; source files are MOVED to a quarantine folder, never
deleted.
MSG
exit 1
