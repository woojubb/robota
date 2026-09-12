import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(
  readFileSync(
    new URL('../../../.github/workflows/security-scheduled.yml', import.meta.url),
    'utf8',
  ),
);
const job = workflow.jobs['osv-scan'];
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const LOCK_SHA = 'c'.repeat(64);

function runStep(step, environment = {}) {
  expect(step?.run, 'expected an executable workflow step').toBeTypeOf('string');
  const functions = `
    record() {
      printf '%s\\n' "$*" >&2
      [[ "$1" != "$FAIL_COMMAND" ]] || return 23
    }
    git() {
      record git "$@" || return $?
      [[ "$*" == 'rev-parse HEAD' ]] || return 91
      printf '%s\\n' "$CHECKOUT_SHA"
    }
    sha256sum() {
      record sha256sum "$@" || return $?
      if [[ "$*" == 'pnpm-lock.yaml' ]]; then
        printf '%s  pnpm-lock.yaml\\n' "$LOCK_SHA"
      elif [[ "$*" == '-c -' ]]; then
        IFS= read -r checksum
        printf 'checksum-input %s\\n' "$checksum" >&2
        [[ "$checksum" == "$OSV_SCANNER_SHA256  $RUNNER_TEMP/osv-scanner" ]] || return 92
      else
        return 92
      fi
    }
    curl() { record curl "$@"; }
    chmod() { record chmod "$@"; }
    function /mock/osv-scanner { record scanner "$@"; }
  `;
  const result = spawnSync(
    '/bin/bash',
    ['--noprofile', '--norc', '-c', `${functions}\n${step.run}`],
    {
      encoding: 'utf8',
      timeout: 3000,
      // No inherited credentials, executable search path or shell startup scripts.
      env: {
        PATH: '/nonexistent',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_SHA: SHA_A,
        CHECKOUT_SHA: SHA_A,
        SCAN_BRANCH: 'develop',
        LOCK_SHA,
        FAIL_COMMAND: '',
        RUNNER_TEMP: '/mock',
        GITHUB_STEP_SUMMARY: '/dev/fd/3',
        ...workflow.env,
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    },
  );
  expect(result.error).toBeUndefined();
  return { ...result, summary: result.output[3] };
}

describe('integrated dependency scan event contract (INFRA-2655)', () => {
  it('selects only develop for push and both manual branches with an event-bound checkout', () => {
    // Pin the actual Actions contract; do not reproduce its evaluator in the test.
    expect(job.strategy.matrix).toEqual({
      branch:
        '${{ fromJSON(github.event_name == \'push\' && \'["develop"]\' || \'["main","develop"]\') }}',
    });
    expect(job.strategy['fail-fast']).toBe(false);
    expect(job.name).toBe('osv-scanner (${{ matrix.branch }}, full lockfile)');
    expect(job.steps[0]).toEqual({
      uses: 'actions/checkout@v7',
      with: {
        ref: "${{ github.event_name == 'workflow_dispatch' && matrix.branch || github.sha }}",
        'persist-credentials': false,
      },
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toBeUndefined();
  });

  it('runs on every develop push without path filters and retains manual dispatch', () => {
    expect(workflow.on).toEqual({ push: { branches: ['develop'] }, workflow_dispatch: null });
    expect(workflow.name).toBe('Security scan (develop push and on demand)');
    expect(workflow.concurrency).toBeUndefined();
    expect(job.concurrency).toBeUndefined();
    expect(job.if).toBeUndefined();
    expect(job['continue-on-error']).toBeUndefined();
    for (const step of job.steps) {
      expect(step.if).toBeUndefined();
      expect(step['continue-on-error']).toBeUndefined();
    }
  });
});

describe('integrated dependency scan subject identity (INFRA-2655)', () => {
  it.each([
    ['main', SHA_A],
    ['develop', SHA_B],
  ])('reports the actual %s dispatch checkout rather than the event SHA', (branch, sha) => {
    const step = job.steps.find((candidate) => candidate.name === 'Record scan subject');
    const result = runStep(step, {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_SHA: 'd'.repeat(40),
      SCAN_BRANCH: branch,
      CHECKOUT_SHA: sha,
    });
    expect(result.status, result.stderr).toBe(0);
    const expected = `Branch: ${branch}\nCheckout SHA: ${sha}\nLockfile SHA256: ${LOCK_SHA}\n`;
    expect(result.stdout).toBe(expected);
    expect(result.summary).toBe(expected);
  });

  it.each(['git', 'sha256sum'])(
    'propagates %s identity-read failure without publishing a subject',
    (command) => {
      const step = job.steps.find((candidate) => candidate.name === 'Record scan subject');
      const result = runStep(step, { FAIL_COMMAND: command });
      expect(result.status).toBe(23);
      expect(result.stdout).toBe('');
      expect(result.summary).toBe('');
      if (command === 'git') expect(result.stderr).not.toContain('sha256sum');
    },
  );

  it('refuses a push checkout that differs from its triggering SHA', () => {
    const step = job.steps.find((candidate) => candidate.name === 'Record scan subject');
    const result = runStep(step, { GITHUB_SHA: SHA_A, CHECKOUT_SHA: SHA_B });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error::Push checkout does not match triggering SHA');
    expect(result.stderr).not.toContain('sha256sum');
    expect(result.stdout).toBe('');
    expect(result.summary).toBe('');
  });

  it('reports the actual checkout and lockfile identities for two distinct pushes', () => {
    const step = job.steps.find((candidate) => candidate.name === 'Record scan subject');
    expect(step?.env).toEqual({ SCAN_BRANCH: '${{ matrix.branch }}' });
    for (const sha of [SHA_A, SHA_B]) {
      const result = runStep(step, { GITHUB_SHA: sha, CHECKOUT_SHA: sha });
      expect(result.status, result.stderr).toBe(0);
      const expected = `Branch: develop\nCheckout SHA: ${sha}\nLockfile SHA256: ${LOCK_SHA}\n`;
      expect(result.stdout).toBe(expected);
      expect(result.summary).toBe(expected);
      expect(result.stderr).toBe('git rev-parse HEAD\nsha256sum pnpm-lock.yaml\n');
    }
  });
});

describe('integrated dependency scan command failures (INFRA-2655)', () => {
  const install = job.steps.find((step) => step.name === 'Install osv-scanner');
  const scan = job.steps.find(
    (step) => step.name === 'Vulnerability scan (osv-scanner) over the full lockfile',
  );
  const checksum = '3abcfd7126c453a00421487e721b296e0cb68085bd431d6cef60872774170fc8';
  const download =
    'curl -fsSL https://github.com/google/osv-scanner/releases/download/v2.0.2/osv-scanner_linux_amd64 -o /mock/osv-scanner\n';
  const verification = `sha256sum -c -\nchecksum-input ${checksum}  /mock/osv-scanner\n`;

  it('retains the reviewed scanner pins and records identity before installation and scanning', () => {
    expect(workflow.env.OSV_SCANNER_VERSION).toBe('v2.0.2');
    expect(workflow.env.OSV_SCANNER_SHA256).toBe(checksum);
    expect(job.steps.map((step) => step.name ?? step.uses)).toEqual([
      'actions/checkout@v7',
      'Record scan subject',
      'Install osv-scanner',
      'Vulnerability scan (osv-scanner) over the full lockfile',
    ]);
  });

  it('downloads the pinned binary and verifies its checksum before chmod', () => {
    const result = runStep(install);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe(`${download}${verification}chmod +x /mock/osv-scanner\n`);
  });

  it.each([
    ['curl', download],
    ['sha256sum', `${download}sha256sum -c -\n`],
    ['chmod', `${download}${verification}chmod +x /mock/osv-scanner\n`],
  ])('propagates %s installation failure and stops subsequent commands', (command, trace) => {
    const result = runStep(install, { FAIL_COMMAND: command });
    expect(result.status).toBe(23);
    expect(result.stderr).toBe(trace);
    expect(result.stdout).toBe('');
  });

  it('scans the full committed lockfile using only the existing exclusions config', () => {
    const result = runStep(scan);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe(
      'scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml\n',
    );
  });

  it('propagates the scanner nonzero result rather than reporting a clean scan', () => {
    const result = runStep(scan, { FAIL_COMMAND: 'scanner' });
    expect(result.status).toBe(23);
    expect(result.stderr).toBe(
      'scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml\n',
    );
    expect(result.stdout).toBe('');
  });
});
