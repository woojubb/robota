#!/usr/bin/env bash
#
# configure-trusted-publishers.sh — make .github/workflows/publish.yml (environment `npm-publish`) the
# trusted publisher of every public package in the selected scope. The owner runs this once, and again for a
# package published for the first time. npm asks for 2FA; nothing here stores a credential.
#
# Usage: bash scripts/publish/configure-trusted-publishers.sh [package ...]
#
# A package that is not on npm yet cannot be configured (publish it once with the OTP first), and a
# package that already has a trusted publisher is reported as failed by npm; both are listed at the end.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

PACKAGE_SCOPE="${PRODUCT_PACKAGE_SCOPE:?Set PRODUCT_PACKAGE_SCOPE from the selected product configuration.}"
REPOSITORY_URL="${PROJECT_REPOSITORY_URL:?Set PROJECT_REPOSITORY_URL from the selected product configuration.}"
if [[ ! "$PACKAGE_SCOPE" =~ ^@[a-z0-9][a-z0-9._-]*$ ]]; then
  echo "❌ Invalid PRODUCT_PACKAGE_SCOPE." >&2
  exit 1
fi
REPOSITORY=$(node -e '
const url = new URL(process.env.PROJECT_REPOSITORY_URL);
if (url.hostname !== "github.com") process.exit(1);
const slug = url.pathname.slice(1).replace(/\.git$/u, "").replace(/\/$/u, "");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(slug)) process.exit(1);
process.stdout.write(slug);
' 2>/dev/null) || { echo "❌ PROJECT_REPOSITORY_URL must identify a GitHub owner/repository." >&2; exit 1; }
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
  const scope = process.env.PRODUCT_PACKAGE_SCOPE;
  for (const pkg of JSON.parse(input)) {
    if (pkg.name?.startsWith(`${scope}/`) && pkg.private === false) console.log(pkg.name);
  }
});
'
  )
fi
if [ "${#PACKAGES[@]}" -eq 0 ]; then
  echo "❌ No public packages found in $PACKAGE_SCOPE."
  exit 1
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
