/**
 * Harness check: dist freshness gate
 *
 * Verifies that every workspace package with a build script has a non-empty
 * dist/ directory. Catches "CI will fail on typecheck because dist is missing"
 * before the code ever reaches remote CI.
 *
 * Run: node scripts/harness/scan-dist-freshness.mjs
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listWorkspaceScopes, readJson } from './shared.mjs';

const ROOT = process.cwd();
let errors = 0;
let warnings = 0;

function error(msg) {
  console.error(`\x1b[31m❌ ${msg}\x1b[0m`);
  errors++;
}

function warn(msg) {
  console.warn(`\x1b[33m⚠️  ${msg}\x1b[0m`);
  warnings++;
}

function ok(msg) {
  console.log(`\x1b[32m✅ ${msg}\x1b[0m`);
}

function isNonEmptyDir(dirPath) {
  if (!existsSync(dirPath)) return false;
  try {
    const entries = readdirSync(dirPath, { recursive: true });
    return entries.some((e) => {
      const full = join(dirPath, e);
      return statSync(full).isFile();
    });
  } catch {
    return false;
  }
}

const scopes = await listWorkspaceScopes();
const buildable = scopes.filter((s) => s.scripts.build);

for (const scope of buildable) {
  const distPath = join(ROOT, scope.relativeDir, 'dist');
  const pkg = await readJson(join(ROOT, scope.relativeDir, 'package.json'));

  // Skip packages with no exports pointing to dist (e.g. apps that don't publish)
  const hasDistExport =
    pkg.main?.includes('dist') || pkg.exports
      ? JSON.stringify(pkg.exports ?? {}).includes('dist')
      : false;

  if (!hasDistExport && !pkg.bin) {
    // App or internal package with no dist-based exports — warn but don't error
    if (!isNonEmptyDir(distPath)) {
      warn(`${scope.workspaceName}: no dist/ (app/internal, not blocking)`);
    }
    continue;
  }

  if (!isNonEmptyDir(distPath)) {
    error(
      `${scope.workspaceName} (${scope.relativeDir}): dist/ is missing or empty — run pnpm build first`,
    );
  } else {
    ok(`${scope.workspaceName}: dist/ present`);
  }
}

console.log('');
if (errors > 0) {
  console.error(
    `\x1b[31m${errors} package(s) have missing dist/. Run \`pnpm build\` before pushing.\x1b[0m`,
  );
  process.exit(1);
} else {
  console.log(
    `\x1b[32mAll ${buildable.length} buildable packages have dist/. ${warnings > 0 ? `(${warnings} app/internal warnings)` : ''}\x1b[0m`,
  );
}
