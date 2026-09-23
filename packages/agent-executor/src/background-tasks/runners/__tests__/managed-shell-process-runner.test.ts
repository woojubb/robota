import { spawn as spawnMock } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedShellProcessRunner } from '../managed-shell-process-runner.js';
import type { IBackgroundTaskHandle, IBackgroundTaskStart } from '../../types.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const TEST_PROCESS_TIMEOUT_MS = 30_000;
const VITEST_PROCESS_TEST_TIMEOUT_MS = 20_000;

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function makeTask(command: string, env?: Record<string, string>): IBackgroundTaskStart {
  return {
    taskId: 'process_1',
    request: {
      kind: 'process',
      label: command,
      mode: 'background',
      parentSessionId: 'session_1',
      depth: 0,
      cwd: process.cwd(),
      command,
      timeoutMs: TEST_PROCESS_TIMEOUT_MS,
      ...(env ? { env } : {}),
    },
  };
}

async function readLog(handle: IBackgroundTaskHandle): Promise<string[]> {
  if (!handle.readLog) throw new Error('readLog should be supported');
  const page = await handle.readLog({ offset: 0 });
  return page.lines;
}

describe('createManagedShellProcessRunner', () => {
  it(
    'runs a shell command and exposes captured output as a process result',
    async () => {
      const runner = createManagedShellProcessRunner();
      const command = nodeCommand(
        "process.stdout.write('hello'); process.stderr.write('warn'); process.exit(0);",
      );

      const handle = runner.start(makeTask(command));
      const result = await handle.result;
      const lines = await readLog(handle);

      expect(result).toMatchObject({
        taskId: 'process_1',
        kind: 'process',
        exitCode: 0,
      });
      expect(result.output).toContain('hello');
      expect(result.output).toContain('warn');
      expect(lines.join('\n')).toContain('[stdout] hello');
      expect(lines.join('\n')).toContain('[stderr] warn');
    },
    VITEST_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    'supports stdin writes for running processes',
    async () => {
      const runner = createManagedShellProcessRunner();
      const command = 'cat';

      const handle = runner.start(makeTask(command));
      await handle.send?.({ stdin: 'from stdin' });
      const result = await handle.result;

      expect(result.output).toContain('from stdin');
    },
    VITEST_PROCESS_TEST_TIMEOUT_MS,
  );

  it(
    'returns paged log lines with a next cursor',
    async () => {
      const runner = createManagedShellProcessRunner();
      const command = nodeCommand(
        "for (let i = 0; i < 205; i += 1) process.stdout.write('line-' + i + '\\n');",
      );

      const handle = runner.start(makeTask(command));
      await handle.result;
      if (!handle.readLog) throw new Error('readLog should be supported');
      const firstPage = await handle.readLog({ offset: 0 });
      const secondPage = await handle.readLog(firstPage.nextCursor);

      expect(firstPage.lines).toHaveLength(200);
      expect(firstPage.nextCursor).toEqual({ offset: 200 });
      expect(secondPage.lines).toHaveLength(5);
    },
    VITEST_PROCESS_TEST_TIMEOUT_MS,
  );
});

/**
 * The shell executable must be resolved from the HOST environment through the agent-core SSOT
 * (`resolvePlatformShell`), never as a bare `sh` looked up in the merged — caller-controlled — `PATH`.
 */
describe.skipIf(process.platform === 'win32')(
  'createManagedShellProcessRunner shell resolution',
  () => {
    const createdDirs: string[] = [];

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.mocked(spawnMock).mockClear();
      for (const dir of createdDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    /** A directory holding an executable named `sh` that ignores its args and reports the hijack. */
    function hijackedShellDir(): string {
      const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'shell-hijack-')));
      createdDirs.push(dir);
      const hijack = path.join(dir, 'sh');
      writeFileSync(hijack, '#!/bin/sh\nprintf HIJACKED\n', 'utf8');
      chmodSync(hijack, 0o755);
      return dir;
    }

    it(
      'spawns an absolute shell path, not the bare name "sh"',
      async () => {
        vi.stubEnv('SHELL', '/bin/sh');
        const runner = createManagedShellProcessRunner();

        const handle = runner.start(makeTask(nodeCommand("process.stdout.write('ok');")));
        await handle.result;

        const command = vi.mocked(spawnMock).mock.calls[0]?.[0];
        expect(command).not.toBe('sh');
        expect(typeof command === 'string' && path.isAbsolute(command)).toBe(true);
      },
      VITEST_PROCESS_TEST_TIMEOUT_MS,
    );

    it(
      'a caller-supplied PATH cannot redirect which shell binary runs',
      async () => {
        vi.stubEnv('SHELL', '/bin/sh');
        const runner = createManagedShellProcessRunner();
        const command = nodeCommand("process.stdout.write('ok');");

        const handle = runner.start(makeTask(command, { PATH: hijackedShellDir() }));
        const result = await handle.result;

        expect(result.output).not.toContain('HIJACKED');
        expect(result.output).toContain('ok');
      },
      VITEST_PROCESS_TEST_TIMEOUT_MS,
    );
  },
);
