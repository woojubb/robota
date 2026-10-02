/** Cleanup of the local transport simulation, not a claim about cloud VM deletion. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

describe('hosted worker fixture cleanup', () => {
  it.each(['close', 'timeout'] as const)(
    'drains an active run on %s',
    async (cause) => {
      const fixture = await hostedWorkerCliFixture(
        {},
        cause === 'timeout' ? { runTimeoutMs: 45000 } : {},
      );
      const abort = new AbortController();
      const observation = mkdtempSync(join(tmpdir(), 'hosted-cleanup-observation-'));
      const marker = join(observation, 'heartbeat');
      const pidFile = join(observation, 'pid');
      const program = join(fixture.worker, 'heartbeat.mjs');
      let closed = false;
      let running: Promise<unknown> | undefined;
      try {
        writeFileSync(
          program,
          `import {writeFileSync} from 'node:fs'; const path = ${JSON.stringify(marker)}; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); writeFileSync(path, String(Date.now())); const timer = setInterval(() => writeFileSync(path, String(Date.now())), 50); setTimeout(() => clearInterval(timer), 60000);`,
        );
        scriptedHostedBroker(fixture.f, (_body, index) =>
          index === 0
            ? {
                tool: {
                  name: 'Bash',
                  arguments: JSON.stringify({
                    command: `${quote(process.execPath)} ${quote(program)}`,
                    timeout: 65000,
                  }),
                },
              }
            : { content: 'normal completion' },
        );
        running = fixture
          .run(
            [
              '-p',
              'Run cleanup probe',
              '--permission-mode',
              'bypassPermissions',
              '--no-session-persistence',
            ],
            abort.signal,
          )
          .then(
            (result) => ({ result }),
            (error: unknown) => ({ error }),
          );
        await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 40000 });
        if (cause === 'close') {
          await fixture.close();
          closed = true;
        }
        const outcome = await Promise.race([
          running,
          new Promise((resolve) =>
            setTimeout(() => resolve('still running'), cause === 'timeout' ? 46000 : 1500),
          ),
        ]);
        expect(outcome).not.toBe('still running');
        if (cause === 'timeout')
          expect(outcome).toEqual({ error: new Error('hosted worker fixture did not settle') });
        const stopped = readFileSync(marker, 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(readFileSync(marker, 'utf8')).toBe(stopped);
      } finally {
        abort.abort();
        if (existsSync(pidFile)) {
          try {
            process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL');
          } catch {
            /* The controlled probe may already have exited. */
          }
        }
        await running;
        if (!closed) await fixture.close();
        rmSync(observation, { recursive: true, force: true });
      }
    },
    75000,
  );
});
