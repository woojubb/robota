import type { ISubagentSpawnRequest } from './types.js';

/**
 * The directory a spawned subagent actually runs in. ARCH-010.
 *
 * `ISubagentSpawnRequest.cwd` has always been REQUIRED, but neither runner read it: the in-process
 * one had no session option to pass it to, and the child-process worker called `createDefaultTools()`
 * with no argument at all. Both children therefore fell back to `process.cwd()` — the PARENT's
 * directory — and their file tools, with no containment root, had no boundary. That is the breach the
 * audit measured: a subagent `Read` of `/etc/hostname` returned the file.
 *
 * A worktree-isolated job runs in its WORKTREE. Isolating a subagent into a worktree and then running
 * it in the parent's checkout would defeat the isolation entirely, so the worktree wins when present.
 *
 * One implementation rather than the same expression at each runner, because two copies of a rule
 * about which root a subagent runs in can disagree — and a subagent running in a root nobody intended
 * is exactly the defect this closes.
 */
export function subagentExecutionRoot(request: ISubagentSpawnRequest): string {
  return request.worktreePath ?? request.cwd;
}
