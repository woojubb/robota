import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sealConnectionEnvironment } from '@robota-sdk/agent-executor';
import { describe, expect, it } from 'vitest';

import { SUBAGENT_WORKER_MODE_FLAG } from '../index.js';

/**
 * Issue #3248 — a child-process subagent's session consults the sandbox its tools run under.
 *
 * In `auto` mode a broad execution allow rule (`Bash(npm *)`) leaves the allow list but stays in the
 * `inherit-allowlist` ceiling, so a command inside the ceiling reaches the sandbox step. Spawns the
 * real `runSubagentWorkerMain` over IPC. Build-dependent: the fixture imports the package's `dist`.
 */
const ENTRY = fileURLToPath(new URL('./fixtures/sandbox-worker-entry.mjs', import.meta.url));
const DIST = fileURLToPath(new URL('../../dist/node/index.js', import.meta.url));
const TEST_TIMEOUT_MS = 30_000;

interface IRecord {
  toolsGotComposedSandbox?: boolean;
  bashRan?: string;
}

function runWorker(composesSandbox: boolean): Promise<IRecord[]> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-worker-sandbox-')));
  const recordPath = join(dir, 'records.jsonl');
  return new Promise<IRecord[]>((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, SUBAGENT_WORKER_MODE_FLAG], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...process.env,
        SANDBOX_RECORD_PATH: recordPath,
        SANDBOX_FIXTURE_COMPOSES: composesSandbox ? '1' : '0',
      },
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`worker never finished; stderr: ${stderr.slice(0, 600)}`));
    }, TEST_TIMEOUT_MS - 5_000);
    child.on('message', (message: { type?: string }) => {
      if (message.type !== 'ready') return;
      child.send({
        type: 'start',
        payload: {
          taskId: 'agent_1',
          request: {
            permissionPolicy: 'inherit-allowlist',
            agentType: 'general-purpose',
            label: 'Sandboxed',
            parentSessionId: 'session_1',
            mode: 'background',
            depth: 1,
            cwd: dir,
            prompt: 'run the tests',
          },
          agentDefinition: {
            name: 'general-purpose',
            description: 'Sandboxed agent',
            systemPrompt: 'Run tasks.',
          },
          parentConfig: {
            provider: { model: 'scripted' },
            permissions: { allow: ['Bash(npm *)'], deny: [] },
            defaultTrustLevel: 'moderate',
          },
          parentContext: { agentsMd: '', projectNotesMd: '' },
          permissionMode: 'auto',
          providerProfile: { type: 'sandbox-fixture-provider', model: 'scripted' },
          connectionCheck: sealConnectionEnvironment([], {}),
        },
      });
    });
    child.on('exit', () => {
      clearTimeout(timer);
      const records = existsSync(recordPath)
        ? readFileSync(recordPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as IRecord)
        : [];
      rmSync(dir, { recursive: true, force: true });
      resolve(records);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe.skipIf(!existsSync(DIST))('a child-process subagent and its composed sandbox', () => {
  it(
    'runs a confined command inside its ceiling, approved by the sandbox its tools run under',
    async () => {
      const records = await runWorker(true);

      expect(records).toContainEqual({ toolsGotComposedSandbox: true });
      expect(records).toContainEqual({ bashRan: 'npm test' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'without a composed sandbox, the same command is not approved on a sandbox’s say-so',
    async () => {
      const records = await runWorker(false);

      expect(records).toContainEqual({ toolsGotComposedSandbox: false });
      expect(records.some((record) => record.bashRan !== undefined)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
