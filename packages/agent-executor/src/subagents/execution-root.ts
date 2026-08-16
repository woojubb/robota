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
 *
 * ARCH-031: reads the runner ENVELOPE, not the request. The worktree does not exist when a caller
 * builds a request — `ISubagentWorktreeAdapter.prepare()` creates it inside the runner — so the
 * worktree identity is runner-produced and belongs on `ISubagentJobStart`. It used to be written back
 * onto the request, which also meant the runner overwrote `request.cwd` with the same path, giving
 * this rule two carriers that could disagree. Now there is one.
 */
export function subagentExecutionRoot(job: ISubagentExecutionEnvelope): string {
  return job.worktree?.path ?? job.request.cwd;
}

/**
 * The structural minimum this rule needs. Deliberately not `ISubagentJobStart`: the child-process
 * worker answers the same question from its IPC payload, which is a different envelope carrying the
 * same two facts. One rule, both callers, no second copy of the expression.
 */
export interface ISubagentExecutionEnvelope {
  readonly request: Pick<ISubagentSpawnRequest, 'cwd'>;
  readonly worktree?: { readonly path: string };
}
