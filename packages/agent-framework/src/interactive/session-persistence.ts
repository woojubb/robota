import { dirname } from 'node:path';

import { isSafeSessionId as sessionIsSafeSessionId } from '@robota-sdk/agent-session';
import {
  NodePromptHistoryFile,
  NodeSessionStore,
  NodeToolResultSpillStore,
  sessionSealingOf,
  sweepStaleToolResultSpillDirectories as sessionSweepStaleToolResultSpillDirectories,
} from '@robota-sdk/agent-session/node';

import { lockedReasonOf, sealedSessionState } from './locked-session-wording.js';
import { WorkspaceProjectSessionStore } from './workspace-session-store.js';

import type { TLockedSessionReason } from './locked-session-wording.js';

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
  ISessionListEntry,
  ISessionStoreScan,
  TSessionAuthorship,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';
import type {
  INodeSessionStoreOptions,
  INodeToolResultSpillStoreOptions,
  ISessionStoreOptions,
} from '@robota-sdk/agent-session/node';

export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  TSessionLoadOutcome,
};
export { WorkspaceSessionLogSink, WorkspaceSessionLogSource } from './workspace-session-io.js';
export {
  WorkspaceProjectSessionStore,
  projectSessionClaimsDirectory,
} from './workspace-session-store.js';

export interface IHostToolResultSpillStore extends IToolResultSpillStore {
  read(reference: string): Promise<string>;
  shutdown(): Promise<void>;
}

/**
 * Explicit host-owned storage for bounded MCP result references, in `options.parentDirectory`: an
 * owner-only directory the host owns; spilled results never go anywhere else. `options.sealing`
 * (required) seals each result with `{ sealer }`, or states `'plain'`.
 */
export function createNodeToolResultSpillStore(
  options: INodeToolResultSpillStoreOptions,
): IHostToolResultSpillStore {
  return new NodeToolResultSpillStore(options);
}

/**
 * Remove the spill directories under `parent` whose recorded owner can no longer be alive. A host
 * calls this once at startup for the parent it hands to {@link createNodeToolResultSpillStore}.
 */
export function sweepStaleToolResultSpillDirectories(parent: string): readonly string[] {
  return sessionSweepStaleToolResultSpillDirectories(parent);
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

/**
 * Project session store over a trusted workspace's state facets. `options.sealing` (required) seals
 * its records with `{ sealer }`, or states `'plain'`.
 */
export function createProjectSessionStore(
  sessions: IWorkspaceProjectStateStorage,
  logs: IWorkspaceProjectStateStorage,
  options: ISessionStoreOptions,
): IInteractiveSessionStore {
  return new WorkspaceProjectSessionStore(sessions, logs, options);
}

/**
 * Explicit host-filesystem session store. This does not establish project trust. `options.sealing`
 * is required, as for {@link createProjectSessionStore}; `options.ownedRoot` is an ancestor of
 * `baseDirectory` the host also owns, tightened along with it.
 */
export function createNodeHostSessionStore(
  baseDirectory: string,
  options: INodeSessionStoreOptions,
): IInteractiveSessionStore {
  return new NodeSessionStore(baseDirectory, options);
}

/**
 * SCREEN-1993: the caller-selected prompt-history file, one object serving
 * both the session-side writer and the surface's newest-first source. SEC-020: the user root is
 * passed as OWNED, exactly as `createUserSessionStore` does, so it is tightened along with the file.
 * `options.sealing` (required) seals each entry as one line with `{ sealer }`, or states `'plain'`.
 */
export function createUserPromptHistoryFile(
  history: string,
  options: ISessionStoreOptions,
): IPromptHistoryWriter & IPromptHistorySource {
  return new NodePromptHistoryFile(history, {
    ownedRoot: dirname(history),
    sealing: sessionSealingOf(options),
  });
}

/**
 * User-level session store at a caller-selected directory. Symmetric to {@link createProjectSessionStore};
 * there is no user-level replay-log directory, so it reads persisted records only. `options.sealing`
 * as for {@link createProjectSessionStore}.
 */
export function createUserSessionStore(
  sessions: string,
  options: ISessionStoreOptions,
): IInteractiveSessionStore {
  // SEC-020: the user store root is passed as OWNED, so it is tightened along with the sessions
  // directory inside it. The caller owns the layout and supplies this path.
  // This is the path the restricted-workspace fallback takes, where no other writer may ever run
  // to tighten the root on its behalf.
  return new NodeSessionStore(sessions, {
    ownedRoot: dirname(sessions),
    sealing: sessionSealingOf(options),
    ...(options.releaseCommand === undefined ? {} : { releaseCommand: options.releaseCommand }),
  });
}

/** This workspace's resumable sessions, newest first; {@link listResumableSessions} also counts locked ones. */
export function listResumableSessionSummaries(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): IResumableSessionSummary[] {
  return listResumableSessions(sessionStore, cwd).sessions;
}

/**
 * One pass over a store: what it lists, and how many sealed sessions it left out because they cannot
 * be opened right now. A store that cannot scan holds no sealed records, so it has none to leave out.
 */
export function scanSessionStore(
  sessionStore: IInteractiveSessionStore | undefined,
): ISessionStoreScan {
  if (sessionStore === undefined) return { entries: [], locked: 0 };
  return sessionStore.scan?.() ?? { entries: sessionStore.list(), locked: 0 };
}

/** Verified (and plain) records first, then unverified ones; within each, newest first. */
function compareResumable(
  left: { readonly record: IInteractiveSessionRecord; readonly authorship?: TSessionAuthorship },
  right: { readonly record: IInteractiveSessionRecord; readonly authorship?: TSessionAuthorship },
): number {
  const rank = (entry: { readonly authorship?: TSessionAuthorship }): number =>
    entry.authorship === 'unverified' ? 1 : 0;
  return (
    rank(left) - rank(right) ||
    new Date(right.record.updatedAt).getTime() - new Date(left.record.updatedAt).getTime()
  );
}

/**
 * This workspace's resumable sessions, newest first, and how many sealed sessions the store left out
 * — locked ones and ones sealed with keys this process does not have — from one scan, for a surface
 * that lists sessions or picks one and must say that they are there (see
 * {@link lockedSessionsNotice}). A sealed session's workspace cannot be told, so the counts are the
 * whole store's. A store that seals says whose each one is, and its unverified records come after
 * every verified one: the time such a record gives is its own word, so it never ranks it among
 * records the owner wrote.
 */
export function listResumableSessions(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): {
  readonly sessions: IResumableSessionSummary[];
  readonly locked: number;
  readonly noKeys: number;
} {
  const scan = scanSessionStore(sessionStore);
  const sessions = scan.entries
    .flatMap((entry) =>
      entry.outcome.status === 'valid'
        ? [{ record: entry.outcome.record, authorship: entry.outcome.authorship }]
        : [],
    )
    .filter(({ record }) => record.cwd === cwd)
    .sort(compareResumable)
    .map(({ record: session, authorship }) => {
      const title = getFirstUserMessageTitle(session.messages);
      return {
        id: session.id,
        ...(session.name !== undefined ? { name: session.name } : {}),
        cwd: session.cwd,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        preview: getLastAssistantPreview(session.messages),
        ...(title !== undefined ? { title } : {}),
        ...(authorship !== undefined ? { authorship } : {}),
      };
    });
  return { sessions, locked: scan.locked, noKeys: scan.noKeys ?? 0 };
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
 * A store shared across workspaces (the user-level `~/.agent/sessions`) holds unreadable records
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
  return outcome.status === 'corrupt' || outcome.status === 'unsupported' ? outcome.cwd : undefined;
}

/**
 * Why session `id` exists, sealed, and this store cannot open it right now — `undefined` when that is
 * not so. What a surface asks before it says a session "was not found": a locked session is not in a
 * listing, but it is there, and the reason decides whether an unlock would open it. An id that is not
 * a safe session id names no file, so it is never locked. A probe: the store remembers nothing it
 * read here.
 */
export function lockedSessionReason(
  sessionStore: IInteractiveSessionStore | undefined,
  id: string,
): TLockedSessionReason | undefined {
  if (sessionStore === undefined || !sessionIsSafeSessionId(id)) return undefined;
  const outcome = sessionStore.load(id);
  return outcome.status === 'locked' ? lockedReasonOf(outcome) : undefined;
}

/** Whether session `id` exists, sealed, and this store cannot open it right now; see {@link lockedSessionReason}. */
export function isSessionLocked(
  sessionStore: IInteractiveSessionStore | undefined,
  id: string,
): boolean {
  return lockedSessionReason(sessionStore, id) !== undefined;
}

/**
 * How a surface says to unlock: by its command where it has one (a terminal holding keys has
 * `/unlock`), and in plain words where it has none, so no surface names a command it does not offer.
 */
function unlockTo(action: string, unlockCommand: string | undefined): string {
  return unlockCommand === undefined
    ? `unlock to ${action}`
    : `run \`${unlockCommand}\` to ${action}`;
}

/**
 * The fixed answer for a session that is present but sealed out of reach, saying to unlock only when
 * that would open it — naming `unlockCommand` when the surface has one.
 */
export function lockedSessionMessage(
  sessionId: string,
  reason: TLockedSessionReason = 'locked',
  unlockCommand?: string,
): string {
  const state = sealedSessionState(reason);
  return reason === 'locked'
    ? `Session ${sessionId} is ${state}; ${unlockTo('open it', unlockCommand)}.`
    : `Session ${sessionId} is ${state}.`;
}

/**
 * The one note every surface adds where it lists sessions or picks one while some are sealed out of
 * reach — a listing leaves those out, so without it they would read as gone. `locked` are sealed with
 * the keys locked, which an unlock opens; `noKeys` are sealed with keys this process does not have,
 * which no unlock here opens. `undefined` when there are none, so a surface says nothing then. A
 * surface that has an unlock command passes it as `unlockCommand`, and the note names it.
 */
export function lockedSessionsNotice(
  locked: number,
  noKeys = 0,
  unlockCommand?: string,
): string | undefined {
  const notes: string[] = [];
  if (locked > 0) {
    notes.push(
      locked === 1
        ? `1 saved session is sealed and locked; ${unlockTo('open it', unlockCommand)}.`
        : `${locked} saved sessions are sealed and locked; ${unlockTo('open them', unlockCommand)}.`,
    );
  }
  if (noKeys > 0) {
    notes.push(
      noKeys === 1
        ? '1 saved session is sealed with keys this process does not have.'
        : `${noKeys} saved sessions are sealed with keys this process does not have.`,
    );
  }
  return notes.length === 0 ? undefined : notes.join(' ');
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
      // An unverified record is not the owner's to land in unasked, however empty it says it is.
      session.authorship !== 'unverified' &&
      session.messageCount === 0 &&
      session.id !== options.excludeSessionId &&
      (options.otherClientsOf?.(session.id) ?? 0) <= 0 &&
      (options.isBusy?.(session.id) ?? false) === false,
  );
  return candidate?.id;
}

/** What a run's `-r <id or name>` answers to (see {@link resolveSessionIdByIdOrName}). */
export type TSessionIdResolution =
  | { readonly status: 'found'; readonly id: string }
  /**
   * The text is a verified record's name and also the id of a record not verified as the owner's — one
   * nothing vouched for, or one that does not read at all — so neither is taken.
   */
  | { readonly status: 'ambiguous'; readonly namedId: string; readonly otherId: string }
  /** Nothing answers to it; `unverifiedNamed` are the unverified records that give themselves that name. */
  | { readonly status: 'not-found'; readonly unverifiedNamed: readonly string[] };

/**
 * The session `idOrName` names, in tiers: a readable record by its exact id when it is verified or
 * plain, then a verified or plain record by its name, then any other record by its exact id. What an
 * unverified record says of itself — its name, and the time it sorts by — never decides the answer:
 * a name it gives itself answers for nothing, and an id that is also a verified record's name is
 * refused as ambiguous, since a record planted under a name's id would otherwise be offered (or, when
 * it does not read, refused) in place of the session the person named. Only a verified name refuses
 * so: a store that never seals vouches for no record over another, so there an exact id answers
 * before a name, readable or not, and a caller refuses an unreadable one in its own words. A name
 * lives on the record, so only a readable entry can be matched by name; an unreadable one can still
 * be matched by its id, which is what a user holding an old id would type. A locked one is not
 * listed at all, so neither matches; `isSessionLocked` is how a caller says why.
 */
export function resolveSessionIdByIdOrName(
  sessionStore: IInteractiveSessionStore | undefined,
  idOrName: string,
): TSessionIdResolution {
  const entries = sessionStore?.list() ?? [];
  const unverified = (entry: ISessionListEntry): boolean =>
    entry.outcome.status === 'valid' && entry.outcome.authorship === 'unverified';
  const ownedOrPlain = (entry: ISessionListEntry): boolean =>
    entry.outcome.status === 'valid' && entry.outcome.authorship !== 'unverified';
  const byId = entries.find((entry) => entry.id === idOrName);
  if (byId !== undefined && ownedOrPlain(byId)) return { status: 'found', id: byId.id };
  const byName = entries.find(
    (entry) =>
      ownedOrPlain(entry) &&
      entry.outcome.status === 'valid' &&
      entry.outcome.record.name === idOrName,
  );
  if (byName !== undefined) {
    if (byId === undefined) return { status: 'found', id: byName.id };
    return byName.outcome.status === 'valid' && byName.outcome.authorship === 'verified'
      ? { status: 'ambiguous', namedId: byName.id, otherId: byId.id }
      : { status: 'found', id: byId.id };
  }
  if (byId !== undefined) return { status: 'found', id: byId.id };
  return {
    status: 'not-found',
    unverifiedNamed: entries.flatMap((entry) =>
      unverified(entry) &&
      entry.outcome.status === 'valid' &&
      entry.outcome.record.name === idOrName
        ? [entry.id]
        : [],
    ),
  };
}

/**
 * What `-r` says of a text that is both a verified record's name and the id of a record not verified
 * as the owner's. Fixed text and ids only.
 */
export function ambiguousSessionNameMessage(namedId: string, otherId: string): string {
  return (
    `${otherId} is the name of session ${namedId} and also the id of a session not verified as ` +
    `yours, so it resumes neither; resume ${namedId} by its id to continue it, or pick ${otherId} ` +
    'in the resume picker when it is listed there.'
  );
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
