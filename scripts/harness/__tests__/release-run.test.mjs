import { describe, expect, it } from 'vitest';

import {
  buildTriageNote,
  parseReleaseRun,
  releaseRunPathForVersion,
  renderReleaseRun,
  validateReleaseRun,
} from '../release-run.mjs';

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
});
