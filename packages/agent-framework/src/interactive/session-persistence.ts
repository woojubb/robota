import { dirname } from 'node:path';

import { NodeSessionStore } from '@robota-sdk/agent-session';

import { userPaths } from '../paths.js';
import { WorkspaceProjectSessionStore } from './workspace-session-store.js';

// Session persistence contracts SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
};
export { WorkspaceSessionLogSink, WorkspaceSessionLogSource } from './workspace-session-io.js';
export { WorkspaceProjectSessionStore } from './workspace-session-store.js';

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
 * User-level session store (`~/.robota/sessions`). Symmetric to {@link createProjectSessionStore};
 * there is no user-level replay-log directory, so it reads persisted records only.
 */
export function createUserSessionStore(): IInteractiveSessionStore {
  // SEC-020: the user store root is passed as OWNED, so it is tightened along with the sessions
  // directory inside it. This is the composition that knows the layout — `userPaths()` is here —
  // and it is the path the restricted-workspace fallback takes, where no other writer may ever run
  // to tighten the root on its behalf.
  const sessions = userPaths().sessions;
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
    .map((session) => ({
      id: session.id,
      ...(session.name !== undefined ? { name: session.name } : {}),
      cwd: session.cwd,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      preview: getLastAssistantPreview(session.messages),
    }));
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
 * Not filtered by `cwd`: an unreadable entry has no record, so it has no `cwd` to compare.
 */
export function listUnreadableSessions(
  sessionStore: IInteractiveSessionStore | undefined,
): readonly { readonly id: string; readonly outcome: TSessionLoadOutcome }[] {
  return (sessionStore?.list() ?? []).filter((entry) => entry.outcome.status !== 'valid');
}

export function resolveLatestSessionId(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): string | undefined {
  return listResumableSessionSummaries(sessionStore, cwd)[0]?.id;
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
