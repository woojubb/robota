import { createHook } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { UnsupportedShellError, resolvePlatformShell } from '@robota-sdk/agent-core/node';
import type { IBackgroundTaskHandle, IBackgroundTaskStart } from '@robota-sdk/agent-executor';
import {
  createManagedShellProcessRunner,
  createScheduledTaskRunner,
} from '@robota-sdk/agent-executor/node';

interface IShellCase {
  name: string;
  expectedObservedBasename: string;
  expectedRequestedBasename: string;
  executable?: string;
  command: string;
  sentinel: string;
}

type TTrackedSchedule = { handle: IBackgroundTaskHandle; cancelled: boolean };

type TRunnerResult = { success: true; executableBasename: string; output: string };

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function executableBasename(executable: string): string {
  return executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? executable.toLowerCase();
}

function observedExecutableBasename(output: string, caseName: string): string {
  const marker = output.match(/SHELL_EXECUTABLE:([^\r\n]+)/)?.[1]?.trim();
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

function requestFor(shellCase: IShellCase, kind: 'process'): IBackgroundTaskStart<'process'>;
function requestFor(shellCase: IShellCase, kind: 'scheduled'): IBackgroundTaskStart<'scheduled'>;
function requestFor(
  shellCase: IShellCase,
  kind: 'process' | 'scheduled',
): IBackgroundTaskStart<'process'> | IBackgroundTaskStart<'scheduled'> {
  const common = {
    label: `windows-shell-${shellCase.name}-${kind}`,
    mode: 'background' as const,
    parentSessionId: 'session-windows-shell-runners',
    depth: 0,
    cwd: process.cwd(),
    command: shellCase.command,
    ...(shellCase.executable !== undefined ? { shell: shellCase.executable } : {}),
  };
  if (kind === 'process') {
    return { taskId: `${kind}-${shellCase.name}`, request: { ...common, kind, timeoutMs: 15_000 } };
  }
  return {
    taskId: `${kind}-${shellCase.name}`,
    request: { ...common, kind, cronExpression: '* * * * * *', timeoutMs: 15_000 },
  };
}

async function managedResult(shellCase: IShellCase): Promise<TRunnerResult> {
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
  schedules: TTrackedSchedule[],
): Promise<TRunnerResult & { fires: 1 }> {
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
    expectedObservedBasename: 'unknown-shell.exe',
    expectedRequestedBasename: 'unknown-shell.exe',
    executable: 'unknown-shell.exe',
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
      let error: unknown;
      let handle: IBackgroundTaskHandle | undefined;
      try {
        handle =
          kind === 'process'
            ? createManagedShellProcessRunner().start(requestFor(unknown, 'process'))
            : createScheduledTaskRunner().start(requestFor(unknown, 'scheduled'));
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
  const originalFixtureShell = process.env['FIXTURE_SHELL'];
  const originalShell = process.env['SHELL'];
  const schedules: TTrackedSchedule[] = [];
  let failure: unknown;
  let rows: Array<Record<string, unknown>> = [];
  let unknownShellSpawnAttempts = -1;
  let environmentRestored = false;
  try {
    delete process.env['FIXTURE_SHELL'];
    delete process.env['SHELL'];
    const cases: IShellCase[] = [
      {
        name: 'default',
        expectedObservedBasename: 'powershell.exe',
        expectedRequestedBasename: 'powershell.exe',
        command:
          "$shellPath=(Get-Process -Id $PID).Path; Write-Output ('SHELL_EXECUTABLE:' + [IO.Path]::GetFileName($shellPath)); Write-Output 'shell-default'",
        sentinel: 'shell-default',
      },
      {
        name: 'sh',
        expectedObservedBasename: 'bash.exe',
        expectedRequestedBasename: 'sh.exe',
        executable: installedExecutable('sh.exe'),
        command: `printf 'SHELL_EXECUTABLE:%s\\n' "$(basename "$0")"; printf 'shell-sh\\n'`,
        sentinel: 'shell-sh',
      },
      {
        name: 'bash',
        expectedObservedBasename: 'bash.exe',
        expectedRequestedBasename: 'bash.exe',
        executable: installedExecutable('bash.exe'),
        command: `printf 'SHELL_EXECUTABLE:%s\\n' "$(basename "$0")"; printf 'shell-bash\\n'`,
        sentinel: 'shell-bash',
      },
      {
        name: 'powershell',
        expectedObservedBasename: 'powershell.exe',
        expectedRequestedBasename: 'powershell.exe',
        executable: installedExecutable('powershell.exe'),
        command:
          "$shellPath=(Get-Process -Id $PID).Path; Write-Output ('SHELL_EXECUTABLE:' + [IO.Path]::GetFileName($shellPath)); Write-Output 'shell-powershell'",
        sentinel: 'shell-powershell',
      },
      {
        name: 'pwsh',
        expectedObservedBasename: 'pwsh.exe',
        expectedRequestedBasename: 'pwsh.exe',
        executable: installedExecutable('pwsh.exe'),
        command:
          "$shellPath=(Get-Process -Id $PID).Path; Write-Output ('SHELL_EXECUTABLE:' + [IO.Path]::GetFileName($shellPath)); Write-Output 'shell-pwsh'",
        sentinel: 'shell-pwsh',
      },
      {
        name: 'cmd',
        expectedObservedBasename: 'cmd.exe',
        expectedRequestedBasename: 'cmd.exe',
        executable: installedExecutable('cmd.exe'),
        command: 'echo SHELL_EXECUTABLE:%COMSPEC%&& echo shell-cmd',
        sentinel: 'shell-cmd',
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
    originalFixtureShell === undefined
      ? delete process.env['FIXTURE_SHELL']
      : (process.env['FIXTURE_SHELL'] = originalFixtureShell);
    originalShell === undefined
      ? delete process.env['SHELL']
      : (process.env['SHELL'] = originalShell);
    environmentRestored =
      process.env['FIXTURE_SHELL'] === originalFixtureShell && process.env['SHELL'] === originalShell;
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
  const outputPath = process.env['PRODUCT_SCENARIO_OUTPUT'];
  if (outputPath) writeFileSync(outputPath, serialized, 'utf8');
  process.stdout.write(serialized);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
