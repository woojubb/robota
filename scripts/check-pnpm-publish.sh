#!/bin/sh
# Blocks npm publish — only pnpm publish is allowed in this monorepo.
# Add "prepublishOnly": "bash ../../scripts/check-pnpm-publish.sh" to each package.

if echo "${npm_config_user_agent:-}" | grep -q "^npm/"; then
  echo ""
  echo "❌ BLOCKED: Use 'pnpm publish', not 'npm publish'."
  echo "   pnpm resolves workspace:* deps. npm does not."
  echo ""
  exit 1
fi
