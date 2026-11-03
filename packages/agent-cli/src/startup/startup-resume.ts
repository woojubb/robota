/**
 * Which saved session a run starts in, from `-c`, `-r <id|name>` and a served runtime's launch, and
 * what a person must say first when that session is not verified as theirs (#3679).
 *
 * A store that seals says whose each record is. Sealing needs only the public key, so a record that
 * opens says nothing about who wrote it, and a resumed record is fed to the model as this
 * conversation's history: an unverified one is never resumed without a person saying it is theirs,
 * and nothing it says of itself — its name, its time — decides what a run resumes.
 *
 * - `-c` continues the newest verified record. When a newer unverified one exists it stops: a person
 *   at a terminal is asked whether to continue the verified one, and a run with no one to ask exits.
 *   With only unverified records it lists them and exits; it never resumes one on its own.
 * - `-r <id|name>` resolves in tiers (`resolveSessionIdByIdOrName`): a name an unverified record gives
 *   itself answers for nothing, and an unverified id that is also a verified record's name is refused
 *   as ambiguous.
 * - `-r <id>` of an unverified record shows a fixed notice and asks; "no" writes nothing, "yes" hands
 *   the digest of exactly the bytes the run read to the session, which raises them only once it has
 *   restored from them and refuses anything else. A run with no one to ask refuses with the
 *   session's own fixed reason.
 *
 * A store that never seals carries no authorship, and every path here is what it always was.
 */
import { createInterface } from 'node:readline/promises';

import {
  SessionAuthorshipRefusedError,
  UNVERIFIED_SESSION_QUESTION,
  ambiguousSessionNameMessage,
  listResumableSessions,
  lockedSessionsNotice,
  resolveReusableEmptySessionId,
  resolveSessionIdByIdOrName,
  resumeRefusal,
  unacceptableSessionMessage,
  unverifiedSessionNotice,
} from '@robota-sdk/agent-framework';

import type {
  IInteractiveSessionStore,
  IResumableSessionSummary,
} from '@robota-sdk/agent-interface-session';

/** Asks on stderr and reads the answer from stdin, which the caller checked is a terminal. */
export async function confirmResumeOnTerminal(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

/** What a run asked for, and how it can be answered. */
export interface IStartupResumeInput {
  readonly store: IInteractiveSessionStore | undefined;
  readonly cwd: string;
  /** `-c`. */
  readonly continueMode: boolean;
  /** `-r <id|name>`; `''` opens the picker. */
  readonly resumeId: string | undefined;
  /** A served runtime's own launch, which reuses an empty session of this workspace. */
  readonly reuseEmptySession: boolean;
  /** A person at a terminal can answer a question before the session starts. */
  readonly interactive: boolean;
  /** Asks `question` and answers whether the person said yes; no is the default. */
  readonly confirm: (question: string) => Promise<boolean>;
  /** Where the run says what it decided (stderr). */
  readonly write: (text: string) => void;
}

/** How the run starts, or the status it exits with having said why. */
export type TStartupResume =
  | {
      readonly kind: 'start';
      readonly resumeSessionId?: string;
      /** The digest of the record bytes the person accepted as theirs, for the session's claim. */
      readonly acceptedDigest?: string;
      readonly showSessionPicker?: true;
    }
  | { readonly kind: 'exit'; readonly code: number };

/** What `-c` finds: nothing to continue, the newest verified record, or a reason to stop. */
export type TContinueTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'continue'; readonly session: IResumableSessionSummary }
  | {
      readonly kind: 'newer-unverified';
      readonly session: IResumableSessionSummary;
      readonly newerUnverified: readonly string[];
    }
  | { readonly kind: 'unverified-only'; readonly unverified: readonly string[] };

const isUnverified = (session: IResumableSessionSummary): boolean =>
  session.authorship === 'unverified';

/**
 * What `-c` continues among `sessions` (as `listResumableSessions` orders them: verified records
 * first, newest first). Newer is judged by each unverified record's own time, which can only make
 * `-c` stop and ask, never choose it.
 */
export function continueTarget(sessions: readonly IResumableSessionSummary[]): TContinueTarget {
  const verified = sessions.find((session) => !isUnverified(session));
  const unverified = sessions.filter(isUnverified);
  if (verified === undefined) {
    return unverified.length === 0
      ? { kind: 'none' }
      : { kind: 'unverified-only', unverified: unverified.map((session) => session.id) };
  }
  const since = Date.parse(verified.updatedAt);
  const newer = unverified.filter((session) => Date.parse(session.updatedAt) > since);
  return newer.length === 0
    ? { kind: 'continue', session: verified }
    : {
        kind: 'newer-unverified',
        session: verified,
        newerUnverified: newer.map((session) => session.id),
      };
}

const REVIEW_BY_ID = 'resume one by its id to review it';

/** The question `-c` asks when newer unverified records exist. The verified record is the owner's. */
export function continueQuestion(
  session: IResumableSessionSummary,
  newerUnverified: readonly string[],
): string {
  const title = session.title ?? session.name ?? 'untitled';
  return (
    `Continue ${session.id} (${title}, ${session.updatedAt})? Newer unverified sessions: ` +
    `${newerUnverified.join(', ')} — ${REVIEW_BY_ID}. [y/N] `
  );
}

/** What `-c` says when it stops with no one to ask. */
export function continueStoppedMessage(
  session: IResumableSessionSummary,
  newerUnverified: readonly string[],
): string {
  return (
    `Did not continue ${session.id}: newer unverified sessions: ${newerUnverified.join(', ')} — ` +
    `${REVIEW_BY_ID}, or resume ${session.id} by its id to continue it.`
  );
}

/** What `-c` says when every record it could continue is unverified. */
export function noVerifiedSessionMessage(unverified: readonly string[]): string {
  return (
    `No session verified as yours to continue. Unverified sessions: ${unverified.join(', ')} — ` +
    `${REVIEW_BY_ID}.`
  );
}

/** What `-r <name>` says when only unverified records give themselves that name. */
export function unverifiedNameMessage(name: string, ids: readonly string[]): string {
  return ids.length === 1
    ? `${name} matches an unverified session ${ids[0]}; resume it by its id to review it.`
    : `${name} matches unverified sessions ${ids.join(', ')}; ${REVIEW_BY_ID}.`;
}

/**
 * `-r` and `-c`'s target `sessionId`, judged once from one read of it: a record that is there and
 * unreadable is refused in the session's own words; an unverified one is asked about, or refused with
 * no one to ask. A yes raises nothing here: the session raises the accepted bytes once it restored
 * from them, so a resume refused after the question (or a copy made from them) leaves them as they are.
 */
async function judgeTarget(
  input: IStartupResumeInput,
  store: IInteractiveSessionStore,
  sessionId: string,
): Promise<TStartupResume> {
  const outcome = store.load(sessionId);
  const refusal = resumeRefusal(sessionId, outcome, true);
  if (refusal !== undefined) {
    input.write(`${refusal.message}\n`);
    return { kind: 'exit', code: 1 };
  }
  if (outcome.status !== 'valid' || outcome.authorship !== 'unverified') {
    return { kind: 'start', resumeSessionId: sessionId };
  }
  if (!input.interactive) {
    input.write(`${new SessionAuthorshipRefusedError(sessionId, 'unverified').message}\n`);
    return { kind: 'exit', code: 1 };
  }
  const digest = outcome.digest;
  if (digest === undefined) {
    input.write(`${unacceptableSessionMessage(sessionId)}\n`);
    return { kind: 'exit', code: 1 };
  }
  input.write(`${unverifiedSessionNotice(sessionId)}\n`);
  if (!(await input.confirm(`${UNVERIFIED_SESSION_QUESTION} [y/N] `))) {
    input.write('Not resumed; nothing was changed.\n');
    return { kind: 'exit', code: 0 };
  }
  return { kind: 'start', resumeSessionId: sessionId, acceptedDigest: digest };
}

async function continueSession(
  input: IStartupResumeInput,
  store: IInteractiveSessionStore | undefined,
): Promise<TStartupResume> {
  const resumable = listResumableSessions(store, input.cwd);
  // Sealed sessions this process cannot open are not in the listing, so the latest readable session
  // may not be the latest one, and "nothing to continue" would read as "nothing saved".
  const notice = lockedSessionsNotice(resumable.locked, resumable.noKeys);
  if (notice !== undefined) input.write(`${notice}\n`);
  const target = continueTarget(resumable.sessions);
  switch (target.kind) {
    case 'none':
      return { kind: 'start' };
    case 'unverified-only':
      input.write(`${noVerifiedSessionMessage(target.unverified)}\n`);
      return { kind: 'exit', code: 1 };
    case 'newer-unverified':
      if (!input.interactive) {
        input.write(`${continueStoppedMessage(target.session, target.newerUnverified)}\n`);
        return { kind: 'exit', code: 1 };
      }
      if (!(await input.confirm(continueQuestion(target.session, target.newerUnverified)))) {
        input.write('Not continued; nothing was changed.\n');
        return { kind: 'exit', code: 0 };
      }
      break;
    case 'continue':
      break;
  }
  return store === undefined
    ? { kind: 'start', resumeSessionId: target.session.id }
    : judgeTarget(input, store, target.session.id);
}

/**
 * Which session the run starts in. `notFound` says what `-r` answers when nothing matches (the
 * locked-session wording is the caller's).
 */
export async function resolveStartupResume(
  input: IStartupResumeInput,
  notFound: (idOrName: string) => string,
): Promise<TStartupResume> {
  const store = input.store;
  if (input.continueMode) return continueSession(input, store);
  if (input.resumeId === '') return { kind: 'start', showSessionPicker: true };
  if (input.resumeId !== undefined) {
    const resolved = resolveSessionIdByIdOrName(store, input.resumeId);
    if (resolved.status === 'ambiguous') {
      input.write(`${ambiguousSessionNameMessage(resolved.namedId, resolved.otherId)}\n`);
      return { kind: 'exit', code: 1 };
    }
    if (resolved.status === 'not-found') {
      input.write(
        `${resolved.unverifiedNamed.length > 0 ? unverifiedNameMessage(input.resumeId, resolved.unverifiedNamed) : notFound(input.resumeId)}\n`,
      );
      return { kind: 'exit', code: 1 };
    }
    return store === undefined
      ? { kind: 'start', resumeSessionId: resolved.id }
      : judgeTarget(input, store, resolved.id);
  }
  if (input.reuseEmptySession) {
    const reusable = resolveReusableEmptySessionId(store, input.cwd);
    if (reusable === undefined || store === undefined) return { kind: 'start' };
    return judgeTarget(input, store, reusable);
  }
  return { kind: 'start' };
}
