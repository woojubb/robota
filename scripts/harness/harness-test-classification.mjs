import { readdirSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../..');
export const TEST_DIR = 'scripts/harness/__tests__';

/** Tests proven to run in a repository stripped of every live-tree owner. */
export const HERMETIC_TEST_FILES = Object.freeze([
  'scripts/harness/__tests__/api-pagination.test.mjs',
  'scripts/harness/__tests__/canonical-temporary-directory.test.mjs',
  'scripts/harness/__tests__/check-adr-completeness.test.mjs',
  'scripts/harness/__tests__/check-agent-server-boundary.test.mjs',
  'scripts/harness/__tests__/check-architecture-map-completeness.test.mjs',
  'scripts/harness/__tests__/check-architecture-map-paths.test.mjs',
  'scripts/harness/__tests__/check-background-workspace-conformance.test.mjs',
  'scripts/harness/__tests__/check-backlog-placement.test.mjs',
  'scripts/harness/__tests__/check-build-output-contracts.test.mjs',
  'scripts/harness/__tests__/check-command-layering.test.mjs',
  'scripts/harness/__tests__/check-dep-kind.test.mjs',
  'scripts/harness/__tests__/check-design-doc-completeness.test.mjs',
  'scripts/harness/__tests__/check-doc-examples.test.mjs',
  'scripts/harness/__tests__/check-document-authority.test.mjs',
  'scripts/harness/__tests__/check-document-standards-index.test.mjs',
  'scripts/harness/__tests__/check-done-evidence.test.mjs',
  'scripts/harness/__tests__/check-functional-coverage.test.mjs',
  'scripts/harness/__tests__/check-harness-config-paths.test.mjs',
  'scripts/harness/__tests__/check-llms-txt.test.mjs',
  'scripts/harness/__tests__/check-nested-package-glob-coverage.test.mjs',
  'scripts/harness/__tests__/check-orphan-exports.test.mjs',
  'scripts/harness/__tests__/check-patch-coverage.test.mjs',
  'scripts/harness/__tests__/check-plan.test.mjs',
  'scripts/harness/__tests__/check-publish-safety.test.mjs',
  'scripts/harness/__tests__/check-regression-red-proof-execution-witness.test.mjs',
  'scripts/harness/__tests__/check-release-governance.test.mjs',
  'scripts/harness/__tests__/check-review-gate.test.mjs',
  'scripts/harness/__tests__/check-sdk-public-surface.test.mjs',
  'scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs',
  'scripts/harness/__tests__/check-spec-paths.test.mjs',
  'scripts/harness/__tests__/check-stub-markers.test.mjs',
  'scripts/harness/__tests__/check-task-archival.test.mjs',
  'scripts/harness/__tests__/check-temp-script-placement.test.mjs',
  'scripts/harness/__tests__/check-test-coverage-scripts.test.mjs',
  'scripts/harness/__tests__/check-workspace-refs.test.mjs',
  'scripts/harness/__tests__/cited-paths.test.mjs',
  'scripts/harness/__tests__/detect-changed-files.test.mjs',
  'scripts/harness/__tests__/file-name-shape.test.mjs',
  'scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs',
  'scripts/harness/__tests__/governed-tree.test.mjs',
  'scripts/harness/__tests__/list-source-files.test.mjs',
  'scripts/harness/__tests__/live-provider-smoke.test.mjs',
  'scripts/harness/__tests__/live-smoke-provider-coverage.test.mjs',
  'scripts/harness/__tests__/pre-push-lockfile.test.mjs',
  'scripts/harness/__tests__/pre-push-sequence.test.mjs',
  'scripts/harness/__tests__/promote.test.mjs',
  'scripts/harness/__tests__/record-local-review-disposition.test.mjs',
  'scripts/harness/__tests__/release-run.test.mjs',
  'scripts/harness/__tests__/run-all-scans.test.mjs',
  'scripts/harness/__tests__/scan-ci-base-history.test.mjs',
  'scripts/harness/__tests__/scan-conflict-markers.test.mjs',
  'scripts/harness/__tests__/scan-deprecated-markers.test.mjs',
  'scripts/harness/__tests__/scan-dist-freshness.test.mjs',
  'scripts/harness/__tests__/scan-helper-limits.test.mjs',
  'scripts/harness/__tests__/scan-interface-runtime.test.mjs',
  'scripts/harness/__tests__/scan-legacy-typescript.test.mjs',
  'scripts/harness/__tests__/scan-main-required-checks.test.mjs',
  'scripts/harness/__tests__/scan-measurement-provenance.test.mjs',
  'scripts/harness/__tests__/scan-memory-mirror.test.mjs',
  'scripts/harness/__tests__/scan-orchestration-map.test.mjs',
  'scripts/harness/__tests__/scan-promotion-ancestry.test.mjs',
  'scripts/harness/__tests__/scan-prompt-prose.test.mjs',
  'scripts/harness/__tests__/scan-review-findings.test.mjs',
  'scripts/harness/__tests__/scan-spec-research.test.mjs',
  'scripts/harness/__tests__/scan-test-plan.test.mjs',
  'scripts/harness/__tests__/scan-test-selection-tolerance.test.mjs',
  'scripts/harness/__tests__/scan-vitest-resource-ceiling.test.mjs',
  'scripts/harness/__tests__/task-lifecycle.test.mjs',
  'scripts/harness/__tests__/tree-prerequisites.test.mjs',
  'scripts/harness/__tests__/workspace-check-batches.test.mjs',
  'scripts/harness/__tests__/worktree-gate.test.mjs',
]);

export const ISOLATED_CONTRACT_TEST_FILES = Object.freeze([
  'scripts/harness/__tests__/hook-reading-matches-bash.test.mjs',
]);

function listTestFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(root, TEST_DIR));
  return files.sort();
}

/** Return the fail-closed, complete partition of the harness self-test suite. */
export function classifyHarnessTestFiles(root = DEFAULT_ROOT) {
  const all = listTestFiles(root);
  const hermeticDeclared = new Set(HERMETIC_TEST_FILES);
  const isolatedDeclared = new Set(ISOLATED_CONTRACT_TEST_FILES);
  if (hermeticDeclared.size !== HERMETIC_TEST_FILES.length) {
    throw new Error('the hermetic harness-test allowlist contains duplicate entries');
  }
  if (isolatedDeclared.size !== ISOLATED_CONTRACT_TEST_FILES.length) {
    throw new Error('the isolated contract-test allowlist contains duplicate entries');
  }
  const missing = [...HERMETIC_TEST_FILES, ...ISOLATED_CONTRACT_TEST_FILES].filter(
    (file) => !all.includes(file),
  );
  if (missing.length > 0) {
    throw new Error(`declared harness test(s) do not exist: ${missing.join(', ')}`);
  }
  const overlap = ISOLATED_CONTRACT_TEST_FILES.filter((file) => hermeticDeclared.has(file));
  if (overlap.length > 0) {
    throw new Error(`isolated contract test(s) cannot be hermetic: ${overlap.join(', ')}`);
  }
  const hermetic = all.filter((file) => hermeticDeclared.has(file));
  const contract = all.filter((file) => !hermeticDeclared.has(file));
  const isolatedContract = contract.filter((file) => isolatedDeclared.has(file));
  const concurrentContract = contract.filter((file) => !isolatedDeclared.has(file));
  if (hermetic.length === 0 || contract.length === 0) {
    throw new Error('both harness-test tiers must contain at least one test');
  }
  if (isolatedContract.length !== ISOLATED_CONTRACT_TEST_FILES.length) {
    throw new Error('every isolated harness test must belong to the repository-contract tier');
  }
  return { all, concurrentContract, contract, hermetic, isolatedContract };
}

/** Build a complete, non-overlapping execution schedule for one logical tier. */
export function testInvocationsForTier(tiers, tier) {
  const isolated = tiers.isolatedContract.map((file) => [file]);
  if (tier === 'contracts') return [tiers.concurrentContract, ...isolated];
  if (tier === 'hermetic') return [tiers.hermetic];
  if (tier === 'all') {
    const concurrent = tiers.all.filter((file) => !tiers.isolatedContract.includes(file));
    return [concurrent, ...isolated];
  }
  throw new Error(`unknown harness test tier: ${tier}`);
}
