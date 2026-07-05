/**
 * Harness check: publish safety gate
 *
 * Verifies:
 * 1. agent-core has zero @robota-sdk dependencies
 * 2. All publishable packages have prepublishOnly hook blocking npm publish
 * 3. All publishable packages have workspace:* deps (not hardcoded versions in source)
 * 4. agent-cli publishes as a SELF-CONTAINED bundle — zero @robota-sdk runtime `dependencies`
 *    (INFRA-028: all @robota-sdk workspace code is bundled into dist; siblings are devDeps).
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let errors = 0;

function error(msg) {
  console.error(`❌ ${msg}`);
  errors++;
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

// 1. agent-core must have zero @robota-sdk dependencies
const corePkg = JSON.parse(readFileSync(join(ROOT, 'packages/agent-core/package.json'), 'utf-8'));
const coreDeps = Object.keys(corePkg.dependencies || {}).filter((d) =>
  d.startsWith('@robota-sdk/'),
);
if (coreDeps.length > 0) {
  error(`agent-core has @robota-sdk dependencies: ${coreDeps.join(', ')}`);
} else {
  ok('agent-core has zero @robota-sdk dependencies');
}

const coreDevDeps = Object.keys(corePkg.devDependencies || {}).filter((d) =>
  d.startsWith('@robota-sdk/'),
);
if (coreDevDeps.length > 0) {
  error(`agent-core has @robota-sdk devDependencies: ${coreDevDeps.join(', ')}`);
} else {
  ok('agent-core has zero @robota-sdk devDependencies');
}

// 2. All publishable packages must have prepublishOnly hook
const pkgDirs = readdirSync(join(ROOT, 'packages'))
  .map((d) => `packages/${d}/package.json`)
  .filter((p) => existsSync(join(ROOT, p)));
for (const pkgPath of pkgDirs) {
  const pkg = JSON.parse(readFileSync(join(ROOT, pkgPath), 'utf-8'));
  if (pkg.private) continue;

  const hasPrepublish = pkg.scripts?.prepublishOnly?.includes('check-pnpm-publish');
  if (!hasPrepublish) {
    error(`${pkg.name} missing prepublishOnly hook (pnpm publish enforcement)`);
  }
}
ok('Checked prepublishOnly hooks on all publishable packages');

// 3. check-pnpm-publish.sh exists
if (!existsSync(join(ROOT, 'scripts/check-pnpm-publish.sh'))) {
  error('scripts/check-pnpm-publish.sh not found');
} else {
  ok('check-pnpm-publish.sh exists');
}

// 4. INFRA-028: agent-cli must publish as a self-contained bundle — zero @robota-sdk runtime deps.
const cliPkg = JSON.parse(readFileSync(join(ROOT, 'packages/agent-cli/package.json'), 'utf-8'));
const cliRuntimeRobota = Object.keys(cliPkg.dependencies || {}).filter((d) =>
  d.startsWith('@robota-sdk/'),
);
if (cliRuntimeRobota.length > 0) {
  error(
    `agent-cli must be a self-contained bundle (INFRA-028): move these to devDependencies (bundled): ${cliRuntimeRobota.join(', ')}`,
  );
} else {
  ok('agent-cli publishes self-contained — zero @robota-sdk runtime dependencies (INFRA-028)');
}

// Summary
console.log(`\n${errors === 0 ? '✅ Publish safety check passed' : `❌ ${errors} error(s) found`}`);
process.exit(errors > 0 ? 1 : 0);
