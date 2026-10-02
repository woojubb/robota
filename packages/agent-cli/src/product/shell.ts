import { resolvePlatformShell } from '@robota-sdk/agent-core';

/** The product's host policy; neutral packages only receive the selected executable. */
export function resolveProductShellExecutable(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const executable = env['PRODUCT_SHELL']?.trim();
  if (!executable) return undefined;
  return resolvePlatformShell({ executable }).command;
}
