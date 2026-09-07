/**
 * CLI-1994: the record an in-session fork writes.
 *
 * A fork is a COPY of the live conversation under a fresh id — the same thing the startup
 * `--fork-session` produces, built from the live session instead of from a stored record so it can
 * be taken from inside the conversation, after the expensive context is already there. The copy
 * carries what a fork inherits (the messages, the ASSEMBLED system message, the tool schemas, the
 * full history) and omits what the startup fork already refuses to carry over
 * (`interactive-session.ts` restore path: the sandbox snapshot, the goal, the plan and the active
 * checkpoint branch). Background tasks, memory events, skill activations and context references are
 * the parent's own runtime state and are not copied either.
 *
 * Writing the record is the caller's job (`InteractiveSession.forkSession` saves it through the
 * session store). Nothing here reads the store, so the source record is untouched by construction —
 * `fork-record.test.ts` TC-02 measures that rather than trusting this sentence.
 */

import { createSessionId } from '../assembly/create-session.js';

import type { IInteractiveSessionRecord, IInteractiveSessionStore } from './session-persistence.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { Session } from '@robota-sdk/agent-session';

/** The four members of the live session a fork reads — and no others. */
export type TForkSourceSession = Pick<
  Session,
  'getHistory' | 'getSystemMessage' | 'getToolSchemas' | 'getFullHistory'
>;

export interface IBuildForkedSessionRecordInput {
  readonly source: TForkSourceSession;
  /** The fork's own name — distinct from the source's, so a name lookup cannot match both. */
  readonly name: string;
  readonly cwd: string;
}

export function buildForkedSessionRecord(
  input: IBuildForkedSessionRecordInput,
): IInteractiveSessionRecord {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    name: input.name,
    cwd: input.cwd,
    createdAt: now,
    updatedAt: now,
    // Copied arrays: the fork owns its conversation from the first byte, so a mutation on one side
    // cannot reach the other even before the record is written.
    messages: [...input.source.getHistory()],
    history: [...input.source.getFullHistory()],
    systemPrompt: input.source.getSystemMessage(),
    toolSchemas: [...input.source.getToolSchemas()],
  };
}

/**
 * A fork is a COPY, prompt included: it answers under the parent's ASSEMBLED system message rather
 * than one rebuilt from scratch. Applied after assembly because the message is the session's, not
 * an option the constructor takes.
 *
 * Three conditions, each a declared branch and none a fallback. Only a FORK inherits — a plain
 * resume is not a copy and rebuilds from the current AGENTS.md/preset, so edits made between
 * sessions reach it, exactly as before. Only a record that carried a prompt has one to inherit; one
 * written without it rebuilds, the unchanged pre-existing path. And an explicit `systemPrompt`
 * option is the operator replacing the prompt on purpose, which still wins.
 */
export function applyForkedSystemPrompt(
  session: { updateSystemMessage: (message: string) => void },
  input: {
    readonly isFork: boolean;
    readonly restoredSystemPrompt: string | undefined;
    readonly explicitSystemPrompt: string | undefined;
  },
): boolean {
  if (!input.isFork) return false;
  if (input.restoredSystemPrompt === undefined) return false;
  if (input.explicitSystemPrompt !== undefined) return false;
  session.updateSystemMessage(input.restoredSystemPrompt);
  return true;
}

/** The suffix a fork's default name carries, so `<source> (fork)` never collides with `<source>`. */
const FORK_NAME_SUFFIX = ' (fork)';

/**
 * The fork's name: the operator's, or `<source name or id> (fork)`.
 *
 * REFUSES the source's own name rather than accepting it. `resolveSessionIdByIdOrName` matches a
 * record by name, so two records answering to one name would make `--resume <name>` pick either —
 * the "is a copy" property lost through the lookup rather than through the data.
 */
function resolveForkName(
  requested: string | undefined,
  sourceName: string | undefined,
  sourceId: string,
): string {
  const trimmed = requested?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return `${sourceName ?? sourceId}${FORK_NAME_SUFFIX}`;
  }
  if (trimmed === sourceName) {
    throw new Error(
      `A fork cannot be named "${trimmed}": that is the source session's name, and a name lookup ` +
        'could then resolve to either record.',
    );
  }
  return trimmed;
}

export interface IWriteForkedSessionRecordInput {
  /** The live session the copy is taken from. */
  readonly source: Pick<Session, 'getHistory' | 'getSystemMessage' | 'getToolSchemas'>;
  /** The interactive transcript as the parent persists it (`InteractiveSession.getFullHistory`). */
  readonly fullHistory: () => IHistoryEntry[];
  readonly sessionStore: IInteractiveSessionStore;
  readonly requestedName: string | undefined;
  readonly sourceName: string | undefined;
  readonly sourceId: string;
  readonly cwd: string;
}

/** Build the copy and write it. The one production caller is `InteractiveSession.forkSession`. */
export function writeForkedSessionRecord(input: IWriteForkedSessionRecordInput): {
  sessionId: string;
  name: string;
} {
  const name = resolveForkName(input.requestedName, input.sourceName, input.sourceId);
  const record = buildForkedSessionRecord({
    source: {
      getHistory: () => input.source.getHistory(),
      getSystemMessage: () => input.source.getSystemMessage(),
      getToolSchemas: () => input.source.getToolSchemas(),
      getFullHistory: input.fullHistory,
    },
    name,
    cwd: input.cwd,
  });
  input.sessionStore.save(record);
  return { sessionId: record.id, name };
}
