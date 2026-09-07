/**
 * `/fork [name] [--same-dir]` (CLI-1994, issue #1994) — copy this conversation into a background
 * session and keep working here.
 *
 * The two halves are deliberately separate calls to two different capabilities, because they are two
 * different facts. `forkSession` writes a COPY of the live conversation as a new session record: the
 * messages, the parent's assembled system message, the tool schemas and the transcript, under a
 * fresh id and a name that is not the parent's. Spawning then starts a background agent job that
 * carries ONLY that id — the conversation never rides on the request, so it never crosses the
 * child-process wire (ARCH-044); the child reads the record from the session store, exactly as the
 * startup `--fork-session` does.
 *
 * A fork is a copy, not a branch of one live thing: from the moment the record is written, work in
 * the fork and work here are two histories that never rejoin. Attaching to the fork later (the
 * background panel's `attach` control) switches the terminal's VIEW to that session; it does not
 * merge anything back.
 */

import type { ICommandHostAgentJobs, ICommandHostSessionAccess } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { TBackgroundTaskIsolation } from '@robota-sdk/agent-interface-execution';

/** What `/fork` needs from its host: the copy-writer and the job dispatcher. */
export type TForkCommandContext = ICommandHostSessionAccess & ICommandHostAgentJobs;

/**
 * The fork runs in its own worktree by DEFAULT.
 *
 * A spawned job inherits the parent's cwd, so a fork that keeps working in the same directory writes
 * over the files the parent is still editing — the "work in it does not affect the original"
 * property lost through the filesystem rather than through the conversation. `--same-dir` is the
 * explicit opt-out for a fork that is meant to read and think rather than to edit.
 */
const DEFAULT_ISOLATION: TBackgroundTaskIsolation = 'worktree';
const SAME_DIR_ISOLATION: TBackgroundTaskIsolation = 'none';
const SAME_DIR_FLAG = '--same-dir';

/** The agent a forked conversation continues under — the general one, since the fork IS the context. */
const FORK_AGENT_TYPE = 'general-purpose';

/**
 * The fork's first turn input.
 *
 * A fork inherits the parent's whole conversation and its assembled system message, so there is
 * nothing left to brief it about — this is a minimal continuation cue, deliberately NOT a prompt.
 * The spec asked for an empty string; a turn with no user content is rejected by providers, and one
 * word is the smallest thing that is not. Anything longer would be this neutral command layer
 * deciding how a forked agent should behave, which is the product layer's call
 * (`scan-prompt-prose` is the mechanical form of that rule).
 */
const FORK_FIRST_TURN = 'Continue.';

export interface IParsedForkArgs {
  readonly name: string | undefined;
  readonly isolation: TBackgroundTaskIsolation;
}

/** A rejected argument string, kept distinct from a parse so neither can be read as the other. */
export interface IForkArgsError {
  readonly error: string;
}

/**
 * `--same-dir` may appear anywhere; everything else is the name.
 *
 * An unrecognised `--flag` is REFUSED rather than folded into the name: a mistyped `--same-dr` that
 * became a session called "--same-dr" would silently give the operator a worktree they asked not to
 * have, and the name is the one field they will later use to find the fork.
 */
export function parseForkArgs(args: string): IParsedForkArgs | IForkArgsError {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const unknownFlag = tokens.find((token) => token.startsWith('--') && token !== SAME_DIR_FLAG);
  if (unknownFlag !== undefined) {
    return { error: `Unknown option: ${unknownFlag}\nUsage: /fork [name] [${SAME_DIR_FLAG}]` };
  }
  const nameTokens = tokens.filter((token) => token !== SAME_DIR_FLAG);
  return {
    name: nameTokens.length > 0 ? nameTokens.join(' ') : undefined,
    isolation: tokens.includes(SAME_DIR_FLAG) ? SAME_DIR_ISOLATION : DEFAULT_ISOLATION,
  };
}

function formatError<TError>(error: TError): string {
  return error instanceof Error ? error.message : String(error);
}

function describeFork(name: string, taskId: string, isolation: TBackgroundTaskIsolation): string {
  const where = isolation === SAME_DIR_ISOLATION ? 'in this directory' : 'in its own worktree';
  return [
    `Forked this conversation into "${name}" (${taskId}), running ${where}.`,
    'The fork is a copy: this session keeps going, and the two are separate records.',
    'See it with /background list; attach to it from the background panel.',
  ].join('\n');
}

/**
 * The copy is on disk and the job is not. Both facts are reported, because the record is still
 * resumable by name and an operator told only "failed" would not know that.
 */
function describeSpawnFailure(fork: { sessionId: string; name: string }, reason: string): string {
  return (
    `The fork "${fork.name}" was written (${fork.sessionId}) but its background job could not ` +
    `start: ${reason}\nResume it in a new terminal with: robota --resume "${fork.name}"`
  );
}

export async function executeForkCommand(
  context: TForkCommandContext,
  args = '',
): Promise<ICommandResult> {
  const parsed = parseForkArgs(args);
  if ('error' in parsed) return { message: parsed.error, success: false };

  const jobs = context.getAgentJobCapability();
  if (!jobs) {
    return {
      message: 'This session cannot start background jobs, so it cannot run a fork.',
      success: false,
    };
  }

  // The copy is written FIRST, and a failure here is reported without spawning: a job that resumes a
  // record which was never written is a child that fails on its own far side, out of the operator's
  // sight.
  let fork: { sessionId: string; name: string };
  try {
    fork = await context.forkSession(parsed.name !== undefined ? { name: parsed.name } : {});
  } catch (error) {
    return { message: `Could not fork this session: ${formatError(error)}`, success: false };
  }

  try {
    const state = await jobs.spawnAgentJob({
      agentType: FORK_AGENT_TYPE,
      label: fork.name,
      mode: 'background',
      prompt: FORK_FIRST_TURN,
      isolation: parsed.isolation,
      resumeSessionId: fork.sessionId,
    });
    return {
      message: describeFork(fork.name, state.id, parsed.isolation),
      success: true,
      data: { sessionId: fork.sessionId, name: fork.name, taskId: state.id },
    };
  } catch (error) {
    return { message: describeSpawnFailure(fork, formatError(error)), success: false };
  }
}
