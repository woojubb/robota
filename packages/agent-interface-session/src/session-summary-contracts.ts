/** Projection used to render a resume picker. */
export interface IResumableSessionSummary {
  id: string;
  name?: string;
  cwd: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

/**
 * The sessions a client can switch to, as a host lists them: this workspace's readable sessions,
 * newest first, which one is current, and the ids of records that could not be read — listed, not
 * dropped, so an unreadable session never looks deleted.
 */
export interface ISessionListing {
  readonly currentSessionId: string;
  readonly sessions: readonly IResumableSessionSummary[];
  readonly unreadableSessionIds: readonly string[];
}

/**
 * A host that can hold one session among several and change which (#3189). Clients reach it over the
 * wire to list, start and switch sessions. A switch that would lose work in progress — a running turn,
 * a pending prompt, live background tasks — is refused with an Error whose message says why.
 */
export interface ISessionDirectory {
  listSessions(): ISessionListing;
  /** Make the stored session `sessionId` the current one. */
  switchSession(sessionId: string): Promise<void>;
  /** Start a fresh session and make it current; it is saved at once, so it is listed. */
  newSession(): Promise<void>;
}

/** The host's current session changed; every attached client re-reads what it shows. */
export interface ISessionSwitchedEvent {
  readonly sessionId: string;
}
