/** InteractiveSession execution lifecycle, queue, streaming, and tool state. */

import { randomBytes } from 'node:crypto';

import {
  createUserMessage,
  createSystemMessage,
  messageToHistoryEntry,
  providerCallSpanId,
} from '@robota-sdk/agent-core';

import { InteractiveExecutionClaimOwner } from './interactive-execution-claim.js';
import { checkAndRefreshContextIfStale } from './interactive-session-context-refresh.js';
import {
  createLivePromptContentAccumulator,
  enqueueLivePromptContent,
} from './interactive-session-live-prompt-content.js';
import {
  LivePromptTraceAccumulator,
  enqueueLivePromptTrace,
  reportLivePromptTraceProjectionFailure,
  reportTraceContextUnavailable,
} from './interactive-session-live-prompt-trace.js';
import {
  projectCompactEvent,
  projectForkSkillResult,
  projectToolExecution,
} from './interactive-session-execution-events.js';
import { PendingInputQueue } from './interactive-session-pending-queue.js';
import { capturePostTurnMemory } from './interactive-session-post-turn-memory.js';
import { executePromptTurn, promptTurnAttribution } from './interactive-session-prompt.js';
import { STREAMING_FLUSH_INTERVAL_MS } from './interactive-session-streaming.js';
import { recordUsageObservation } from './interactive-session-usage-observation.js';
import { TurnSettlerRegistry } from './turn-settler-registry.js';
import { humanizeApiError } from '../utils/error-humanizer.js';

import type { IExecutionClaim } from './interactive-execution-claim.js';
import type {
  IExecutionControllerCallbacks,
  ICompletedToolExecution,
  ITurnOptions,
  IQueuedInput,
  TResumeQueuedTurnFn,
} from './interactive-session-execution-contracts.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import type { SessionSkillRouter } from './interactive-session-skill-router.js';
import type { IToolState } from './types.js';
import type { IExecutionResult } from './types.js';
import type { TExecutionWorkspaceUpdateCause } from '../background-tasks/index.js';
import type { ICommand, ICommandResult, ISkillExecutionResult } from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type { IMemoryEvent } from '../memory/automatic-memory-types.js';
import type { IHistoryEntry, IRunTraceContext, TToolArgs } from '@robota-sdk/agent-core';
import type {
  IProviderCallTraceEntry,
  IToolBodyTraceEntry,
} from '@robota-sdk/agent-interface-analytics';
import type { TDriverId, TTurnSource } from '@robota-sdk/agent-interface-session';
import type { ICompactEvent } from '@robota-sdk/agent-interface-session';

export type { TTurnSource };

// The contracts moved to their own file when this one grew past its size baseline; re-exported so
// every existing importer keeps working and the split is not a breaking change to the package.
export type {
  IExecutionControllerCallbacks,
  ITurnOptions,
  IQueuedInput,
  TResumeQueuedTurnFn,
  TSubmitFn,
} from './interactive-session-execution-contracts.js';

function randomOtelId(bytes: number): string {
  let id: string;
  do {
    id = randomBytes(bytes).toString('hex');
  } while (!/[1-9a-f]/.test(id));
  return id;
}

export class SessionExecutionController {
  private completedToolExecutions: ICompletedToolExecution[] = [];
  readonly executionClaim: InteractiveExecutionClaimOwner;
  streamingText = '';
  flushTimer: ReturnType<typeof setTimeout> | null = null;
  activeTools: IToolState[] = [];
  /** REMOTE-014 E5: co-drive input queue (same-driver coalesces to the tail, cross-driver appends). */
  readonly pending = new PendingInputQueue({
    refuse: (turnId, reason) => this.turns.refuse(turnId, reason),
    releaseWake: (wakeTaskId) => this.wakeTaskIds.delete(wakeTaskId),
  });
  /** REMOTE-014 E5: the driver id of the ACTIVE turn (null when idle) — read at event-emit time for attribution. */
  activeDriverId: TDriverId | null = null;
  shuttingDown = false;

  /** FLOW-002: background task ids with an in-flight wake turn (coalesces duplicate wakes). */
  readonly wakeTaskIds = new Set<string>();

  constructor(
    private readonly histTracker: SessionHistoryTracker,
    private readonly skillRouter: SessionSkillRouter,
    private readonly callbacks: IExecutionControllerCallbacks,
  ) {
    this.executionClaim = new InteractiveExecutionClaimOwner([
      () => this.callbacks.persistSession(),
      () => this.callbacks.emit('thinking', false),
      () => this.emitExecutionWorkspaceUpdated('main_thread'),
    ]);
  }

  /** RUNTIME-003: the registry that makes `ITurnHandle.completed` able to promise it settles. */
  readonly turns = new TurnSettlerRegistry();

  get executing(): boolean {
    return this.executionClaim.active;
  }

  /** The HEAD queued prompt (next to run), or null — backward-compatible single-prompt read. */
  get pendingPrompt(): string | null {
    return this.pending.head;
  }

  /** REMOTE-014 E5: total queued inputs (0 when idle) — a co-drive "N queued" hint. */
  pendingCount(): number {
    return this.pending.size;
  }

  enqueuePending(entry: IQueuedInput): 'queued' | 'coalesced' | 'dropped' {
    return this.pending.enqueue(entry);
  }

  clearPendingQueue(): TDriverId[] {
    return this.pending.clear();
  }

  removePendingWake(wakeTaskId: string): boolean {
    return this.pending.removeWake(wakeTaskId);
  }

  clearStreaming(): void {
    this.streamingText = '';
    this.activeTools = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  flushStreaming(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  handleTextDelta(delta: string): void {
    this.streamingText += delta;
    this.callbacks.emit('text_delta', delta);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
      }, STREAMING_FLUSH_INTERVAL_MS);
    }
  }

  handleCompactEvent(event: ICompactEvent): void {
    projectCompactEvent(this.histTracker, this.callbacks, event);
  }
  handleToolExecution(event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  }): void {
    if (event.type === 'end') {
      this.completedToolExecutions.push({
        name: event.toolName,
        args: event.toolArgs,
        success: event.success === true && event.denied !== true,
      });
    }
    this.activeTools = projectToolExecution(
      this.activeTools,
      this.histTracker.getHistory(),
      this.callbacks,
      (activeTools) => void (this.activeTools = activeTools),
      event,
    );
  }

  emitExecutionWorkspaceUpdated(cause: TExecutionWorkspaceUpdateCause, entryId?: string): void {
    const session = this.callbacks.getSession();
    if (!session) return;
    this.callbacks.emit('execution_workspace_event', {
      type: 'execution_workspace_updated',
      cause,
      ...(entryId ? { entryId } : {}),
      snapshot: this.callbacks.getExecutionWorkspaceSnapshot(),
    });
  }

  // `protected`, not `private`: the queue's resubmission path is what settles a queued caller's
  // handle, and a case that drives it directly is the only way to reach the throw-on-resubmit
  // outcome without standing up a whole session and a real shutdown race. A subclass is what the
  // modifier permits — the same reasoning the settles suite already applies to `enqueuePending`.
  protected drainPendingQueue(resumeQueuedTurn: TResumeQueuedTurnFn): void {
    if (!this.shuttingDown && this.pending.size > 0) {
      // Dequeue the HEAD (submission order); resubmit it. Its wakeTaskId is NOT released here — the turn it
      // starts will release it on completion (or `clearPendingQueue` if aborted).
      const head = this.pending.shift() as IQueuedInput;
      // RUNTIME-006: resume the complete accepted entry through the private execution path. The
      // entry's own required id is what every settle point uses; public submit is never re-entered.
      // Start in this tick: deferring leaves `executing === false`, letting a public submission
      // start before the queued turn claims continuous execution ownership.
      let resumed: Promise<void>;
      try {
        resumed = resumeQueuedTurn(head);
      } catch (error) {
        this.turns.fail(head.turnId, error instanceof Error ? error : new Error(String(error)));
        return;
      }
      void resumed.catch((error: unknown) => {
        this.turns.fail(head.turnId, error instanceof Error ? error : new Error(String(error)));
      });
    }
  }

  async executePrompt(
    input: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    agentsFileEntries: IContextFileEntry[],
    projectNotesFileEntries: IContextFileEntry[],
    rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null,
    setEntries: (agents: IContextFileEntry[], claude: IContextFileEntry[]) => void,
    resumeQueuedTurn: TResumeQueuedTurnFn,
    turnId: string,
    turnOptions: ITurnOptions = {},
  ): Promise<void> {
    // RUNTIME-12: claim synchronously before any await so a concurrent submit queues rather than also
    // starting. The `finally` releases this claim even when context refresh or execution throws.
    let executionClaim: IExecutionClaim;
    try {
      executionClaim = this.executionClaim.acquire('prompt');
    } catch (error) {
      this.turns.fail(turnId, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    // RUNTIME-003: which submission this turn belongs to; the handle minted then settles here.
    // REMOTE-014 E5: capture the ACTIVE turn's driver so event/prompt emitters can attribute to it.
    this.activeDriverId = turnOptions.driverId ?? null;
    this.completedToolExecutions = [];
    // SELFHOST-008 P2: stash the completed turn's result so post-turn capture can run in the `finally`
    // BEFORE persistSession() (awaiting inside `onComplete` would not order there — it is not awaited).
    let completedResult: IExecutionResult | undefined;
    // RUNTIME-003: what this turn ended with. `completedResult` cannot stand in — it is the
    // COMPLETED path only, and a handle must settle for an interrupted turn too.
    let terminalResult: IExecutionResult | undefined;
    let turnError: Error | undefined;
    let turnOutcome: 'success' | 'failure' | 'interrupted' = 'failure';
    let promptRoot:
      | {
          startedAt: string;
          startedAtMs: number;
          endedAt?: string;
          outcome?: 'success' | 'failure' | 'interrupted';
          traceId: string;
          spanId: string;
        }
      | undefined;
    const providerCallEntries: IHistoryEntry<IProviderCallTraceEntry>[] = [];
    const seenProviderCallIds = new Set<string>();
    const toolBodyEntries: IHistoryEntry<IToolBodyTraceEntry>[] = [];
    const liveTrace = this.callbacks.livePromptTrace ? new LivePromptTraceAccumulator() : undefined;
    // Opt-in content: only with a host content port, a gate on, and an owner-typed turn.
    const liveContent = createLivePromptContentAccumulator(this.callbacks.livePromptTrace, {
      turnSource: turnOptions.turnSource ?? 'user',
      driverId: turnOptions.driverId,
    });
    const closePromptRoot = (outcome: 'success' | 'failure' | 'interrupted'): void => {
      if (!promptRoot || promptRoot.endedAt) return;
      promptRoot.endedAt = new Date(Math.max(Date.now(), promptRoot.startedAtMs)).toISOString();
      promptRoot.outcome = outcome;
    };
    let ephemeralSystemContext: string | undefined;
    // MEM-2055: recall runs before the turn's own messages reach history — stash events, record in `finally`.
    let pendingMemoryEvents: IMemoryEvent[] = [];
    try {
      await checkAndRefreshContextIfStale(
        agentsFileEntries,
        projectNotesFileEntries,
        rebuildSystemMessage,
        this.callbacks.getProjectAccess(),
        setEntries,
        () => this.callbacks.getSessionOrThrow(),
        (event: string, payload: unknown) => this.callbacks.emit(event, payload),
      );
      this.clearStreaming();
      // FLOW-002: surface the turn origin so consumers (hooks, TUI) can distinguish a human
      // prompt from an agent-wakeup re-entry.
      this.callbacks.emit('turn_source', turnOptions.turnSource ?? 'user');
      this.callbacks.emit('user_message', displayInput ?? input);
      // SCREEN-1993: what the owner typed, recorded after the message is on the channel.
      this.callbacks.recordPrompt?.({
        input,
        rawInput,
        turnSource: turnOptions.turnSource ?? 'user',
        driverId: turnOptions.driverId,
      });
      liveContent?.addPrompt(rawInput ?? input);
      this.callbacks.emit('thinking', true);
      this.histTracker.resetUsedMemoryReferences(); // MEM-2055: before recall — old order lost it
      if (this.callbacks.recallMemory) {
        try {
          const recalled = await this.callbacks.recallMemory(input);
          if (recalled.context.trim().length > 0) ephemeralSystemContext = recalled.context;
          pendingMemoryEvents = recalled.events;
        } catch {
          // allow-fallback: per-turn recall is best-effort over the always-present startup memory; a recall
          // error skips ephemeral injection and the turn proceeds normally (SELFHOST-008 P3 declared degradation).
          ephemeralSystemContext = undefined;
        }
      }
      const startedAtMs = Date.now();
      promptRoot = {
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
        traceId: randomOtelId(16),
        spanId: randomOtelId(8),
      };
      const traceContext = this.promptTraceContext(promptRoot);
      await executePromptTurn(input, displayInput, rawInput, {
        providerErrorGuidance: this.callbacks.providerErrorGuidance,
        promptFileReferenceTag: this.callbacks.promptFileReferenceTag,
        turnSource: turnOptions.turnSource,
        ...promptTurnAttribution(ephemeralSystemContext, turnOptions.driverId),
        ...(turnOptions.signal ? { signal: turnOptions.signal } : {}),
        ...(traceContext ? { traceContext } : {}),
        getSession: () => this.callbacks.getSessionOrThrow(),
        getCwd: () => this.callbacks.getCwd(),
        getProjectAccess: () => this.callbacks.getProjectAccess(),
        getHistory: () => this.histTracker.getHistory(),
        getContextReferences: () => this.histTracker.listInjectionContextReferences(),
        getActiveTools: () => this.activeTools,
        recordContextReferenceUsage: (r) => this.histTracker.recordContextReferenceUsage(r),
        recordPromptContextReferences: (r) => this.histTracker.recordPromptContextReferences(r),
        beginEditCheckpointTurn: (p) => this.histTracker.beginEditCheckpointTurn(p),
        flushStreaming: () => this.flushStreaming(),
        clearStreaming: () => this.clearStreaming(),
        getStreamingText: () => this.streamingText,
        onWorkspaceUpdated: () => this.emitExecutionWorkspaceUpdated('main_thread'),
        onComplete: (result: IExecutionResult) => {
          closePromptRoot('success');
          completedResult = result; // stash for post-turn capture in the `finally`
          terminalResult = result;
          liveContent?.addResponse(result.response, false);
          turnOutcome = 'success';
        },
        onProviderCallCompleted: (observation) => {
          if (!promptRoot) return;
          // Core mints the call ID before every call and the span ID is derived from it, so the span
          // a provider was told is its parent is the span exported here. A call without one has no
          // span it could have been told about, and is counted as omitted rather than invented.
          if (!observation.callId) {
            liveTrace?.omit({ provider: 1, tool: 0 });
            return;
          }
          if (seenProviderCallIds.has(observation.callId)) return;
          seenProviderCallIds.add(observation.callId);
          const spanId = providerCallSpanId(observation.callId);
          const entry: IHistoryEntry<IProviderCallTraceEntry> = {
            id: `provider_call_trace_${randomOtelId(8)}`,
            timestamp: new Date(),
            category: 'event',
            type: 'provider-call-trace',
            data: {
              traceId: promptRoot.traceId,
              parentSpanId: promptRoot.spanId,
              spanId,
              startedAt: observation.startedAt,
              endedAt: observation.endedAt,
              outcome: observation.outcome,
              round: observation.round,
              ...(observation.callId && { callId: observation.callId }),
              ...(observation.disposition && { disposition: observation.disposition }),
              ...(observation.providerId && { providerId: observation.providerId }),
              ...(observation.modelId && { modelId: observation.modelId }),
              ...(observation.usageProvenance && { usageProvenance: observation.usageProvenance }),
              ...(observation.usageProvenance === 'complete' &&
                observation.promptTokens !== undefined &&
                observation.completionTokens !== undefined &&
                observation.totalTokens !== undefined && {
                  promptTokens: observation.promptTokens,
                  completionTokens: observation.completionTokens,
                  totalTokens: observation.totalTokens,
                }),
            },
          };
          providerCallEntries.push(entry);
          if (entry.data) {
            // A non-string value only drops the field, never the child: unlike an unsafe tool-call
            // ID, an unsafe provider-request ID (or one from a gateway outside the opaque-ID shape)
            // must not withhold this call's usage/cost data. `projectProvider` re-validates the
            // shape before export; this only guards the type.
            const providerRequestId = observation.providerRequestId;
            liveTrace?.addProvider({
              ...entry.data,
              ...(typeof providerRequestId === 'string' ? { providerRequestId } : {}),
            });
          }
        },
        onToolBodyCompleted: (observation) => {
          if (!promptRoot) return;
          const entry: IHistoryEntry<IToolBodyTraceEntry> = {
            id: `tool_body_trace_${randomOtelId(8)}`,
            timestamp: new Date(),
            category: 'event',
            type: 'tool-body-trace',
            data: {
              traceId: promptRoot.traceId,
              parentSpanId: promptRoot.spanId,
              spanId: randomOtelId(8),
              startedAt: observation.startedAt,
              endedAt: observation.endedAt,
              outcome: observation.outcome,
            },
          };
          toolBodyEntries.push(entry);
          if (entry.data) {
            const toolCallId = observation.toolCallId;
            if (toolCallId !== undefined && typeof toolCallId !== 'string') {
              liveTrace?.omit({ provider: 0, tool: 1 });
            } else {
              liveTrace?.addTool({ ...entry.data, ...(toolCallId !== undefined ? { toolCallId } : {}) });
            }
          }
        },
        onToolPermissionDecided: (observation) => {
          if (!promptRoot) return;
          const toolCallId = observation.toolCallId;
          if (toolCallId !== undefined && typeof toolCallId !== 'string') {
            liveTrace?.omit({ provider: 0, tool: 0, permission: 1 });
          } else {
            liveTrace?.addPermission({
              traceId: promptRoot.traceId,
              parentSpanId: promptRoot.spanId,
              decidedAt: observation.decidedAt,
              decision: observation.decision,
              ...(toolCallId !== undefined ? { toolCallId } : {}),
            });
          }
        },
        onCompletionsOmitted: (counts) => liveTrace?.omit(counts),
        onInterrupted: (result: IExecutionResult) => {
          closePromptRoot('interrupted');
          // RUNTIME-003: an interrupted turn RAN — resolve, do not reject.
          terminalResult = result;
          liveContent?.addResponse(result.response, true);
          turnOutcome = 'interrupted';
        },
        onError: (err: Error) => {
          closePromptRoot('failure');
          turnError = err;
          this.callbacks.emit('error', err);
        },
        onContextUpdate: () => {
          this.callbacks.emit('context_update', this.callbacks.getContextState());
        },
      });
    } catch (error) {
      closePromptRoot('failure');
      // RUNTIME-003: preserve pre-execution failures instead of replacing the real cause.
      turnError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (liveTrace && promptRoot?.endedAt && promptRoot.outcome && this.callbacks.livePromptTrace) {
        try {
          enqueueLivePromptTrace(this.callbacks.livePromptTrace, liveTrace.finish({
            sessionId: this.callbacks.getSessionOrThrow().getSessionId(),
            turnId,
            root: {
              traceId: promptRoot.traceId,
              spanId: promptRoot.spanId,
              startedAt: promptRoot.startedAt,
              endedAt: promptRoot.endedAt,
              outcome: promptRoot.outcome,
            },
          }));
        } catch {
          reportLivePromptTraceProjectionFailure(this.callbacks.livePromptTrace);
        }
      }
      if (liveContent && promptRoot?.endedAt && this.callbacks.livePromptTrace) {
        enqueueLivePromptContent(this.callbacks.livePromptTrace, liveContent, {
          traceId: promptRoot.traceId,
          spanId: promptRoot.spanId,
          endedAt: promptRoot.endedAt,
        });
      }
      try {
        await this.histTracker.finalizeEditCheckpointTurn();
      } catch (error) {
        this.callbacks.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
      // MEM-2055: turn's own messages are already in history now, so this renders after them.
      for (const event of pendingMemoryEvents) this.histTracker.recordMemoryEvent(event);
      // SELFHOST-008 P2: post-turn auto-capture, awaited here so its events land in THIS turn's record.
      await capturePostTurnMemory({
        capture: this.callbacks.captureMemory,
        completedResult,
        turnSource: turnOptions.turnSource,
        userMessage: displayInput ?? input,
        record: (event) => this.histTracker.recordMemoryEvent(event),
        onError: (error) => this.callbacks.emit('error', error),
      });
      for (const entry of providerCallEntries) this.histTracker.getHistory().push(entry);
      for (const entry of toolBodyEntries) this.histTracker.getHistory().push(entry);
      recordUsageObservation(this.histTracker.getHistory(), this.callbacks.getSessionOrThrow(), {
        turnId,
        outcome: turnOutcome,
        ...(promptRoot?.endedAt
          ? {
              promptExecutionStartedAt: promptRoot.startedAt,
              promptExecutionEndedAt: promptRoot.endedAt,
              promptExecutionOutcome: promptRoot.outcome,
              promptExecutionTraceId: promptRoot.traceId,
              promptExecutionSpanId: promptRoot.spanId,
            }
          : {}),
        ...(turnOptions.driverId ? { driverId: turnOptions.driverId } : {}),
        ...(turnOptions.surface ? { surface: turnOptions.surface } : {}),
        ...(terminalResult?.usage ? { usage: terminalResult.usage } : {}),
      });
      if (turnOptions.wakeTaskId !== undefined && this.callbacks.onWakeTurnFinalizing) {
        try {
          await this.callbacks.onWakeTurnFinalizing(
            turnOptions.wakeTaskId,
            terminalResult,
            turnOutcome,
            this.completedToolExecutions,
          );
        } catch (error) {
          turnError = error instanceof Error ? error : new Error(String(error));
          terminalResult = undefined;
          this.callbacks.emit('error', turnError);
        }
      }
      // Observers (including the TUI) see the completed history only after the durable wake
      // transition and its cadence receipt have succeeded. Never announce success then fail it.
      if (terminalResult !== undefined) {
        try {
          emitTerminalTurnEvent(this.callbacks, turnOutcome, terminalResult);
        } catch (error) {
          turnError = error instanceof Error ? error : new Error(String(error));
          terminalResult = undefined;
          try {
            this.callbacks.emit('error', turnError);
          } catch (notificationError) {
            turnError = new AggregateError(
              [turnError, notificationError],
              'Turn completion notification failed',
            );
          }
        }
      }
      // RUNTIME-003: settled BEFORE draining, in the `finally` that always runs — so a caller is
      // answered by ITS turn, and a turn that threw where onError never saw still settles.
      if (terminalResult !== undefined) this.turns.settle(turnId, terminalResult);
      else this.turns.fail(turnId, turnError ?? new Error('the turn ended without a result'));
      this.activeDriverId = null; // REMOTE-014 E5: turn ended — events after this are not turn-authored
      // FLOW-002: the wake for this task id is no longer in flight; allow future wakes to inject.
      if (turnOptions.wakeTaskId !== undefined) this.wakeTaskIds.delete(turnOptions.wakeTaskId);
      this.executionClaim.complete(executionClaim, () => this.drainPendingQueue(resumeQueuedTurn));
    }
  }

  /**
   * The trace a prompt's provider calls carry, only while that prompt's root exists and only when
   * the host configured propagation. Built per prompt, so no other run can inherit it.
   */
  private promptTraceContext(promptRoot: { traceId: string; spanId: string }): IRunTraceContext | undefined {
    const port = this.callbacks.livePromptTrace;
    const allowedOrigins = port?.traceContextPropagation?.allowedOrigins;
    if (!port || !allowedOrigins || allowedOrigins.length === 0) return undefined;
    return {
      traceId: promptRoot.traceId,
      parentSpanId: promptRoot.spanId,
      allowedOrigins: [...allowedOrigins],
      onPropagationUnavailable: (providerId) => reportTraceContextUnavailable(port, providerId),
    };
  }

  async executeForkSkillCommand(
    skill: ICommand,
    args: string,
    displayInput: string | undefined,
    qualifiedName: string | undefined,
    invocation: ISkillActivationEvent['invocation'],
    resumeQueuedTurn: TResumeQueuedTurnFn,
  ): Promise<ISkillExecutionResult> {
    if (this.executing) {
      throw new Error('Cannot execute fork skill while another prompt is running.');
    }
    const executionClaim = this.executionClaim.acquire('fork-skill');

    try {
      this.clearStreaming();
      this.callbacks.emit('thinking', true);
      this.histTracker.append(
        messageToHistoryEntry(createUserMessage(displayInput ?? `/${skill.name}`)),
      );
      this.emitExecutionWorkspaceUpdated('main_thread');
      const result = await this.skillRouter.executeSkillWithActivation(
        skill,
        args,
        invocation,
        qualifiedName,
      );
      await this.applyForkSkillResult(result.result ?? '(empty response)');
      return result;
    } catch (err) {
      // allow-fallback: fork-skill errors must not crash the main execution thread
      const error = err instanceof Error ? err : new Error(String(err));
      this.histTracker.append(
        messageToHistoryEntry(
          createSystemMessage(
            `Error: ${humanizeApiError(error, this.callbacks.providerErrorGuidance)}`,
          ),
        ),
      );
      this.callbacks.emit('error', error);
      return { mode: 'fork', result: '' };
    } finally {
      this.executionClaim.complete(executionClaim, () => this.drainPendingQueue(resumeQueuedTurn));
    }
  }

  async executeForegroundCommand(
    execute: () => Promise<ICommandResult>,
    resumeQueuedTurn: TResumeQueuedTurnFn,
  ): Promise<ICommandResult> {
    let executionClaim: IExecutionClaim;
    try {
      executionClaim = this.executionClaim.acquire('foreground-command');
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      this.clearStreaming();
      this.callbacks.emit('thinking', true);
      this.emitExecutionWorkspaceUpdated('main_thread');
      const result = await execute();
      this.callbacks.emit('context_update', this.callbacks.getContextState());
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Error: ${errMsg}` };
    } finally {
      this.executionClaim.complete(executionClaim, () => this.drainPendingQueue(resumeQueuedTurn));
    }
  }

  async applyForkSkillResult(result: string): Promise<void> {
    projectForkSkillResult(
      result,
      this.activeTools,
      this.histTracker,
      this.callbacks,
      () => this.flushStreaming(),
      () => this.clearStreaming(),
    );
  }
}

function emitTerminalTurnEvent(
  callbacks: IExecutionControllerCallbacks,
  outcome: 'success' | 'failure' | 'interrupted',
  result: IExecutionResult,
): void {
  callbacks.emit(outcome === 'interrupted' ? 'interrupted' : 'complete', result);
}
