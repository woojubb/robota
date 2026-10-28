/** Cleanup of the local transport simulation, not a claim about cloud VM deletion. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
const TIMEOUT_PROBE_MS = 3_000;
const STARTUP_MARGIN_MS = 2_000;
const SETTLEMENT_MARGIN_MS = 1_000;

describe('hosted worker fixture cleanup', () => {
  it.each(['close', 'timeout'] as const)(
    'drains an active run on %s',
    async (cause) => {
      const fixture = await hostedWorkerCliFixture(
        {},
        cause === 'timeout' ? { runTimeoutMs: TIMEOUT_PROBE_MS } : {},
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
          `import {writeFileSync} from 'node:fs'; const path = ${JSON.stringify(marker)}; writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); writeFileSync(path, String(Date.now())); const timer = setInterval(() => writeFileSync(path, String(Date.now())), 50); setTimeout(() => clearInterval(timer), 30000);`,
        );
        running = fixture.runFixtureProcess(program, abort.signal).then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
        await vi.waitFor(() => expect(existsSync(marker)).toBe(true), {
          timeout: STARTUP_MARGIN_MS,
        });
        if (cause === 'close') {
          await fixture.close();
          closed = true;
        }
        const outcome = await Promise.race([
          running,
          new Promise((resolve) =>
            setTimeout(
              () => resolve('still running'),
              cause === 'timeout' ? TIMEOUT_PROBE_MS + SETTLEMENT_MARGIN_MS : 1_500,
            ),
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
    6_000,
  );
});
