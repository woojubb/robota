import { dirname } from 'node:path';

import {
  NodePromptHistoryFile,
  NodeSessionStore,
  NodeToolResultSpillStore,
  isSafeSessionId as sessionIsSafeSessionId,
} from '@robota-sdk/agent-session';

import { WorkspaceProjectSessionStore } from './workspace-session-store.js';

// Session persistence contracts SSOT relocated to @robota-sdk/agent-interface-session (DATA-001).
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { IToolResultSpillStore } from '@robota-sdk/agent-core';
import type {
  IPromptHistorySource,
  IPromptHistoryWriter,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';
import type { INodeToolResultSpillStoreOptions } from '@robota-sdk/agent-session';

export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
};
export { WorkspaceSessionLogSink, WorkspaceSessionLogSource } from './workspace-session-io.js';
export { WorkspaceProjectSessionStore } from './workspace-session-store.js';

export interface IHostToolResultSpillStore extends IToolResultSpillStore {
  read(reference: string): Promise<string>;
  shutdown(): Promise<void>;
}

/** Explicit host-owned storage for bounded MCP result references. */
export function createNodeToolResultSpillStore(
  options: INodeToolResultSpillStoreOptions = {},
): IHostToolResultSpillStore {
  return new NodeToolResultSpillStore(options);
}

/**
 * Whether an untrusted session selector is safe to use as one filesystem path component.
 *
 * The validation rule is owned by agent-session. This framework facade keeps command and UI
 * consumers on the SDK boundary instead of duplicating the rule or importing the lower package.
 */
export function isSafeSessionId(id: string): boolean {
  return sessionIsSafeSessionId(id);
}

export function createProjectSessionStore(
  sessions: IWorkspaceProjectStateStorage,
  logs: IWorkspaceProjectStateStorage,
): IInteractiveSessionStore {
  return new WorkspaceProjectSessionStore(sessions, logs);
}

/** Explicit host-filesystem session store. This does not establish project trust. */
export function createNodeHostSessionStore(
  baseDirectory: string,
  ownedRoot?: string,
): IInteractiveSessionStore {
  return new NodeSessionStore(baseDirectory, ownedRoot);
}

/**
 * SCREEN-1993: the caller-selected prompt-history file, one object serving
 * both the session-side writer and the surface's newest-first source. SEC-020: the user root is
 * passed as OWNED, exactly as `createUserSessionStore` does, so it is tightened along with the file.
 */
export function createUserPromptHistoryFile(
  history: string,
): IPromptHistoryWriter & IPromptHistorySource {
  return new NodePromptHistoryFile(history, { ownedRoot: dirname(history) });
}

/**
 * User-level session store at a caller-selected directory. Symmetric to {@link createProjectSessionStore};
 * there is no user-level replay-log directory, so it reads persisted records only.
 */
export function createUserSessionStore(sessions: string): IInteractiveSessionStore {
  // SEC-020: the user store root is passed as OWNED, so it is tightened along with the sessions
  // directory inside it. The caller owns the layout and supplies this path.
  // This is the path the restricted-workspace fallback takes, where no other writer may ever run
  // to tighten the root on its behalf.
  return new NodeSessionStore(sessions, dirname(sessions));
}

export function listResumableSessionSummaries(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): IResumableSessionSummary[] {
  return (sessionStore?.list() ?? [])
    .flatMap((entry) => (entry.outcome.status === 'valid' ? [entry.outcome.record] : []))
    .filter((session) => session.cwd === cwd)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((session) => {
      const title = getFirstUserMessageTitle(session.messages);
      return {
        id: session.id,
        ...(session.name !== undefined ? { name: session.name } : {}),
        cwd: session.cwd,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        preview: getLastAssistantPreview(session.messages),
        ...(title !== undefined ? { title } : {}),
      };
    });
}

/**
 * The sessions this build cannot read (TRANS-007).
 *
 * `listResumableSessionSummaries` returns only what can be resumed, which is what its name promises
 * — an unreadable session is genuinely not resumable. What it must not do is make those sessions
 * DISAPPEAR: before this, both stores dropped what they could not parse, so a damaged or
 * older-format session read as gone rather than as unreadable. A surface that wants to say "3
 * sessions here were written by a different build" asks this.
 *
 * Not filtered by `cwd`: an unreadable entry has no record, so it has no `cwd` to compare in general
 * — {@link listUnreadableSessionsForWorkspace} answers that question for the entries that DO carry
 * one.
 */
export function listUnreadableSessions(
  sessionStore: IInteractiveSessionStore | undefined,
): readonly { readonly id: string; readonly outcome: TSessionLoadOutcome }[] {
  return (sessionStore?.list() ?? []).filter((entry) => entry.outcome.status !== 'valid');
}

/**
 * The unreadable sessions of ONE workspace (#3289 §1).
 *
 * A store shared across workspaces (the user-level `~/.robota/sessions`) holds unreadable records
 * from every folder ever worked in there, and a brand-new folder used to be told about all of them —
 * "191 sessions could not be read" on a folder that had never seen one. An unreadable record still
 * carries its raw `cwd` when the bytes are readable enough for that (TRANS-007's best-effort peek);
 * this asks only for the ones whose peeked `cwd` is THIS workspace. A record whose workspace cannot
 * be told at all is left out here — it is not lost, it simply is not this workspace's business.
 */
export function listUnreadableSessionsForWorkspace(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): readonly { readonly id: string }[] {
  return listUnreadableSessions(sessionStore)
    .filter((entry) => unreadableOutcomeCwd(entry.outcome) === cwd)
    .map((entry) => ({ id: entry.id }));
}

function unreadableOutcomeCwd(outcome: TSessionLoadOutcome): string | undefined {
  return outcome.status === 'corrupt' || outcome.status === 'unsupported'
    ? outcome.cwd
    : undefined;
}

export function resolveLatestSessionId(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): string | undefined {
  return listResumableSessionSummaries(sessionStore, cwd)[0]?.id;
}

/**
 * An existing session of this workspace with no messages yet, that no OTHER client is on and has no
 * work of its own in progress — the one a fresh "New session" (a serve/daemon start, or the button)
 * should reuse instead of adding another empty row to the list (#3289 §1). `excludeSessionId` lets a
 * caller leaving a session (e.g. deleting it) ask "reuse some OTHER empty session" without that one
 * answering its own question.
 *
 * `otherClientsOf` reports how many clients are on a session besides the one asking, when the caller
 * knows; omitted, every candidate is treated as free (the common case: nothing is live yet, as at a
 * serve/daemon start, when nothing could be bound to anything). `isBusy` reports whether a candidate
 * has work of its own in progress even with no client on it — a background task or a self-paced loop
 * outlives the client that started it, and "New session" landing someone there would join that work
 * mid-flight rather than starting fresh. Omitted, no candidate is treated as busy, for the same
 * "nothing is live yet" reason `otherClientsOf` is omittable.
 */
export function resolveReusableEmptySessionId(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
  options: {
    readonly excludeSessionId?: string;
    readonly otherClientsOf?: (sessionId: string) => number;
    readonly isBusy?: (sessionId: string) => boolean;
  } = {},
): string | undefined {
  const candidate = listResumableSessionSummaries(sessionStore, cwd).find(
    (session) =>
      session.messageCount === 0 &&
      session.id !== options.excludeSessionId &&
      (options.otherClientsOf?.(session.id) ?? 0) <= 0 &&
      (options.isBusy?.(session.id) ?? false) === false,
  );
  return candidate?.id;
}

export function resolveSessionIdByIdOrName(
  sessionStore: IInteractiveSessionStore | undefined,
  idOrName: string,
): string | undefined {
  // A name lives on the record, so only a readable entry can be matched by name. An unreadable one
  // can still be matched by its id, which is what a user holding an old id would type.
  const match = (sessionStore?.list() ?? []).find(
    (entry) =>
      entry.id === idOrName ||
      (entry.outcome.status === 'valid' && entry.outcome.record.name === idOrName),
  );
  return match?.id;
}

function getLastAssistantPreview(messages: readonly TUniversalMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    if (typeof message.content !== 'string') continue;
    return message.content.replace(/[\n\r]+/g, ' ').trim();
  }
  return '';
}

/** A title never runs past this many characters before the ellipsis. */
const TITLE_MAX_LENGTH = 60;

/**
 * A stable session title (#3289 §1): the first user request, one line, Markdown syntax markers
 * stripped, whitespace collapsed, and capped at {@link TITLE_MAX_LENGTH} characters. Unlike
 * {@link getLastAssistantPreview} — the raw latest reply, which is what the resume picker wants — this
 * reads the FIRST user message and nothing later, so it never changes as the conversation continues:
 * a session titled from its first question does not retitle itself to `##`, a code fence, or "OK." on
 * the next turn.
 */
function getFirstUserMessageTitle(messages: readonly TUniversalMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (typeof message.content !== 'string') continue;
    const title = titleFromText(message.content);
    if (title.length > 0) return title;
  }
  return undefined;
}

/** One line, common Markdown syntax characters removed (not their content), collapsed and capped. */
function titleFromText(text: string): string {
  const stripped = text
    .replace(/[#*_~`]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= TITLE_MAX_LENGTH) return stripped;
  return `${stripped.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}
