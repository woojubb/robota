import { relative, resolve } from 'node:path';

/** Convert a host cwd into the authenticated project's relative prompt-resolution start. */
export function resolveProjectPromptStart(worktreeRoot: string, cwd: string): string {
  return relative(worktreeRoot, resolve(cwd));
}
