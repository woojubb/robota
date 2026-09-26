#!/usr/bin/env bash
#
# configure-trusted-publishers.sh — make .github/workflows/publish.yml (environment `npm-publish`) the
# trusted publisher of every public @robota-sdk package. The owner runs this once, and again for a
# package published for the first time. npm asks for 2FA; nothing here stores a credential.
#
# Usage: bash scripts/publish/configure-trusted-publishers.sh [package ...]
#
# A package that is not on npm yet cannot be configured (publish it once with the OTP first), and a
# package that already has a trusted publisher is reported as failed by npm; both are listed at the end.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

REPOSITORY=woojubb/robota
WORKFLOW=publish.yml
ENVIRONMENT=npm-publish
# `npm trust` needs npm >= 11.15.0; run it through npx so the global npm is left alone.
NPM=(npx --yes npm@^11.15.0)

if [ "$#" -gt 0 ]; then
  PACKAGES=("$@")
else
  PACKAGES=()
  while IFS= read -r NAME; do PACKAGES+=("$NAME"); done < <(
    pnpm -r --depth -1 --json list | node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  for (const pkg of JSON.parse(input)) {
    if (pkg.name?.startsWith("@robota-sdk/") && pkg.private === false) console.log(pkg.name);
  }
});
'
  )
fi
echo "📋 ${#PACKAGES[@]} packages → $REPOSITORY / $WORKFLOW / environment $ENVIRONMENT"

FAILED=()
for NAME in "${PACKAGES[@]}"; do
  echo "🔐 $NAME"
  if ! "${NPM[@]}" trust github "$NAME" --file "$WORKFLOW" --repo "$REPOSITORY" \
    --env "$ENVIRONMENT" --allow-publish --yes; then
    FAILED+=("$NAME")
  fi
done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "⚠️  Not configured: ${FAILED[*]}"
  echo "   Check with: npx npm@^11.15.0 trust list <package>"
  exit 1
fi
echo "🎉 All ${#PACKAGES[@]} packages trust $WORKFLOW"
