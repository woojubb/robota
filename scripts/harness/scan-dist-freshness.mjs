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
import { pathToFileURL } from 'node:url';
import { listWorkspaceScopes, readJson } from './shared.mjs';

const ROOT = process.cwd();

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

/**
 * Pure finding collector: classifies each buildable scope's dist state.
 * Returns ordered results ({ kind: 'ok' | 'warn' | 'error', message }) plus the
 * buildable count, so the CLI wrapper can print identically to the original.
 */
export async function collectDistFreshnessResults(root, scopes) {
  const buildable = scopes.filter((s) => s.scripts.build);
  const results = [];

  for (const scope of buildable) {
    const distPath = join(root, scope.relativeDir, 'dist');
    const pkg = await readJson(join(root, scope.relativeDir, 'package.json'));

    // Private packages are never published, so their dist freshness is a dev concern, not a
    // release/publish gate. This is what "apps that don't publish" below intends — but a private
    // package can still carry dist-based `exports`/`main` (e.g. a private server app), so key the
    // skip on `private`, not just the absence of dist exports.
    if (pkg.private === true) {
      if (!isNonEmptyDir(distPath)) {
        results.push({
          kind: 'warn',
          message: `${scope.workspaceName}: no dist/ (private, not published — not blocking)`,
        });
      }
      continue;
    }

    // Skip packages with no exports pointing to dist (e.g. apps that don't publish)
    const hasDistExport =
      pkg.main?.includes('dist') || pkg.exports
        ? JSON.stringify(pkg.exports ?? {}).includes('dist')
        : false;

    if (!hasDistExport && !pkg.bin) {
      // App or internal package with no dist-based exports — warn but don't error
      if (!isNonEmptyDir(distPath)) {
        results.push({
          kind: 'warn',
          message: `${scope.workspaceName}: no dist/ (app/internal, not blocking)`,
        });
      }
      continue;
    }

    if (!isNonEmptyDir(distPath)) {
      results.push({
        kind: 'error',
        message: `${scope.workspaceName} (${scope.relativeDir}): dist/ is missing or empty — run pnpm build first`,
      });
    } else {
      results.push({ kind: 'ok', message: `${scope.workspaceName}: dist/ present` });
    }
  }

  return { results, buildableCount: buildable.length };
}

export async function main() {
  const scopes = await listWorkspaceScopes();
  const { results, buildableCount } = await collectDistFreshnessResults(ROOT, scopes);

  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    if (result.kind === 'error') {
      console.error(`\x1b[31m❌ ${result.message}\x1b[0m`);
      errors++;
    } else if (result.kind === 'warn') {
      console.warn(`\x1b[33m⚠️  ${result.message}\x1b[0m`);
      warnings++;
    } else {
      console.log(`\x1b[32m✅ ${result.message}\x1b[0m`);
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
      `\x1b[32mAll ${buildableCount} buildable packages have dist/. ${warnings > 0 ? `(${warnings} app/internal warnings)` : ''}\x1b[0m`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
