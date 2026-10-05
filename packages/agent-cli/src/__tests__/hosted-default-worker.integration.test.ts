/** Real public and worker CLI; simulated E2B transport, no physical containment claim. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';

describe('public hosted CLI uses its installed worker executor', () => {
  it('runs real file and Git tools without projecting runtime credentials', async () => {
    const fixture = await hostedWorkerCliFixture();
    const { worker, home, receipts } = fixture;
    try {
      const replay = join(worker, 'replay.jsonl');
      const target = join(worker, 'tool-file.txt');
      const workerEnv = join(worker, 'worker-env.json');
      const git = `git init -q && git add tool-file.txt && git -c user.name=synthetic -c user.email=synthetic@example.invalid commit -qm worker-proof`;
      const calls = [
        ['Write', { filePath: target, content: 'worker-task-canary' }],
        ['Read', { filePath: target }],
        ['Bash', { command: git, timeout: 5000 }],
        [
          'Bash',
          {
            command: `${JSON.stringify(process.execPath)} -e 'require("node:fs").writeFileSync(${JSON.stringify(workerEnv)},JSON.stringify(process.env))'`,
            timeout: 5000,
          },
        ],
      ];
      writeFileSync(
        replay,
        [
          ...calls.map(([name, parameters], round) => ({
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            sessionId: 'worker-fixture',
            event: 'provider_response_normalized',
            executionId: 'fixture',
            conversationId: 'fixture',
            round,
            response: {
              id: `a${round}`,
              role: 'assistant',
              timestamp: new Date(),
              state: 'complete',
              content: '',
              toolCalls: [
                {
                  id: `tool-${round}`,
                  type: 'function',
                  function: { name, arguments: JSON.stringify(parameters) },
                },
              ],
            },
          })),
          {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            sessionId: 'worker-fixture',
            event: 'provider_response_normalized',
            executionId: 'fixture',
            conversationId: 'fixture',
            round: calls.length,
            response: {
              id: 'done',
              role: 'assistant',
              timestamp: new Date(),
              state: 'complete',
              content: 'WORKER_CLI_COMPLETE',
            },
          },
        ]
          .map((line) => JSON.stringify(line))
          .join('\n') + '\n',
      );
      const hostInjection = join(home, 'injected');
      const result = await fixture.run([
        '-p',
        `quote'; touch ${hostInjection}; #`,
        '--session-log',
        replay,
        '--permission-mode',
        'bypassPermissions',
        '--no-session-persistence',
        '--safe-mode',
      ]);
      expect(result.stderr, result.stdout).not.toContain('Hosted runtime admission refused');
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('WORKER_CLI_COMPLETE');
      expect(readFileSync(target, 'utf8')).toBe('worker-task-canary');
      expect(existsSync(join(worker, '.git', 'HEAD'))).toBe(true);
      expect(existsSync(hostInjection)).toBe(false);
      const projected = readFileSync(workerEnv, 'utf8');
      expect(projected).not.toContain('runtime-management-canary');
      expect(projected).not.toContain('runtime-upstream-canary');
      // The task's broker token authenticates the worker's provider, never its commands (#3429).
      expect(projected).not.toContain('synthetic-task-token');
      expect(projected).not.toContain('PRODUCT_HOSTED_RUNTIME_CONFIG');
      expect(readFileSync(receipts, 'utf8')).not.toContain('runtime-management-canary');
    } finally {
      await fixture.close();
    }
  }, 75_000);
});
