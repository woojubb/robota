/**
 * SessionBackgroundTaskTracker — manages background task and job group state
 * for an InteractiveSession. Handles subscriptions, events, and persistence
 * integration without owning the session or store directly.
 */

import {
  isTerminalBackgroundTaskStatus,
  nextScheduledFireOnOrAfter,
} from '@robota-sdk/agent-executor';

import { createSourceUsageSummaryEntry } from './interactive-session-execution.js';
import { isReArmableScheduledTask, restoredScheduleDisposition } from './schedule-rearm.js';
import { sessionLoopExpiry, sessionLoopFirstWakeEligibility } from './session-loop-lifecycle.js';
import {
  BackgroundJobOrchestrator,
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createLineDetailPage,
  summarizeBackgroundJobGroup,
} from '../background-tasks/index.js';
import { retrieveSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';

import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  TBackgroundJobGroupEvent,
  TExecutionWorkspaceUpdateCause,
} from '../background-tasks/index.js';
import type { IFrameworkHost } from '../host/framework-host.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskIdReservation,
  IBackgroundTaskManager,
  IPreparedRestoredSchedules,
} from '@robota-sdk/agent-executor';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type { Session } from '@robota-sdk/agent-session';

export interface IBackgroundTrackerState {
  tasks: IBackgroundTaskState[];
  taskEvents: TBackgroundTaskEvent[];
  groups: IBackgroundJobGroupState[];
  groupEvents: TBackgroundJobGroupEvent[];
}

export class SessionBackgroundTaskTracker {
  private backgroundTasks: IBackgroundTaskState[] = [];
  private restoredTaskIds: string[] = [];
  private taskIdReservation?: IBackgroundTaskIdReservation;
  private restoredTerminalTasks: IBackgroundTaskState[] = [];
  private preparedSchedules: IBackgroundTaskState<'scheduled'>[] = [];
  private shutdownSchedules = new Map<string, IBackgroundTaskState<'scheduled'>>();
  private restoringBackground = false;
  private unexpectedRestoreEvent = false;
  /** Restored loops held by the host switch, or terminally expired before re-arm. */
  private heldSessionLoops: IBackgroundTaskState[] = [];
  private backgroundTaskEvents: TBackgroundTaskEvent[] = [];
  private backgroundJobGroups: IBackgroundJobGroupState[] = [];
  private backgroundJobGroupEvents: TBackgroundJobGroupEvent[] = [];
  private backgroundTaskUnsubscribe: (() => void) | null = null;
  private backgroundJobUnsubscribe: (() => void) | null = null;
  private backgroundJobOrchestrator: BackgroundJobOrchestrator | null = null;

  constructor(
    private readonly getManager: () => IBackgroundTaskManager | undefined,
    private readonly onChanged: (cause: TExecutionWorkspaceUpdateCause, entryId?: string) => void,
    private readonly emitTaskEvent: (event: TBackgroundTaskEvent) => void,
    private readonly emitGroupEvent: (event: TBackgroundJobGroupEvent) => void,
    private readonly persistSession: () => void,
    // FLOW-002: invoked when a background task fires a wake carrying an agent instruction.
    private readonly onWake?: (instruction: string, taskId: string) => void,
    // FLOW-003: append a user-visible system note (e.g. a missed-wake notice) to history.
    private readonly appendSystemNote?: (message: string) => void,
    // ANALYTICS-001 (Phase 2): append a structured history entry (a source-attributed usage summary).
    private readonly appendHistoryEntry?: (entry: IHistoryEntry) => void,
    private readonly sessionLoopsDisabled = false,
    private readonly onSessionLoopRearmed?: (task: IBackgroundTaskState) => void,
    private readonly observerFailureWarningCode?: string,
    // The host's reporter for a failed group listener; absent, the executor's own line is written.
    private readonly reportObserverFailure?: IFrameworkHost['reportObserverFailure'],
  ) {}

  subscribe(session: Session, restore?: { canCommit(): boolean; commit(): void }): void {
    if (this.backgroundTaskUnsubscribe) return;
    const manager =
      retrieveSessionBackgroundTaskManager(session) ??
      retrieveAgentToolDeps(session)?.backgroundTaskManager;
    if (this.restoredTaskIds.length > 0) {
      if (!manager?.reserveTaskIds)
        throw new Error('Restoring background tasks requires a manager that can reserve task IDs.');
      if (manager.list().length > 0)
        throw new Error('Cannot restore background tasks: the manager already owns a task.');
      const reservation: unknown = manager.reserveTaskIds(this.restoredTaskIds);
      if (!isTaskIdReservation(reservation)) {
        // The capability violation is already reported below; do not leave an async rejection unhandled.
        void Promise.resolve(reservation)
          .then((late: unknown) => {
            if (isTaskIdReservation(late)) late.release();
          })
          .catch(() => undefined);
        throw new Error('Background task ID reservation must complete synchronously.');
      }
      this.taskIdReservation = reservation;
    }
    if (!manager) return;
    this.restoringBackground = this.restoredTaskIds.length > 0;
    this.backgroundTaskUnsubscribe = manager.subscribe((event) => {
      if (this.restoringBackground) {
        this.unexpectedRestoreEvent = true;
        return;
      }
      this.recordTaskEvent(event);
      this.emitTaskEvent(event);
      // FLOW-002: a wake carrying an instruction re-enters the agent loop with a non-user turn.
      if (event.type === 'background_task_waking' && event.instruction !== undefined) {
        this.onWake?.(event.instruction, event.taskId);
      }
    });
    try {
      this.assertNoRestoreEvent();
      if (this.restoringBackground && manager.list().length > 0) {
        throw new Error('Cannot restore background tasks: the manager already owns a task.');
      }
      this.reArmRestoredSchedules(manager, restore);
      this.assertNoRestoreEvent();
    } catch (error) {
      this.backgroundTaskUnsubscribe();
      this.backgroundTaskUnsubscribe = null;
      throw error;
    } finally {
      this.restoringBackground = false;
    }
  }

  /**
   * FLOW-003: re-spawn restored sleeping scheduled wakes so they fire again after a resume,
   * and surface a one-time note for any whose fire time elapsed while the CLI was closed.
   */
  private reArmRestoredSchedules(
    manager: IBackgroundTaskManager,
    restore?: { canCommit(): boolean; commit(): void },
  ): void {
    if (this.restoredTaskIds.length === 0) return;
    const nowMs = Date.now();
    // Classify every held task before spawning any timer. A runner may synchronously emit a
    // sleeping event and persist its snapshot while this method is still iterating.
    const restoredTasks = this.backgroundTasks.map((task) => ({
      task,
      disposition: restoredScheduleDisposition(task, nowMs, this.sessionLoopsDisabled),
    }));
    for (const { task, disposition: blocked } of restoredTasks) {
      if (!isReArmableScheduledTask(task) || !task.schedule) continue;
      if (blocked !== 'expired' && blocked !== 'disabled') continue;
      this.heldSessionLoops.push(
        blocked === 'expired'
          ? { ...task, status: 'cancelled', completedAt: new Date(nowMs).toISOString() }
          : task,
      );
      this.appendSystemNote?.(`Session loop "${task.label}" ${blocked}; it was not re-armed.`);
    }
    const schedules: IBackgroundTaskState<'scheduled'>[] = [];
    for (const { task, disposition } of restoredTasks) {
      // SELFHOST-012: re-arm both `sleeping` and `paused` scheduled tasks (shared predicate — must agree with
      // the restore reconciliation). A paused one is re-spawned then immediately paused again so a restart keeps
      // it paused (not silently running).
      if (!isReArmableScheduledTask(task) || !task.schedule) continue;
      if (disposition !== 'rearm' && disposition !== 'rearm-paused') continue;
      // A paused schedule carries no pending fire time, so the missed-wake note applies only to sleeping ones.
      let missedFireAt: number | undefined;
      if (task.status === 'sleeping' && task.nextFireAt !== undefined) {
        const storedFireAt = Date.parse(task.nextFireAt);
        const eligibility = sessionLoopFirstWakeEligibility(task, storedFireAt);
        if (eligibility === 'eligible') {
          missedFireAt = storedFireAt;
        } else if (eligibility === 'early') {
          const firstAllowedAt = task.metadata?.['sessionLoopFirstAllowedAt'];
          if (typeof firstAllowedAt === 'string') {
            const calculateNextFire =
              manager.nextScheduledFireOnOrAfter?.bind(manager) ?? nextScheduledFireOnOrAfter;
            missedFireAt =
              calculateNextFire(
                task.schedule.cronExpression,
                new Date(firstAllowedAt),
              )?.getTime() ?? undefined;
          }
        }
      }
      if (missedFireAt !== undefined && missedFireAt < nowMs) {
        this.appendSystemNote?.(
          `Missed scheduled wake "${task.label}" (was due ${new Date(missedFireAt).toISOString()} while the session was closed); re-arming.`,
        );
      }
      const expiry = sessionLoopExpiry(task);
      schedules.push({
        ...task,
        ...(task.metadata
          ? {
              metadata: {
                ...task.metadata,
                ...(task.metadata['sessionLoop'] === true &&
                task.metadata['sessionLoopExpiresAt'] === undefined &&
                expiry !== undefined
                  ? { sessionLoopExpiresAt: new Date(expiry).toISOString() }
                  : {}),
              },
            }
          : {}),
      });
    }
    if (schedules.length === 0) return;
    if (!restore?.canCommit() || !manager.prepareRestoredSchedules || !this.taskIdReservation) {
      throw new Error(
        'Restoring schedules requires an atomic store and a prepared schedule manager.',
      );
    }
    const candidate: unknown = manager.prepareRestoredSchedules(schedules, this.taskIdReservation);
    if (!isPreparedSchedules(candidate)) {
      void Promise.resolve(candidate)
        .then((late: unknown) => {
          if (isPreparedSchedules(late)) late.abort();
        })
        .catch(() => undefined);
      throw new Error('Prepared schedule batch must complete synchronously.');
    }
    const batch = candidate;
    this.preparedSchedules = schedules;
    try {
      restore.commit();
      if (!restore.canCommit()) throw new Error('Restored schedule claim ownership was lost.');
      this.assertNoRestoreEvent();
      if (manager.list().length > 0) {
        throw new Error('Cannot restore background tasks: the manager already owns a task.');
      }
      const expected = new Set(schedules.map((task) => task.id));
      const activated = batch.activate(() => {
        this.assertNoRestoreEvent();
        const active = manager.list();
        if (active.length !== expected.size || active.some((task) => !expected.has(task.id))) {
          throw new Error('Unexpected background task during restore.');
        }
        for (const task of schedules) {
          if (task.metadata?.['sessionLoop'] === true) this.onSessionLoopRearmed?.(task);
        }
        this.assertNoRestoreEvent();
        const afterSetup = manager.list();
        if (
          afterSetup.length !== expected.size ||
          afterSetup.some((task) => !expected.has(task.id))
        ) {
          throw new Error('Unexpected background task during restore.');
        }
        if (!restore.canCommit()) throw new Error('Restored schedule claim ownership was lost.');
      });
      if (activated !== 'active') throw new Error('Prepared schedule activation was aborted.');
    } catch (error) {
      batch.abort();
      throw error;
    } finally {
      this.preparedSchedules = [];
    }
  }

  dispose(): void {
    this.backgroundTaskUnsubscribe?.();
    this.backgroundTaskUnsubscribe = null;
    this.backgroundJobUnsubscribe?.();
    this.backgroundJobUnsubscribe = null;
    this.backgroundJobOrchestrator?.dispose();
    this.backgroundJobOrchestrator = null;
  }

  releaseTaskIdReservation(): void {
    this.taskIdReservation?.release();
    this.taskIdReservation = undefined;
  }

  preserveSchedulesForShutdown(): boolean {
    const manager = this.getManager();
    if (!manager) return false;
    for (const task of manager.list()) {
      if (isReArmableScheduledTask(task)) this.shutdownSchedules.set(task.id, task);
    }
    return this.shutdownSchedules.size > 0;
  }

  restoreState(state: IBackgroundTrackerState, preserveTerminalTasks = true): void {
    const ids = state.tasks.map((task) => task.id);
    if (preserveTerminalTasks && new Set(ids).size !== ids.length)
      throw new Error('Duplicate restored background task IDs.');
    this.restoredTaskIds = preserveTerminalTasks ? ids : [];
    this.restoredTerminalTasks = preserveTerminalTasks
      ? state.tasks.filter((task) => isTerminalBackgroundTaskStatus(task.status))
      : [];
    this.backgroundTasks = preserveTerminalTasks ? state.tasks : [];
    this.heldSessionLoops = [];
    this.backgroundTaskEvents = state.taskEvents;
    this.backgroundJobGroups = state.groups;
    this.backgroundJobGroupEvents = state.groupEvents;
  }

  getState(): IBackgroundTrackerState {
    if (this.restoringBackground) {
      const tasks = new Map(this.backgroundTasks.map((task) => [task.id, task]));
      for (const task of [...this.heldSessionLoops, ...this.preparedSchedules])
        tasks.set(task.id, task);
      return {
        tasks: [...tasks.values()],
        taskEvents: this.backgroundTaskEvents,
        groups: this.backgroundJobGroups,
        groupEvents: this.backgroundJobGroupEvents,
      };
    }
    const tasks = this.getTaskSnapshots().map(
      (task) => this.shutdownSchedules.get(task.id) ?? task,
    );
    const manager = this.getManager();
    if (manager && this.restoredTerminalTasks.some((task) => manager.get(task.id) !== undefined)) {
      throw new Error('A restored background task ID is already in use.');
    }
    const ids = new Set(tasks.map((task) => task.id));
    return {
      tasks: [
        ...tasks,
        ...[
          ...this.restoredTerminalTasks,
          ...this.preparedSchedules,
          ...this.shutdownSchedules.values(),
        ].filter((task) => !ids.has(task.id)),
      ],
      taskEvents: this.backgroundTaskEvents,
      groups: this.getGroupSnapshots(),
      groupEvents: this.backgroundJobGroupEvents,
    };
  }

  private assertNoRestoreEvent(): void {
    if (this.unexpectedRestoreEvent) throw new Error('Unexpected background event during restore.');
  }

  getManagerOrThrow(): IBackgroundTaskManager {
    const manager = this.getManager();
    if (!manager) {
      throw new Error('Background task manager is not available for this session.');
    }
    return manager;
  }

  getOrchestratorOrThrow(sessionId: string): BackgroundJobOrchestrator {
    if (this.backgroundJobOrchestrator) return this.backgroundJobOrchestrator;
    const manager = this.getManagerOrThrow();
    this.backgroundJobOrchestrator = new BackgroundJobOrchestrator({
      manager,
      initialGroups: this.backgroundJobGroups,
      observerFailureWarningCode: this.observerFailureWarningCode,
      ...(this.reportObserverFailure !== undefined
        ? { reportObserverFailure: this.reportObserverFailure }
        : {}),
    });
    this.subscribeGroupEvents(sessionId);
    return this.backgroundJobOrchestrator;
  }

  async cancelTask(taskId: string, reason?: string): Promise<void> {
    this.assertTaskWritable(taskId);
    await this.getManagerOrThrow().cancel(taskId, reason);
  }

  async closeTask(taskId: string): Promise<void> {
    this.assertTaskWritable(taskId);
    await this.getManagerOrThrow().close(taskId);
  }

  async sendTask(taskId: string, input: IBackgroundTaskInput): Promise<void> {
    this.assertTaskWritable(taskId);
    await this.getManagerOrThrow().send(taskId, input);
  }

  async readTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage> {
    this.assertTaskWritable(taskId);
    return this.getManagerOrThrow().readLog(taskId, cursor);
  }

  listTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[] {
    const historical = this.restoredTerminalTasks.filter(
      (task) =>
        (!filter?.kind || task.kind === filter.kind) &&
        (!filter?.status || task.status === filter.status) &&
        (!filter?.mode || task.mode === filter.mode),
    );
    return [...this.getManagerOrThrow().list(filter), ...structuredClone(historical)];
  }

  getTask(taskId: string): IBackgroundTaskState | undefined {
    const historical = this.restoredTerminalTasks.find((task) => task.id === taskId);
    return historical ? structuredClone(historical) : this.getManagerOrThrow().get(taskId);
  }

  isRestoredTerminalTask(taskId: string): boolean {
    return this.restoredTerminalTasks.some((task) => task.id === taskId);
  }

  private assertTaskWritable(taskId: string): void {
    if (this.isRestoredTerminalTask(taskId))
      throw new Error('Restored terminal background tasks are read-only.');
  }

  listHeldSessionLoops(): IBackgroundTaskState[] {
    return this.heldSessionLoops.map((task) => ({ ...task }));
  }

  getHeldSessionLoop(taskId: string): IBackgroundTaskState | undefined {
    return this.heldSessionLoops.find((task) => task.id === taskId);
  }

  markHeldSessionLoopCancelled(taskId: string): void {
    this.heldSessionLoops = this.heldSessionLoops.map((task) =>
      task.id === taskId
        ? { ...task, status: 'cancelled', completedAt: new Date().toISOString() }
        : task,
    );
  }

  createGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
    sessionId: string,
  ): IBackgroundJobGroupState {
    return this.getOrchestratorOrThrow(sessionId).createGroup({
      ...input,
      parentSessionId: sessionId,
    });
  }

  listGroups(sessionId: string): IBackgroundJobGroupState[] {
    return this.getOrchestratorOrThrow(sessionId).listGroups();
  }

  getGroup(groupId: string, sessionId: string): IBackgroundJobGroupState | undefined {
    return this.getOrchestratorOrThrow(sessionId).getGroup(groupId);
  }

  async waitGroup(groupId: string, sessionId: string): Promise<IBackgroundJobGroupState> {
    return this.getOrchestratorOrThrow(sessionId).waitGroup(groupId);
  }

  async readTaskDetail(
    entryId: string,
    taskId: string,
    cursor?: IExecutionDetailCursor,
  ): Promise<IExecutionDetailPage> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Unknown background task: ${taskId}`);
    if (!this.isRestoredTerminalTask(taskId) && (task.logPath || task.transcriptPath)) {
      const page = await this.getManagerOrThrow().readLog(taskId, cursor);
      return createLineDetailPage({
        entryId,
        lines: page.lines,
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        kind: task.kind === 'process' ? 'process_output' : 'progress',
      });
    }
    const detailKind =
      task.status === 'failed' ? 'error' : task.status === 'completed' ? 'result' : 'progress';
    const text =
      task.error?.message ??
      task.result?.output ??
      task.currentAction ??
      (task.kind === 'agent' ? task.promptPreview : task.commandPreview) ??
      task.status;
    return createLineDetailPage({ entryId, lines: [text], cursor, kind: detailKind });
  }

  readGroupDetail(entryId: string, groupId: string, sessionId: string): IExecutionDetailPage {
    const group = this.getOrchestratorOrThrow(sessionId).getGroup(groupId);
    if (!group) throw new Error(`Unknown background job group: ${groupId}`);
    const summary = summarizeBackgroundJobGroup(group);
    return createLineDetailPage({ entryId, lines: summary.lines, kind: 'group_summary' });
  }

  getTaskSnapshots(): IBackgroundTaskState[] {
    try {
      return [
        ...this.getManagerOrThrow().list(),
        ...this.heldSessionLoops,
        ...structuredClone(this.restoredTerminalTasks),
      ];
    } catch {
      return this.backgroundTasks;
    }
  }

  getGroupSnapshots(): IBackgroundJobGroupState[] {
    try {
      return this.backgroundJobOrchestrator?.listGroups() ?? this.backgroundJobGroups;
    } catch {
      return this.backgroundJobGroups;
    }
  }

  private subscribeGroupEvents(sessionId: string): void {
    if (this.backgroundJobUnsubscribe || !this.backgroundJobOrchestrator) return;
    this.backgroundJobUnsubscribe = this.backgroundJobOrchestrator.subscribe((event) => {
      this.recordGroupEvent(event, sessionId);
      this.emitGroupEvent(event);
    });
  }

  private recordTaskEvent(event: TBackgroundTaskEvent): void {
    this.backgroundTasks = this.getTaskSnapshots();
    this.backgroundTaskEvents.push(event);
    this.recordCompletedTaskUsage(event);
    this.persistSession();
    this.onChanged('background_task', getTaskEventEntryId(event));
  }

  /**
   * ANALYTICS-001 (Phase 2): when a background agent task completes with token usage, append a
   * source-attributed usage-summary to the parent history so the usage report attributes those tokens
   * to that task (not the main thread).
   */
  private recordCompletedTaskUsage(event: TBackgroundTaskEvent): void {
    if (event.type !== 'background_task_completed') return;
    // #2079: `usage` exists only on the agent-kind state/result member, correlated with
    // `event.task.kind` now — narrowing on the task's own kind narrows `result` (and unlocks
    // `agentType` below) in one step, rather than narrowing `result.kind` alone.
    if (event.task.kind !== 'agent') return;
    const usage = event.task.result?.usage;
    if (!usage || usage.totalTokens <= 0) return;
    this.appendHistoryEntry?.(
      createSourceUsageSummaryEntry(usage, {
        scope: 'background',
        id: event.task.id,
        label: event.task.agentType ?? event.task.label,
      }),
    );
  }

  private recordGroupEvent(event: TBackgroundJobGroupEvent, _sessionId: string): void {
    this.backgroundJobGroups = this.getGroupSnapshots();
    this.backgroundJobGroupEvents.push(event);
    this.persistSession();
    this.onChanged('background_group', createBackgroundGroupExecutionEntryId(event.group.id));
  }
}

function isTaskIdReservation(value: unknown): value is IBackgroundTaskIdReservation {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('then' in value && typeof value.then === 'function') &&
    'release' in value &&
    typeof value.release === 'function'
  );
}

function isPreparedSchedules(value: unknown): value is IPreparedRestoredSchedules {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('then' in value && typeof value.then === 'function') &&
    'activate' in value &&
    typeof value.activate === 'function' &&
    'abort' in value &&
    typeof value.abort === 'function'
  );
}

function getTaskEventEntryId(event: TBackgroundTaskEvent): string | undefined {
  if ('task' in event) return createBackgroundTaskExecutionEntryId(event.task.id);
  if ('taskId' in event) return createBackgroundTaskExecutionEntryId(event.taskId);
  return undefined;
}
