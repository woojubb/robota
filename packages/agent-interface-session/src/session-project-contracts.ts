/**
 * #3282 §4c — the Project panel's read contracts: git status, one file's diff, and project memory as
 * readable text. A session method's return value crosses the wire UNCHANGED as the matching message's
 * payload (the same shape `TWaitingLoopStopOutcome` already uses for `stopWaitingSelfPacedLoop`) — no
 * separate wire-shape/session-shape pair to keep in sync.
 */
import type { IDiffLine } from './session-event-map.js';

/** Never a raw git XY code — the #3277 "usable by anyone" principle applies to this panel too. */
export type TProjectFileStatus =
  | 'Added'
  | 'Modified'
  | 'Deleted'
  | 'Renamed'
  | 'Copied'
  | 'Untracked'
  | 'Conflicted';

export interface IProjectStatusFile {
  path: string;
  status: TProjectFileStatus;
  /** For a rename/copy, the record's own prior path. */
  renamedFrom?: string;
  /** Lines added/removed since HEAD (or the empty tree on an unborn branch). Absent for Untracked,
   *  Conflicted, and a binary file. */
  added?: number;
  removed?: number;
}

/**
 * `not-a-repository` is the panel's one plain sentence, not an error — most workspaces this panel
 * opens over are a git repository, but nothing requires it.
 */
export type TProjectStatusRead =
  | {
      readonly kind: 'status';
      readonly branch?: string;
      readonly unborn: boolean;
      readonly files: readonly IProjectStatusFile[];
      /** True when `files` stopped at the server's own file-count cap — there were more. */
      readonly truncated: boolean;
    }
  | { readonly kind: 'not-a-repository' }
  | { readonly kind: 'failed'; readonly message: string };

export type TProjectDiffRead =
  | { readonly kind: 'diff'; readonly diffLines: readonly IDiffLine[]; readonly truncated: boolean }
  | { readonly kind: 'not-a-repository' }
  | { readonly kind: 'outside-workspace' }
  | { readonly kind: 'failed'; readonly message: string };

export type TProjectMemoryRead =
  | { readonly kind: 'memory'; readonly content: string; readonly path: string; readonly truncated: boolean }
  | { readonly kind: 'unavailable'; readonly message: string };
