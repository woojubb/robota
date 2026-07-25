import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectReleaseGovernanceFindings } from '../check-release-governance.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-release-governance.mjs', import.meta.url));

const GREEN_PUBLISH_RULES = `# Publish & Release Runbook

### Release Control Plane

Track the current SHA, target version, and the exact gate currently running.
Record the next action and the stop condition for every gate.

### Release State Machine

Every release run advances gate by gate.

### CI Failure Triage

Classify each failure with a failure class, a failure signature, a local reproduction,
and a minimal fix recommendation before touching CI.
Failures in \`build\`, \`test\`, or \`typecheck\` require the root monorepo build once.

### Long-Running Gates

Watchers must be cleared before publish.

### Dist Artifact Invariant

Dist artifacts must exist before scans that check them.

### Publish Boundary

OTP is requested only inside the publish boundary.

### Stop Conditions

Stop when a gate fails or stalls.
`;

const GREEN_RELEASE_TEMPLATE = `# Release Run Template

- Version:
- Branch:
- SHA:
- PR:
- Target branch:
- Active gate:
- Gate status:
- Next action:
- Stop condition:
- Publish ready:
- Active watchers:
- Cleanup status:
`;

const GREEN_CI_WORKFLOW = `name: CI
jobs:
  build:
    steps:
      - run: |
          const checksRequiringPackageDist = new Set(['build', 'test', 'typecheck'])
      - run: tar -czf package-dist.tgz dist
  quality:
    if: needs.build.outputs.package_dist_required == 'true'
    steps:
      - run: echo restore package-dist.tgz
`;

const GREEN_PUBLISH_SCRIPT = `#!/bin/bash
command+=(publish -r --no-git-checks)
run_publish_command dry-run
pnpm harness:release:check -- --version "$VERSION" --publish
read -rp "🔑 Enter npm OTP for publish: " OTP
`;

const GREEN_PACKAGE_JSON = {
  name: 'fixture-root',
  scripts: {
    'harness:scan': 'node scripts/harness/run-all-scans.mjs',
    'harness:scan:release-governance': 'node scripts/harness/check-release-governance.mjs',
    'harness:release:init': 'node scripts/harness/release-run.mjs init',
    'harness:release:check': 'node scripts/harness/release-run.mjs check',
    'harness:release:triage': 'node scripts/harness/release-run.mjs triage',
    'harness:release:report': 'node scripts/harness/release-run.mjs report',
    'harness:verify:release':
      'pnpm build:deps && pnpm harness:scan && pnpm test && pnpm typecheck && pnpm lint',
  },
};

function greenFixtureFiles() {
  return {
    'package.json': JSON.stringify(GREEN_PACKAGE_JSON, null, 2),
    '.agents/rules/publish.md': GREEN_PUBLISH_RULES,
    '.agents/rules/process.md': '# Process\n\nSee [index.md](index.md).\n',
    '.agents/rules/index.md': '# Rules Index\n\n- [publish.md](publish.md)\n',
    '.agents/rules/common-mistakes.md':
      '# Common Mistakes\n\n- Running release work as ad-hoc CI debugging.\n' +
      '- Fixing CI before classifying the failure.\n',
    '.github/workflows/ci.yml': GREEN_CI_WORKFLOW,
    'scripts/publish/publish-packages.sh': GREEN_PUBLISH_SCRIPT,
    'scripts/harness/run-all-scans.mjs':
      '// fixture runner\n// includes check-release-governance.mjs in the scan table\n',
    'scripts/harness/release-run.mjs':
      '// fixture release-run\nfunction validatePublishReadiness() {}\n' +
      "// checks the 'Active watchers' field\n",
    '.agents/release-runs/README.md':
      '# Release Runs\n\nRun `pnpm harness:release:check -- --version <version> --publish` before OTP.\n',
    '.agents/templates/release-run-template.md': GREEN_RELEASE_TEMPLATE,
  };
}

async function createFixture(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-release-governance-'));
  const files = { ...greenFixtureFiles(), ...overrides };
  for (const [relativePath, content] of Object.entries(files)) {
    if (content === null) {
      continue;
    }
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('collectReleaseGovernanceFindings', () => {
  it('passes a fully wired release-governance fixture', async () => {
    const root = await createFixture();
    expect(collectReleaseGovernanceFindings(root)).toEqual([]);
  });

  it('flags a missing required governance file', async () => {
    const root = await createFixture();
    rmSync(path.join(root, '.agents/rules/publish.md'));

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: '.agents/rules/publish.md',
      detail: 'Required release governance file is missing.',
    });
  });

  it('flags a drifted release control-plane script in package.json', async () => {
    const packageJson = structuredClone(GREEN_PACKAGE_JSON);
    packageJson.scripts['harness:release:check'] = 'echo skipped';
    const root = await createFixture({ 'package.json': JSON.stringify(packageJson, null, 2) });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: 'package.json',
      detail:
        'Root package.json must expose harness:release:check as "node scripts/harness/release-run.mjs check".',
    });
  });

  it('flags a removed runbook section (Stop Conditions)', async () => {
    const root = await createFixture({
      '.agents/rules/publish.md': GREEN_PUBLISH_RULES.replace(
        '### Stop Conditions',
        '### Renamed Section',
      ),
    });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: '.agents/rules/publish.md',
      detail: 'Release operations rules must include ### Stop Conditions.',
    });
  });

  it('flags release verification that scans before building', async () => {
    const packageJson = structuredClone(GREEN_PACKAGE_JSON);
    packageJson.scripts['harness:verify:release'] =
      'pnpm harness:scan && pnpm build:deps && pnpm test && pnpm typecheck && pnpm lint';
    const root = await createFixture({ 'package.json': JSON.stringify(packageJson, null, 2) });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: 'package.json',
      detail: 'Release verification must build before harness scan so dist checks have artifacts.',
    });
  });

  it('flags a publish script that requests OTP before the release-run preflight', async () => {
    const root = await createFixture({
      'scripts/publish/publish-packages.sh': `#!/bin/bash
command+=(publish -r --no-git-checks)
run_publish_command dry-run
read -rp "🔑 Enter npm OTP for publish: " OTP
pnpm harness:release:check -- --version "$VERSION" --publish
`,
    });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: 'scripts/publish/publish-packages.sh',
      detail: 'Publish script must validate release-run state before requesting OTP.',
    });
  });

  it('flags CI that no longer archives package dist artifacts', async () => {
    const root = await createFixture({
      '.github/workflows/ci.yml': GREEN_CI_WORKFLOW.replaceAll('package-dist.tgz', 'other.tgz'),
    });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: '.github/workflows/ci.yml',
      detail: 'CI must archive package dist artifacts for skip-build quality verification.',
    });
  });

  it('flags a release-run template that drops a required state field', async () => {
    const root = await createFixture({
      '.agents/templates/release-run-template.md': GREEN_RELEASE_TEMPLATE.replace(
        '- Publish ready:\n',
        '',
      ),
    });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: '.agents/templates/release-run-template.md',
      detail: 'Release-run template must include Publish ready.',
    });
  });

  it('flags a scan runner that dropped the release-governance scan', async () => {
    const root = await createFixture({
      'scripts/harness/run-all-scans.mjs': '// fixture runner without the governance scan\n',
    });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: 'scripts/harness/run-all-scans.mjs',
      detail: 'run-all-scans.mjs must include the release-governance scan.',
    });
  });
});

describe('check-release-governance CLI', () => {
  function runScan(cwd) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT], { cwd, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture', async () => {
    const root = await createFixture();
    const result = runScan(root);
    expect(result.stdout).toContain('release governance scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a violating fixture', async () => {
    const root = await createFixture();
    rmSync(path.join(root, 'scripts/publish/publish-packages.sh'));

    const result = runScan(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('release governance scan failed:');
    expect(result.stdout).toContain(
      'scripts/publish/publish-packages.sh: Required release governance file is missing.',
    );
  });
});
