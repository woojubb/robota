import { isAbsolutePath, relativePath, resolvePath } from '@robota-sdk/agent-core';

/**
 * Convert a host cwd into the authenticated project's relative prompt-resolution start. The cwd is
 * absolute: a relative one names a place only the process directory could say, which a neutral
 * library does not read.
 */
export function resolveProjectPromptStart(worktreeRoot: string, cwd: string): string {
  if (!isAbsolutePath(cwd)) {
    throw new Error(`The session working directory must be absolute, got ${JSON.stringify(cwd)}.`);
  }
  return relativePath(worktreeRoot, resolvePath(cwd, '.'));
}
