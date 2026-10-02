import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createAgentRuntime, createSessionRunFn, runEval } from '../src/index.js';

// Consumer-owned repository and verifier: no filesystem I/O occurs in a metric.
const broken = 'export const add = (a, b) => a - b;\n';
const fixed = 'export const add = (a, b) => a + b;\n';
const root = mkdtempSync(join(tmpdir(), 'agent-outcome-baseline-'));
const oldHome = process.env.HOME;
const oldState = process.env.PRODUCT_USER_STATE_DIR;
const trials: Array<{
  variant: string;
  trial: number;
  success: boolean;
  toolSteps: number;
  elapsedMs: number;
  costUsd: number | null;
}> = [];

try {
  const home = join(root, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  process.env.PRODUCT_USER_STATE_DIR = join(root, 'state');
  for (const variant of ['false-done', 'fixed'] as const) {
    for (let trial = 1; trial <= 3; trial++) {
      const cwd = join(root, `${variant}-${trial}`);
      mkdirSync(cwd);
      const file = join(cwd, 'math.mjs');
      writeFileSync(file, broken);
      const gitEnv = { ...process.env };
      for (const key of Object.keys(gitEnv)) if (key.startsWith('GIT_')) delete gitEnv[key];
      execFileSync('git', ['init', '--quiet', cwd], { env: gitEnv });
      const script = createScriptedProvider(
        variant === 'false-done'
          ? [{ text: 'Done' }]
          : [
              { toolCalls: [{ name: 'Write', args: { filePath: file, content: fixed } }] },
              { text: 'Done' },
            ],
      );
      const runtime = createAgentRuntime({ cwd, provider: script.provider });
      const run = createSessionRunFn(runtime, {
        permissionMode: 'acceptEdits',
        bare: true,
        allowedTools: ['Write'],
        deniedTools: ['Bash', 'Shell', 'WebFetch', 'WebSearch', 'BackgroundProcess'],
      });
      const start = performance.now();
      const result = await run('Fix add(2, 3) so it returns 5 in math.mjs.');
      let actualOutcome = false;
      try {
        actualOutcome =
          execFileSync(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              'import { add } from "./math.mjs"; if (add(2,3)!==5 || add(-2,3)!==1) process.exit(1);',
            ],
            { cwd, stdio: 'pipe', timeout: 5000 },
          ).length === 0;
      } catch {
        actualOutcome = false;
      }
      const observation = Object.freeze({
        actualOutcome,
        changed: readFileSync(file, 'utf8') !== broken,
      });
      const report = await runEval(
        {
          cases: [{ input: 'fix add' }],
          threshold: 0.5,
          metrics: [
            {
              name: 'environment-outcome',
              required: true,
              score: () => observation.actualOutcome && observation.changed,
            },
            { name: 'claims-done', score: (r) => r.response.includes('Done') },
          ],
        },
        async () => result,
      );
      if (report.passed !== (variant === 'fixed'))
        throw new Error(`Unexpected verdict: ${variant}`);
      trials.push({
        variant,
        trial,
        success: report.passed,
        toolSteps: result.toolSummaries.length,
        elapsedMs: performance.now() - start,
        costUsd: result.usage?.costStatus !== 'unknown' ? (result.usage?.costUsd ?? null) : null,
      });
    }
  }
} finally {
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  if (oldState === undefined) delete process.env.PRODUCT_USER_STATE_DIR;
  else process.env.PRODUCT_USER_STATE_DIR = oldState;
  rmSync(root, { recursive: true, force: true });
}

const successes = trials.filter((trial) => trial.success).length;
const knownCost = trials.every((trial) => trial.costUsd !== null);
console.log(
  JSON.stringify(
    {
      fixtureRevision: 'arithmetic-v1',
      provider: 'scripted-test-provider',
      model: 'offline-script',
      permissionMode: 'acceptEdits',
      isolation: 'temporary-directory-and-product-state; no OS sandbox',
      stochasticComparison: false,
      trials,
      sampleSize: trials.length,
      successRate: successes / trials.length,
      costPerSuccess:
        knownCost && successes > 0
          ? trials.reduce((sum, trial) => sum + (trial.costUsd ?? 0), 0) / successes
          : null,
      cleanupRemoved: true,
    },
    null,
    2,
  ),
);
