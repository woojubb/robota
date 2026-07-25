/**
 * INFRA-048-A — the review gate must turn review findings into a merge-visible signal, WITHOUT
 * becoming a gate that fires on NITs (which would be bypassed, i.e. worse than advisory).
 *
 * The fixtures are shaped like real GitHub code-scanning alerts, including the exact severity this
 * repo's ~100 open alerts carry (`note` on `js/unused-local-variable`) — the calibration point for
 * the severity split.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACKNOWLEDGE_LABEL,
  UNAVAILABLE,
  decideReviewGate,
  isBlockingAlert,
  renderDecision,
} from '../check-review-gate.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '../check-review-gate.mjs');

function alert({ number, severity = 'note', security = null, rule = 'js/unused-local-variable' }) {
  return {
    number,
    state: 'open',
    rule: { id: rule, severity, security_severity_level: security },
    most_recent_instance: { location: { path: `src/file-${number}.ts`, start_line: 10 } },
  };
}

describe('isBlockingAlert (the severity split)', () => {
  it('does NOT block on `note` — the severity every open alert in this repo carries', () => {
    expect(isBlockingAlert(alert({ number: 1, severity: 'note' }))).toBe(false);
  });

  it('does NOT block on `warning`', () => {
    expect(isBlockingAlert(alert({ number: 2, severity: 'warning' }))).toBe(false);
  });

  it('blocks on `error`', () => {
    expect(isBlockingAlert(alert({ number: 3, severity: 'error' }))).toBe(true);
  });

  it('blocks on high/critical security severity regardless of rule severity', () => {
    expect(isBlockingAlert(alert({ number: 4, severity: 'warning', security: 'high' }))).toBe(true);
    expect(isBlockingAlert(alert({ number: 5, severity: 'note', security: 'critical' }))).toBe(
      true,
    );
    expect(isBlockingAlert(alert({ number: 6, severity: 'note', security: 'medium' }))).toBe(false);
  });
});

describe('decideReviewGate', () => {
  it('BLOCKS a PR that introduces an error-severity finding', () => {
    const decision = decideReviewGate({
      prAlerts: [alert({ number: 10, severity: 'error', rule: 'js/incomplete-sanitization' })],
      baseAlerts: [],
    });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('blocking-findings');
    expect(decision.blocking).toHaveLength(1);
  });

  it('PASSES a PR whose only new findings are advisory — but reports them', () => {
    const decision = decideReviewGate({
      prAlerts: [alert({ number: 11 }), alert({ number: 12 })],
      baseAlerts: [],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.reason).toBe('advisory-only');
    expect(decision.advisory).toHaveLength(2);
    // The signal is still merge-visible: previously nothing was reported at all.
    expect(renderDecision(decision)).toContain('Advisory findings introduced by this PR');
  });

  it('never blocks on findings that were already open on the base branch', () => {
    const preExisting = alert({ number: 20, severity: 'error' });
    const decision = decideReviewGate({ prAlerts: [preExisting], baseAlerts: [preExisting] });
    expect(decision.blocked).toBe(false);
    expect(decision.preExisting).toHaveLength(1);
    expect(decision.blocking).toHaveLength(0);
  });

  it('PASSES a clean PR with no extra friction', () => {
    const decision = decideReviewGate({ prAlerts: [], baseAlerts: [] });
    expect(decision.blocked).toBe(false);
    expect(decision.reason).toBe('clean');
  });

  it('ignores alerts that are no longer open', () => {
    const fixed = { ...alert({ number: 30, severity: 'error' }), state: 'fixed' };
    const decision = decideReviewGate({ prAlerts: [fixed], baseAlerts: [] });
    expect(decision.blocked).toBe(false);
  });

  // The INFRA-048 root cause, one level up: a check must never report success for an answer it
  // could not compute.
  it('FAIL-CLOSED: blocks when the PR alert list is unavailable', () => {
    const decision = decideReviewGate({ prAlerts: UNAVAILABLE, baseAlerts: [] });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('verdict-unavailable');
  });

  it('FAIL-CLOSED: blocks when the base alert list is unavailable', () => {
    const decision = decideReviewGate({ prAlerts: [], baseAlerts: UNAVAILABLE });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('verdict-unavailable');
  });

  it('the acknowledge label overrides a block, and the override is recorded', () => {
    const decision = decideReviewGate({
      prAlerts: [alert({ number: 40, severity: 'error' })],
      baseAlerts: [],
      labels: [ACKNOWLEDGE_LABEL],
    });
    expect(decision.blocked).toBe(false);
    expect(decision.acknowledged).toBe(true);
    // Overridden, not hidden: the findings stay in the report.
    const report = renderDecision(decision);
    expect(report).toContain('OVERRIDDEN');
    expect(report).toContain('Blocking findings introduced by this PR');
  });

  it('an unrelated label does not override', () => {
    const decision = decideReviewGate({
      prAlerts: [alert({ number: 41, severity: 'error' })],
      baseAlerts: [],
      labels: ['dependencies', 'size/S'],
    });
    expect(decision.blocked).toBe(true);
  });
});

describe('CLI (the shape the workflow calls)', () => {
  async function fixture(files) {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-review-gate-'));
    mkdirSync(root, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content, 'utf8');
    }
    return root;
  }

  function run(root, args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  }

  it('exits 1 and names the finding when the PR introduces a blocking one', async () => {
    const root = await fixture({
      'pr.json': JSON.stringify([alert({ number: 50, severity: 'error', rule: 'js/xss' })]),
      'base.json': '[]',
    });
    const result = run(root, ['--alerts-file', 'pr.json', '--base-alerts-file', 'base.json']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('review-gate: BLOCK (blocking-findings)');
    expect(result.stdout).toContain('js/xss');
  });

  it('exits 0 on a clean PR', async () => {
    const root = await fixture({ 'pr.json': '[]', 'base.json': '[]' });
    const result = run(root, ['--alerts-file', 'pr.json', '--base-alerts-file', 'base.json']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('review-gate: PASS (clean)');
  });

  it('exits 0 on note-severity findings — the NIT-bypass failure mode is designed out', async () => {
    const root = await fixture({
      'pr.json': JSON.stringify([alert({ number: 51 }), alert({ number: 52 })]),
      'base.json': '[]',
    });
    const result = run(root, ['--alerts-file', 'pr.json', '--base-alerts-file', 'base.json']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('review-gate: PASS (advisory-only)');
    expect(result.stdout).toContain('js/unused-local-variable');
  });

  it('FAIL-CLOSED: exits 1 on the UNAVAILABLE sentinel the workflow writes', async () => {
    const root = await fixture({ 'pr.json': 'UNAVAILABLE\n', 'base.json': '[]' });
    const result = run(root, ['--alerts-file', 'pr.json', '--base-alerts-file', 'base.json']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('verdict-unavailable');
  });

  it('FAIL-CLOSED: exits 1 on an unparseable alert payload rather than treating it as empty', async () => {
    const root = await fixture({ 'pr.json': '{"message":"Not Found"}', 'base.json': '[]' });
    const result = run(root, ['--alerts-file', 'pr.json', '--base-alerts-file', 'base.json']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('verdict-unavailable');
  });

  it('exits 0 when the acknowledge label is passed', async () => {
    const root = await fixture({
      'pr.json': JSON.stringify([alert({ number: 53, severity: 'error' })]),
      'base.json': '[]',
    });
    const result = run(root, [
      '--alerts-file',
      'pr.json',
      '--base-alerts-file',
      'base.json',
      '--labels',
      `other,${ACKNOWLEDGE_LABEL}`,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OVERRIDDEN');
  });
});
