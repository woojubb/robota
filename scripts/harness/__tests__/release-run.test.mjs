import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildTriageNote,
  parseReleaseRun,
  releaseRunPathForVersion,
  renderReleaseRun,
  validateReleaseRun,
} from '../release-run.mjs';

const RELEASE_RUN_SCRIPT = fileURLToPath(new URL('../release-run.mjs', import.meta.url));

function greenReleaseRun() {
  return `# Release Run: 3.0.0-beta.99

## State

- Version: 3.0.0-beta.99
- Branch: release/v3.0.0-beta.99
- SHA: abcdef123456
- PR: 999
- Target branch: main
- Active gate: publish
- Gate status: passed
- Next action: Run pnpm publish:beta.
- Stop condition: Stop if npm auth or dry-run fails.

## Publish Gate

- Publish ready: yes
- NPM auth verified: yes
- Dry run passed: yes
- OTP requested: no

## Long-Running Watchers

- Active watchers: none
- Cleanup status: clear

## CI Triage Notes

### Triage 2026-05-09T00:00:00.000Z

- PR: 999
- Check: quality
- Failure class: CI harness infrastructure
- Failure signature: missing dist artifact
- Local reproduction: reproduced with pnpm harness:scan
- Owning layer: .github/workflows/ci.yml
- Minimal fix recommendation: restore package dist artifact before quality
- Validation gate: quality check
- Status: resolved

## Final Report

- Merged PRs: #999
- Published version: 3.0.0-beta.99
- Validation gates: build, quality, security audit
- Skipped checks: none
`;
}

describe('release-run parser and checker', () => {
  it('parses and validates a green publish-ready release-run', () => {
    const run = parseReleaseRun(greenReleaseRun(), '.agents/release-runs/3.0.0-beta.99.md');

    expect(validateReleaseRun(run)).toEqual([]);
    expect(validateReleaseRun(run, { publish: true })).toEqual([]);
    expect(run.triageNotes).toHaveLength(1);
  });

  it('flags missing required state fields', () => {
    const run = parseReleaseRun(`# Release Run: broken

## State

- Version: TBD
- Branch: release/test

## Publish Gate

- Publish ready: maybe
`);

    expect(validateReleaseRun(run)).toEqual([
      {
        file: '<memory>',
        detail: 'Version: required release-run field must be concrete.',
      },
      {
        file: '<memory>',
        detail: 'SHA: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'PR: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Target branch: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Active gate: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Gate status: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Next action: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Stop condition: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Active watchers: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Cleanup status: required release-run field is missing.',
      },
      {
        file: '<memory>',
        detail: 'Publish ready: must be yes or no.',
      },
    ]);
  });

  it('blocks publish when gates are pending or watchers are active', () => {
    const run = parseReleaseRun(
      greenReleaseRun()
        .replace('- Gate status: passed', '- Gate status: pending')
        .replace('- Publish ready: yes', '- Publish ready: no')
        .replace('- Active watchers: none', '- Active watchers: gh pr checks --watch'),
    );

    expect(validateReleaseRun(run, { publish: true })).toContainEqual({
      file: '<memory>',
      detail: 'Gate status: must be passed before publish.',
    });
    expect(validateReleaseRun(run, { publish: true })).toContainEqual({
      file: '<memory>',
      detail: 'Publish ready: must be yes before publish.',
    });
    expect(validateReleaseRun(run, { publish: true })).toContainEqual({
      file: '<memory>',
      detail: 'Active watchers: must be none/clear before publish asks for OTP.',
    });
  });

  it('renders the standard release-run artifact and triage note', () => {
    const content = renderReleaseRun({
      version: '3.0.0-beta.100',
      branch: 'release/v3.0.0-beta.100',
      sha: 'abc123',
    });
    const triage = buildTriageNote({
      pr: '1000',
      check: 'build',
      class: 'product defect',
      signature: 'Type error',
      local: 'reproduced',
      owner: 'packages/agent-core',
      fix: 'update type contract',
      validation: 'pnpm typecheck',
    });

    expect(releaseRunPathForVersion('3.0.0-beta.100')).toBe(
      '.agents/release-runs/3.0.0-beta.100.md',
    );
    expect(content).toContain('- Version: 3.0.0-beta.100');
    expect(content).toContain('- Cleanup status: clear');
    expect(triage).toContain('- Failure class: product defect');
    expect(triage).toContain('- Validation gate: pnpm typecheck');
    expect(triage).toContain('- Status: open');
  });

  it('rejects an invalid Gate status value', () => {
    const run = parseReleaseRun(
      greenReleaseRun().replace('- Gate status: passed', '- Gate status: almost-done'),
    );

    expect(validateReleaseRun(run)).toContainEqual({
      file: '<memory>',
      detail:
        'Gate status: must be one of pending, running, passed, failed, stalled, skipped; found almost-done.',
    });
  });

  it('rejects angle-bracket placeholder values as non-concrete', () => {
    const run = parseReleaseRun(
      greenReleaseRun().replace('- SHA: abcdef123456', '- SHA: <fill in>'),
    );

    expect(validateReleaseRun(run)).toContainEqual({
      file: '<memory>',
      detail: 'SHA: required release-run field must be concrete.',
    });
  });

  it('blocks publish while Cleanup status is not clear', () => {
    const run = parseReleaseRun(
      greenReleaseRun().replace('- Cleanup status: clear', '- Cleanup status: in progress'),
    );

    expect(validateReleaseRun(run)).toEqual([]);
    expect(validateReleaseRun(run, { publish: true })).toContainEqual({
      file: '<memory>',
      detail: 'Cleanup status: must be clear before publish.',
    });
  });

  it('blocks publish while a triage note is still open', () => {
    const run = parseReleaseRun(greenReleaseRun().replace('- Status: resolved', '- Status: open'));

    expect(validateReleaseRun(run)).toEqual([]);
    expect(validateReleaseRun(run, { publish: true })).toContainEqual({
      file: '<memory>',
      detail:
        'Triage 2026-05-09T00:00:00.000Z: Status must be resolved, closed, or deferred before publish.',
    });
  });

  it('blocks publish on placeholder triage fields, but only at the publish gate', () => {
    const run = parseReleaseRun(
      greenReleaseRun().replace(
        '- Local reproduction: reproduced with pnpm harness:scan',
        '- Local reproduction: TBD',
      ),
    );

    expect(validateReleaseRun(run)).toEqual([]);
    expect(validateReleaseRun(run, { publish: true })).toContainEqual({
      file: '<memory>',
      detail:
        'Triage 2026-05-09T00:00:00.000Z: Local reproduction must be resolved before publish.',
    });
  });

  it('flags a triage note that drops a required field even outside publish', () => {
    const run = parseReleaseRun(
      greenReleaseRun().replace('- Failure signature: missing dist artifact\n', ''),
    );

    expect(validateReleaseRun(run)).toContainEqual({
      file: '<memory>',
      detail: 'Triage 2026-05-09T00:00:00.000Z: Failure signature is missing from the triage note.',
    });
  });
});

describe('release-run CLI (init → check → triage → publish gate → report)', () => {
  function runCli(cwd, args) {
    try {
      const stdout = execFileSync(process.execPath, [RELEASE_RUN_SCRIPT, ...args], {
        cwd,
        encoding: 'utf8',
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      return {
        status: error.status,
        stdout: `${error.stdout ?? ''}`,
        stderr: `${error.stderr ?? ''}`,
      };
    }
  }

  it('drives a full release-run lifecycle against a scratch workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-release-run-cli-'));

    // init creates the release-run artifact.
    // The scratch workspace is not a git repo, so branch/SHA must be explicit
    // (the git fallbacks would render placeholder values the checker rejects).
    const init = runCli(root, [
      'init',
      '--version',
      '9.9.9',
      '--pr',
      '1234',
      '--branch',
      'release/v9.9.9',
      '--sha',
      'abcdef123456',
    ]);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('created .agents/release-runs/9.9.9.md');
    const artifactPath = path.join(root, '.agents/release-runs/9.9.9.md');
    expect(existsSync(artifactPath)).toBe(true);

    // A second init without --force must refuse to clobber the artifact.
    const reinit = runCli(root, ['init', '--version', '9.9.9']);
    expect(reinit.status).toBe(1);
    expect(reinit.stderr).toContain('Release-run file already exists');

    // The freshly initialized run passes the plain check...
    const check = runCli(root, ['check', '--version', '9.9.9']);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('release-run check passed.');

    // ...but fails the publish gate (gate pending, publish ready: no).
    const publishCheck = runCli(root, ['check', '--version', '9.9.9', '--publish']);
    expect(publishCheck.status).toBe(1);
    expect(publishCheck.stdout).toContain('Gate status: must be passed before publish.');
    expect(publishCheck.stdout).toContain('Publish ready: must be yes before publish.');

    // triage appends a structured note under CI Triage Notes.
    const triage = runCli(root, [
      'triage',
      '--version',
      '9.9.9',
      '--pr',
      '1234',
      '--check',
      'quality',
      '--class',
      'CI harness infrastructure',
    ]);
    expect(triage.status).toBe(0);
    const artifact = readFileSync(artifactPath, 'utf8');
    expect(artifact).toContain('- Check: quality');
    expect(artifact).toContain('- Failure class: CI harness infrastructure');

    // An open triage note keeps the publish gate shut.
    const publishAfterTriage = runCli(root, ['check', '--version', '9.9.9', '--publish']);
    expect(publishAfterTriage.status).toBe(1);
    expect(publishAfterTriage.stdout).toContain(
      'Status must be resolved, closed, or deferred before publish.',
    );

    // report summarizes the run state including the triage count.
    const report = runCli(root, ['report', '--version', '9.9.9']);
    expect(report.status).toBe(0);
    expect(report.stdout).toContain('Release run 9.9.9');
    expect(report.stdout).toContain('- Triage notes: 1');
  });

  it('exits 1 with usage on an unknown command', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-release-run-cli-'));
    const result = runCli(root, ['bogus']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Usage:');
  });

  it('requires --version for init, triage, report, and publish checks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-release-run-cli-'));

    for (const args of [['init'], ['triage'], ['report'], ['check', '--publish']]) {
      const result = runCli(root, args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('--version');
    }
  });

  it('passes the plain check when no release-run files exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-release-run-cli-'));
    const result = runCli(root, ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no release-run files to validate');
  });
});
