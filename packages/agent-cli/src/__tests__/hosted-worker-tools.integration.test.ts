import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

describe('hosted stock CLI task-owned tools', () => {
  it('executes managed background, command hooks and file search/edit inside the worker', async () => {
    const fixture = await hostedWorkerCliFixture();
    const { f, worker, state } = fixture;
    try {
      const hookOutput = join(worker, 'hook.json');
      const backgroundOutput = join(worker, 'background.json');
      const target = join(worker, 'editable.txt');
      const probe = join(worker, 'capture.mjs');
      writeFileSync(
        probe,
        `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({cwd: process.cwd(), env: process.env}));`,
      );
      writeFileSync(target, 'before-worker-edit');
      const capture = (path: string): string =>
        `${quote(process.execPath)} ${quote(probe)} ${quote(path)}`;
      const settings = JSON.parse(readFileSync(join(state, 'settings.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(
        join(state, 'settings.json'),
        JSON.stringify({
          ...settings,
          hooks: {
            PreToolUse: [
              { matcher: '', hooks: [{ type: 'command', command: capture(hookOutput) }] },
            ],
          },
        }),
      );
      const calls: Array<[string, Record<string, unknown>]> = [
        ['BackgroundProcess', { command: capture(backgroundOutput), timeout: 5000 }],
        [
          'Bash',
          {
            command: `for attempt in 1 2 3 4 5 6 7 8 9 10; do test -f ${quote(backgroundOutput)} && exit 0; sleep 0.1; done; exit 1`,
            timeout: 2000,
          },
        ],
        ['Read', { filePath: target }],
        [
          'Edit',
          { filePath: target, oldString: 'before-worker-edit', newString: 'after-worker-edit' },
        ],
        ['Glob', { pattern: '*.txt', path: worker }],
        ['Grep', { pattern: 'after-worker-edit', path: target, outputMode: 'content' }],
      ];
      const broker = scriptedHostedBroker(f, (_body, index) => {
        const next = calls[index];
        return next
          ? { tool: { name: next[0], arguments: JSON.stringify(next[1]) } }
          : { content: 'WORKER_TOOLS_COMPLETE' };
      });
      const result = await fixture.run([
        '-p',
        'Exercise task tools',
        '--permission-mode',
        'bypassPermissions',
        '--no-session-persistence',
        '--max-turns',
        '10',
      ]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, result.stderr).toContain('WORKER_TOOLS_COMPLETE');
      expect(readFileSync(target, 'utf8')).toBe('after-worker-edit');
      for (const path of [hookOutput, backgroundOutput]) {
        const observation = JSON.parse(readFileSync(path, 'utf8')) as {
          cwd: string;
          env: Record<string, string>;
        };
        expect(observation.cwd).toBe(worker);
        expect(observation.env.OPENAI_API_KEY).toBe('synthetic-task-token');
        expect(JSON.stringify(observation)).not.toContain('runtime-management-canary');
        expect(JSON.stringify(observation)).not.toContain('runtime-upstream-canary');
      }
      const results = broker.flatMap((call) =>
        ((call.body.input ?? call.body.messages) as Array<Record<string, unknown>>).filter(
          (message) => message.type === 'function_call_output' || message.role === 'tool',
        ),
      );
      const resultFor = (name: string): { success: boolean; output: string; error?: string } => {
        const index = calls.findIndex(([tool]) => tool === name);
        const result = results.find(
          (message) => (message.call_id ?? message.tool_call_id) === `call-${index + 1}`,
        );
        expect(result, `missing ${name} result`).toBeDefined();
        const parsed = JSON.parse(String(result!.output ?? result!.content)) as {
          success: boolean;
          output: string;
          error?: string;
        };
        expect(parsed.success, `${name}: ${parsed.error ?? parsed.output}`).toBe(true);
        return parsed;
      };
      expect(resultFor('Read').output).toBe(`[File: ${target} (1 lines)]\n1\tbefore-worker-edit`);
      expect(resultFor('Glob').output).toBe('editable.txt');
      expect(resultFor('Grep').output).toBe(`${target}:1:after-worker-edit`);
    } finally {
      await fixture.close();
    }
  }, 75_000);
  it('a runtime SIGTERM requests provider deletion while an actual worker shell is active', async () => {
    const fixture = await hostedWorkerCliFixture();
    const abort = new AbortController();
    const started = join(fixture.worker, 'active-shell.json');
    const program = join(fixture.worker, 'active-shell.mjs');
    let pid: number | undefined;
    try {
      writeFileSync(
        program,
        `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(started)}, JSON.stringify({pid: process.pid,cwd:process.cwd()})); setTimeout(() => {}, 5000);`,
      );
      scriptedHostedBroker(fixture.f, (_body, index) =>
        index === 0
          ? {
              tool: {
                name: 'Bash',
                arguments: JSON.stringify({
                  command: `${quote(process.execPath)} ${quote(program)}`,
                  timeout: 10_000,
                }),
              },
            }
          : { content: 'unexpected normal completion' },
      );
      const running = fixture.run(
        [
          '-p',
          'Run the active shell',
          '--permission-mode',
          'bypassPermissions',
          '--no-session-persistence',
          '--max-turns',
          '3',
        ],
        abort.signal,
      );
      await vi.waitFor(() => expect(existsSync(started)).toBe(true), { timeout: 40_000 });
      const observed = JSON.parse(readFileSync(started, 'utf8')) as { pid: number; cwd: string };
      pid = observed.pid;
      expect(observed.cwd).toBe(fixture.worker);
      const stoppingAt = Date.now();
      abort.abort();
      const result = await running;
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain('process signal stopped the hosted runtime');
      const receipts = readFileSync(fixture.receipts, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { kind?: string; sandboxId?: string; at?: number });
      expect(receipts.filter((receipt) => receipt.kind === 'delete')).toEqual([
        expect.objectContaining({
          sandboxId: fixture.f.config.worker.resource,
          at: expect.any(Number),
        }),
      ]);
      expect(receipts.find((receipt) => receipt.kind === 'delete')!.at!).toBeGreaterThanOrEqual(
        stoppingAt,
      );
      // The mock only reports provider deletion; physical descendant termination remains cloud validation.
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // The controlled shell may already have exited after provider deletion.
        }
      }
      await fixture.close();
    }
  }, 75_000);
});
