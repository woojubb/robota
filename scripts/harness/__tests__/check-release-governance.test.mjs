import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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

/**
 * The fixed-group half of the fixture workspace (REL-025).
 *
 * Two published packages and one private one, because the distinction is the whole point: a private
 * package is never published, so naming it in the `fixed` group is as much a dangling reference as
 * naming a package that does not exist.
 */
const GREEN_CHANGESET_CONFIG = {
  fixed: [['@fixture/alpha', '@fixture/beta']],
  linked: [],
  access: 'public',
  baseBranch: 'main',
};

const GREEN_WORKSPACE_MANIFESTS = {
  'packages/alpha/package.json': JSON.stringify(
    { name: '@fixture/alpha', version: '1.0.0' },
    null,
    2,
  ),
  'packages/beta/package.json': JSON.stringify(
    { name: '@fixture/beta', version: '1.0.0' },
    null,
    2,
  ),
  'packages/internal/package.json': JSON.stringify(
    { name: '@fixture/internal', version: '1.0.0', private: true },
    null,
    2,
  ),
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
    '.changeset/config.json': JSON.stringify(GREEN_CHANGESET_CONFIG, null, 2),
    ...GREEN_WORKSPACE_MANIFESTS,
  };
}

async function createFixture(overrides = {}) {
  const root = makeTemp('robota-release-governance-');
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

describe('changeset fixed-group integrity (REL-025)', () => {
  it('passes when every fixed-group entry names a published workspace package', async () => {
    const root = await createFixture();
    expect(collectReleaseGovernanceFindings(root)).toEqual([]);
  });

  it('flags a fixed-group entry that names no workspace package', async () => {
    const config = structuredClone(GREEN_CHANGESET_CONFIG);
    config.fixed[0].push('@fixture/removed-last-year');
    const root = await createFixture({ '.changeset/config.json': JSON.stringify(config, null, 2) });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: '.changeset/config.json',
      detail:
        'Fixed group entry "@fixture/removed-last-year" names no published workspace package.',
    });
  });

  it('flags a fixed-group entry that names a PRIVATE package', async () => {
    const config = structuredClone(GREEN_CHANGESET_CONFIG);
    config.fixed[0].push('@fixture/internal');
    const root = await createFixture({ '.changeset/config.json': JSON.stringify(config, null, 2) });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: '.changeset/config.json',
      detail: 'Fixed group entry "@fixture/internal" names no published workspace package.',
    });
  });

  it('flags a PUBLISHED package that is absent from the fixed group (REL-025 decision A)', async () => {
    const root = await createFixture({
      'packages/gamma/package.json': JSON.stringify(
        { name: '@fixture/gamma', version: '1.0.0' },
        null,
        2,
      ),
    });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: '.changeset/config.json',
      detail: 'Published package "@fixture/gamma" is not in the changeset fixed group.',
    });
    // The private package is not published, so its absence from the group is not a finding.
    expect(findings.filter((finding) => finding.detail.includes('@fixture/internal'))).toEqual([]);
  });

  it('flags published packages split across two fixed groups rather than one', async () => {
    const root = await createFixture({
      '.changeset/config.json': JSON.stringify(
        { ...GREEN_CHANGESET_CONFIG, fixed: [['@fixture/alpha'], ['@fixture/beta']] },
        null,
        2,
      ),
    });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: '.changeset/config.json',
      detail:
        'Published packages are split across 2 fixed groups; version-management rule 4 requires one.',
    });
  });

  it('still names an absent published package when another manifest is unreadable', async () => {
    // An unreadable manifest makes the published set INCOMPLETE, which forbids the claim "this
    // group entry names nothing" — but a manifest that WAS read is a published package whether or
    // not another one could be, so its absence from the group is still a finding.
    const root = await createFixture({
      'packages/beta/package.json': '{ "name": ',
      'packages/gamma/package.json': JSON.stringify(
        { name: '@fixture/gamma', version: '1.0.0' },
        null,
        2,
      ),
    });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: '.changeset/config.json',
      detail: 'Published package "@fixture/gamma" is not in the changeset fixed group.',
    });
  });

  it('flags the same package declared in two fixed groups', async () => {
    const root = await createFixture({
      '.changeset/config.json': JSON.stringify(
        {
          ...GREEN_CHANGESET_CONFIG,
          fixed: [['@fixture/alpha'], ['@fixture/alpha', '@fixture/beta']],
        },
        null,
        2,
      ),
    });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: '.changeset/config.json',
      detail: 'Fixed group entry "@fixture/alpha" appears in more than one group.',
    });
  });

  it('flags a missing "fixed" key rather than reading it as an empty group', async () => {
    const config = structuredClone(GREEN_CHANGESET_CONFIG);
    delete config.fixed;
    const root = await createFixture({ '.changeset/config.json': JSON.stringify(config, null, 2) });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: '.changeset/config.json',
      detail: 'Changeset config must declare "fixed" as an array of package-name groups.',
    });
  });

  it('flags an unreadable changeset config instead of treating it as agreement', async () => {
    const root = await createFixture({ '.changeset/config.json': '{ "fixed": [ ' });

    const findings = collectReleaseGovernanceFindings(root);
    expect(findings).toContainEqual({
      file: '.changeset/config.json',
      detail: 'Changeset config could not be parsed as JSON, so the fixed group could not be read.',
    });
    // The unreadable branch must not ALSO report every published package as absent — a parse
    // failure is one finding about one file, not a verdict about the workspace.
    expect(findings.filter((finding) => finding.detail.startsWith('Fixed group entry'))).toEqual(
      [],
    );
  });

  it('flags an unreadable package manifest instead of dropping it from the published set', async () => {
    const root = await createFixture({ 'packages/beta/package.json': '{ "name": ' });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: 'packages/beta/package.json',
      detail: 'Package manifest could not be read, so the published package set is incomplete.',
    });
  });

  it('flags a workspace with no packages/ directory rather than passing vacuously', async () => {
    const root = await createFixture();
    rmSync(path.join(root, 'packages'), { recursive: true, force: true });

    expect(collectReleaseGovernanceFindings(root)).toContainEqual({
      file: 'packages',
      detail: 'No packages/ directory, so the published package set could not be derived.',
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
