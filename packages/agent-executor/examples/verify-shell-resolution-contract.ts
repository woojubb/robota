import { createHook } from 'node:async_hooks';

import { UnsupportedShellError } from '@robota-sdk/agent-core';
import {
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
  resolveBackgroundTaskShellCommand,
  type IBackgroundTaskHandle,
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

async function assertUnknownShellZeroSpawns(): Promise<number> {
  let spawnAttempts = 0;
  const hook = createHook({
    init(_asyncId, type) {
      if (type === 'PROCESSWRAP') spawnAttempts += 1;
    },
  });
  hook.enable();
  try {
    for (const runner of [createManagedShellProcessRunner(), createScheduledTaskRunner()]) {
      let error: unknown;
      let handle: IBackgroundTaskHandle | undefined;
      try {
        handle = runner.start(unknownTask(runner.kind === 'process' ? 'process' : 'scheduled'));
      } catch (caught) {
        error = caught;
      } finally {
        await handle?.cancel();
      }
      assertCondition(
        error instanceof UnsupportedShellError,
        `${runner.kind} accepted unknown shell`,
      );
    }
  } finally {
    hook.disable();
  }
  assertCondition(spawnAttempts === 0, `Unknown shell caused ${spawnAttempts} spawn attempts`);
  return spawnAttempts;
}

async function main(): Promise<void> {
  const rows = matrix.map(({ name, command, options, ...request }) => ({
    name,
    ...resolveBackgroundTaskShellCommand({ command, ...request }, options),
  }));
  const expectedRows = [
    { name: 'posix-default', executable: '/bin/sh', args: ['-c', 'sentinel-posix'] },
    {
      name: 'windows-default',
      executable: 'powershell.exe',
      args: ['-NoProfile', '-Command', 'sentinel-powershell'],
    },
    {
      name: 'windows-bash',
      executable: 'C:\\Git\\bin\\BASH.EXE',
      args: ['-c', 'sentinel-bash'],
    },
    {
      name: 'posix-pwsh',
      executable: '/opt/microsoft/pwsh',
      args: ['-NoProfile', '-Command', 'sentinel-pwsh'],
    },
    {
      name: 'posix-cmd',
      executable: '/windows/System32/CMD.exe',
      args: ['/d', '/s', '/c', 'sentinel-cmd'],
    },
    { name: 'blank-request', executable: '/bin/bash', args: ['-c', 'sentinel-blank'] },
  ];
  assertCondition(JSON.stringify(rows) === JSON.stringify(expectedRows), 'Shell matrix drifted');
  const unknownShellSpawnAttempts = await assertUnknownShellZeroSpawns();
  process.stdout.write(
    `${JSON.stringify({ rows, unknownShellZeroSpawns: unknownShellSpawnAttempts === 0, unknownShellSpawnAttempts })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
