import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

const workflow = parse(
  readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
);

function schedules(event, branch) {
  if (!Object.hasOwn(workflow.on, event)) return false;
  const trigger = workflow.on[event];
  if (event === 'workflow_dispatch') return true;
  return trigger.branches.includes(branch);
}

it('runs required branch and manual checks without duplicating develop push CI', () => {
  expect(schedules('pull_request', 'develop')).toBe(true);
  expect(schedules('pull_request', 'main')).toBe(true);
  expect(schedules('push', 'main')).toBe(true);
  expect(schedules('workflow_dispatch', 'develop')).toBe(true);
  expect(schedules('push', 'develop')).toBe(false);
  expect(schedules('pull_request', 'feature')).toBe(false);

  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.jobs.tests.needs).toEqual(['scope', 'workspace-build']);
  expect(workflow.jobs['release-checks'].needs).toBe('scope');
  expect(workflow.jobs['pr-validation'].needs).toEqual([
    'scope',
    'workspace-build',
    'static-checks',
    'tests',
    'release-checks',
  ]);
  expect(
    workflow.jobs['pr-validation'].steps.some((step) => step.run === 'node scripts/ci.mjs gate'),
  ).toBe(true);
  expect(workflow.jobs.security.needs).toEqual(['secret-scan']);
});

function concurrencyFor({ attempt, ref, runId }) {
  const groupExpression = workflow.concurrency.group;
  const groupMatch =
    /^\$\{\{\s*github\.run_attempt\s*==\s*'1'\s*&&\s*format\('([^']+)'\s*,\s*github\.ref\)\s*\|\|\s*format\('([^']+)'\s*,\s*github\.run_id\)\s*\}\}$/.exec(
      groupExpression,
    );
  expect(groupMatch).not.toBeNull();
  const firstAttempt = String(attempt) === '1';
  const template = firstAttempt ? groupMatch[1] : groupMatch[2];
  expect(template.match(/\{0\}/g)).toHaveLength(1);

  const cancellationExpression = workflow.concurrency['cancel-in-progress'];
  expect(cancellationExpression).toBe("${{ github.run_attempt == '1' }}");
  return {
    group: template.replace('{0}', firstAttempt ? ref : runId),
    cancelsInProgress: firstAttempt,
  };
}

function displaces(incoming, existing, state) {
  if (incoming.group !== existing.group) return false;
  return state === 'pending' || (state === 'in_progress' && incoming.cancelsInProgress);
}

it('keeps stale retries separate from pending and in-progress current-head runs', () => {
  const ref = 'refs/pull/3474/merge';
  const current = concurrencyFor({ attempt: 1, ref, runId: '200' });
  const staleRetry = concurrencyFor({ attempt: 2, ref, runId: '100' });
  expect(staleRetry.group).not.toBe(current.group);
  for (const state of ['pending', 'in_progress']) {
    expect(displaces(staleRetry, current, state)).toBe(false);
  }
  expect(concurrencyFor({ attempt: 3, ref, runId: '100' }).group).toBe(staleRetry.group);
});

it('lets new automatic heads supersede old heads on the same ref but keeps PRs separate', () => {
  const old = concurrencyFor({ attempt: 1, ref: 'refs/pull/3474/merge', runId: '100' });
  const newer = concurrencyFor({ attempt: 1, ref: 'refs/pull/3474/merge', runId: '200' });
  expect(newer.group).toBe(old.group);
  for (const state of ['pending', 'in_progress']) {
    expect(displaces(newer, old, state)).toBe(true);
  }
  const anotherPr = concurrencyFor({ attempt: 1, ref: 'refs/pull/3493/merge', runId: '300' });
  expect(displaces(anotherPr, newer, 'in_progress')).toBe(false);
});
