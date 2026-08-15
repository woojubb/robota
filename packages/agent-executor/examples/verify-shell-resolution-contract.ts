import { UnsupportedShellError } from '@robota-sdk/agent-core';
import {
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
  resolveBackgroundTaskShellCommand,
  type IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const matrix = [
  {
    name: 'posix-default',
    command: 'sentinel-posix',
    options: { env: {}, platform: 'linux' as const },
  },
  {
    name: 'windows-default',
    command: 'sentinel-powershell',
    options: { env: {}, platform: 'win32' as const },
  },
  {
    name: 'windows-bash',
    command: 'sentinel-bash',
    shell: 'C:\\Git\\bin\\BASH.EXE',
    options: { env: { ROBOTA_SHELL: 'powershell.exe' }, platform: 'win32' as const },
  },
  {
    name: 'posix-pwsh',
    command: 'sentinel-pwsh',
    shell: '/opt/microsoft/pwsh',
    options: { env: { SHELL: '/bin/sh' }, platform: 'linux' as const },
  },
  {
    name: 'posix-cmd',
    command: 'sentinel-cmd',
    shell: '/windows/System32/CMD.exe',
    options: { env: {}, platform: 'darwin' as const },
  },
  {
    name: 'blank-request',
    command: 'sentinel-blank',
    shell: '   ',
    options: { env: { ROBOTA_SHELL: '/bin/bash' }, platform: 'linux' as const },
  },
] as const;

function unknownTask(kind: 'process' | 'scheduled'): IBackgroundTaskStart {
  const common = {
    label: `unknown-${kind}`,
    mode: 'background' as const,
    parentSessionId: 'session-arch-026',
    depth: 0,
    cwd: process.cwd(),
    command: 'must-not-spawn',
    shell: '/opt/unknown-shell',
  };
  return {
    taskId: `unknown-${kind}`,
    request:
      kind === 'process' ? { ...common, kind } : { ...common, kind, cronExpression: '* * * * *' },
  };
}

function assertUnknownShellZeroSpawns(): void {
  for (const runner of [createManagedShellProcessRunner(), createScheduledTaskRunner()]) {
    let error: unknown;
    try {
      runner.start(unknownTask(runner.kind === 'process' ? 'process' : 'scheduled'));
    } catch (caught) {
      error = caught;
    }
    assertCondition(
      error instanceof UnsupportedShellError,
      `${runner.kind} accepted unknown shell`,
    );
  }
}

function main(): void {
  const rows = matrix.map(({ name, command, options, ...request }) => ({
    name,
    ...resolveBackgroundTaskShellCommand({ command, ...request }, options),
  }));
  assertUnknownShellZeroSpawns();
  process.stdout.write(`${JSON.stringify({ rows, unknownShellZeroSpawns: true })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
