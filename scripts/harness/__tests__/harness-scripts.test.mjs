import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, it, expect } from 'vitest';

// harness:scan delegates to the aggregating runner (HARNESS-011); wiring
// assertions check the runner's scan table.
const runAllScansSource = readFileSync(new URL('../run-all-scans.mjs', import.meta.url), 'utf8');
import {
  parseScopeArgs,
  classifyScopeChanges,
  classifyPackageManifestChange,
  classifyRootManifestChange,
  mapFilesToScopes,
  resolveBaseRef,
  resolveRequestedScopes,
} from '../shared.mjs';
import {
  decidePrePushVerification,
  isDeletedRefUpdate,
  parsePrePushUpdates,
} from '../pre-push-updates.mjs';
import { repositoryCheckEnvironment, selectRepositoryChecks } from '../verify-change.mjs';

// ---------------------------------------------------------------------------
// parseScopeArgs
// ---------------------------------------------------------------------------
describe('parseScopeArgs', () => {
  it('parses --scope packages/foo correctly', () => {
    const result = parseScopeArgs(['--scope', 'packages/foo']);
    expect(result.scopeTokens).toEqual(['packages/foo']);
  });

  it('parses --dry-run flag', () => {
    const result = parseScopeArgs(['--dry-run']);
    expect(result.dryRun).toBe(true);
  });

  it('parses --skip-tests flag', () => {
    const result = parseScopeArgs(['--skip-tests']);
    expect(result.skipTests).toBe(true);
  });

  it('parses --skip-lint flag', () => {
    const result = parseScopeArgs(['--skip-lint']);
    expect(result.skipLint).toBe(true);
  });

  it('parses --skip-typecheck flag', () => {
    const result = parseScopeArgs(['--skip-typecheck']);
    expect(result.skipTypecheck).toBe(true);
  });

  it('parses --include-scenarios flag', () => {
    const result = parseScopeArgs(['--include-scenarios']);
    expect(result.includeScenarios).toBe(true);
  });

  it('parses --skip-repository-checks flag', () => {
    const result = parseScopeArgs(['--skip-repository-checks']);
    expect(result.skipRepositoryChecks).toBe(true);
  });

  it('parses repeatable named repository-check omissions', () => {
    const result = parseScopeArgs([
      '--skip-repository-check',
      'harness-tests',
      '--skip-repository-check',
      'task-plan-scan',
    ]);
    expect(result.skipRepositoryCheckNames).toEqual(['harness-tests', 'task-plan-scan']);
  });

  it('parses --skip-dependent-scopes flag', () => {
    const result = parseScopeArgs(['--skip-dependent-scopes']);
    expect(result.skipDependentScopes).toBe(true);
  });

  it('parses --report-file path and --report-format json', () => {
    const result = parseScopeArgs(['--report-file', 'output.json', '--report-format', 'json']);
    expect(result.reportFile).toBe('output.json');
    expect(result.reportFormat).toBe('json');
  });

  it('parses --base-ref main', () => {
    const result = parseScopeArgs(['--base-ref', 'main']);
    expect(result.baseRef).toBe('main');
  });

  it('throws on unknown argument', () => {
    expect(() => parseScopeArgs(['--unknown'])).toThrow('Unknown argument: --unknown');
  });

  it('throws on --scope without value', () => {
    expect(() => parseScopeArgs(['--scope'])).toThrow('--scope requires a value');
  });

  it('throws on --report-format with invalid value', () => {
    expect(() => parseScopeArgs(['--report-format', 'xml'])).toThrow(
      '--report-format must be one of: markdown, json',
    );
  });

  it('returns correct defaults when no arguments are provided', () => {
    const result = parseScopeArgs([]);
    expect(result).toEqual({
      scopeTokens: [],
      dryRun: false,
      skipBuild: false,
      skipTests: false,
      skipLint: false,
      skipTypecheck: false,
      includeScenarios: false,
      skipRecordCheck: false,
      skipRepositoryChecks: false,
      skipRepositoryCheckNames: [],
      skipDependentScopes: false,
      reportFile: null,
      reportFormat: null,
      baseRef: null,
    });
  });
});

describe('repository-check ownership', () => {
  it('canonicalizes only the complete harness-test temp root', () => {
    expect(repositoryCheckEnvironment('harness-tests')).toEqual({
      TMPDIR: realpathSync(tmpdir()),
    });
    expect(repositoryCheckEnvironment('task-plan-scan')).toEqual({});
  });

  it('omits only explicitly named checks while preserving the remaining owners', () => {
    expect(selectRepositoryChecks(['harness-tests', 'task-plan-scan'], ['harness-tests'])).toEqual([
      'task-plan-scan',
    ]);
  });

  it('fails closed when a caller names an unknown repository check', () => {
    expect(() => selectRepositoryChecks(['harness-tests'], ['not-a-real-check'])).toThrow(
      'Unknown repository check omission: not-a-real-check',
    );
  });

  it('assigns harness self-tests to exactly one owner in each aggregate execution graph', () => {
    const localGate = readFileSync('scripts/harness/verify-like-ci-execution.mjs', 'utf8');
    const prePushRuntime = readFileSync('scripts/harness/pre-push-runtime.mjs', 'utf8');
    const prePushMirror = readFileSync('scripts/harness/pre-push-ci-mirror.mjs', 'utf8');
    const prePushVerification = readFileSync(
      'scripts/harness/pre-push-verification-execution.mjs',
      'utf8',
    );

    expect(prePushRuntime).toContain('runPrePushVerification');
    expect(prePushVerification).toContain("'--skip-repository-check',\n    'harness-tests'");
    expect(localGate.match(/'harness-self-test'/g)).not.toHaveLength(0);
    expect(localGate).toContain("'harness:test:contracts:affected'");
    expect(localGate).toContain("'--head-ref',\n    'HEAD'");
    expect(prePushMirror).toContain("'harness:test:contracts:affected'");
    expect(prePushMirror).toContain("return [command, ['harness:test:contracts']]");
    expect(prePushMirror).toContain("['pnpm', ['harness:test:hermetic']]");
  });
});

// ---------------------------------------------------------------------------
// CI build shape
// ---------------------------------------------------------------------------
describe('CI build workflow', () => {
  it('runs the monorepo root build once instead of per-scope package builds', () => {
    const content = readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(content).toContain('run: pnpm build');
    expect(content).toContain('Detect build requirement');
    expect(content).toContain(
      "const checksRequiringPackageDist = new Set(['build', 'test', 'typecheck'])",
    );
    expect(content).toContain(
      'scope.checks.some((check) => checksRequiringPackageDist.has(check))',
    );
    expect(content).toContain("steps.build_requirement.outputs.required == 'true'");
    expect(content).toContain(
      'tar --null -czf package-dist.tgz --files-from .agents/evals/local-metrics/package-dist-membership.bin',
    );
    expect(content).not.toContain('tar -czf package-dist.tgz packages/*/dist');
    expect(content).toContain(
      'package_dist_required: ${{ steps.build_requirement.outputs.required || steps.build_requirement_na.outputs.required }}',
    );
    expect(content).not.toContain('Build affected scopes');
    expect(content).not.toContain('--skip-tests --skip-lint --skip-typecheck');
    expect(content).not.toContain('<scope>^...');
  });

  it('restores root build output before skip-build quality verification', () => {
    const content = readFileSync('.github/workflows/ci.yml', 'utf8');
    const restoreIndex = content.indexOf('Restore package build output');
    const verifyIndex = content.indexOf('Verify full or affected package quality concurrently');

    expect(content).toContain('needs: [changes, build]');
    expect(content).toContain("needs.build.outputs.package_dist_required == 'true'");
    expect(content).toContain('tar -xzf .artifacts/package-dist/package-dist.tgz');
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(restoreIndex);
  });

  it('delegates scoped typechecks to the affected root command exactly once', () => {
    const content = readFileSync('scripts/harness/verify-change-commands.mjs', 'utf8');

    expect(content).toContain("affectedScript: 'typecheck:affected'");
    expect(content).not.toContain("runCommand('pnpm', ['typecheck'], workdir");
  });

  // INFRA-055 inverted this assertion. It used to require the "fast successful no-op" shape — a
  // "Skip duplicate … for main PR" echo with every real step gated on `base_ref != 'main'` — which
  // existed only because these four jobs were REQUIRED contexts on `protect-main` and so had to
  // resolve rather than linger pending. Measured on promotion #1427 they reported 5s/5s/6s/3s of
  // echo and branch protection reported green from jobs that deliberately did no work. The required
  // list was moved to the jobs that verify (`promotion ancestry`, `main PR source guard`,
  // `release-grade verification`), so the echo must NOT come back: a job that resolves rather than
  // verifies is a lie encoded in YAML.
  it('excludes the develop-side duplicate jobs on a main PR at the job level, not as echo steps', () => {
    const content = readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(content).not.toContain('covered by release-grade verification');
    expect(content).not.toMatch(/name: Skip duplicate/);

    for (const jobId of ['build', 'quality', 'scans', 'dependency-audit']) {
      const jobIndex = content.indexOf(`\n  ${jobId}:\n`);
      expect(jobIndex, `${jobId} job must exist`).toBeGreaterThanOrEqual(0);
      const header = content.slice(jobIndex, content.indexOf('steps:', jobIndex));
      expect(header, `${jobId} must be excluded on a main PR at the job level`).toContain(
        "(github.base_ref || inputs.base_ref) != 'main'",
      );
    }
  });

  it('detects dependency graph changes before the security scan (INFRA-038: osv-scanner, not the retired pnpm audit)', () => {
    const content = readFileSync('.github/workflows/ci.yml', 'utf8');
    const diffIndex = content.indexOf('Detect dependency graph changes');
    const scanIndex = content.indexOf(
      'Vulnerability scan (osv-scanner) for dependency graph changes',
    );

    expect(diffIndex).toBeGreaterThanOrEqual(0);
    expect(scanIndex).toBeGreaterThan(diffIndex);
    // The retired npm audit endpoint (410) must not be reintroduced as a command.
    expect(content).not.toContain('pnpm audit --audit-level');
    expect(content).toContain('scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml');
  });
});

// ---------------------------------------------------------------------------
// (INFRA-058) The `deploy workflow` block that stood here asserted the build shape of
// `.github/workflows/deploy.yml` — artifact names, tar invocations, the Vercel working directory. (allow-missing-artifact: INFRA-058 deleted it; records what the case covered)
// Both assertions passed for eight months while the workflow itself deployed nothing across 206
// runs, because it referenced `vercel/action`, a repository that does not exist, and died at
// `Set up job`. Asserting a workflow's TEXT says nothing about whether it runs; these tests were
// green over a permanently broken job. Removed with the workflow.
// ---------------------------------------------------------------------------
// publish workflow
// ---------------------------------------------------------------------------
describe('publish workflow', () => {
  it('syncs and verifies beta dist-tags after recursive publish', () => {
    const script = readFileSync('scripts/publish/publish-packages.sh', 'utf8');

    expect(script).toContain('command+=(publish -r --no-git-checks)');
    expect(script).toContain('command+=(--otp "$OTP")');
    expect(script).toContain('Already published packages will be skipped on retry.');
    expect(script).toContain('Syncing beta dist-tags');
    expect(script).toContain('npm dist-tag add "$1@$VERSION" beta');
    expect(script).toContain('Verifying npm dist-tags');
    expect(script).toContain('dist-tags.latest');
    expect(script).toContain('dist-tags.beta');
  });

  it('scopes the release to packages at VERSION and prepares before the OTP (INFRA-029)', () => {
    const script = readFileSync('scripts/publish/publish-packages.sh', 'utf8');

    // Version-scoped detection: only packages at THIS release's version publish.
    expect(script).toContain('packageInfo.version === version');
    // Build preflight runs before the OTP prompt, with an opt-out.
    expect(script).toContain('--skip-build');
    // The beta dist-tag sync is issued concurrently (background jobs + wait), not sequentially.
    expect(script).toContain('Syncing beta dist-tags (parallel)');
    expect(script).toContain('TAG_PIDS+=');
  });

  it('documents beta dist-tag sync in publish rules and version management', () => {
    const publishRules = readFileSync('.agents/rules/publish.md', 'utf8');
    const versionSkill = readFileSync('.agents/skills/version-management/SKILL.md', 'utf8');

    expect(publishRules).toContain('syncs and verifies `beta` afterward');
    expect(versionSkill).toContain('script explicitly syncs `beta` afterward');
    expect(publishRules).not.toContain('No manual dist-tag sync needed');
    expect(versionSkill).not.toContain('No dist-tag sync needed');
  });
});

// ---------------------------------------------------------------------------
// release governance
// ---------------------------------------------------------------------------
describe('release governance scan', () => {
  it('is registered in the root harness scan and checks release operation rules', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
    const script = readFileSync('scripts/harness/check-release-governance.mjs', 'utf8');
    // HARNESS-DIET-004: release-operations.md merged into publish.md (pointer stub remains).
    const releaseRules = readFileSync('.agents/rules/publish.md', 'utf8');

    expect(rootPackage.scripts['harness:scan:release-governance']).toBe(
      'node scripts/harness/check-release-governance.mjs',
    );
    expect(rootPackage.scripts['harness:release:init']).toBe(
      'node scripts/harness/release-run.mjs init',
    );
    expect(rootPackage.scripts['harness:release:check']).toBe(
      'node scripts/harness/release-run.mjs check',
    );
    expect(rootPackage.scripts['harness:release:triage']).toBe(
      'node scripts/harness/release-run.mjs triage',
    );
    expect(rootPackage.scripts['harness:release:report']).toBe(
      'node scripts/harness/release-run.mjs report',
    );
    expect(runAllScansSource).toContain('check-release-governance.mjs');
    expect(script).toContain('Release Control Plane');
    expect(script).toContain('release-run.mjs');
    expect(script).toContain('checksRequiringPackageDist');
    expect(releaseRules).toContain('current SHA');
    expect(releaseRules).toContain('failure class');
    expect(releaseRules).toContain('root monorepo build once');
  });
});

// ---------------------------------------------------------------------------
// CLI dev source resolution
// ---------------------------------------------------------------------------
describe('CLI dev source resolution', () => {
  const cliDevSourcePackages = [
    'packages/agent-cli',
    'packages/agent-command',
    'packages/agent-core',
    'packages/agent-executor',
    'packages/agent-framework',
    'packages/agent-provider-anthropic',
    'packages/agent-provider-openai',
    'packages/agent-provider-openai-compatible',
    'packages/agent-provider-gemini',
    'packages/agent-builtin-providers',
    'packages/agent-session',
    'packages/agent-tools',
    'packages/agent-transport',
  ];

  it('runs cli:dev with source export conditions', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['cli:dev']).toContain('--conditions=source');
  });

  it('declares source root exports for the CLI dependency closure', () => {
    for (const packageDir of cliDevSourcePackages) {
      const packageJson = JSON.parse(readFileSync(`${packageDir}/package.json`, 'utf8'));

      expect(existsSync(`${packageDir}/src/index.ts`)).toBe(true);
      expect(packageJson.exports['.'].source).toBe('./src/index.ts');
      expect(packageJson.exports['.'].node).toBeDefined();
      expect(packageJson.exports['.'].default).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// agent-web deploy import shape
// ---------------------------------------------------------------------------
describe('agent-web deploy imports', () => {
  it('uses the browser-safe agent-playground client entry in playground routes', () => {
    const playgroundPage = readFileSync('apps/agent-web/src/app/playground/page.tsx', 'utf8');
    const demoPage = readFileSync('apps/agent-web/src/app/playground/demo/page.tsx', 'utf8');

    expect(playgroundPage).toContain('@robota-sdk/agent-playground/client');
    expect(demoPage).toContain('@robota-sdk/agent-playground/client');
    expect(playgroundPage).not.toContain("import('@robota-sdk/agent-playground')");
    expect(demoPage).not.toContain("import('@robota-sdk/agent-playground')");
  });

  it('declares an agent-playground client subpath export', () => {
    const packageJson = JSON.parse(readFileSync('packages/agent-playground/package.json', 'utf8'));

    expect(packageJson.exports['./client']).toMatchObject({
      types: './dist/browser/client.d.ts',
      import: './dist/browser/client.js',
      default: './dist/browser/client.js',
    });
  });

  it('blocks Node builtin polyfills from the agent-web browser bundle', () => {
    const content = readFileSync('apps/agent-web/next.config.ts', 'utf8');

    expect(content).toContain('if (!isServer)');
    expect(content).toContain('fs: false');
    expect(content).toContain('child_process: false');
  });
});

// ---------------------------------------------------------------------------
// verify-change build flow
// ---------------------------------------------------------------------------
describe('verify-change build flow', () => {
  it('uses affected root commands for scoped checks and preserves a full build escape hatch', () => {
    const content = readFileSync('scripts/harness/verify-change-commands.mjs', 'utf8');

    expect(content).toContain("affectedScript: 'build:affected'");
    expect(content).toContain("fullScript: 'build'");
    expect(content).toContain("environment.HARNESS_VERIFY_MODE === 'full'");
    expect(content).not.toContain('createWorkspaceDependencyBuildArgs');
    expect(content).not.toContain('shouldPrepareWorkspaceDependencies');
    expect(content).not.toContain("runCommand('pnpm', ['build'], workdir");
  });
});

// ---------------------------------------------------------------------------
// command layering scan
// ---------------------------------------------------------------------------
describe('command layering scan', () => {
  it('is wired into the root harness scan', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(rootPackage.scripts['harness:scan:commands']).toBe(
      'node scripts/harness/check-command-layering.mjs',
    );
    expect(runAllScansSource).toContain('check-command-layering.mjs');
  });
});

// ---------------------------------------------------------------------------
// SDK public surface scan
// ---------------------------------------------------------------------------
describe('SDK public surface scan', () => {
  it('is wired into the root harness scan', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(rootPackage.scripts['harness:scan:sdk-public-surface']).toBe(
      'node scripts/harness/check-sdk-public-surface.mjs',
    );
    expect(runAllScansSource).toContain('check-sdk-public-surface.mjs');
  });
});

describe('public project authority scan', () => {
  it('is wired into the root harness scan', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(rootPackage.scripts['harness:scan:public-project-authority']).toBe(
      'node scripts/harness/scan-public-project-authority.mjs',
    );
    expect(runAllScansSource).toContain('scan-public-project-authority.mjs');
  });
});

// ---------------------------------------------------------------------------
// pre-push hook
// ---------------------------------------------------------------------------
describe('pre-push hook', () => {
  it('delegates to harness:pre-push without hardcoding origin/main or dist scan', () => {
    const content = readFileSync('.husky/pre-push', 'utf8');

    expect(content).toContain('pnpm harness:pre-push');
    expect(content).toContain('HARNESS_PRE_PUSH_REMOTE_NAME="$1"');
    expect(content).toContain('HARNESS_PRE_PUSH_REMOTE_URL="$2"');
    expect(content).not.toContain('origin/main');
    expect(content).not.toContain('harness:scan:dist');
  });

  it('keeps dependent scope expansion opt-in for pre-push', () => {
    const content = readFileSync('scripts/harness/pre-push-runtime.mjs', 'utf8');
    const verification = readFileSync(
      'scripts/harness/pre-push-verification-execution.mjs',
      'utf8',
    );

    expect(content).toContain('HARNESS_PRE_PUSH_MODE');
    expect(content).toContain('--skip-dependent-scopes');
    expect(verification).toContain('HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push');
  });

  it('does not skip dirty working tree changes as tree-equivalent pushes', () => {
    const content = readFileSync('scripts/harness/pre-push-runtime.mjs', 'utf8');

    expect(content).toContain('hasWorkingTreeChanges');
    expect(content).toContain('basePlan.decisionBaseRef && !hasWorkingTreeChanges()');
  });

  it('threads the one resolved base plan through every pre-push consumer', () => {
    const content = readFileSync('scripts/harness/pre-push-runtime.mjs', 'utf8');
    const verification = readFileSync(
      'scripts/harness/pre-push-verification-execution.mjs',
      'utf8',
    );

    expect(content).toContain('baseRef: basePlan.classificationBaseRef');
    expect(verification).toContain('baseRef: runtime.basePlan.classificationBaseRef ?? null');
    expect(content).toContain('baseRef: runtime.basePlan.decisionBaseRef');
    expect(content).toContain('baseRef: runtime.basePlan.receiptBaseRef');
    expect(content).toContain('baseArgs: basePlan.baseArgs');
  });

  it('parses Git pre-push update lines', () => {
    const updates = parsePrePushUpdates(
      `refs/heads/topic abc123 refs/heads/topic def456
(delete) 0000000000000000000000000000000000000000 refs/heads/old abc123
`,
    );

    expect(updates).toEqual([
      {
        localRef: 'refs/heads/topic',
        localObjectId: 'abc123',
        remoteRef: 'refs/heads/topic',
        remoteObjectId: 'def456',
      },
      {
        localRef: '(delete)',
        localObjectId: '0000000000000000000000000000000000000000',
        remoteRef: 'refs/heads/old',
        remoteObjectId: 'abc123',
      },
    ]);
  });

  it('detects deleted ref updates from hook payloads', () => {
    expect(
      isDeletedRefUpdate({
        localRef: '(delete)',
        localObjectId: '0000000000000000000000000000000000000000',
        remoteRef: 'refs/heads/topic',
        remoteObjectId: 'abc123',
      }),
    ).toBe(true);
  });

  it('skips verification for delete-only pushes', () => {
    const decision = decidePrePushVerification({
      updates: [
        {
          localRef: '(delete)',
          localObjectId: '0000000000000000000000000000000000000000',
          remoteRef: 'refs/heads/topic',
          remoteObjectId: 'abc123',
        },
      ],
      baseRef: 'origin/develop',
      treeMatchesBase: false,
    });

    expect(decision).toEqual({
      shouldRun: false,
      reason: 'delete-only push',
    });
  });

  it('skips verification when the branch tree already matches the base', () => {
    const decision = decidePrePushVerification({
      updates: [],
      baseRef: 'origin/develop',
      treeMatchesBase: true,
    });

    expect(decision).toEqual({
      shouldRun: false,
      reason: 'no content delta from origin/develop',
    });
  });

  it('runs verification when a pushed ref has a content delta', () => {
    const decision = decidePrePushVerification({
      updates: [
        {
          localRef: 'refs/heads/topic',
          localObjectId: 'abc123',
          remoteRef: 'refs/heads/topic',
          remoteObjectId: 'def456',
        },
      ],
      baseRef: 'origin/develop',
      treeMatchesBase: false,
    });

    expect(decision).toEqual({
      shouldRun: true,
      reason: null,
    });
  });
});

// ---------------------------------------------------------------------------
// release verification
// ---------------------------------------------------------------------------
describe('release verification script', () => {
  it('builds before running harness:scan so dist freshness has artifacts in clean CI', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
    const releaseScript = rootPackage.scripts['harness:verify:release'];

    expect(releaseScript).toContain('pnpm build:deps');
    expect(releaseScript).toContain('pnpm harness:scan');
    expect(releaseScript.indexOf('pnpm build:deps')).toBeLessThan(
      releaseScript.indexOf('pnpm harness:scan'),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBaseRef
// ---------------------------------------------------------------------------
describe('resolveBaseRef', () => {
  it('uses an explicit base ref without probing fallback refs', () => {
    const result = resolveBaseRef({
      explicitBaseRef: 'origin/custom',
      env: {},
      refExists: () => false,
    });

    expect(result).toBe('origin/custom');
  });

  it('uses HARNESS_BASE_REF before GitHub base refs', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {
        HARNESS_BASE_REF: 'origin/release',
        GITHUB_BASE_REF: 'main',
      },
      refExists: (ref) => ref === 'origin/release' || ref === 'origin/main',
    });

    expect(result).toBe('origin/release');
  });

  it('prefers origin GitHub base refs when running in pull request context', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {
        GITHUB_BASE_REF: 'main',
      },
      refExists: (ref) => ref === 'origin/main',
    });

    expect(result).toBe('origin/main');
  });

  it('defaults feature branch development to origin/develop when available', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {},
      refExists: (ref) => ref === 'origin/develop' || ref === 'origin/main',
    });

    expect(result).toBe('origin/develop');
  });

  it('falls back to main only when develop refs are unavailable', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {},
      refExists: (ref) => ref === 'main',
    });

    expect(result).toBe('main');
  });

  it('returns null when no candidate refs exist', () => {
    const result = resolveBaseRef({
      explicitBaseRef: null,
      env: {},
      refExists: () => false,
    });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyPackageManifestChange
// ---------------------------------------------------------------------------
describe('classifyPackageManifestChange', () => {
  it('detects version-only package manifest changes', () => {
    const result = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', version: '1.0.0' },
      after: { name: '@robota-sdk/agent-core', version: '1.0.1' },
    });

    expect(result.kind).toBe('version-only');
    expect(result.hasVersionOnlyChanges).toBe(true);
    expect(result.needsSourceHeavyChecks).toBe(false);
  });

  it('detects dependency package manifest changes', () => {
    const result = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', dependencies: { zod: '^3.0.0' } },
      after: { name: '@robota-sdk/agent-core', dependencies: { zod: '^4.0.0' } },
    });

    expect(result.kind).toBe('dependency');
    expect(result.hasDependencyChanges).toBe(true);
    expect(result.needsSourceHeavyChecks).toBe(true);
  });

  it('detects public surface package manifest changes', () => {
    const result = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', exports: { '.': './dist/index.js' } },
      after: {
        name: '@robota-sdk/agent-core',
        exports: { '.': './dist/index.js', './tools': './dist/tools.js' },
      },
    });

    expect(result.kind).toBe('public-surface');
    expect(result.hasPublicSurfaceChanges).toBe(true);
    expect(result.needsSourceHeavyChecks).toBe(true);
  });
});

describe('classifyRootManifestChange', () => {
  const before = {
    scripts: {
      'lint:fix': 'eslint packages apps --ext .ts,.tsx --fix',
      'lint:fix:staged': 'scripts/harness/with-repo-lock.sh pnpm exec lint-staged',
      build: 'pnpm -r build',
    },
    devDependencies: { eslint: '8.57.1' },
  };

  it('recognizes changes limited to the two developer-only fixer commands', () => {
    const after = structuredClone(before);
    after.scripts['lint:fix'] = 'eslint packages apps --ext .ts,.tsx --fix && prettier --write .';

    expect(classifyRootManifestChange({ before, after })).toEqual({
      kind: 'developer-quality-only',
      changedKeys: ['scripts'],
      changedScriptKeys: ['lint:fix'],
      workspaceWide: false,
    });
  });

  it('recognizes root harness command changes as developer-quality-only', () => {
    const after = structuredClone(before);
    after.scripts['harness:work-run'] = 'node scripts/harness/work-run.mjs';
    after.scripts['harness:test'] = 'node scripts/harness/harness-test-tiers.mjs --tier contracts';

    expect(classifyRootManifestChange({ before, after })).toEqual({
      kind: 'developer-quality-only',
      changedKeys: ['scripts'],
      changedScriptKeys: ['harness:work-run', 'harness:test'],
      workspaceWide: false,
    });
  });

  it('fails closed when a product test command changes beside harness commands', () => {
    const after = structuredClone(before);
    after.scripts['harness:work-run'] = 'node scripts/harness/work-run.mjs';
    after.scripts.test = 'pnpm -r test --changed';

    expect(classifyRootManifestChange({ before, after }).workspaceWide).toBe(true);
  });

  it('fails closed when a build script changes beside a fixer command', () => {
    const after = structuredClone(before);
    after.scripts['lint:fix'] = 'prettier --write .';
    after.scripts.build = 'pnpm build:all';

    expect(classifyRootManifestChange({ before, after }).workspaceWide).toBe(true);
  });

  it('fails closed for dependency and unknown top-level changes', () => {
    expect(
      classifyRootManifestChange({
        before,
        after: { ...before, devDependencies: { eslint: '9.0.0' } },
      }).workspaceWide,
    ).toBe(true);
    expect(
      classifyRootManifestChange({ before, after: { ...before, futureField: true } }).workspaceWide,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyScopeChanges
// ---------------------------------------------------------------------------
describe('classifyScopeChanges', () => {
  const scope = {
    relativeDir: 'packages/agent-core',
    shortName: 'agents',
    workspaceName: '@robota-sdk/agent-core',
    scripts: {},
    hasTsconfig: true,
  };

  it('detects production source changes for files in src/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.ts'], false);
    expect(result.hasSourceChanges).toBe(true);
  });

  it('detects test changes for .test.ts files without classifying them as production source', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.test.ts'], false);
    expect(result.hasTestChanges).toBe(true);
    expect(result.hasSourceChanges).toBe(false);
  });

  it('detects test changes for files in __tests__/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/__tests__/agent.ts'], false);
    expect(result.hasTestChanges).toBe(true);
  });

  it('detects config changes for package.json', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false);
    expect(result.hasConfigChanges).toBe(true);
  });

  it('detects config changes for tsconfig.json', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/tsconfig.json'], false);
    expect(result.hasConfigChanges).toBe(true);
  });

  it('detects scenario changes for files in examples/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/examples/basic.ts'], false);
    expect(result.hasScenarioChanges).toBe(true);
  });

  it('detects scenario changes for files containing "scenario"', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/scenario/run.ts'], false);
    expect(result.hasScenarioChanges).toBe(true);
  });

  it('detects entrypoint changes for src/index.ts', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/index.ts'], false);
    expect(result.hasEntrypointChanges).toBe(true);
  });

  it('sets needsBuild = true when source changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/core.ts'], false);
    expect(result.needsBuild).toBe(true);
  });

  it('does not run source-heavy checks for version-only package manifest changes', () => {
    const manifestChange = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', version: '1.0.0' },
      after: { name: '@robota-sdk/agent-core', version: '1.0.1' },
    });
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false, {
      manifestChange,
    });

    expect(result.hasVersionOnlyManifestChanges).toBe(true);
    expect(result.needsBuild).toBe(false);
    expect(result.needsTest).toBe(false);
    expect(result.needsLint).toBe(false);
    expect(result.needsTypecheck).toBe(false);
  });

  it('runs build and typecheck for dependency package manifest changes', () => {
    const manifestChange = classifyPackageManifestChange({
      before: { name: '@robota-sdk/agent-core', dependencies: { zod: '^3.0.0' } },
      after: { name: '@robota-sdk/agent-core', dependencies: { zod: '^4.0.0' } },
    });
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false, {
      manifestChange,
    });

    expect(result.hasDependencyManifestChanges).toBe(true);
    expect(result.needsBuild).toBe(true);
    expect(result.needsTypecheck).toBe(true);
    expect(result.needsTest).toBe(false);
    expect(result.needsLint).toBe(false);
  });

  it('sets needsTest = true when source changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/core.ts'], false);
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTest = true when test changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.test.ts'], false);
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTest = true when config changes exist', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/package.json'], false);
    expect(result.needsTest).toBe(true);
  });

  it('sets needsTypecheck = true only when hasTsconfig is true', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/core.ts'], false);
    expect(result.needsTypecheck).toBe(true);

    const scopeNoTsconfig = { ...scope, hasTsconfig: false };
    const resultNoTsconfig = classifyScopeChanges(
      scopeNoTsconfig,
      ['packages/agent-core/src/core.ts'],
      false,
    );
    expect(resultNoTsconfig.needsTypecheck).toBe(false);
  });

  it('sets all needs* flags to true when forceFullVerification is true', () => {
    const result = classifyScopeChanges(scope, [], true);
    expect(result.needsBuild).toBe(true);
    expect(result.needsTest).toBe(true);
    expect(result.needsLint).toBe(true);
    expect(result.needsTypecheck).toBe(true);
  });

  it('sets needsBuild = false when test files are under src/', () => {
    const result = classifyScopeChanges(scope, ['packages/agent-core/src/agent.test.ts'], false);
    expect(result.needsBuild).toBe(false);
  });

  it('sets needsBuild = false when test files are only in __tests__/', () => {
    const result = classifyScopeChanges(
      scope,
      ['packages/agent-core/__tests__/agent.test.ts'],
      false,
    );
    expect(result.needsBuild).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapFilesToScopes
// ---------------------------------------------------------------------------
describe('mapFilesToScopes', () => {
  const scopes = [
    {
      relativeDir: 'packages/agent-core',
      shortName: 'agents',
      workspaceName: '@robota-sdk/agent-core',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'packages/agent-provider-openai',
      shortName: 'openai',
      workspaceName: '@robota-sdk/agent-provider-openai',
      scripts: {},
      hasTsconfig: true,
    },
  ];

  it('maps files to the correct scope', () => {
    const files = [
      'packages/agent-core/src/agent.ts',
      'packages/agent-provider-openai/src/provider.ts',
    ];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agent-core')).toEqual(['packages/agent-core/src/agent.ts']);
    expect(result.get('packages/agent-provider-openai')).toEqual([
      'packages/agent-provider-openai/src/provider.ts',
    ]);
  });

  it('does not map files outside any scope', () => {
    const files = ['scripts/harness/shared.mjs'];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agent-core')).toEqual([]);
    expect(result.get('packages/agent-provider-openai')).toEqual([]);
  });

  it('maps multiple files to the same scope', () => {
    const files = ['packages/agent-core/src/agent.ts', 'packages/agent-core/src/plugin.ts'];
    const result = mapFilesToScopes(files, scopes);

    expect(result.get('packages/agent-core')).toEqual([
      'packages/agent-core/src/agent.ts',
      'packages/agent-core/src/plugin.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveRequestedScopes
// ---------------------------------------------------------------------------
describe('resolveRequestedScopes', () => {
  const scopes = [
    {
      relativeDir: 'packages/agent-core',
      shortName: 'agents',
      workspaceName: '@robota-sdk/agent-core',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'packages/agent-provider-openai',
      shortName: 'openai',
      workspaceName: '@robota-sdk/agent-provider-openai',
      scripts: {},
      hasTsconfig: true,
    },
    {
      relativeDir: 'apps/web',
      shortName: 'web',
      workspaceName: '@robota/web',
      scripts: {},
      hasTsconfig: true,
    },
  ];

  it('matches by relativeDir', () => {
    const result = resolveRequestedScopes(['packages/agent-core'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agent-core');
  });

  it('matches by workspaceName', () => {
    const result = resolveRequestedScopes(['@robota-sdk/agent-provider-openai'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agent-provider-openai');
  });

  it('matches by shortName', () => {
    const result = resolveRequestedScopes(['web'], scopes);
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('apps/web');
  });

  it('throws on unknown scope', () => {
    expect(() => resolveRequestedScopes(['packages/nonexistent'], scopes)).toThrow(
      'Unknown scope: packages/nonexistent',
    );
  });

  it('throws on ambiguous scope', () => {
    const scopesWithAmbiguity = [
      ...scopes,
      {
        relativeDir: 'packages/agent-provider-openai-v2',
        shortName: 'openai',
        workspaceName: '@robota-sdk/agent-provider-openai-v2',
        scripts: {},
        hasTsconfig: true,
      },
    ];
    expect(() => resolveRequestedScopes(['openai'], scopesWithAmbiguity)).toThrow(
      /Ambiguous scope: openai/,
    );
  });

  it('deduplicates resolved scopes', () => {
    const result = resolveRequestedScopes(
      ['packages/agent-core', 'agents', '@robota-sdk/agent-core'],
      scopes,
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativeDir).toBe('packages/agent-core');
  });
});
