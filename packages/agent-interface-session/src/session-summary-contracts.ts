/** Projection used to render a resume picker. */
export interface IResumableSessionSummary {
  id: string;
  name?: string;
  cwd: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  /**
   * A stable title from the session's first request: one line, Markdown markers stripped, never
   * changing as later turns arrive. Optional so a client reading an older host, which sends none,
   * falls back to `name` or `preview`. `preview` stays the raw latest assistant reply — it still
   * serves the resume picker, which wants to show what the session last said.
   */
  title?: string;
}

/**
 * A row of a session listing on a host that keeps sessions live. Both fields are optional so a
 * client reading an older host, which sends neither, sees a plain summary.
 */
export interface ISessionListingEntry extends IResumableSessionSummary {
  /** The session is running in the host now, not only stored. */
  live?: boolean;
  /** How many clients are bound to it. */
  clients?: number;
}

/**
 * The sessions a client can switch to, as a host lists them: this workspace's readable sessions,
 * newest first, which one is current, and the ids of records that could not be read and belong to
 * THIS workspace — listed, not dropped, so an unreadable session of this workspace never looks
 * deleted. A record whose workspace is another folder, or cannot be told at all, is left out here:
 * it is still on disk, but it is not this workspace's business to report.
 */
export interface ISessionListing {
  readonly currentSessionId: string;
  readonly sessions: readonly ISessionListingEntry[];
  readonly unreadableSessionIds: readonly string[];
}

/**
 * A host that can hold one session among several and change which (#3189). Clients reach it over the
 * wire to list, start, switch, rename and delete sessions. A switch or delete that would lose work in
 * progress — a running turn, a pending prompt, live background tasks — is refused with an Error whose
 * message says why.
 */
export interface ISessionDirectory {
  listSessions(): ISessionListing;
  /** Make the stored session `sessionId` the current one. */
  switchSession(sessionId: string): Promise<void>;
  /**
   * Start a fresh session and make it current; it is saved at once, so it is listed. Reuses an
   * existing session of this workspace that has no messages yet and no other client on it, rather
   * than letting empty sessions pile up.
   */
  newSession(): Promise<void>;
  /**
   * Persist a new name onto a stored session that is not live. The current session's own rename path
   * (the `/rename` command) updates its live in-memory name and broadcasts the change to every client
   * on it; this one writes the record directly, for a row in the list that is not the one this caller
   * is on — and is refused, with an Error whose message says why, for a session that IS live (current
   * or not), because a live session's next persist would overwrite a rename made only on disk.
   */
  renameSession(sessionId: string, name: string): Promise<void>;
  /**
   * Remove a stored session's record for good. Refused when the session is live and another client
   * is on it, or it is running a turn — deleting it would either cut someone else off or drop
   * in-flight work. Deleting the current session switches this binding to another session first (an
   * existing one, or a fresh/reused empty one), so it is never left pointing at nothing.
   */
  deleteSession(sessionId: string): Promise<void>;
}

/** The host's current session changed; every attached client re-reads what it shows. */
export interface ISessionSwitchedEvent {
  readonly sessionId: string;
}
