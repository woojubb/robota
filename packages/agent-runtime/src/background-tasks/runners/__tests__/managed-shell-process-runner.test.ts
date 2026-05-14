import { describe, expect, it } from 'vitest';
import { createManagedShellProcessRunner } from '../managed-shell-process-runner.js';
import type { IBackgroundTaskHandle, IBackgroundTaskStart } from '../../types.js';

const TEST_PROCESS_TIMEOUT_MS = 30_000;
const VITEST_PROCESS_TEST_TIMEOUT_MS = 20_000;

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function makeTask(command: string): IBackgroundTaskStart {
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
