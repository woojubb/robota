import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SUBAGENT_WORKER_MODE_FLAG } from '../index.js';

/**
 * ARCH-021 TC-01 — the injected composition is what the worker uses, on the REAL entry point.
 *
 * `agent-cli`'s bintest asserts what robota composes, but `composedToolNames` is derived from the
 * composition independently of `runInitialPrompt`, so it stays green if `parentTools:` is reverted or
 * built at the wrong root. This spawns the actual `runSubagentWorkerMain` over a real IPC channel and
 * observes which root it asked the composition for.
 *
 * Build-dependent: the fixture imports the package's own `dist`, because that is what a composition
 * root loads.
 */
const ENTRY = fileURLToPath(new URL('./fixtures/composition-worker-entry.mjs', import.meta.url));
const DIST = fileURLToPath(new URL('../../dist/node/index.js', import.meta.url));
const SCRATCH_TOOL_NAME = 'arch021ScratchTool';
const TEST_TIMEOUT_MS = 30_000;

interface IWorkerObservation {
  ready: { composedToolNames?: readonly string[] } | undefined;
  records: { createToolsCwd?: string }[];
}

/** Drive the real worker entry, optionally sending a `start` so `runInitialPrompt` runs. */
function runWorker(options: {
  start?: { cwd: string; worktree?: string };
}): Promise<IWorkerObservation> {
  const recordPath = join(mkdtempSync(join(tmpdir(), 'arch-021-')), 'records.jsonl');
  return new Promise<IWorkerObservation>((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, SUBAGENT_WORKER_MODE_FLAG], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, ARCH_021_RECORD_PATH: recordPath },
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => (stderr += chunk));

    let ready: IWorkerObservation['ready'];
    const finish = (): void => {
      child.kill('SIGKILL');
      const records = existsSync(recordPath)
        ? readFileSync(recordPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { createToolsCwd?: string })
        : [];
      resolve({ ready, records });
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`worker never settled; stderr: ${stderr.slice(0, 600)}`));
    }, TEST_TIMEOUT_MS - 5_000);

    child.on('message', (message: { type?: string; composedToolNames?: readonly string[] }) => {
      if (message.type !== 'ready') return;
      ready = message;
      if (!options.start) {
        clearTimeout(timer);
        finish();
        return;
      }
      child.send({
        type: 'start',
        payload: {
          taskId: 'agent_1',
          request: {
            permissionPolicy: 'inherit-allowlist',
            agentType: 'general-purpose',
            label: 'Scratch',
            parentSessionId: 'session_1',
            mode: 'background',
            depth: 1,
            cwd: options.start.cwd,
            prompt: 'do work',
          },
          ...(options.start.worktree ? { worktree: { path: options.start.worktree } } : {}),
          agentDefinition: { name: 'general-purpose', systemPrompt: 'Run tasks.' },
          parentConfig: {},
          parentContext: {},
          providerProfile: { type: 'arch021-scratch-provider', model: 'scratch-model' },
        },
      });
      // The turn itself needs no model to reach `createTools` — give it a moment, then read.
      setTimeout(() => {
        clearTimeout(timer);
        finish();
      }, 2_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe.skipIf(!existsSync(DIST))(
  'ARCH-021 — the injected composition reaches the real worker',
  () => {
    it(
      'declares the INJECTED tool surface, not an imported default set',
      async () => {
        const { ready } = await runWorker({});

        // A default tier would report Read/Write/Edit/…; only the injected recipe reports this name.
        expect(ready?.composedToolNames).toEqual([SCRATCH_TOOL_NAME]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'builds the job tools at the execution root, not at the parent cwd (ARCH-010)',
      async () => {
        // The line the bintest cannot reach: `parentTools: composition.createTools({ cwd:
        // subagentExecutionRoot(payload) })`. Reverting it to `[]`, or to `payload.request.cwd`,
        // changes what this observes.
        const worktree = mkdtempSync(join(tmpdir(), 'arch-021-worktree-'));
        const requestCwd = mkdtempSync(join(tmpdir(), 'arch-021-parent-'));

        const { records } = await runWorker({ start: { cwd: requestCwd, worktree } });

        const roots = records.map((record) => record.createToolsCwd).filter(Boolean);
        // The worktree wins over `request.cwd` — that is `subagentExecutionRoot`.
        expect(roots).toContain(worktree);
        expect(roots).not.toContain(requestCwd);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
