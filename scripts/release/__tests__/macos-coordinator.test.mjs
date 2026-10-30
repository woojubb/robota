import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import * as order from '../desktop-release-order.mjs';
import * as fetcher from '../fetch-release-runs.mjs';

const workflow = parse(readFileSync('.github/workflows/release-macos-verification.yml', 'utf8'));
const script = workflow.jobs.prerequisites.steps
  .find((step) => step.id === 'join')
  .with.script.replace(/await import\(`[^`]+desktop-release-order\.mjs`\)/, 'order')
  .replace(/await import\(`[^`]+fetch-release-runs\.mjs`\)/, 'fetcher');
const run = (id) => ({
  id,
  run_attempt: 1,
  event: 'push',
  head_branch: 'v3.0.3',
  head_sha: 'abc',
  head_repository: { full_name: 'owner/repo' },
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-01-01T00:00:00Z',
});

test('the actual coordinator schedules verification for both successful matching receipts', async () => {
  const native = run(1),
    desktop = run(2),
    outputs = {};
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async ({ workflow_id, event }) => ({
          data:
            event === 'push'
              ? {
                  total_count: 1,
                  workflow_runs: [workflow_id === 'release-bun-binaries.yml' ? native : desktop],
                }
              : { total_count: 0, workflow_runs: [] },
        }),
        listWorkflowRunArtifacts: async ({ run_id }) => ({
          data: {
            total_count: 1,
            artifacts: [
              {
                name: `${run_id === 1 ? 'native' : 'desktop'}-release-evidence-${run_id}-1`,
                expired: false,
              },
            ],
          },
        }),
      },
      git: { getRef: async () => ({ data: { object: { type: 'commit', sha: 'abc' } } }) },
    },
  };
  const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { workflow_run: native } };
  const core = {
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    notice: () => {},
  };
  const old = process.env.GITHUB_WORKSPACE;
  process.env.GITHUB_WORKSPACE = process.cwd();
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)(
      'github',
      'context',
      'core',
      'order',
      'fetcher',
      script,
    )(github, context, core, order, fetcher);
  } finally {
    if (old === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = old;
  }
  expect(outputs.ready).toBe('true');
  expect(JSON.parse(outputs.matrix)).toEqual([
    expect.objectContaining({ tag: 'v3.0.3', native_run: '1', desktop_run: '2' }),
  ]);
});
