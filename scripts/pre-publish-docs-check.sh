#!/bin/bash
# pre-publish-docs-check.sh
# Validates that all publishable packages have up-to-date documentation.
# This script is a mandatory gate before any npm publish.
#
# Exit 0 = all checks pass
# Exit 1 = documentation issues found (publishing blocked)

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

error() {
  echo -e "${RED}ERROR: $1${NC}"
  ERRORS=$((ERRORS + 1))
}

warn() {
  echo -e "${YELLOW}WARN: $1${NC}"
  WARNINGS=$((WARNINGS + 1))
}

ok() {
  echo -e "${GREEN}OK: $1${NC}"
}

# Find all publishable packages (those with "files" in package.json)
PACKAGES=$(find packages -maxdepth 1 -mindepth 1 -type d | sort)

echo "=== Pre-Publish Documentation Check ==="
echo ""

for pkg in $PACKAGES; do
  PKG_JSON="$pkg/package.json"
  if [[ ! -f "$PKG_JSON" ]]; then
    continue
  fi

  # Skip private packages
  PRIVATE=$(node -e "const p=require('./$PKG_JSON'); console.log(p.private || false)" 2>/dev/null)
  if [[ "$PRIVATE" == "true" ]]; then
    continue
  fi

  NAME=$(node -e "console.log(require('./$PKG_JSON').name)" 2>/dev/null)
  echo "--- $NAME ---"

  # Check 1: README.md exists and has content
  README="$pkg/README.md"
  if [[ ! -f "$README" ]]; then
    error "$NAME: Missing README.md"
  elif [[ $(wc -l < "$README") -lt 10 ]]; then
    error "$NAME: README.md has fewer than 10 lines"
  else
    ok "$NAME: README.md exists"
  fi

  # Check 2: SPEC.md exists and has content
  SPEC="$pkg/docs/SPEC.md"
  if [[ ! -f "$SPEC" ]]; then
    error "$NAME: Missing docs/SPEC.md"
  elif [[ $(wc -l < "$SPEC") -lt 20 ]]; then
    warn "$NAME: docs/SPEC.md has fewer than 20 lines (may be incomplete)"
  else
    ok "$NAME: docs/SPEC.md exists"
  fi

  # Check 3: package.json has description
  DESC=$(node -e "console.log(require('./$PKG_JSON').description || '')" 2>/dev/null)
  if [[ -z "$DESC" ]]; then
    error "$NAME: package.json missing 'description' field"
  else
    ok "$NAME: description present"
  fi

  # Check 4: package.json has license
  LICENSE=$(node -e "console.log(require('./$PKG_JSON').license || '')" 2>/dev/null)
  if [[ -z "$LICENSE" ]]; then
    error "$NAME: package.json missing 'license' field"
  else
    ok "$NAME: license present"
  fi

  # Check 5: README.md contains package name
  if [[ -f "$README" ]] && ! grep -q "$NAME" "$README"; then
    warn "$NAME: README.md does not mention the package name"
  fi

  # Check 6: README.md has installation section
  if [[ -f "$README" ]] && ! grep -qi "install\|setup\|getting started\|usage" "$README"; then
    warn "$NAME: README.md missing installation/usage section"
  fi

  echo ""
done

echo "=== Summary ==="
echo -e "Errors: ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo -e "${RED}BLOCKED: Fix all errors before publishing.${NC}"
  exit 1
fi

if [[ $WARNINGS -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}Warnings found. Review before publishing.${NC}"
fi

echo -e "${GREEN}Documentation check passed.${NC}"
exit 0
