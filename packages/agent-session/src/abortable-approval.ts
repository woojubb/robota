import type { TPermissionResult } from './permission-types.js';
import type { ITerminalOutput, TToolArgs } from '@robota-sdk/agent-core';

/**
 * Wait for an approval, or for the turn to be cancelled — whichever happens first.
 *
 * RUNTIME-005: a human-approval prompt is a wait with no natural end. `abort()` reached the provider
 * and the tool-start check but not this, so a turn parked here ran until somebody answered, and since
 * RUNTIME-003 holds the session's claim until the turn unwinds, the session stayed busy with no way
 * for the caller to clear it short of discarding it.
 *
 * A cancelled approval resolves to `false`, NOT to a rejection and never to `true`. Two reasons, and
 * the first is the load-bearing one:
 *
 * - **Fail closed.** If cancelling read as approval, aborting a turn would become a way to run an
 *   unapproved tool. Denial is the same answer the enforcer already gives when no approver is
 *   attached.
 * - The caller (`permission-enforcer`'s tool wrapper) must never throw — a throw there records an
 *   assistant `tool_use` with no matching `tool_result` and corrupts the conversation.
 *
 * The listener is removed on every path, so an approval that arrives after the abort does not keep a
 * handler alive on a long-lived signal.
 */
async function raceAbort(
  approval: Promise<TPermissionResult>,
  signal?: AbortSignal,
): Promise<TPermissionResult> {
  if (signal === undefined) return approval;
  if (signal.aborted) return false;

  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      approval,
      new Promise<TPermissionResult>((resolve) => {
        onAbort = (): void => resolve(false);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * What an approval RESULT means, in one place.
 *
 * The two prompt paths — a consumer `permissionHandler` and an injected `promptForApprovalFn` —
 * interpreted `allow-session` / `allow-project` identically, in two copies. Two readings of "does
 * this answer grant permission" that can drift is the shape this repository keeps removing; and the
 * caller now only has to know WHICH prompt to run, not what its answer implies.
 *
 * Side effects are returned rather than performed, so this stays a pure decision the enforcer applies.
 */
interface IApprovalOutcome {
  allowed: boolean;
  rememberForSession: boolean;
  rememberForProject: boolean;
}

function interpretApproval(result: TPermissionResult): IApprovalOutcome {
  if (result === 'allow-session') {
    return { allowed: true, rememberForSession: true, rememberForProject: false };
  }
  if (result === 'allow-project') {
    return { allowed: true, rememberForSession: true, rememberForProject: true };
  }
  return { allowed: result === true, rememberForSession: false, rememberForProject: false };
}

/**
 * The whole human-approval path: allow-list, cancellation, prompt, and what the answer means.
 *
 * Moved out of the enforcer when RUNTIME-005 pushed it past its size ceiling, and the seam is real
 * rather than convenient — this decides whether a human said yes, while the enforcer decides whether
 * a human is asked at all. Side effects come back as flags so the enforcer keeps ownership of its own
 * allow lists.
 *
 * A human-approval prompt is a wait with NO NATURAL END, which is why the signal matters here more
 * than anywhere else in the permission path: without it an aborted turn parked on a prompt ran until
 * somebody answered, and the session stayed claimed. Cancelling DENIES — a cancelled approval must
 * never read as approval, or aborting a turn becomes a way to run an unapproved tool.
 */
export interface IApprovalRequest {
  toolName: string;
  toolArgs: TToolArgs;
  alreadyAllowed: boolean;
  /** A consumer-supplied handler. Takes precedence over `injectedPrompt`, as it always did. */
  handler?: (toolName: string, toolArgs: TToolArgs) => Promise<TPermissionResult>;
  injectedPrompt?: (
    terminal: ITerminalOutput,
    toolName: string,
    toolArgs: TToolArgs,
  ) => Promise<TPermissionResult>;
  terminal?: ITerminalOutput;
  signal?: AbortSignal;
}

export async function decideApproval(request: IApprovalRequest): Promise<IApprovalOutcome> {
  const denied: IApprovalOutcome = {
    allowed: false,
    rememberForSession: false,
    rememberForProject: false,
  };
  if (request.alreadyAllowed) {
    return { allowed: true, rememberForSession: false, rememberForProject: false };
  }
  // RUNTIME-005: a turn already cancelled asks nobody. Prompting here would put a question on screen
  // for work that is not going to happen.
  if (request.signal?.aborted === true) return denied;
  // Which prompt to run is this module's business too: the enforcer supplies the approvers it has
  // and does not decide between them.
  const prompt = request.handler
    ? (): Promise<TPermissionResult> => request.handler!(request.toolName, request.toolArgs)
    : request.injectedPrompt && request.terminal
      ? (): Promise<TPermissionResult> =>
          request.injectedPrompt!(request.terminal!, request.toolName, request.toolArgs)
      : undefined;
  // No approval mechanism available — deny by default.
  if (prompt === undefined) return denied;
  return interpretApproval(await raceAbort(prompt(), request.signal));
}
