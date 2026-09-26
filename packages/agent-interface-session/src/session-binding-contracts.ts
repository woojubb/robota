/**
 * #3189 — one client's hold on a host that keeps several sessions live at once.
 *
 * A host that can switch sessions used to hold one current session for every client, so one client's
 * switch moved all of them. A binder gives each client connection a binding of its own instead: the
 * session it is on, its own view of the directory, and a release for when it leaves. Switching moves
 * only that binding, and only its client hears `session_switched`.
 *
 * Everything here is a type or a pure predicate: this package is inert by rule, so the refusal is
 * declared as a shape and constructed where it is thrown.
 */

import type { IInteractiveSession } from './session-contracts.js';
import type { ISessionDirectory } from './session-summary-contracts.js';

/**
 * What a binding may do. A `drive` binding submits and answers prompts; an `observe` binding only
 * watches. The difference matters when a binding leaves: a prompt pending on the session needs a
 * driver left to answer it.
 */
export type TSessionBindingRole = 'drive' | 'observe';

/** One client's hold on a session. */
export interface ISessionBinding<TSession = IInteractiveSession> {
  /** The session this client is on, stable across its switches: calls reach whichever is current. */
  readonly session: TSession;
  /**
   * This client's directory. `listSessions().currentSessionId` is the session THIS binding is on, and
   * a switch through it moves this binding alone.
   */
  readonly directory: ISessionDirectory;
  /** The client has gone. A session nobody is bound to may then be shut down once it is idle. */
  release(): void;
}

/** Hands each client connection a binding of its own. */
export interface ISessionBinder<TSession = IInteractiveSession> {
  bind(role: TSessionBindingRole): ISessionBinding<TSession>;
}

/** Every reason a session change can be refused, in one place so a wire decoder can check a code. */
export const SESSION_CHANGE_REFUSAL_CODES = Object.freeze([
  /** The host cannot change sessions at all (none attached yet, or no directory). */
  'not_available',
  /** The host is shutting down. */
  'stopping',
  /** Another change for this client is already under way. */
  'in_progress',
  /** This client is the last driver of its session and a prompt there waits for an answer. */
  'prompt_pending',
  /** No such session in this workspace. */
  'unknown_session',
  /** The session was saved in a form this version cannot read. */
  'unreadable',
  /** The session could not be started. */
  'start_failed',
  /** As many sessions are live as the host allows, and none of them can be closed. */
  'limit',
  /** Anything else; the message says what. */
  'failed',
] as const);

/** Why a session change was refused. */
export type TSessionChangeRefusalCode = (typeof SESSION_CHANGE_REFUSAL_CODES)[number];

/**
 * The error a refused session change carries. A client shows `message` and may branch on `code`; it
 * never has to parse the message to tell a limit from a pending prompt.
 */
export interface ISessionChangeRefusal extends Error {
  readonly name: 'SessionChangeRefusal';
  readonly code: TSessionChangeRefusalCode;
}

/**
 * Is this error a declared refusal, or a real failure? A refusal is an outcome to report to the
 * client that asked; anything else should surface as the fault it is.
 */
export function isSessionChangeRefusal(value: unknown): value is ISessionChangeRefusal {
  return (
    value instanceof Error &&
    value.name === 'SessionChangeRefusal' &&
    (SESSION_CHANGE_REFUSAL_CODES as readonly unknown[]).includes(
      (value as { code?: unknown }).code,
    )
  );
}
