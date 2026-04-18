#!/usr/bin/env bash
# PostToolUse hook: detect cross-package re-exports in TypeScript files.
# Flags "export { ... } from '@robota-sdk/...'" and "export * from '@robota-sdk/...'"
# patterns where the source is a different package than the file's own package.
#
# Environment variables (provided by Claude Code):
#   CLAUDE_TOOL_INPUT - JSON with file_path field

set -euo pipefail

# Read JSON from stdin (Claude Code sends hook input via stdin)
INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Only check TypeScript files within packages/ or apps/
case "$FILE_PATH" in
  "$CLAUDE_PROJECT_DIR"/packages/*.ts|"$CLAUDE_PROJECT_DIR"/packages/*.tsx) ;;
  "$CLAUDE_PROJECT_DIR"/apps/*.ts|"$CLAUDE_PROJECT_DIR"/apps/*.tsx) ;;
  *) exit 0 ;;
esac

# Determine the current package name from the nearest package.json
PKG_DIR="$FILE_PATH"
PKG_NAME=""
while [ "$PKG_DIR" != "$CLAUDE_PROJECT_DIR" ] && [ "$PKG_DIR" != "/" ]; do
  PKG_DIR=$(dirname "$PKG_DIR")
  if [ -f "$PKG_DIR/package.json" ]; then
    PKG_NAME=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$PKG_DIR/package.json" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    break
  fi
done

if [ -z "$PKG_NAME" ]; then
  exit 0
fi

# Find re-export lines: export { ... } from '@robota-sdk/...' or export * from '@robota-sdk/...'
# Exclude lines that re-export from the same package
VIOLATIONS=$(grep -nE "export\s+(type\s+)?\{[^}]*\}\s+from\s+['\"]@robota-sdk/" "$FILE_PATH" 2>/dev/null || true)
VIOLATIONS="$VIOLATIONS"$'\n'$(grep -nE "export\s+\*\s+from\s+['\"]@robota-sdk/" "$FILE_PATH" 2>/dev/null || true)

# Filter out empty lines and self-references
ISSUES=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # Extract the package being re-exported
  REEXPORT_PKG=$(echo "$line" | grep -o "'@robota-sdk/[^']*'" | tr -d "'" || echo "$line" | grep -o '"@robota-sdk/[^"]*"' | tr -d '"')
  if [ -n "$REEXPORT_PKG" ] && [ "$REEXPORT_PKG" != "$PKG_NAME" ]; then
    ISSUES="$ISSUES$line\n"
  fi
done <<< "$VIOLATIONS"

if [ -n "$ISSUES" ]; then
  echo "⚠️ Cross-package re-export detected in $FILE_PATH"
  echo "Rule: Import from the owning package directly, do not re-export (common-mistakes #4)"
  echo ""
  echo "Violations:"
  echo -e "$ISSUES"
  echo ""
  echo "Fix: Import the type/value directly from the owning package at the usage site."
  exit 1
fi
