/**
 * SCREEN-1993 — prompt history: the prompts a person typed, across sessions and projects, as a
 * derived append-only projection the terminal UI searches. The session record stays the owner of
 * every message; this projection exists so a search never decodes a record and never crosses a
 * workspace boundary.
 */

/** One prompt as it was typed, with where and when. */
export interface IPromptHistoryEntry {
  /** ISO timestamp of the turn. */
  readonly at: string;
  readonly sessionId: string;
  /** The project key: the workspace identity's worktree root, or the real path of the cwd. */
  readonly project: string;
  /** The typed text, trimmed. */
  readonly text: string;
}

/** Appends one entry; a failure is the caller's to report, never swallowed here. */
export interface IPromptHistoryWriter {
  append(entry: IPromptHistoryEntry): void;
}

/** One block of a streamed read: entries newest-first, plus the lines the block could not read. */
export interface IPromptHistoryBlock {
  readonly entries: readonly IPromptHistoryEntry[];
  /** Lines in this block that were not a well-formed entry — counted, never silently dropped. */
  readonly skippedLines: number;
}

export interface IPromptHistoryReadOptions {
  /** Honoured between blocks: an aborted read yields no further block. */
  readonly signal: AbortSignal;
}

/** Streams the history newest-first so the most recent prompts render before the rest is read. */
export interface IPromptHistorySource {
  read(options: IPromptHistoryReadOptions): AsyncIterable<IPromptHistoryBlock>;
}
