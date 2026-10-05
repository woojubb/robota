/** Broker and provider transport are synthetic; stock CLI and child processes execute real tools. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';

describe('public hosted CLI child execution', () => {
  it.each([false, true])(
    'inherits the parent allowlist as a child effect ceiling: %s',
    async (allowEffects) => {
      const fixture = await hostedWorkerCliFixture({
        permissions: { allow: allowEffects ? ['Write', 'Bash'] : [] },
      });
      const { f, worker, home, processes, receipts } = fixture;
      try {
        const target = join(worker, 'child-file.txt');
        const workerEnv = join(worker, 'child-env.json');
        let childRound = 0;
        let parentRound = 0;
        const brokerCalls = scriptedHostedBroker(f, (body) => {
          const messages = (body.messages ?? body.input) as Array<{
            role: string;
            content?: unknown;
          }>;
          const isChild = messages.some(
            (message) =>
              message.role === 'user' &&
              JSON.stringify(message.content).includes('CHILD_WORKER_CANARY'),
          );
          let tool: { name: string; arguments: string } | undefined;
          let content: string | null = null;
          if (!isChild && parentRound++ === 0) {
            tool = {
              name: 'test_product_command_agent',
              arguments: JSON.stringify({
                args: 'parallel child:"CHILD_WORKER_CANARY"',
              }),
            };
          } else if (isChild && childRound === 0) {
            childRound++;
            tool = {
              name: 'Write',
              arguments: JSON.stringify({ filePath: target, content: 'child-task-canary' }),
            };
          } else if (isChild && childRound === 1) {
            childRound++;
            tool = {
              name: 'Bash',
              arguments: JSON.stringify({
                command: `${JSON.stringify(process.execPath)} -e 'require("node:fs").writeFileSync(${JSON.stringify(workerEnv)},JSON.stringify({cwd:process.cwd(),env:process.env}))'`,
                timeout: 5000,
              }),
            };
          } else {
            content = isChild ? 'CHILD_WORKER_COMPLETE' : 'PARENT_WORKER_COMPLETE';
          }
          return { ...(tool ? { tool } : {}), ...(content ? { content } : {}) };
        });
        const hostInjection = join(home, 'injected');
        const result = await fixture.run([
          '-p',
          `quote'; touch ${hostInjection}; #`,
          '--permission-mode',
          'bypassPermissions',
          '--no-session-persistence',
          '--max-turns',
          '10',
        ]);
        expect(result.stderr, result.stdout).not.toContain('Hosted runtime admission refused');
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout, result.stderr).toContain('PARENT_WORKER_COMPLETE');
        expect(childRound).toBe(2);
        expect(existsSync(target)).toBe(allowEffects);
        expect(existsSync(workerEnv)).toBe(allowEffects);
        if (allowEffects) expect(readFileSync(target, 'utf8')).toBe('child-task-canary');
        const workers = readFileSync(processes, 'utf8')
          .trim()
          .split('\n')
          .map(
            (line) =>
              JSON.parse(line) as {
                ipc: boolean;
                argv: string[];
                environment: Record<string, string>;
                cwd: string;
              },
          );
        expect(
          workers.some((record) => record.ipc && record.argv.includes('--__agent-subagent-worker')),
        ).toBe(true);
        for (const record of workers) {
          expect(record.cwd).toBe(worker);
          expect(record.environment.OPENAI_API_KEY).toBe('synthetic-task-token');
          expect(JSON.stringify(record)).not.toContain('runtime-management-canary');
          expect(JSON.stringify(record)).not.toContain('runtime-upstream-canary');
        }
        expect(childRound).toBe(2);
        expect(brokerCalls.length).toBeGreaterThanOrEqual(5);
        expect(
          brokerCalls.every((call) => call.authorization === 'Bearer synthetic-task-token'),
        ).toBe(true);
        expect(existsSync(hostInjection)).toBe(false);
        const projected = allowEffects ? readFileSync(workerEnv, 'utf8') : JSON.stringify(workers);
        expect(projected).not.toContain('runtime-management-canary');
        expect(projected).not.toContain('runtime-upstream-canary');
        // A subagent worker is started with the broker token; a command never sees it (#3429).
        expect(projected.includes('synthetic-task-token')).toBe(!allowEffects);
        expect(projected).not.toContain('PRODUCT_HOSTED_RUNTIME_CONFIG');
        expect(readFileSync(receipts, 'utf8')).not.toContain('runtime-management-canary');
      } finally {
        await fixture.close();
      }
    },
    75_000,
  );
});
