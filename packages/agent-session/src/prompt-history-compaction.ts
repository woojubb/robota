/**
 * Compaction of the prompt-history file (secure conversation): every entry, plain or sealed,
 * rewritten one per line under the one sealer the caller hands over, so the file holds no plaintext
 * and — given a sealer of its own — its sealed lines share one writer epoch, read back with one key
 * opening instead of one per epoch the file collected.
 *
 * The file has no lock: every terminal appends to it by path whenever a prompt is sent. So it is
 * rewritten beside itself, renamed over, and what terminals appended meanwhile is caught up under the
 * same sealer (`append-file-rewrite.ts`, which also refuses a history that is a link, and abandons a
 * compaction another one overtook or whose history was deleted meanwhile). A line that does not open
 * here, or that a newer build sealed, is carried over byte for byte. A crash inside the catch-up
 * window, or a catch-up that fails, can lose what was appended in it: milliseconds, and the session
 * records hold those prompts too, since this file is only a derived copy of them.
 */
import { closeSync } from 'node:fs';

import { ArtifactLockedError, isSealedArtifactLine } from '@robota-sdk/agent-core';

import { openAppendFile, readWhole, rewriteAppendFile } from './append-file-rewrite.js';
import { PROMPT_HISTORY_OWNER_ID, parsePromptHistoryLine } from './prompt-history-file.js';
import { StoredLines, splitStoredLines } from './stored-append-lines.js';

import type {
  IAppendFileCatchUpFailure,
  IAppendFileRewriter,
  TAppendFileRefusal,
} from './append-file-rewrite.js';
import type { IStoredLineSink } from './stored-append-lines.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';

const NEWLINE = '\n';

/** Why a history was left as it is. */
export type TPromptHistoryRefusal = TAppendFileRefusal;

export interface IInspectPromptHistoryOptions {
  /** Opens sealed lines; with the keys locked, inspecting a sealed line throws `ArtifactLockedError`. */
  readonly sealer: IArtifactSealer;
}

export interface ICompactPromptHistoryOptions {
  /**
   * Seals every entry and opens the sealed ones. Give the compaction a sealer of its own so all of
   * its lines share one writer epoch. With the keys locked it stops with `ArtifactLockedError` and
   * replaces nothing.
   */
  readonly sealer: IArtifactSealer;
  /** An ancestor of the file the host also owns, tightened along with the directory. */
  readonly ownedRoot?: string;
  /**
   * Runs once the new file is written and flushed, just before it replaces the history. Throwing
   * abandons the compaction with nothing replaced and no temporary file left.
   */
  readonly beforeCommit?: () => void;
  /** Waits between catch-up passes over the replaced file; defaults to a short timer. */
  readonly pause?: () => Promise<void>;
}

export type TPromptHistoryInspection =
  | { readonly status: 'missing' }
  | { readonly status: 'refused'; readonly reason: TPromptHistoryRefusal }
  | {
      readonly status: 'present';
      /** Physical lines that are plaintext. */
      readonly plainLines: number;
      /** Physical lines sealed in this build's framing that open. */
      readonly sealedLines: number;
      /** Physical lines that do not open here or that a newer build sealed. */
      readonly unreadableLines: number;
    };

export type TPromptHistoryCompaction =
  | { readonly status: 'missing' }
  | { readonly status: 'refused'; readonly reason: TPromptHistoryRefusal }
  /** Another compaction replaced the history before this one's rename; nothing was replaced. */
  | { readonly status: 'replaced' }
  /** The history was deleted before this compaction's rename; nothing was put in its place. */
  | { readonly status: 'removed' }
  | {
      readonly status: 'compacted';
      /** Entries written sealed, one per line. */
      readonly entries: number;
      /** Of those, entries that were plain lines. */
      readonly fromPlain: number;
      /** Of those, entries appended after the snapshot and caught up from the replaced file. */
      readonly caughtUp: number;
      /** Lines that do not open here, or that a newer build sealed, carried over unchanged. */
      readonly carriedOver: number;
      /** The replaced file ended in an unfinished sealed append, which no reader shows; it was dropped. */
      readonly droppedTail: boolean;
      /** Plain lines in the new file afterwards: plaintext an older build appended meanwhile. */
      readonly plainLinesAfter: number;
      /**
       * Set when the catch-up failed after the rename: entries appended to the replaced file from
       * then on are not in the history (their session records hold them).
       */
      readonly catchUpFailed?: IAppendFileCatchUpFailure;
    };

interface IRewriteCounts {
  entries: number;
  fromPlain: number;
  carriedOver: number;
}

/**
 * Rewrites physical lines: every entry a line holds becomes one sealed line, a line that does not
 * open or that a newer build sealed is carried over as it is, and empty lines go (readers skip them).
 * `leadingNewline` keeps the append framing of a file other writers append to at the same time.
 */
class EntryRewriter implements IAppendFileRewriter {
  readonly counts: IRewriteCounts = { entries: 0, fromPlain: 0, carriedOver: 0 };
  readonly #lines: StoredLines;

  constructor(sealer: IArtifactSealer) {
    this.#lines = new StoredLines({ sealer }, 'prompt-history-line');
  }

  rewrite(lines: Iterable<string>, out: IStoredLineSink, leadingNewline: boolean): void {
    for (const physical of lines) {
      if (physical.length === 0) continue;
      const read = this.#lines.decode(physical, PROMPT_HISTORY_OWNER_ID);
      if (read.kind === 'locked') throw new ArtifactLockedError(read.reason);
      if (read.kind !== 'lines') {
        out.write(`${physical}${NEWLINE}`);
        this.counts.carriedOver += 1;
        continue;
      }
      if (!isSealedArtifactLine(physical)) this.counts.fromPlain += read.lines.length;
      for (const text of read.lines) {
        // A sealed append is framed `\n<line>\n`; a file this rewrite writes alone needs no leading one.
        const stored = this.#lines.encode(`${text}${NEWLINE}`, PROMPT_HISTORY_OWNER_ID);
        out.write(leadingNewline ? stored : stored.slice(NEWLINE.length));
        this.counts.entries += 1;
      }
    }
  }
}

/** What the history holds, line by line, as {@link compactPromptHistoryFile} would find it. */
export function inspectPromptHistoryFile(
  path: string,
  options: IInspectPromptHistoryOptions,
): TPromptHistoryInspection {
  const opened = openAppendFile(path);
  if (opened.status !== 'open') return opened;
  const lines = new StoredLines({ sealer: options.sealer }, 'prompt-history-line');
  let plainLines = 0;
  let sealedLines = 0;
  let unreadableLines = 0;
  try {
    for (const physical of splitStoredLines(readWhole(opened.descriptor).toString('utf8'))) {
      if (physical.length === 0) continue;
      const read = lines.decode(physical, PROMPT_HISTORY_OWNER_ID);
      if (read.kind === 'locked') throw new ArtifactLockedError(read.reason);
      if (read.kind !== 'lines') unreadableLines += 1;
      else if (isSealedArtifactLine(physical)) sealedLines += 1;
      else plainLines += 1;
    }
  } finally {
    closeSync(opened.descriptor);
  }
  return { status: 'present', plainLines, sealedLines, unreadableLines };
}

/**
 * The distinct `project` values the history's entries name, plain or sealed, in the order first met;
 * lines that do not open or do not parse are passed over. A history that is missing or refused names
 * none. Writes nothing.
 */
export function readPromptHistoryProjects(
  path: string,
  options: IInspectPromptHistoryOptions,
): readonly string[] {
  const opened = openAppendFile(path);
  if (opened.status !== 'open') return [];
  const lines = new StoredLines({ sealer: options.sealer }, 'prompt-history-line');
  const projects = new Set<string>();
  try {
    for (const physical of splitStoredLines(readWhole(opened.descriptor).toString('utf8'))) {
      if (physical.length === 0) continue;
      const read = lines.decode(physical, PROMPT_HISTORY_OWNER_ID);
      if (read.kind === 'locked') throw new ArtifactLockedError(read.reason);
      if (read.kind !== 'lines') continue;
      for (const text of read.lines) {
        const entry = parsePromptHistoryLine(text);
        if (entry !== undefined && entry.project.length > 0) projects.add(entry.project);
      }
    }
  } finally {
    closeSync(opened.descriptor);
  }
  return [...projects];
}

/**
 * Compacts the history at `path` as the module documentation describes. Rerunning it gives the same
 * entries under a new writer epoch.
 */
export async function compactPromptHistoryFile(
  path: string,
  options: ICompactPromptHistoryOptions,
): Promise<TPromptHistoryCompaction> {
  const rewriter = new EntryRewriter(options.sealer);
  let entriesInSnapshot = 0;
  const result = await rewriteAppendFile(path, rewriter, {
    ...(options.ownedRoot === undefined ? {} : { ownedRoot: options.ownedRoot }),
    ...(options.pause === undefined ? {} : { pause: options.pause }),
    beforeCommit: () => {
      entriesInSnapshot = rewriter.counts.entries;
      options.beforeCommit?.();
    },
  });
  if (result.status !== 'rewritten') return result;
  return {
    status: 'compacted',
    ...rewriter.counts,
    caughtUp: rewriter.counts.entries - entriesInSnapshot,
    droppedTail: result.droppedTail,
    plainLinesAfter: result.plainLinesAfter,
    ...(result.catchUpFailed === undefined ? {} : { catchUpFailed: result.catchUpFailed }),
  };
}
