import { resolvePlatformShell } from '@robota-sdk/agent-core';

/** Minimal command shape shared by process and scheduled background-task requests. */
export interface IBackgroundTaskShellCommand {
  readonly command: string;
  readonly shell?: string;
}

/** Pure environment/host inputs for deterministic adapter verification. */
export interface IBackgroundTaskShellResolutionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

/** The inseparable executable and matching non-interactive argument family passed to spawn. */
export interface IResolvedBackgroundTaskShellCommand {
  readonly executable: string;
  readonly args: string[];
}

/** Project a background-task command request through agent-core's shell-resolution SSOT. */
export function resolveBackgroundTaskShellCommand(
  request: IBackgroundTaskShellCommand,
  options: IBackgroundTaskShellResolutionOptions = {},
): IResolvedBackgroundTaskShellCommand {
  const shell = resolvePlatformShell({
    ...(request.shell !== undefined ? { executable: request.shell } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
  });
  return { executable: shell.command, args: shell.commandArgs(request.command) };
}
