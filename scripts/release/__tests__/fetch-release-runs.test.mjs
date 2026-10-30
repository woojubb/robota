import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { fetchAllPushRuns, fetchReleaseRuns } from '../fetch-release-runs.mjs';

test('rejects incomplete pages instead of treating history as complete', async () => {
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async ({ page }) => ({
          data: {
            total_count: 2,
            workflow_runs: page === 1 ? [{ id: 1 }] : [],
          },
        }),
      },
    },
  };
  await assert.rejects(
    fetchAllPushRuns(github, 'owner', 'repo', 'release.yml', '2026-01-01T00:00:00Z'),
    /Incomplete/,
  );
});

test('includes pending manual producers in the active release search', async () => {
  const queried = [];
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async (options) => {
          queried.push(options.status);
          return { data: { total_count: 0, workflow_runs: [] } };
        },
      },
    },
  };
  await fetchReleaseRuns(github, 'owner', 'repo', 'release.yml', 'v3.0.3');
  assert.ok(queried.includes('pending'));
  assert.ok(queried.includes('action_required'));
});

test('splits a 1000-result interval and recovers both halves', async () => {
  let calls = 0;
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async ({ created }) => {
          calls += 1;
          const [start, end] = created.split('..').map(Date.parse);
          return {
            data:
              end - start > 1000 * 60 * 60 * 24 * 300
                ? { total_count: 1000, workflow_runs: [] }
                : { total_count: 1, workflow_runs: [{ id: calls }] },
          };
        },
      },
    },
  };
  const runs = await fetchAllPushRuns(
    github,
    'owner',
    'repo',
    'release.yml',
    '2026-01-01T00:00:00Z',
  );
  assert.ok(calls > 1);
  assert.ok(runs.length >= 2);
});
