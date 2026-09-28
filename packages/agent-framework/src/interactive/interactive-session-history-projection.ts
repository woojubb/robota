/**
 * #3288 §2 (history replay): projects STORED chat history into the same display shapes a live stream
 * produces — text runs and finished tool calls, in chronological order — so a reload, a reconnect, or
 * a session resume shows the same tool rows, diffs, and Shell output a live turn would have shown,
 * instead of losing them back to bare text (the pre-existing gap `case 'messages'` in
 * `useSessionClient.ts` left: only `role: 'user'|'assistant'` text survived a replay; every tool call
 * and its result were simply dropped).
 *
 * `IHistoryEntry`'s `category: 'chat'` entries already hold everything needed: an assistant message's
 * `toolCalls` (id, name, JSON-string arguments) and each call's paired result as a SEPARATE
 * `role: 'tool'` entry whose `toolCallId` equals that same id (`@robota-sdk/agent-core`'s
 * `messages.ts`). Pairing a call to its result is by that id — the same id a model can reuse across
 * PARALLEL calls of the same tool name in one turn, so matching by name would pair the wrong result to
 * the wrong call exactly when it matters most.
 */
import {
  buildDiffState,
  extractFirstArg,
  getStringArg,
  toWorkspaceRelativeDisplayPath,
} from './interactive-session-streaming.js';
import { GOAL_SIGNAL_TOOL_NAME } from '../goal/index.js';

import type {
  IAssistantMessage,
  IHistoryEntry,
  IToolCall,
  IToolMessage,
  TToolArgs,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { IHistoryDisplaySegment, IToolState } from '@robota-sdk/agent-interface-session';

export interface IHistoryProjectionOptions {
  /** The session's cwd — used ONLY for the pure, lexical display-path rewrite, never for a disk read. */
  cwd?: string;
  /** Projects a tool name to the `/command` it stands in for; mirrors live's `applyToolStart`. */
  modelCommandToolNames?: ReadonlyMap<string, string>;
}

/** Parse a tool call's JSON-string arguments back into the object shape `buildDiffState` expects. */
function parseToolCallArguments(raw: string): TToolArgs {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as TToolArgs)
      : {};
  } catch {
    // allow-fallback: a call whose arguments failed to decode never reached the tool either (see
    // `isArgumentDecodeErrorResult`) — an empty args object still produces a valid, if argument-less,
    // row instead of losing the whole segment.
    return {};
  }
}

/** `metadata.success` is the ONE signal `addToolResultsToHistory` persists (see its own file) — a
 * denied-vs-failed distinction is a LIVE, ephemeral concept (`session-prompt-registry.ts`'s pending
 * prompt) that is never written into the stored tool-result contract, so a replay cannot recover it
 * and collapses both into `'error'`. */
function resultStatusFrom(resultMessage: IToolMessage): 'success' | 'error' {
  return resultMessage.metadata?.['success'] === true ? 'success' : 'error';
}

/**
 * One finished call's `IToolState`, built the SAME way a live `tool_end` builds one — except the diff
 * (Edit/Write) is built from the call's ARGUMENTS ONLY. `buildDiffState` is called with no `cwd`,
 * which its own MUST-1 containment guard (`isSafeToReadForDiff` in `interactive-session-streaming.ts`)
 * already fails closed on whenever `cwd` is `undefined` — the same "no file context" mode the live
 * PRE-APPROVAL diff preview relies on for a path it must not read yet. Reused deliberately rather than
 * reimplemented: a file a historical Edit touched may since have changed, moved, or been deleted, so
 * reading it now would show today's content as if it were the diff's context — wrong, not just stale.
 *
 * `resultMessage === undefined` means the call's turn was interrupted before any result was recorded
 * (`IBaseMessage.state: 'interrupted'`) — a static replay has no way to make it finish, and a
 * perpetual "running" spinner would misrepresent a page that is not live. It renders as a failed call.
 */
function buildHistoricalToolState(
  toolCall: IToolCall,
  resultMessage: IToolMessage | undefined,
  options: IHistoryProjectionOptions,
): IToolState {
  const toolName = toolCall.function.name;
  const toolArgs = parseToolCallArguments(toolCall.function.arguments);
  const firstArg = extractFirstArg(toolArgs);
  const filePathArg = getStringArg(toolArgs, 'file_path', 'filePath');
  const displayPath =
    options.cwd && filePathArg ? toWorkspaceRelativeDisplayPath(options.cwd, filePathArg) : undefined;
  const commandName = options.modelCommandToolNames?.get(toolName);
  const internal = toolName === GOAL_SIGNAL_TOOL_NAME;

  const base: IToolState = {
    toolName,
    firstArg,
    isRunning: false,
    result: resultMessage ? resultStatusFrom(resultMessage) : 'error',
    executionId: toolCall.id,
    ...(displayPath ? { displayPath } : {}),
    ...(commandName ? { commandName } : {}),
    ...(internal ? { internal: true } : {}),
  };
  if (!resultMessage) return base;

  const { diffFile: rawDiffFile, diffLines } = buildDiffState({
    toolName,
    toolArgs,
    toolResultData: resultMessage.content,
  });
  const diffFile =
    options.cwd && rawDiffFile ? toWorkspaceRelativeDisplayPath(options.cwd, rawDiffFile) : rawDiffFile;

  return {
    ...base,
    toolResultData: resultMessage.content,
    ...(diffFile ? { diffFile } : {}),
    ...(diffLines ? { diffLines } : {}),
  };
}

/** Every tool-result entry, keyed by the call id it answers — built once, read for every call. */
function indexToolResultsById(messages: readonly TUniversalMessage[]): Map<string, IToolMessage> {
  const byCallId = new Map<string, IToolMessage>();
  for (const message of messages) {
    if (message.role === 'tool') byCallId.set(message.toolCallId, message);
  }
  return byCallId;
}

/**
 * Projects an assistant message's own content and tool calls into display segments, in the order a
 * live stream would have produced them: its text (if it said anything), then each of its tool calls.
 */
function projectAssistantMessage(
  message: IAssistantMessage,
  resultsByCallId: ReadonlyMap<string, IToolMessage>,
  options: IHistoryProjectionOptions,
): IHistoryDisplaySegment[] {
  const segments: IHistoryDisplaySegment[] = [];
  if (message.content) {
    segments.push({ type: 'text', role: 'assistant', content: message.content });
  }
  for (const toolCall of message.toolCalls ?? []) {
    const tool = buildHistoricalToolState(toolCall, resultsByCallId.get(toolCall.id), options);
    segments.push({ type: 'tool', tool });
  }
  return segments;
}

/**
 * Turns STORED history into the chronological sequence of display segments described at the top of
 * this file. `history` is the session's full timeline (`getFullHistory()`); only `category: 'chat'`
 * entries carry a message — anything else (an event entry, a tool-summary entry, …) is skipped, the
 * same filter `getMessages()` itself applies.
 */
export function projectHistoryForDisplay(
  history: readonly IHistoryEntry[],
  options: IHistoryProjectionOptions = {},
): IHistoryDisplaySegment[] {
  const messages = history
    .filter((entry) => entry.category === 'chat')
    .map((entry) => entry.data as TUniversalMessage);
  const resultsByCallId = indexToolResultsById(messages);

  const segments: IHistoryDisplaySegment[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      segments.push({ type: 'text', role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      segments.push(...projectAssistantMessage(message, resultsByCallId, options));
    }
    // 'system' and 'tool' entries carry no segment of their own — a 'tool' entry was already
    // consumed above, paired to its call by id via `resultsByCallId`.
  }
  return segments;
}
