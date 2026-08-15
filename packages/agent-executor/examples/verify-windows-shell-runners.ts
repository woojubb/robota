import { createHook } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { UnsupportedShellError, resolvePlatformShell } from '@robota-sdk/agent-core';
import {
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
  type IBackgroundTaskHandle,
  type IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';

interface IShellCase {
  name: string;
  expectedObservedBasename: string;
  expectedRequestedBasename: string;
  executable?: string;
  command: string;
  sentinel: string;
}

interface ITrackedSchedule {
  handle: IBackgroundTaskHandle;
  cancelled: boolean;
}

interface IRunnerResult {
  success: true;
  executableBasename: string;
  output: string;
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function executableBasename(executable: string): string {
  return executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? executable.toLowerCase();
}

function observedExecutableBasename(output: string, caseName: string): string {
  const marker = output.match(/ARCH026_EXECUTABLE:([^\r\n]+)/)?.[1]?.trim();
  assertCondition(
    marker !== undefined && marker.length > 0,
    `${caseName} executable marker missing`,
  );
  const basename = executableBasename(marker);
  return basename === 'sh' || basename === 'bash' ? `${basename}.exe` : basename;
}

function installedExecutable(name: string): string {
  const output = execFileSync('where.exe', [name], { encoding: 'utf8' });
  const executable = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!executable) throw new Error(`Required Windows executable not found: ${name}`);
  return executable;
}

function requestFor(shellCase: IShellCase, kind: 'process' | 'scheduled'): IBackgroundTaskStart {
  const common = {
    label: `arch-026-${shellCase.name}-${kind}`,
    mode: 'background' as const,
    parentSessionId: 'session-arch-026',
    depth: 0,
    cwd: process.cwd(),
    command: shellCase.command,
    ...(shellCase.executable !== undefined ? { shell: shellCase.executable } : {}),
  };
  return {
    taskId: `${kind}-${shellCase.name}`,
    request:
      kind === 'process'
        ? { ...common, kind, timeoutMs: 15_000 }
        : { ...common, kind, cronExpression: '* * * * * *', timeoutMs: 15_000 },
  };
}

async function managedResult(shellCase: IShellCase): Promise<IRunnerResult> {
  const handle = createManagedShellProcessRunner().start(requestFor(shellCase, 'process'));
  const result = await handle.result;
  assertCondition(result.exitCode === 0, `${shellCase.name} managed exit was ${result.exitCode}`);
  assertCondition(
    result.output?.includes(shellCase.sentinel) === true,
    `${shellCase.name} managed sentinel missing`,
  );
  const basename = observedExecutableBasename(result.output ?? '', `${shellCase.name} managed`);
  assertCondition(
    basename === shellCase.expectedObservedBasename,
    `${shellCase.name} managed executable basename was ${basename}`,
  );
  return { success: true, executableBasename: basename, output: shellCase.sentinel };
}

async function waitForScheduledSentinel(
  handle: IBackgroundTaskHandle,
  sentinel: string,
): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = await handle.readLog?.({ offset: 0 });
    const output = page?.lines.join('\n') ?? '';
    if (output.includes(sentinel)) return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Scheduled sentinel timed out: ${sentinel}`);
}

async function scheduledResult(
  shellCase: IShellCase,
  schedules: ITrackedSchedule[],
): Promise<IRunnerResult & { fires: 1 }> {
  let fires = 0;
  let handle: IBackgroundTaskHandle | undefined;
  const task = requestFor(shellCase, 'scheduled');
  task.emit = (event) => {
    if (event.type !== 'background_task_waking') return;
    fires += 1;
    if (fires === 1) void handle?.pause?.();
  };
  handle = createScheduledTaskRunner().start(task);
  const tracked = { handle, cancelled: false };
  schedules.push(tracked);
  const output = await waitForScheduledSentinel(handle, shellCase.sentinel);
  await handle.cancel();
  tracked.cancelled = true;
  assertCondition(fires === 1, `${shellCase.name} scheduled fire count was ${fires}`);
  const basename = observedExecutableBasename(output, `${shellCase.name} scheduled`);
  assertCondition(
    basename === shellCase.expectedObservedBasename,
    `${shellCase.name} scheduled executable basename was ${basename}`,
  );
  return {
    success: true,
    fires: 1,
    executableBasename: basename,
    output: shellCase.sentinel,
  };
}

async function assertUnknownShellRejected(): Promise<number> {
  const unknown: IShellCase = {
    name: 'unknown',
    expectedObservedBasename: 'arch-026-unknown-shell.exe',
    expectedRequestedBasename: 'arch-026-unknown-shell.exe',
    executable: 'arch-026-unknown-shell.exe',
    command: 'must-not-spawn',
    sentinel: 'must-not-spawn',
  };
  let spawnAttempts = 0;
  const hook = createHook({
    init(_asyncId, type) {
      if (type === 'PROCESSWRAP') spawnAttempts += 1;
    },
  });
  hook.enable();
  try {
    for (const kind of ['process', 'scheduled'] as const) {
      const runner =
        kind === 'process' ? createManagedShellProcessRunner() : createScheduledTaskRunner();
      let error: unknown;
      let handle: IBackgroundTaskHandle | undefined;
      try {
        handle = runner.start(requestFor(unknown, kind));
      } catch (caught) {
        error = caught;
      } finally {
        await handle?.cancel();
      }
      assertCondition(error instanceof UnsupportedShellError, `${kind} accepted unknown shell`);
    }
  } finally {
    hook.disable();
  }
  assertCondition(spawnAttempts === 0, `Unknown shell caused ${spawnAttempts} spawn attempts`);
  return spawnAttempts;
}

async function main(): Promise<void> {
  assertCondition(process.platform === 'win32', 'Windows shell scenario requires win32');
  const originalRobotaShell = process.env['ROBOTA_SHELL'];
  const originalShell = process.env['SHELL'];
  const schedules: ITrackedSchedule[] = [];
  let failure: unknown;
  let rows: Array<Record<string, unknown>> = [];
  let unknownShellSpawnAttempts = -1;
  let environmentRestored = false;
  try {
    delete process.env['ROBOTA_SHELL'];
    delete process.env['SHELL'];
    const cases: IShellCase[] = [
      {
        name: 'default',
        expectedObservedBasename: 'powershell.exe',
        expectedRequestedBasename: 'powershell.exe',
        command:
          "$arch026Path=(Get-Process -Id $PID).Path; Write-Output ('ARCH026_EXECUTABLE:' + [IO.Path]::GetFileName($arch026Path)); Write-Output 'arch026-default'",
        sentinel: 'arch026-default',
      },
      {
        name: 'sh',
        expectedObservedBasename: 'bash.exe',
        expectedRequestedBasename: 'sh.exe',
        executable: installedExecutable('sh.exe'),
        command: `printf 'ARCH026_EXECUTABLE:%s\\n' "$(basename "$0")"; printf 'arch026-sh\\n'`,
        sentinel: 'arch026-sh',
      },
      {
        name: 'bash',
        expectedObservedBasename: 'bash.exe',
        expectedRequestedBasename: 'bash.exe',
        executable: installedExecutable('bash.exe'),
        command: `printf 'ARCH026_EXECUTABLE:%s\\n' "$(basename "$0")"; printf 'arch026-bash\\n'`,
        sentinel: 'arch026-bash',
      },
      {
        name: 'powershell',
        expectedObservedBasename: 'powershell.exe',
        expectedRequestedBasename: 'powershell.exe',
        executable: installedExecutable('powershell.exe'),
        command:
          "$arch026Path=(Get-Process -Id $PID).Path; Write-Output ('ARCH026_EXECUTABLE:' + [IO.Path]::GetFileName($arch026Path)); Write-Output 'arch026-powershell'",
        sentinel: 'arch026-powershell',
      },
      {
        name: 'pwsh',
        expectedObservedBasename: 'pwsh.exe',
        expectedRequestedBasename: 'pwsh.exe',
        executable: installedExecutable('pwsh.exe'),
        command:
          "$arch026Path=(Get-Process -Id $PID).Path; Write-Output ('ARCH026_EXECUTABLE:' + [IO.Path]::GetFileName($arch026Path)); Write-Output 'arch026-pwsh'",
        sentinel: 'arch026-pwsh',
      },
      {
        name: 'cmd',
        expectedObservedBasename: 'cmd.exe',
        expectedRequestedBasename: 'cmd.exe',
        executable: installedExecutable('cmd.exe'),
        command: 'echo ARCH026_EXECUTABLE:%COMSPEC%&& echo arch026-cmd',
        sentinel: 'arch026-cmd',
      },
    ];
    rows = [];
    for (const shellCase of cases) {
      const requestedExecutableBasename = executableBasename(
        shellCase.executable ?? resolvePlatformShell().command,
      );
      assertCondition(
        requestedExecutableBasename === shellCase.expectedRequestedBasename,
        `${shellCase.name} requested executable basename was ${requestedExecutableBasename}`,
      );
      rows.push({
        name: shellCase.name,
        requestedExecutableBasename,
        managed: await managedResult(shellCase),
        scheduled: await scheduledResult(shellCase, schedules),
      });
    }
    unknownShellSpawnAttempts = await assertUnknownShellRejected();
  } catch (error) {
    failure = error;
  } finally {
    for (const tracked of schedules) {
      if (!tracked.cancelled) {
        await tracked.handle.cancel();
        tracked.cancelled = true;
      }
    }
    originalRobotaShell === undefined
      ? delete process.env['ROBOTA_SHELL']
      : (process.env['ROBOTA_SHELL'] = originalRobotaShell);
    originalShell === undefined
      ? delete process.env['SHELL']
      : (process.env['SHELL'] = originalShell);
    environmentRestored =
      process.env['ROBOTA_SHELL'] === originalRobotaShell && process.env['SHELL'] === originalShell;
  }
  if (failure !== undefined) throw failure;
  const output = {
    rows,
    summary: {
      runnerCases: rows.length * 2,
      unknownShellZeroSpawns: unknownShellSpawnAttempts === 0,
      unknownShellSpawnAttempts,
      scheduledHandlesCancelled: schedules.every((entry) => entry.cancelled),
      environmentRestored,
    },
  };
  assertCondition(output.summary.runnerCases === 12, 'Expected 12 runner cases');
  assertCondition(output.summary.scheduledHandlesCancelled, 'Scheduled cleanup failed');
  assertCondition(output.summary.environmentRestored, 'Environment restoration failed');
  const serialized = `${JSON.stringify(output)}\n`;
  const outputPath = process.env['ROBOTA_SCENARIO_OUTPUT'];
  if (outputPath) writeFileSync(outputPath, serialized, 'utf8');
  process.stdout.write(serialized);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
