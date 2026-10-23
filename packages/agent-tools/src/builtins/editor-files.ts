/**
 * The file tools' access through an editor that has the workspace open.
 *
 * An editor that holds the session's files open can carry the reads and writes themselves: the agent
 * then reads what the editor shows, unsaved changes included, and its writes land in the editor, which
 * shows them and keeps them in its own undo history. The tool decides everything before it asks:
 * containment, the session's permission gate and the tool's limits run first, and the editor only
 * performs the access. An editor is not a sandbox: its files are the host's files, so it never
 * replaces the host path guard and never carries commands or searches.
 */

import type { IToolInvocationResult } from '../types/tool-result.js';

/** What the editor offers. A method it does not offer is absent, and the tool uses the disk for it. */
export interface IEditorFileAccess {
  /** The file's text as the editor has it. `path` is absolute. */
  readTextFile?(path: string, signal?: AbortSignal): Promise<string>;
  /** Replace the file's text in the editor. `path` is absolute. */
  writeTextFile?(path: string, content: string, signal?: AbortSignal): Promise<void>;
}

/** The tool option that reaches an editor's file access. */
export interface IEditorFileOptions {
  /**
   * The editor's file access, asked at each call: an editor connects after the tools are built and
   * can go away. Absent, or answering `undefined`, means the disk.
   */
  editorFiles?: () => IEditorFileAccess | undefined;
}

type TEditorRead = (path: string, signal?: AbortSignal) => Promise<string>;
type TEditorWrite = (path: string, content: string, signal?: AbortSignal) => Promise<void>;

/** The editor's read for this call, when an editor is attached and offers reads. */
export function editorRead(options: IEditorFileOptions): TEditorRead | undefined {
  const access = options.editorFiles?.();
  return access?.readTextFile?.bind(access);
}

/** The editor's write for this call, when an editor is attached and offers writes. */
export function editorWrite(options: IEditorFileOptions): TEditorWrite | undefined {
  const access = options.editorFiles?.();
  return access?.writeTextFile?.bind(access);
}

/** The signal an editor request is cancelled by: the tool's own, the call's, or either. */
export function editorSignal(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  return present.length > 1 ? AbortSignal.any(present) : present[0];
}

/** An editor's refusal or failure, as the tool's error result. */
export function editorFailure(action: 'read' | 'write', path: string, error: unknown): string {
  const cause = error instanceof Error ? error.message : String(error);
  const result: IToolInvocationResult = {
    success: false,
    output: '',
    error: `The editor could not ${action} ${path}: ${cause}`,
  };
  return JSON.stringify(result);
}

/**
 * A disk search's result while an editor is attached. Nothing tells the agent which files the editor
 * holds unsaved, and asking the editor for every reported file would open a buffer per result, so the
 * search says what it read instead of claiming the editor's view.
 */
export function withDiskSearchNotice(output: string, options: IEditorFileOptions): string {
  const access = options.editorFiles?.();
  if (access === undefined) return output;
  if (access.readTextFile === undefined && access.writeTextFile === undefined) return output;
  const readHint =
    access.readTextFile === undefined ? '' : ' Read returns a file as the editor has it.';
  return (
    `${output}\n\n[Searched the files on disk. The editor may hold changes to them that are not ` +
    `saved yet, which this search does not see.${readHint}]`
  );
}
