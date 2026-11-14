/** UI-layer permission types for the Ink TUI */

import type { TToolArgs } from '@robota-sdk/agent-core';
import type { TPermissionRequester, TPermissionResultValue } from '@robota-sdk/agent-interface/session';

/**
 * Permission result: true (allow once), false (deny), 'allow-session' (remember for session),
 * or 'allow-project' (persist through the host-selected project settings writer).
 */
export type TPermissionResult = TPermissionResultValue; // Owned by agent-interface/session

export interface IPendingPermissionRequest {
  toolName: string;
  toolArgs: TToolArgs;
  canPersistProjectPermission?: boolean;
  /** The peer session whose message this call serves, when a peer turn asked. */
  requestedByPeer?: string;
  /** A background agent's own request, forwarded to the person. */
  requester?: TPermissionRequester;
  resolve: (result: TPermissionResult) => void;
}

/** What a session switch carries beyond the session's id. */
export interface ISessionSwitchOptions {
  /**
   * The SHA-256 of the stored record bytes the person accepted as theirs. Over a store that seals, the
   * session that opens the record resumes it only if it is the owner's or exactly these bytes.
   */
  readonly acceptedDigest?: string;
  /**
   * How many live background jobs the person already agreed to have stopped with this switch. A
   * switch that would stop more asks again. Absent ⇒ none were agreed to.
   */
  readonly liveJobsApproved?: number;
}

/** A yes or no the terminal asks of the person before it goes on with a switch. */
export interface ISessionSwitchQuestion {
  readonly message: string;
  readonly answer: (yes: boolean) => void;
}

/** The surface's session-switch path: the resume picker and a fork attach both take it. */
export type TSessionSwitch = (sessionId: string, options?: ISessionSwitchOptions) => Promise<void>;
