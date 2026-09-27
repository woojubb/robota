/**
 * GUI-005 — the transport-neutral session reducer for the GUI presentation layer. Reconstructs conversation
 * state from the wire `TServerMessage` stream, independent of HOW the bytes arrive (a `TMakeSessionClient`
 * factory over `{onMessage, onStatusChange}`). The core is **generic over its status type** (default
 * `TConnectionStatus`) so a surface with extra connection states (e.g. the browser WebRTC surface) can widen it
 * WITHOUT this core depending on that surface's types — keeping the dependency direction acyclic.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import {
  applyPromptEvent,
  askResponse,
  permissionResponse,
  type TPendingPrompt,
} from './prompt-state.js';
import {
  describeUiIntentForGui,
  guiScreenForUiIntent,
  uiIntentCommandName,
} from './ui-intent-state.js';
import { createWsSessionClient } from '../client/ws-session-client.js';
import { SERVER_MESSAGE_HANDLING } from './server-message-handling.js';
import { useExecutionDetailState } from './use-execution-detail.js';
import { usePersonalUsageState } from './use-personal-usage.js';
import { useSessionDirectoryState } from './use-session-directory.js';
import { useSettingsState } from './use-settings-state.js';

import type {
  IActiveTool,
  IChangedFileSummary,
  IQueuedPrompt,
  ISessionClientHandle,
  ISessionNotice,
  IWsSessionState,
  TCommandCatalog,
  TConversationEntry,
  TMakeSessionClient,
  TSessionStatus,
} from './session-client-types.js';
import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';
import type {
  IToolState,
  TDriverId,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-execution';
import type { TServerMessage } from '@robota-sdk/agent-transport';

export type {
  IActiveTool,
  IChangedFileSummary,
  IChangedFilesEntry,
  ICommandOutputEntry,
  IConversationMessage,
  IToolGroupEntry,
  IQueuedPrompt,
  ISessionClientHandle,
  ISessionNotice,
  IWsSessionState,
  TConversationEntry,
  TMakeSessionClient,
} from './session-client-types.js';

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

/**
 * #3288: a finished turn's text and tool calls, in the order they actually happened — a running
 * turn accumulates these alongside (not instead of) the legacy `streamingText`/`activeTools` live
 * view, and `finishTurn` flushes them as SEPARATE conversation entries in order, instead of one
 * tools-block followed by one merged text block. Consecutive tool calls with no text between them
 * collapse into one `tools` segment (one expandable group), matching the TUI's own transcript order.
 */
interface ITurnTextSegment {
  readonly type: 'text';
  readonly id: string;
  readonly text: string;
}
interface ITurnToolsSegment {
  readonly type: 'tools';
  readonly id: string;
  readonly tools: readonly IActiveTool[];
}
type TTurnSegment = ITurnTextSegment | ITurnToolsSegment;

function appendTextDeltaToSegments(segments: TTurnSegment[], delta: string): TTurnSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.type === 'text') {
    return [...segments.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...segments, { type: 'text', id: nextId(), text: delta }];
}

function pushToolStartSegment(segments: TTurnSegment[], tool: IActiveTool): TTurnSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.type === 'tools') {
    return [...segments.slice(0, -1), { ...last, tools: [...last.tools, tool] }];
  }
  return [...segments, { type: 'tools', id: nextId(), tools: [tool] }];
}

/**
 * #3288: attribute a `tool_end` to its call by executionId first — two same-named parallel calls
 * can finish out of start order, and matching by name+running alone would close whichever running
 * call of that name is found first, not the one that actually finished. Falls back to name+running
 * only when the event carries no executionId (legacy fixtures / hosts that predate it).
 */
function findRunningToolIndex(
  tools: readonly IActiveTool[],
  state: { toolName: string; executionId?: string },
): number {
  return state.executionId !== undefined
    ? tools.findIndex((t) => t.executionId === state.executionId && t.status === 'running')
    : tools.findIndex((t) => t.name === state.toolName && t.status === 'running');
}

/** The fields a `tool_end` state contributes to the matched `IActiveTool`. */
function toolEndFields(
  state: IToolState,
): Pick<IActiveTool, 'status' | 'result' | 'diffLines' | 'diffFile' | 'toolResultData'> {
  return {
    // A tool that finished with an error result renders failed (ToolCard/ToolGroup key off
    // `status === 'error'`) — `isRunning` alone cannot tell success from failure.
    status: state.isRunning ? 'running' : state.result === 'error' ? 'error' : 'done',
    result: state.result,
    ...(state.diffLines ? { diffLines: state.diffLines } : {}),
    ...(state.diffFile ? { diffFile: state.diffFile } : {}),
    ...(state.toolResultData !== undefined ? { toolResultData: state.toolResultData } : {}),
  };
}

/** Apply a `tool_end` to the ONE matching running tool across a turn's segments (never all of them). */
function applyToolEndToSegments(segments: TTurnSegment[], state: IToolState): TTurnSegment[] {
  let matched = false;
  return segments.map((segment) => {
    if (matched || segment.type !== 'tools') return segment;
    const idx = findRunningToolIndex(segment.tools, state);
    if (idx === -1) return segment;
    matched = true;
    const tools = [...segment.tools];
    tools[idx] = { ...tools[idx]!, ...toolEndFields(state) };
    return { ...segment, tools };
  });
}

/**
 * #3288: the files an Edit/Write call touched during the turn, aggregated by path — the "Changed
 * files" row's data. `diffLines` keeps the LATEST edit's diff (what a click on the file opens); the
 * +/- counts sum every edit to that path within the turn.
 */
function collectChangedFiles(segments: readonly TTurnSegment[]): IChangedFileSummary[] {
  const byPath = new Map<string, IChangedFileSummary>();
  for (const segment of segments) {
    if (segment.type !== 'tools') continue;
    for (const tool of segment.tools) {
      if (!tool.diffFile || !tool.diffLines || tool.diffLines.length === 0) continue;
      const added = tool.diffLines.filter((line) => line.type === 'add').length;
      const removed = tool.diffLines.filter((line) => line.type === 'remove').length;
      const existing = byPath.get(tool.diffFile);
      byPath.set(tool.diffFile, {
        path: tool.diffFile,
        added: (existing?.added ?? 0) + added,
        removed: (existing?.removed ?? 0) + removed,
        diffLines: tool.diffLines,
      });
    }
  }
  return [...byPath.values()];
}

export function useSessionClient<TStatus extends string = TConnectionStatus>(
  makeClient: TMakeSessionClient<TStatus>,
): IWsSessionState<TStatus> {
  const [status, setStatus] = useState<TStatus>('disconnected' as TStatus);
  const [messages, setMessages] = useState<TConversationEntry[]>([]);
  const [activeTools, setActiveTools] = useState<IActiveTool[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [executionWorkspace, setExecutionWorkspace] = useState<IExecutionWorkspaceSnapshot | null>(
    null,
  );
  const [pendingPrompts, setPendingPrompts] = useState<readonly TPendingPrompt[]>([]);
  const [queuedPrompt, setQueuedPrompt] = useState<IQueuedPrompt | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionNotices, setSessionNotices] = useState<readonly ISessionNotice[]>([]);
  const [commandCatalog, setCommandCatalog] = useState<TCommandCatalog | null>(null);
  const [sessionStatus, setSessionStatus] = useState<TSessionStatus | null>(null);
  // #3289 §3: learned from the first frame the server sends this connection, so its own messages and
  // prompts never carry a "from" label — only ANOTHER driver's do.
  const [ownDriverId, setOwnDriverId] = useState<TDriverId | null>(null);

  const clientRef = useRef<ISessionClientHandle | null>(null);
  const streamingTextRef = useRef('');
  // The tools of the running turn, mirrored so the turn's end can keep them in the conversation.
  const activeToolsRef = useRef<IActiveTool[]>([]);
  // #3288: the running turn's text/tools in the order they happened — see `TTurnSegment` above.
  const turnSegmentsRef = useRef<TTurnSegment[]>([]);
  // A screen this surface's command asked for: it answers the command in place of the command's own
  // reply — with the "not available" line (`text`), or with nothing when the screen opened (null).
  const pendingIntentRef = useRef<{ name: string; text: string | null } | null>(null);
  // The latest `session_status`, read (not `sessionStatus` state) when a `model_unavailable` notice
  // is created, so the model it names is a snapshot from that moment — never the live status, which
  // `case 'error'` itself just asked the host to refresh and which the person may since have changed.
  const sessionStatusRef = useRef<TSessionStatus | null>(null);
  const updateActiveTools = useCallback((next: (previous: IActiveTool[]) => IActiveTool[]): void => {
    activeToolsRef.current = next(activeToolsRef.current);
    setActiveTools(activeToolsRef.current);
  }, []);
  const appendEntry = useCallback((entry: TConversationEntry): void => {
    setMessages((previous) => [...previous, entry]);
  }, []);
  /**
   * End the running turn: its text and tool calls stay in the conversation as SEPARATE entries, in
   * the order they happened (#3288) — not one tools-block grouped ahead of a single merged reply.
   */
  const finishTurn = useCallback(
    (toolStatus: (tool: IActiveTool) => IActiveTool['status']): void => {
      const segments = turnSegmentsRef.current;
      turnSegmentsRef.current = [];
      streamingTextRef.current = '';
      setStreamingText('');
      setIsThinking(false);
      updateActiveTools(() => []);
      for (const segment of segments) {
        if (segment.type === 'tools') {
          appendEntry({
            id: segment.id,
            role: 'tools',
            tools: segment.tools.map((tool) => ({ ...tool, status: toolStatus(tool) })),
          });
        } else {
          appendEntry({ id: segment.id, role: 'assistant', content: segment.text });
        }
      }
      // #3288: a turn that changed files ends with one compact summary row, after everything else.
      const changedFiles = collectChangedFiles(segments);
      if (changedFiles.length > 0) {
        appendEntry({ id: nextId(), role: 'changed-files', files: changedFiles });
      }
    },
    [appendEntry, updateActiveTools],
  );
  // Commands this surface sent whose result has not come back — a screen request pairs with one.
  const commandsInFlightRef = useRef(0);
  // Session changes this surface asked for; a refusal answers one of them, not a command.
  const sessionChangesInFlightRef = useRef(0);
  // Their request ids, for this connection: a refusal names the request it answers. A switch
  // answers with no id, so an id that succeeded stays here until the connection is replaced.
  const sessionChangeRequestIdsRef = useRef(new Set<string>());
  const send = useCallback((msg: TClientMessage): void => {
    if (msg.type === 'command') commandsInFlightRef.current += 1;
    if (msg.type === 'switch-session' || msg.type === 'new-session') {
      sessionChangesInFlightRef.current += 1;
      if (msg.requestId !== undefined) sessionChangeRequestIdsRef.current.add(msg.requestId);
    }
    clientRef.current?.send(msg);
  }, []);
  /** One session change this surface asked for has been answered. */
  const settleSessionChange = useCallback((requestId?: string): void => {
    sessionChangesInFlightRef.current = Math.max(0, sessionChangesInFlightRef.current - 1);
    if (requestId !== undefined) sessionChangeRequestIdsRef.current.delete(requestId);
  }, []);
  const { handleUsageMessage, ...personalUsageState } = usePersonalUsageState(send);
  const {
    handleExecutionDetailMessage,
    closeExecutionDetail,
    ...executionDetailState
  } = useExecutionDetailState(send);
  const { handleSessionsMessage, canListSessions, markCurrent, armRestore, ...sessionDirectoryState } =
    useSessionDirectoryState(send);
  const { requestSessions, setSessionSidebarOpen } = sessionDirectoryState;
  const { handleSettingsMessage, openSettings, ...settingsState } = useSettingsState(send);

  const handleMessage = useCallback(
    (msg: TServerMessage): void => {
      // ARCH-2164: touching the exhaustive registry here keeps every decoded variant tied to an
      // explicit GUI ownership decision, including variants intentionally handled by focused views.
      void SERVER_MESSAGE_HANDLING[msg.type];
      if (handleUsageMessage(msg)) return;
      if (handleExecutionDetailMessage(msg)) return;
      if (handleSessionsMessage(msg)) return;
      if (handleSettingsMessage(msg)) return;
      switch (msg.type) {
        case 'messages': {
          const reconstructed: TConversationEntry[] = msg.messages.flatMap((m) => {
            if (m.role !== 'user' && m.role !== 'assistant') return [];
            const content = m.content ?? '';
            return [{ id: nextId(), role: m.role as 'user' | 'assistant', content }];
          });
          setMessages(reconstructed);
          if (msg.driverId) setOwnDriverId(msg.driverId);
          break;
        }
        case 'user_message': {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'user',
              content: msg.content ?? '',
              ...(msg.driverId ? { author: msg.driverId } : {}),
            },
          ]);
          break;
        }
        case 'text_delta': {
          // The ref is the reply's source of truth, updated as each piece arrives: a `complete` in
          // the same batch reads it before React has run a state updater, and would lose the reply.
          const next = streamingTextRef.current + msg.delta;
          streamingTextRef.current = next;
          setStreamingText(next);
          // #3288: also track WHERE this text sits relative to the turn's tool calls, for finishTurn.
          turnSegmentsRef.current = appendTextDeltaToSegments(turnSegmentsRef.current, msg.delta);
          break;
        }
        case 'thinking': {
          setIsThinking(msg.isThinking);
          break;
        }
        case 'tool_start': {
          const { state } = msg;
          const tool: IActiveTool = {
            id: nextId(),
            name: state.toolName,
            status: 'running',
            input: state.firstArg,
            ...(state.executionId ? { executionId: state.executionId } : {}),
            ...(state.displayPath ? { displayPath: state.displayPath } : {}),
            ...(state.commandName ? { commandName: state.commandName } : {}),
            ...(state.internal ? { internal: true } : {}),
          };
          updateActiveTools((prev) => [...prev, tool]);
          turnSegmentsRef.current = pushToolStartSegment(turnSegmentsRef.current, tool);
          break;
        }
        case 'tool_end': {
          const { state } = msg;
          // #3288: attribute to the ONE matching running call (executionId-first) — never map over
          // every running same-named entry, which would close all of them at once.
          updateActiveTools((prev) => {
            const idx = findRunningToolIndex(prev, state);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx]!, ...toolEndFields(state) };
            return next;
          });
          turnSegmentsRef.current = applyToolEndToSegments(turnSegmentsRef.current, state);
          break;
        }
        case 'execution_workspace_event': {
          setExecutionWorkspace(msg.snapshot);
          break;
        }
        // #3288 §1: a Stop that did not take effect (e.g. the task/loop had already finished) is
        // worth telling the operator; a success shows itself through the snapshot update above.
        case 'background_task_control_result': {
          if (!msg.success) {
            setSessionNotices((previous) => [
              ...previous,
              {
                id: nextId(),
                kind: 'background-task-control-failed',
                message: msg.message ?? `Could not stop ${msg.taskId}.`,
              },
            ]);
          }
          break;
        }
        // #3280 §2: the prompt queued behind a running turn — shown above the composer, editable
        // and removable (`cancel-queue`). `pending: null` means nothing waits; the row disappears.
        case 'pending': {
          setQueuedPrompt(
            msg.pending === null ? null : { text: msg.pending, count: msg.pendingCount ?? 1 },
          );
          break;
        }
        case 'permission_request':
        case 'ask_request':
        case 'prompt_resolved': {
          // REMOTE-007/009: the paired owner renders + answers its own prompts (local == remote).
          setPendingPrompts((prev) => applyPromptEvent(prev, msg));
          break;
        }
        case 'ui_intent': {
          // #3189: `/resume` asks for the session picker — the sidebar, when the host lists sessions.
          if (guiScreenForUiIntent(msg.event.intent) === 'session-sidebar' && canListSessions()) {
            setSessionSidebarOpen(true);
            requestSessions();
            if (commandsInFlightRef.current > 0) {
              pendingIntentRef.current = { name: uiIntentCommandName(msg.event.intent), text: null };
            }
            break;
          }
          // #3282 §4a: `/settings` asks for the Settings screen — always available on this surface.
          if (guiScreenForUiIntent(msg.event.intent) === 'settings') {
            openSettings();
            if (commandsInFlightRef.current > 0) {
              pendingIntentRef.current = { name: uiIntentCommandName(msg.event.intent), text: null };
            }
            break;
          }
          // CMD-004 Stage D: a command this surface issued requested a screen the GUI does not have.
          // The command's result follows; the unavailable line answers it (TC-05, never silent).
          const unavailable = {
            name: uiIntentCommandName(msg.event.intent),
            text: describeUiIntentForGui(msg.event.intent),
          };
          if (commandsInFlightRef.current > 0) {
            pendingIntentRef.current = unavailable;
          } else {
            // No command of ours awaits a reply (a model-run command, a broadcast): say it now.
            appendEntry({ id: nextId(), role: 'command', name: unavailable.name, content: unavailable.text, tone: 'info' });
          }
          break;
        }
        // CMD-004 Stage E: broadcast session events — a rename/clear executed by the HOST (from any
        // surface, co-driving included) is reflected here; never a silent drop.
        case 'session_renamed': {
          setSessionName(msg.event.name);
          requestSessions();
          break;
        }
        // #3189: the host made another session current — drop what this one showed, re-read it all.
        case 'session_switched': {
          settleSessionChange();
          // Nothing of the old session stays on screen until the new one's answers arrive.
          sessionStatusRef.current = null;
          setSessionStatus(null);
          streamingTextRef.current = '';
          turnSegmentsRef.current = [];
          setStreamingText('');
          setIsThinking(false);
          updateActiveTools(() => []);
          setMessages([]);
          setPendingPrompts([]);
          setQueuedPrompt(null);
          setSessionName(null);
          setExecutionWorkspace(null);
          closeExecutionDetail();
          markCurrent(msg.event.sessionId);
          send({ type: 'get-messages' });
          send({ type: 'get-status' });
          send({ type: 'get-commands' });
          send({ type: 'get-execution-workspace' });
          send({ type: 'get-pending' });
          requestSessions();
          break;
        }
        case 'history_cleared': {
          streamingTextRef.current = '';
          turnSegmentsRef.current = [];
          setStreamingText('');
          setMessages([]);
          break;
        }
        case 'error': {
          // The `model_unavailable` notice's model is captured NOW, from the wire frame when it
          // named one or else the status this ref already holds — never read live later from
          // render, which would race the `get-status` below (and any model switch after it).
          const model = msg.model ?? sessionStatusRef.current?.model;
          send({ type: 'get-status' });
          finishTurn((tool) => (tool.status === 'running' ? 'error' : tool.status));
          setSessionNotices((previous) => [
            ...previous,
            {
              id: nextId(),
              kind: 'session-error',
              message: msg.message,
              ...(msg.code !== undefined && { code: msg.code }),
              ...(msg.provider !== undefined && { provider: msg.provider }),
              ...(model !== undefined && { model }),
              ...(msg.retryAfterSeconds !== undefined && {
                retryAfterSeconds: msg.retryAfterSeconds,
              }),
            },
          ]);
          break;
        }
        // #3189: a new or switch this surface asked for was refused; the reason is the toast, and
        // commands in flight are untouched. Only the client that asked is told.
        case 'session_change_failed': {
          if (
            msg.requestId !== undefined &&
            !sessionChangeRequestIdsRef.current.has(msg.requestId)
          ) {
            break;
          }
          settleSessionChange(msg.requestId);
          setSessionNotices((previous) => [
            ...previous,
            { id: nextId(), kind: 'session-change-refused', message: msg.message },
          ]);
          break;
        }
        case 'protocol_error': {
          if (sessionChangesInFlightRef.current > 0) {
            // A host older than `session_change_failed` refuses a session change with this.
            settleSessionChange();
            setSessionNotices((previous) => [
              ...previous,
              { id: nextId(), kind: 'protocol-error', message: msg.message },
            ]);
            break;
          }
          // A command can end in a protocol error instead of a result; a screen it asked for still shows.
          commandsInFlightRef.current = Math.max(0, commandsInFlightRef.current - 1);
          const unavailable = pendingIntentRef.current;
          pendingIntentRef.current = null;
          if (unavailable !== null && unavailable.text !== null) {
            appendEntry({ id: nextId(), role: 'command', name: unavailable.name, content: unavailable.text, tone: 'info' });
          }
          setSessionNotices((previous) => [
            ...previous,
            { id: nextId(), kind: 'protocol-error', message: msg.message },
          ]);
          break;
        }
        case 'commands': {
          setCommandCatalog({ commands: msg.commands, skills: msg.skills });
          break;
        }
        case 'session_status': {
          sessionStatusRef.current = msg.status;
          setSessionStatus(msg.status);
          break;
        }
        case 'command_result': {
          // A command may change the status (mode, effort, model) or the catalog (plugins, skills).
          send({ type: 'get-status' });
          send({ type: 'get-commands' });
          commandsInFlightRef.current = Math.max(0, commandsInFlightRef.current - 1);
          const unavailable = pendingIntentRef.current;
          pendingIntentRef.current = null;
          if (unavailable !== null && msg.success) {
            // The screen that opened is the answer; otherwise the line saying it cannot open is.
            if (unavailable.text !== null) {
              appendEntry({ id: nextId(), role: 'command', name: msg.name, content: unavailable.text, tone: 'info' });
            }
            break;
          }
          // A command that starts a turn (a skill) says nothing itself; the turn is its answer.
          if (msg.message.trim().length === 0) break;
          appendEntry({
            id: nextId(),
            role: 'command',
            name: msg.name,
            content: msg.message,
            tone: msg.success ? 'success' : 'error',
          });
          break;
        }
        case 'complete':
        case 'interrupted': {
          send({ type: 'get-status' });
          // #3280 §2: the turn ending can advance the queue (its next entry now runs) or, if this
          // was an abort, drop it entirely (`abort()` clears the whole queue) — either way the
          // composer's queued-message row is stale until this reply refreshes it.
          send({ type: 'get-pending' });
          // The turn changed this session's preview, message count and time in the list.
          requestSessions();
          finishTurn((tool) => (tool.status === 'running' ? 'done' : tool.status));
          break;
        }
      }
    },
    [
      appendEntry,
      canListSessions,
      closeExecutionDetail,
      finishTurn,
      handleExecutionDetailMessage,
      handleSessionsMessage,
      handleSettingsMessage,
      handleUsageMessage,
      markCurrent,
      openSettings,
      requestSessions,
      send,
      setSessionSidebarOpen,
      settleSessionChange,
      updateActiveTools,
    ],
  );

  const answerPermission = useCallback((id: string, result: TPermissionResultValue): void => {
    clientRef.current?.send(permissionResponse(id, result));
    setPendingPrompts((prev) => prev.filter((p) => p.id !== id)); // optimistic dismiss (prompt_resolved confirms)
  }, []);

  const answerAsk = useCallback((id: string, response: TActionResponse): void => {
    clientRef.current?.send(askResponse(id, response));
    setPendingPrompts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const dismissSessionNotice = useCallback((id: string): void => {
    setSessionNotices((previous) => previous.filter((notice) => notice.id !== id));
  }, []);

  useEffect(() => {
    const onStatusChange = (next: TStatus): void => {
      setStatus(next);
      // Every client learns what it can offer and what is in effect as soon as it is attached.
      if (next === 'connected') {
        // A reply lost with the old connection never arrives; stop waiting for it.
        commandsInFlightRef.current = 0;
        sessionChangesInFlightRef.current = 0;
        sessionChangeRequestIdsRef.current.clear();
        pendingIntentRef.current = null;
        client.send({ type: 'get-commands' });
        client.send({ type: 'get-status' });
        // #3280 §2: a reconnect that lands back on the SAME session (the common case) fires no
        // `session_switched` — its own `get-pending` would be missed — so ask here too, or a stale
        // `queuedPrompt` from before the drop keeps showing (with working Edit/Remove) until the
        // turn it was queued behind happens to end.
        client.send({ type: 'get-pending' });
        // A host that keeps sessions live puts a new connection on its primary session.
        armRestore();
        requestSessions();
      }
    };
    const client = makeClient({ onMessage: handleMessage, onStatusChange });
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [makeClient, handleMessage, requestSessions, armRestore]);

  return {
    status,
    messages,
    activeTools,
    streamingText,
    isThinking,
    executionWorkspace,
    sessionName,
    commandCatalog,
    sessionStatus,
    ownDriverId,
    send,
    pendingPrompts,
    queuedPrompt,
    answerPermission,
    answerAsk,
    ...personalUsageState,
    ...executionDetailState,
    closeExecutionDetail,
    ...sessionDirectoryState,
    sessionNotices,
    dismissSessionNotice,
    openSettings,
    ...settingsState,
  };
}

/** Connect to a `robota` sidecar over WebSocket (loopback / localhost path). */
export function useWsSession(
  url: string,
): IWsSessionState<TConnectionStatus> & { connectionLost: boolean } {
  // Issue #3280 §5: retries gave up — the runtime is not coming back by itself. A presentation layer
  // (e.g. `SessionSurface`) reads this to show a banner instead of a callback-driven screen swap.
  const [connectionLost, setConnectionLost] = useState(false);
  const makeClient = useCallback<TMakeSessionClient<TConnectionStatus>>(
    (cb) => createWsSessionClient(url, { ...cb, onGiveUp: () => setConnectionLost(true) }),
    [url],
  );
  const state = useSessionClient(makeClient);
  useEffect(() => {
    if (state.status === 'connected') setConnectionLost(false);
  }, [state.status]);
  return { ...state, connectionLost };
}
