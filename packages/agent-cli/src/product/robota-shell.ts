import { resolvePlatformShell } from '@robota-sdk/agent-core';

/** Robota's host policy; neutral packages only receive the selected executable. */
export function resolveRobotaShellExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const executable = env['ROBOTA_SHELL']?.trim();
  if (!executable) return undefined;
  return resolvePlatformShell({ executable }).command;
}
