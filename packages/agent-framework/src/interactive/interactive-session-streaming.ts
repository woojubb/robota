/**
 * Streaming and tool-event helpers for InteractiveSession.
 *
 * Pure functions that process streaming text deltas and tool execution events,
 * updating state passed in by reference. No class dependency.
 */

import { randomUUID } from 'node:crypto';
import { relative, resolve } from 'node:path';

import { isPathInside } from '@robota-sdk/agent-core/node';

import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { IDiffLine, IToolState } from './types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { TToolArgs } from '@robota-sdk/agent-core';

/** Max chars to display from first tool argument. */
const TOOL_ARG_DISPLAY_MAX = 80;
const TAIL_KEEP = 30;
/** Max completed tools to keep in the activeTools array during a single response. */
const MAX_COMPLETED_TOOLS = 50;
/** Streaming text flush interval (ms) — ~60fps. */
export const STREAMING_FLUSH_INTERVAL_MS = 16;
const DEFAULT_START_LINE = 1;
const EDIT_DIFF_CONTEXT_LINES = 3;
/**
 * #3288 review SHOULD 3: a diff preview's remove/add side (Edit) or whole-file preview (Write) is
 * capped this many lines before it is truncated — one shared constant so neither builder can flood
 * the wire or the renderer with an unbounded change.
 */
const MAX_DIFF_LINES = 500;

/**
 * #3288: the workspace-relative form of an absolute path, for DISPLAY only (`firstArg` is untouched —
 * this is additive). Containment check mirrors `edit-checkpoint-store.ts`'s `captureFile`: a path
 * outside `cwd` (or an ambiguous resolve, e.g. across drives) is shown unchanged, absolute.
 */
export function toWorkspaceRelativeDisplayPath(cwd: string, filePath: string): string {
  const absolute = resolve(cwd, filePath);
  const relativePath = relative(cwd, absolute);
  const withinWorkspace =
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    resolve(cwd, relativePath) === absolute;
  return withinWorkspace ? relativePath : filePath;
}

/** Extract a short display string from the first tool argument. */
export function extractFirstArg(toolArgs?: TToolArgs): string {
  if (!toolArgs) return '';
  const firstVal = Object.values(toolArgs)[0];
  const raw = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? '');
  return raw.length > TOOL_ARG_DISPLAY_MAX
    ? raw.slice(0, TOOL_ARG_DISPLAY_MAX - TAIL_KEEP - 3) + '...' + raw.slice(-TAIL_KEEP)
    : raw;
}

/** Mutable streaming state passed between helpers. */
export interface IStreamingState {
  activeTools: IToolState[];
  history: IHistoryEntry[];
}

interface IToolEndEvent {
  type?: 'start' | 'end';
  toolName: string;
  toolArgs?: TToolArgs;
  success?: boolean;
  denied?: boolean;
  toolResultData?: string;
  executionId?: string;
}

/** #3288 §2: exported so the history-replay projector can extract a path arg the same way live does. */
export function getStringArg(
  args: TToolArgs | undefined,
  snake: string,
  camel: string,
): string | null {
  const value = args?.[snake] ?? args?.[camel];
  return typeof value === 'string' ? value : null;
}

/** The `startLine` the Edit tool itself reported in its (post-execution) result, if parseable. */
function parseStartLineFromResult(toolResultData: string | undefined): number | undefined {
  if (!toolResultData) return undefined;
  try {
    const parsed = JSON.parse(toolResultData) as Partial<{ startLine: number }>;
    return typeof parsed.startLine === 'number' && Number.isFinite(parsed.startLine)
      ? parsed.startLine
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the edit starts: the tool's own reported `startLine` when available (post-execution — the
 * file may already have changed, so re-deriving from its CURRENT content would search the wrong
 * text), else found by searching the CURRENT file content for `oldString` (pre-execution preview —
 * mirrors the same search the Edit tool itself performs, `edit-tool.ts`'s `content.indexOf`).
 *
 * `fs` is `undefined` when the path failed the containment guard in `buildEditDiffState` — in that
 * case this never touches disk and simply falls back to the default line.
 */
function resolveEditStartLine(
  toolResultData: string | undefined,
  filePath: string,
  oldString: string,
  fs: IFileSystem | undefined,
): number {
  const fromResult = parseStartLineFromResult(toolResultData);
  if (fromResult !== undefined) return fromResult;
  if (fs === undefined) return DEFAULT_START_LINE;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const matchIdx = content.indexOf(oldString);
    if (matchIdx >= 0) return content.slice(0, matchIdx).split('\n').length;
  } catch {
    // allow-fallback: unreadable file (e.g. a pre-execution preview of a not-yet-created path)
  }
  return DEFAULT_START_LINE;
}

/**
 * #3288 review MUST 1: whether `filePath` may be read at all to build a diff preview — the ONE guard
 * every disk read in this file goes through, for both the pre-approval permission-request preview
 * (`session-prompt-registry.ts`, before the person has agreed to anything) and the post-execution
 * `tool_end` context read (which had the same gap before this file grew a pre-approval caller).
 *
 * `cwd === undefined` refuses (no workspace to confine reads to — mirrors `agent-tools`'
 * `checkPathWithinCwd`'s ARCH-010 fail-closed default). Containment is decided on CANONICAL
 * (symlink-resolved) paths via `isPathInside`, the repo's one SSOT for this (`agent-core`'s
 * `path-containment.ts`): a purely lexical `resolve()`/`startsWith` check would let a symlink SITTING
 * inside the workspace but POINTING outside it through, exactly the defect that SSOT exists to close.
 * A model-supplied Edit path is exactly the untrusted input that check is for.
 */
function isSafeToReadForDiff(cwd: string | undefined, resolvedFilePath: string): boolean {
  return cwd !== undefined && isPathInside(cwd, resolvedFilePath);
}

/**
 * Where a RELATIVE `filePath` the model supplied is anchored, for BOTH the containment check AND the
 * actual read — the containment root (`cwd`), never `process.cwd()`. `isPathInside` and
 * `fs.readFileSync` each canonicalize a relative candidate against the PROCESS's own directory when
 * given one on their own, so passing the raw (possibly relative) `filePath` straight to both checked
 * it against one root while reading it from another — the same #2429 defect
 * `agent-tools/path-guard.ts`'s `resolveHostPath` exists to close. Resolving once, here, and reusing
 * the result for every downstream call keeps the two decisions from disagreeing. With no `cwd` there
 * is nothing to anchor to; the path is returned as written, and `isSafeToReadForDiff` then refuses it
 * (ARCH-010 fail-closed).
 */
function resolveFilePathForDiffRead(cwd: string | undefined, filePath: string): string {
  return cwd === undefined ? filePath : resolve(cwd, filePath);
}

function buildEditDiffState(
  event: { toolArgs?: TToolArgs; toolResultData?: string },
  cwd: string | undefined,
  fs: IFileSystem,
): Pick<IToolState, 'diffFile' | 'diffLines'> {
  const filePath = getStringArg(event.toolArgs, 'file_path', 'filePath');
  const oldString = getStringArg(event.toolArgs, 'old_string', 'oldString');
  const newString = getStringArg(event.toolArgs, 'new_string', 'newString');
  if (!filePath || oldString === null || newString === null || oldString === newString) return {};

  const resolvedFilePath = resolveFilePathForDiffRead(cwd, filePath);
  const readableFs = isSafeToReadForDiff(cwd, resolvedFilePath) ? fs : undefined;
  const startLine = resolveEditStartLine(event.toolResultData, resolvedFilePath, oldString, readableFs);
  return {
    diffFile: cwd ? toWorkspaceRelativeDisplayPath(cwd, filePath) : filePath,
    diffLines: buildEditDiffLinesWithContext(
      oldString,
      newString,
      startLine,
      resolvedFilePath,
      readableFs,
    ),
  };
}

/** #3288: Write has no "old" side to diff against — the whole new content is shown as additions. */
function buildWriteDiffState(
  event: { toolArgs?: TToolArgs },
  cwd: string | undefined,
): Pick<IToolState, 'diffFile' | 'diffLines'> {
  const filePath = getStringArg(event.toolArgs, 'file_path', 'filePath');
  const content = getStringArg(event.toolArgs, 'content', 'content');
  if (!filePath || content === null) return {};

  const lines = content.split('\n');
  const truncated = lines.length > MAX_DIFF_LINES;
  const shown = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
  const diffLines: IDiffLine[] = [
    { type: 'hunk', text: `@@ -0,0 +1,${lines.length} @@`, lineNumber: 1 },
    ...shown.map((text, index) => ({ type: 'add' as const, text, lineNumber: index + 1 })),
  ];
  if (truncated) {
    diffLines.push({
      type: 'hunk',
      text: `… ${lines.length - MAX_DIFF_LINES} more lines truncated`,
      lineNumber: shown.length + 1,
    });
  }
  return {
    diffFile: cwd ? toWorkspaceRelativeDisplayPath(cwd, filePath) : filePath,
    diffLines,
  };
}

/**
 * #3288: the ONE diff builder — Edit and Write both go through here, at `tool_end` AND at a
 * permission-request preview (`session-prompt-registry.ts`, before the tool has run). No other file
 * builds a diff; a surface renders whatever `diffLines`/`diffFile` this attaches to the wire state.
 */
export function buildDiffState(
  event: { toolName: string; toolArgs?: TToolArgs; toolResultData?: string },
  cwd?: string,
  fs: IFileSystem = new NodeFileSystem(),
): Pick<IToolState, 'diffFile' | 'diffLines'> {
  if (event.toolName === 'Edit') return buildEditDiffState(event, cwd, fs);
  if (event.toolName === 'Write') return buildWriteDiffState(event, cwd);
  return {};
}

/**
 * #3288 review SHOULD 3: one side (all-removed or all-added lines) of an Edit diff, capped at
 * `MAX_DIFF_LINES` with a trailing truncation marker — mirrors Write's own cap so neither an
 * enormous `old_string` nor an enormous `new_string` can flood the wire or the renderer.
 */
function buildCappedDiffSide(
  type: 'remove' | 'add',
  text: string,
  startLine: number,
): IDiffLine[] {
  const lines = text.split('\n');
  const truncated = lines.length > MAX_DIFF_LINES;
  const shown = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
  const diffLines: IDiffLine[] = shown.map((lineText, index) => ({
    type,
    text: lineText,
    lineNumber: startLine + index,
  }));
  if (truncated) {
    const noun = type === 'remove' ? 'removed' : 'added';
    diffLines.push({
      type: 'hunk',
      text: `… ${lines.length - MAX_DIFF_LINES} more ${noun} lines truncated`,
      lineNumber: startLine + shown.length,
    });
  }
  return diffLines;
}

function buildEditDiffLines(oldString: string, newString: string, startLine: number): IDiffLine[] {
  return [
    ...buildCappedDiffSide('remove', oldString, startLine),
    ...buildCappedDiffSide('add', newString, startLine),
  ];
}

/**
 * `fs` is `undefined` when `buildEditDiffState` decided the path is not safe to read (outside the
 * workspace, or a symlink that resolves outside it) — this then returns the diff with NO context
 * lines, never touching disk. See `isSafeToReadForDiff`.
 */
function buildEditDiffLinesWithContext(
  oldString: string,
  newString: string,
  startLine: number,
  filePath: string,
  fs: IFileSystem | undefined,
): IDiffLine[] {
  const diffLines = buildEditDiffLines(oldString, newString, startLine);
  if (fs === undefined) return diffLines;

  let fileLines: string[];
  try {
    fileLines = fs.readFileSync(filePath, 'utf8').split('\n');
  } catch {
    // allow-fallback: unreadable file returns diff without context lines
    return diffLines;
  }

  const beforeContext: IDiffLine[] = [];
  const contextStart = Math.max(0, startLine - 1 - EDIT_DIFF_CONTEXT_LINES);
  for (let index = contextStart; index < startLine - 1; index++) {
    if (index < fileLines.length) {
      beforeContext.push({ type: 'context', text: fileLines[index], lineNumber: index + 1 });
    }
  }

  const afterContext: IDiffLine[] = [];
  const afterStart = startLine - 1 + newString.split('\n').length;
  for (let index = afterStart; index < afterStart + EDIT_DIFF_CONTEXT_LINES; index++) {
    if (index < fileLines.length) {
      afterContext.push({ type: 'context', text: fileLines[index], lineNumber: index + 1 });
    }
  }

  const hunkStart =
    beforeContext[0]?.lineNumber ??
    diffLines[0]?.lineNumber ??
    afterContext[0]?.lineNumber ??
    startLine;
  const oldLineCount = oldString.split('\n').length;
  const newLineCount = newString.split('\n').length;
  const oldHunkLineCount = beforeContext.length + oldLineCount + afterContext.length;
  const newHunkLineCount = beforeContext.length + newLineCount + afterContext.length;

  return [
    {
      type: 'hunk',
      text: `@@ -${hunkStart},${oldHunkLineCount} +${hunkStart},${newHunkLineCount} @@`,
      lineNumber: hunkStart,
    },
    ...beforeContext,
    ...diffLines,
    ...afterContext,
  ];
}

/** Build a tool-summary history entry from current active tools and push it into history. */
export function pushToolSummaryToHistory(state: IStreamingState): void {
  if (state.activeTools.length === 0) return;
  const summary = state.activeTools
    .map((t) => {
      const status = t.isRunning
        ? '⟳'
        : t.result === 'success'
          ? '✓'
          : t.result === 'error'
            ? '✗'
            : '⊘';
      return `${status} ${t.toolName}${t.firstArg ? `(${t.firstArg})` : ''}`;
    })
    .join('\n');

  state.history.push({
    id: randomUUID(),
    timestamp: new Date(),
    category: 'event',
    type: 'tool-summary',
    data: {
      tools: state.activeTools.map((t) => ({
        toolName: t.toolName,
        firstArg: t.firstArg,
        isRunning: t.isRunning,
        result: t.result,
        diffFile: t.diffFile,
        diffLines: t.diffLines,
        toolResultData: t.toolResultData,
      })),
      summary,
    },
  });
}

/** Trim oldest completed tools from the activeTools array if over the limit. */
function trimCompletedTools(activeTools: IToolState[]): IToolState[] {
  const completed = activeTools.filter((t) => !t.isRunning);
  if (completed.length <= MAX_COMPLETED_TOOLS) return activeTools;

  const excess = completed.length - MAX_COMPLETED_TOOLS;
  let removed = 0;
  return activeTools.filter((t) => {
    if (!t.isRunning && removed < excess) {
      removed++;
      return false;
    }
    return true;
  });
}

/** Process a tool-start event: add to activeTools and push to history. */
export function applyToolStart(
  state: IStreamingState,
  event: {
    toolName: string;
    toolArgs?: TToolArgs;
    executionId?: string;
    /** #3288: the `/command` this call projects, when it is a model-command-projection tool. */
    commandName?: string;
    /** #3288: true for an internal signal tool (e.g. goal-status) — never shown as a call. */
    internal?: boolean;
  },
  /** Shown beside the tool name instead of its first argument (the Advisor's model). */
  label?: string,
  /** #3288: the session's cwd, so a path argument can also get a workspace-relative display form. */
  cwd?: string,
): IToolState {
  const firstArg = label ?? extractFirstArg(event.toolArgs);
  const filePathArg = getStringArg(event.toolArgs, 'file_path', 'filePath');
  const displayPath = cwd && filePathArg ? toWorkspaceRelativeDisplayPath(cwd, filePathArg) : undefined;
  const toolState: IToolState = {
    toolName: event.toolName,
    firstArg,
    isRunning: true,
    ...(event.executionId ? { executionId: event.executionId } : {}),
    ...(displayPath ? { displayPath } : {}),
    ...(event.commandName ? { commandName: event.commandName } : {}),
    ...(event.internal ? { internal: true } : {}),
  };
  state.activeTools.push(toolState);

  state.history.push({
    id: randomUUID(),
    timestamp: new Date(),
    category: 'event',
    type: 'tool-start',
    data: { toolName: event.toolName, firstArg, isRunning: true },
  });

  return toolState;
}

/** Process a tool-end event: mark the tool finished and push to history. Returns updated tool or null. */
export function applyToolEnd(
  state: IStreamingState,
  event: IToolEndEvent,
  /** #3288: the session's cwd, threaded to `buildDiffState` for a workspace-relative `diffFile`. */
  cwd?: string,
): IToolState | null {
  const result: IToolState['result'] = event.denied
    ? 'denied'
    : event.success === false
      ? 'error'
      : 'success';

  // #3288: a tool_end is attributed by executionId first — two same-named parallel calls can finish
  // out of start order, and matching by name alone would close whichever running call of that name
  // was found first, regardless of which one actually finished. Falls back to the name+running
  // heuristic only when the event carries no executionId (legacy fixtures / old hosts).
  const idx =
    event.executionId !== undefined
      ? state.activeTools.findIndex((t) => t.executionId === event.executionId && t.isRunning)
      : state.activeTools.findIndex((t) => t.toolName === event.toolName && t.isRunning);
  if (idx === -1) return null;

  const finished: IToolState = {
    ...state.activeTools[idx]!,
    ...buildDiffState(event, cwd),
    isRunning: false,
    result,
    toolResultData: event.toolResultData,
  };
  state.activeTools[idx] = finished;
  state.activeTools = trimCompletedTools(state.activeTools);

  state.history.push({
    id: randomUUID(),
    timestamp: new Date(),
    category: 'event',
    type: 'tool-end',
    data: {
      toolName: finished.toolName,
      firstArg: finished.firstArg,
      isRunning: false,
      result,
      toolResultData: event.toolResultData,
    },
  });

  return finished;
}
