import {
  cloneBackgroundTaskState,
  createDeferred,
  createQueuedBackgroundTaskState,
  createRunnerError,
  matchesBackgroundTaskFilter,
  toBackgroundTaskErrorMessage,
  type ITrackedBackgroundTask,
} from './background-task-manager-helpers.js';
import {
  applyBackgroundTaskRunnerStateEvent,
  markBackgroundTaskCancelled,
  markBackgroundTaskCompleted,
  markBackgroundTaskFailed,
  markBackgroundTaskPaused,
  markBackgroundTaskResumed,
  markBackgroundTaskStarted,
  startBackgroundTaskRunner,
  validateBackgroundTaskRequest,
} from './background-task-manager-state.js';
import { createBackgroundTaskWatchdogs } from './background-task-watchdogs.js';
import {
  deliverToObservers,
  reportObserverFailureAsConsoleWarning,
  type TObserverFailureReporter,
} from './observer-delivery.js';
import { nextScheduledFireOnOrAfter } from './runners/scheduled-fire-time.js';
import {
  isBuiltInScheduledRestoreRunner,
  isBuiltInScheduledStart,
} from './runners/scheduled-restore-trust.js';
import { isTerminalBackgroundTaskStatus } from './state-machine.js';
import {
  BackgroundTaskError,
  type IBackgroundTaskInput,
  type IBackgroundTaskHandle,
  type IBackgroundTaskListFilter,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type IBackgroundTaskManager,
  type IBackgroundTaskIdReservation,
  type IPreparedBackgroundTaskHandle,
  type IPreparedRestoredSchedules,
  type IBackgroundTaskManagerOptions,
  type TBackgroundTaskRequest,
  type IBackgroundTaskResult,
  type IBackgroundTaskRunner,
  type IBackgroundTaskStart,
  type IBackgroundTaskState,
  type IScheduledBackgroundTaskRequest,
  type IScheduleEditPatch,
  type TBackgroundTaskIdFactory,
  type TBackgroundTaskEvent,
  type TBackgroundTaskEventListener,
  type TBackgroundTaskRunnerEvent,
  type TBackgroundTaskTimeoutReason,
} from './types.js';

import type { BackgroundTaskWatchdogController } from './background-task-watchdogs.js';

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_DEPTH = 1;
const PREVIEW_LENGTH = 120;
const builtInManagers = new WeakSet<BackgroundTaskManager>();

export class BackgroundTaskManager implements IBackgroundTaskManager {
  private readonly runners = new Map<string, IBackgroundTaskRunner>();
  private readonly maxConcurrent: number;
  private readonly maxDepth: number;
  private readonly now: () => string;
  private readonly idFactory: TBackgroundTaskIdFactory;
  private readonly watchdogs: BackgroundTaskWatchdogController;
  private readonly listeners = new Set<TBackgroundTaskEventListener>();
  private readonly eventSink?: TBackgroundTaskEventListener;
  private readonly onObserverFailure: TObserverFailureReporter<TBackgroundTaskEvent>;
  private readonly tasks = new Map<string, ITrackedBackgroundTask>();
  private readonly reservedTaskIds = new Map<string, symbol>();
  private readonly reservationOwners = new WeakMap<IBackgroundTaskIdReservation, symbol>();
  private readonly preparedRestores = new Set<IPreparedRestoredSchedules>();
  private readonly preparedRestoreOwners = new WeakMap<IPreparedRestoredSchedules, string>();
  private readonly revokedOwners = new Set<string>();
  private readonly attachedSessions = new Set<object>();
  private exclusiveSession?: object;
  private exclusiveSessionId?: string;
  private exclusiveOwnership?: { canRun(): boolean; onLoss(): void };
  private preparingRestore = false;
  private readonly allocatedTaskIds = new Set<string>();
  private readonly queue: string[] = [];
  /**
   * CORE-024: task ids currently holding a concurrency slot. Keyed by id (not a count) so
   * acquire/release are idempotent — a scheduled task releases on `sleeping` and re-acquires on
   * `waking` without ever double-counting, and a terminal transition from either state is safe.
   */
  private readonly slotHolders = new Set<string>();
  private sequence = 0;
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(options: IBackgroundTaskManagerOptions) {
    builtInManagers.add(this);
    for (const runner of options.runners) this.runners.set(runner.kind, runner);
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.eventSink = options.eventSink;
    this.onObserverFailure =
      options.onObserverFailure ??
      ((failure) =>
        reportObserverFailureAsConsoleWarning(failure, options.observerFailureWarningCode));
    this.now = options.now ?? (() => new Date().toISOString());
    this.watchdogs = createBackgroundTaskWatchdogs(options, (task, reason, message) => {
      void this.failForTimeout(task, reason, message);
    });
    this.idFactory =
      options.idFactory ??
      (() => {
        this.sequence += 1;
        return `task_${this.sequence}`;
      });
  }

  /** Bind a claimed framework session exclusively until its lifecycle releases the binding. */
  attachSession(
    owner: object,
    exclusive: boolean,
    sessionId?: string,
    ownership?: { canRun(): boolean; onLoss(): void },
  ): () => void {
    if (exclusive && !sessionId?.trim()) {
      throw new BackgroundTaskError(
        'validation',
        'An exclusive manager binding requires a session ID.',
      );
    }
    if (
      (this.exclusiveSession && this.exclusiveSession !== owner) ||
      (exclusive && [...this.attachedSessions].some((session) => session !== owner))
    ) {
      throw new BackgroundTaskError(
        'validation',
        'The background task manager is exclusively bound to another session.',
      );
    }
    if (this.attachedSessions.has(owner))
      throw new BackgroundTaskError('validation', 'The session is already attached.');
    this.attachedSessions.add(owner);
    if (exclusive) {
      this.exclusiveSession = owner;
      this.exclusiveSessionId = sessionId;
      this.exclusiveOwnership = ownership;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.attachedSessions.delete(owner);
      if (this.exclusiveSession === owner) {
        this.exclusiveSession = undefined;
        this.exclusiveSessionId = undefined;
        this.exclusiveOwnership = undefined;
      }
    };
  }

  reserveTaskIds(taskIds: readonly string[]): IBackgroundTaskIdReservation {
    this.assertNoRestoreInProgress();
    const unique = new Set(taskIds);
    if (unique.size !== taskIds.length)
      throw new BackgroundTaskError('validation', 'Duplicate restored background task IDs.');
    if (taskIds.some((id) => this.allocatedTaskIds.has(id) || this.reservedTaskIds.has(id)))
      throw new BackgroundTaskError(
        'validation',
        'A restored background task ID is already in use.',
      );
    const owner = Symbol('background-task-reservation');
    const ownedIds = [...taskIds];
    for (const id of ownedIds) this.reservedTaskIds.set(id, owner);
    const reservation: IBackgroundTaskIdReservation = {
      release: () => {
        for (const id of ownedIds) {
          if (this.reservedTaskIds.get(id) === owner) this.reservedTaskIds.delete(id);
        }
        this.reservationOwners.delete(reservation);
      },
    };
    this.reservationOwners.set(reservation, owner);
    return reservation;
  }

  prepareRestoredSchedules(
    states: readonly IBackgroundTaskState<'scheduled'>[],
    reservation: IBackgroundTaskIdReservation,
    ownership?: { canRun(): boolean; onLoss(): void },
  ): IPreparedRestoredSchedules {
    this.assertNoRestoreInProgress();
    if (this.shuttingDown)
      throw new BackgroundTaskError('validation', 'Background task manager is shutting down');
    const owner = this.reservationOwners.get(reservation);
    const runner = this.runners.get('scheduled');
    if (!owner || !runner || runner.kind !== 'scheduled') {
      throw new BackgroundTaskError(
        'validation',
        'A reservation and a prepared schedule runner are required.',
      );
    }
    const prepare = runner.prepareRestore;
    if (!prepare) {
      throw new BackgroundTaskError('validation', 'A prepared schedule runner is required.');
    }
    if (!isBuiltInScheduledRestoreRunner(runner, prepare)) {
      throw new BackgroundTaskError(
        'validation',
        'Restoring schedules requires a built-in scheduled runner.',
      );
    }
    const ids = new Set(states.map((state) => state.id));
    if (
      ids.size !== states.length ||
      states.some(
        (state) =>
          state.kind !== 'scheduled' ||
          state.parentSessionId !== states[0]?.parentSessionId ||
          this.revokedOwners.has(state.parentSessionId) ||
          this.reservedTaskIds.get(state.id) !== owner ||
          this.tasks.has(state.id) ||
          (state.status !== 'sleeping' && state.status !== 'paused') ||
          !state.schedule,
      )
    ) {
      throw new BackgroundTaskError('validation', 'Invalid or unowned restored schedules.');
    }
    const prepared: Array<{
      task: ITrackedBackgroundTask;
      handle: IPreparedBackgroundTaskHandle<'scheduled'>;
    }> = [];
    let phase: 'prepared' | 'active' | 'aborted' = 'prepared';
    const isAborted = (): boolean => phase === 'aborted';
    const abortPrepared = (): void => {
      if (phase === 'aborted') return;
      phase = 'aborted';
      for (const entry of prepared) {
        try {
          entry.handle.abort();
        } catch {
          /* The runner gate stays closed even if cleanup fails. */
        }
      }
    };
    this.preparingRestore = true;
    try {
      for (const state of states) {
        const schedule = state.schedule;
        if (!schedule)
          throw new BackgroundTaskError('validation', 'A restored schedule is missing.');
        const request: IScheduledBackgroundTaskRequest = {
          kind: 'scheduled',
          cronExpression: schedule.cronExpression,
          label: state.label,
          mode: state.mode,
          parentSessionId: state.parentSessionId,
          depth: state.depth,
          cwd: state.cwd,
          ...(state.metadata !== undefined ? { metadata: { ...state.metadata } } : {}),
          ...(schedule.agentInstruction !== undefined
            ? { agentInstruction: schedule.agentInstruction }
            : {}),
          ...(schedule.command !== undefined ? { command: schedule.command } : {}),
          ...(schedule.shell !== undefined ? { shell: schedule.shell } : {}),
          ...(schedule.env !== undefined ? { env: { ...schedule.env } } : {}),
        };
        validateBackgroundTaskRequest(request, this.runners, this.maxDepth);
        const deferred = createDeferred();
        void deferred.promise.catch(() => undefined);
        const task: ITrackedBackgroundTask = {
          state: cloneBackgroundTaskState(state),
          request,
          completion: deferred.promise,
          resolve: deferred.resolve,
          reject: deferred.reject,
          recentText: '',
          outputBytes: 0,
          textDeltas: 0,
          repeatedDeltaCount: 0,
        };
        const candidate: unknown = prepare.call(
          runner,
          {
            taskId: state.id,
            request,
            emit: (event) => {
              if (phase === 'active') this.handleRunnerEvent(task, event);
            },
          },
          {
            paused: state.status === 'paused',
            ...(ownership ? { canRun: ownership.canRun, onClaimLoss: ownership.onLoss } : {}),
          },
        );
        if (!isPreparedScheduledHandle(candidate)) {
          void Promise.resolve(candidate)
            .then((late: unknown) => {
              if (isPreparedScheduledHandle(late)) {
                void late.handle.result.catch(() => undefined);
                late.abort();
              }
            })
            .catch(() => undefined);
          throw new BackgroundTaskError(
            'validation',
            'Prepared runner handle must complete synchronously.',
          );
        }
        const handle = candidate;
        prepared.push({ task, handle });
        if (this.shuttingDown)
          throw new BackgroundTaskError('validation', 'Background task manager is shutting down');
        if (this.reservationOwners.get(reservation) !== owner) {
          throw new BackgroundTaskError(
            'validation',
            'The restored task reservation was released.',
          );
        }
        if (handle.handle.taskId !== state.id) {
          throw new BackgroundTaskError(
            'validation',
            'Prepared task identity does not match the restored record.',
          );
        }
        void handle.handle.result.catch(() => undefined);
      }
    } catch (error) {
      abortPrepared();
      throw error;
    } finally {
      this.preparingRestore = false;
    }
    const batch: IPreparedRestoredSchedules = {
      activate: (beforeOpen) => {
        if (phase === 'active') return 'active';
        if (
          phase === 'aborted' ||
          this.shuttingDown ||
          this.reservationOwners.get(reservation) !== owner
        ) {
          abortPrepared();
          this.preparedRestores.delete(batch);
          return 'aborted';
        }
        for (const { task, handle } of prepared) {
          task.handle = handle.handle;
          this.tasks.set(task.state.id, task);
          this.allocatedTaskIds.add(task.state.id);
        }
        try {
          beforeOpen?.();
        } catch (error) {
          abortPrepared();
          for (const { task } of prepared) {
            if (this.tasks.get(task.state.id) === task) this.tasks.delete(task.state.id);
          }
          this.preparedRestores.delete(batch);
          throw error;
        }
        if (isAborted() || this.shuttingDown || this.reservationOwners.get(reservation) !== owner) {
          abortPrepared();
          for (const { task } of prepared) {
            if (this.tasks.get(task.state.id) === task) this.tasks.delete(task.state.id);
          }
          this.preparedRestores.delete(batch);
          return 'aborted';
        }
        try {
          for (const { handle } of prepared) {
            if (handle.activate() !== 'active') throw new Error('Prepared schedule was aborted.');
          }
        } catch {
          abortPrepared();
          for (const { task } of prepared) this.tasks.delete(task.state.id);
          this.preparedRestores.delete(batch);
          return 'aborted';
        }
        phase = 'active';
        for (const { task, handle } of prepared) {
          void handle.handle.result.then(
            (result) => {
              if (phase === 'active') this.completeTask(task, result);
            },
            (error: unknown) => {
              if (phase === 'active')
                this.failTask(task, error instanceof Error ? error : String(error));
            },
          );
        }
        this.preparedRestores.delete(batch);
        return 'active';
      },
      abort: () => {
        if (phase !== 'prepared') return;
        abortPrepared();
        for (const { task } of prepared) {
          if (this.tasks.get(task.state.id) === task) this.tasks.delete(task.state.id);
        }
        this.preparedRestores.delete(batch);
      },
    };
    this.preparedRestores.add(batch);
    if (states[0]) this.preparedRestoreOwners.set(batch, states[0].parentSessionId);
    return batch;
  }

  /** Close restored gates before reporting lost ownership; never persist a successful completion. */
  invalidateRestoredSchedules(sessionId: string, beforeReport: () => void): void {
    this.revokedOwners.add(sessionId);
    for (const batch of this.preparedRestores) {
      if (this.preparedRestoreOwners.get(batch) === sessionId) batch.abort();
    }
    const tasks = [...this.tasks.values()].filter(
      (task) =>
        task.state.parentSessionId === sessionId &&
        !isTerminalBackgroundTaskStatus(task.state.status),
    );
    for (const task of tasks) {
      this.removeFromQueue(task.state.id);
    }
    for (const task of tasks) {
      try {
        void task.handle?.cancel().catch(() => undefined);
      } catch {
        // Continue closing the other gates when a custom runner cannot cancel.
      }
    }
    try {
      beforeReport();
    } finally {
      for (const task of tasks) this.failTask(task, new Error('Session writer claim was lost.'));
    }
  }

  async spawn(request: TBackgroundTaskRequest): Promise<IBackgroundTaskState> {
    this.assertNoRestoreInProgress();
    if (this.shuttingDown) {
      throw new BackgroundTaskError('validation', 'Background task manager is shutting down');
    }
    if (this.revokedOwners.has(request.parentSessionId)) {
      throw new BackgroundTaskError('validation', 'Session writer claim was lost.');
    }
    if (this.exclusiveSessionId && request.parentSessionId !== this.exclusiveSessionId) {
      throw new BackgroundTaskError(
        'validation',
        'The background task manager is exclusively bound to another session.',
      );
    }
    if (!this.checkOwner(request)) {
      throw new BackgroundTaskError('validation', 'Session writer claim was lost.');
    }
    if (request.kind === 'scheduled' && request.parentSessionId === this.exclusiveSessionId) {
      const runner = this.runners.get('scheduled');
      if (!runner || !isBuiltInScheduledStart(runner, runner.start))
        throw new BackgroundTaskError(
          'validation',
          'A claimed session requires a built-in scheduled runner.',
        );
    }
    validateBackgroundTaskRequest(request, this.runners, this.maxDepth);
    let id: string | undefined;
    for (
      let attempt = 0;
      attempt <= this.reservedTaskIds.size + this.allocatedTaskIds.size;
      attempt += 1
    ) {
      const candidate = this.idFactory(request);
      if (!this.reservedTaskIds.has(candidate) && !this.allocatedTaskIds.has(candidate)) {
        id = candidate;
        break;
      }
    }
    if (id === undefined)
      throw new BackgroundTaskError(
        'validation',
        'Could not allocate a unique background task ID.',
      );
    this.allocatedTaskIds.add(id);
    const deferred = createDeferred();
    void deferred.promise.catch(() => undefined);
    // MCP-004 §S1: a runner may declare `admission: 'already-running'` — its work already runs
    // outside any manager-provisioned resource (an adopted, in-flight call), so it is admitted
    // directly rather than queued. `validateBackgroundTaskRequest` above already required the
    // runner to exist, so the lookup here cannot miss.
    const runner = this.runners.get(request.kind);
    const guardedSchedule =
      request.kind === 'scheduled' && request.parentSessionId === this.exclusiveSessionId;
    const admittingRunner =
      !guardedSchedule && runner?.admission === 'already-running' ? runner : undefined;
    const state = createQueuedBackgroundTaskState(
      id,
      request,
      this.now(),
      PREVIEW_LENGTH,
      admittingRunner ? 'running' : 'queued',
    );

    const tracked: ITrackedBackgroundTask = {
      state,
      request,
      completion: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
      recentText: '',
      outputBytes: 0,
      textDeltas: 0,
      repeatedDeltaCount: 0,
    };
    this.tasks.set(id, tracked);

    if (admittingRunner) {
      // Constructed as `running` above, before `background_task_created` is emitted — bypasses the
      // queue and the concurrency slot entirely so `cancel()` always reaches the bound handle.
      this.emit({ type: 'background_task_created', task: cloneBackgroundTaskState(state) });
      this.startAdmittedTask(tracked, admittingRunner);
    } else {
      this.queue.push(id);
      this.emit({ type: 'background_task_created', task: cloneBackgroundTaskState(state) });
      this.drainQueue();
    }
    return cloneBackgroundTaskState(state);
  }

  wait(taskId: string): Promise<IBackgroundTaskResult> {
    return this.requireTask(taskId).completion;
  }

  list(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[] {
    return [...this.tasks.values()]
      .map((task) => task.state)
      .filter((state) => matchesBackgroundTaskFilter(state, filter))
      .map((state) => cloneBackgroundTaskState(state));
  }

  get(taskId: string): IBackgroundTaskState | undefined {
    const task = this.tasks.get(taskId);
    return task ? cloneBackgroundTaskState(task.state) : undefined;
  }

  nextScheduledFireOnOrAfter(cronExpression: string, firstAllowedAt: Date): Date | null {
    const runner = this.runners.get('scheduled');
    return runner?.nextScheduledFireOnOrAfter
      ? runner.nextScheduledFireOnOrAfter(cronExpression, firstAllowedAt)
      : nextScheduledFireOnOrAfter(cronExpression, firstAllowedAt);
  }

  async cancel(taskId: string, reason?: string): Promise<void> {
    this.assertNoRestoreInProgress();
    await this.cancelOwnedTask(taskId, reason);
  }

  private async cancelOwnedTask(taskId: string, reason?: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;

    if (task.state.status === 'queued') {
      this.removeFromQueue(taskId);
      this.cancelTask(task, reason);
      return;
    }

    const handle = task.handle;
    this.cancelTask(task, reason);
    await handle?.cancel(reason).catch(() => undefined);
  }

  async close(taskId: string): Promise<void> {
    this.assertNoRestoreInProgress();
    const task = this.requireTask(taskId);
    if (!isTerminalBackgroundTaskStatus(task.state.status)) {
      throw createRunnerError(`Cannot close active background task: ${taskId}`);
    }
    this.tasks.delete(taskId);
    this.emit({ type: 'background_task_closed', taskId });
  }

  // SELFHOST-012: non-destructive pause of a scheduled task — croner `.pause()`, not the irreversible `.stop()`
  // that `cancel` uses. A paused schedule holds no concurrency slot (like `sleeping`).
  async pauseScheduledTask(taskId: string): Promise<void> {
    this.assertNoRestoreInProgress();
    const task = this.requireScheduledTask(taskId);
    if (task.state.status === 'paused') return; // idempotent
    const handle = task.handle;
    if (!handle?.pause) {
      throw createRunnerError(`Background task runner does not support pause: ${taskId}`);
    }
    const updated = markBackgroundTaskPaused(task, this.now());
    this.releaseSlot(taskId);
    this.emit({ type: 'background_task_updated', task: updated });
    await handle.pause();
    if (!this.shuttingDown) this.drainQueue();
  }

  async resumeScheduledTask(taskId: string): Promise<void> {
    this.assertNoRestoreInProgress();
    const task = this.requireScheduledTask(taskId);
    if (task.state.status !== 'paused') return; // only a paused schedule resumes; otherwise no-op
    const handle = task.handle;
    if (!handle?.resume) {
      throw createRunnerError(`Background task runner does not support resume: ${taskId}`);
    }
    const updated = markBackgroundTaskResumed(task, this.now());
    this.emit({ type: 'background_task_updated', task: updated });
    // The runner re-emits `sleeping`, which refreshes nextFireAt idempotently (status is already sleeping).
    await handle.resume();
  }

  async editScheduledTask(taskId: string, patch: IScheduleEditPatch): Promise<void> {
    this.assertNoRestoreInProgress();
    const task = this.requireScheduledTask(taskId);
    const handle = task.handle;
    if (!handle?.editSchedule) {
      throw createRunnerError(`Background task runner does not support edit: ${taskId}`);
    }
    await handle.editSchedule(patch);
    const { label, ...schedulePatch } = patch;
    // Keep the reconstructable schedule (FLOW-003) + list view in sync with the in-place re-arm.
    // `schedule` is scheduled-only on the discriminated state; `editScheduledTask` only ever
    // reaches a scheduled task (`requireScheduledTask`), but the kind check lets TS narrow the write.
    if (task.state.kind === 'scheduled' && task.state.schedule) {
      task.state.schedule = { ...task.state.schedule, ...schedulePatch };
    }
    // CMD-009: the label is the list view's rendering of the instruction, so it moves with it.
    if (label !== undefined) task.state.label = label;
    task.state.updatedAt = this.now();
    this.emit({ type: 'background_task_updated', task: cloneBackgroundTaskState(task.state) });
  }

  private requireScheduledTask(taskId: string): ITrackedBackgroundTask {
    const task = this.requireTask(taskId);
    if (task.state.kind !== 'scheduled') {
      throw createRunnerError(`Not a scheduled task: ${taskId}`);
    }
    if (isTerminalBackgroundTaskStatus(task.state.status)) {
      throw createRunnerError(`Cannot change lifecycle of a ${task.state.status} task: ${taskId}`);
    }
    // A queued schedule has no runner handle yet (all concurrency slots busy) — a clearer error than the
    // downstream "runner does not support pause" the missing handle would otherwise produce.
    if (task.state.status === 'queued') {
      throw createRunnerError(
        `Cannot change lifecycle of a not-yet-started (queued) schedule: ${taskId}`,
      );
    }
    return task;
  }

  private assertNoRestoreInProgress(): void {
    if (this.preparingRestore || this.preparedRestores.size > 0) {
      throw new BackgroundTaskError('validation', 'A background task restore is in progress.');
    }
  }

  shutdown(reason = 'Background task manager shutdown'): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    for (const prepared of this.preparedRestores) prepared.abort();
    this.shutdownPromise = Promise.all(
      [...this.tasks.values()]
        .filter((task) => !isTerminalBackgroundTaskStatus(task.state.status))
        .map((task) => this.cancelOwnedTask(task.state.id, reason)),
    ).then(() => undefined);
    return this.shutdownPromise;
  }

  async send(taskId: string, input: IBackgroundTaskInput): Promise<void> {
    this.assertNoRestoreInProgress();
    const task = this.requireTask(taskId);
    if (!task.handle?.send) {
      throw createRunnerError(`Background task runner does not support input: ${taskId}`);
    }
    await task.handle.send(input);
  }

  async readLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage> {
    const task = this.requireTask(taskId);
    if (!task.handle?.readLog) {
      throw createRunnerError(`Background task runner does not support log reads: ${taskId}`);
    }
    return task.handle.readLog(cursor);
  }

  subscribe(listener: TBackgroundTaskEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** CORE-024: acquire/release a concurrency slot for a task (idempotent, set-keyed by id). */
  private acquireSlot(taskId: string): void {
    this.slotHolders.add(taskId);
  }

  private releaseSlot(taskId: string): void {
    this.slotHolders.delete(taskId);
  }

  private drainQueue(): void {
    while (this.slotHolders.size < this.maxConcurrent) {
      const taskId = this.queue.shift();
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task || task.state.status !== 'queued') continue;
      this.startTask(task);
    }
  }

  private checkOwner(request: TBackgroundTaskRequest): boolean {
    if (request.parentSessionId !== this.exclusiveSessionId || !this.exclusiveOwnership)
      return true;
    let owned = false;
    try {
      owned = this.exclusiveOwnership.canRun() === true;
    } catch {
      /* An unverifiable claim is not owned. */
    }
    if (owned) return true;
    try {
      this.exclusiveOwnership.onLoss();
    } catch {
      /* Still close this owner's gates below. */
    }
    if (!this.revokedOwners.has(request.parentSessionId))
      this.invalidateRestoredSchedules(request.parentSessionId, () => undefined);
    return false;
  }

  private startTask(task: ITrackedBackgroundTask): void {
    if (!this.checkOwner(task.request)) return;
    const runner = this.runners.get(task.request.kind);
    if (!runner) {
      this.failTask(task, createRunnerError(`No runner for task kind: ${task.request.kind}`));
      return;
    }

    let startOverride: ((input: IBackgroundTaskStart) => IBackgroundTaskHandle) | undefined;
    if (
      task.request.kind === 'scheduled' &&
      task.request.parentSessionId === this.exclusiveSessionId
    ) {
      if (runner.kind !== 'scheduled') {
        this.failTask(
          task,
          createRunnerError('A claimed session requires a built-in scheduled runner.'),
        );
        return;
      }
      const start = runner.start;
      if (!isBuiltInScheduledStart(runner, start)) {
        this.failTask(
          task,
          createRunnerError('A claimed session requires a built-in scheduled runner.'),
        );
        return;
      }
      startOverride = (input) => start.call(runner, input as IBackgroundTaskStart<'scheduled'>);
    }

    const started = markBackgroundTaskStarted(task, this.now());
    this.acquireSlot(task.state.id);
    this.emit({ type: 'background_task_started', task: started });
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    if (!this.checkOwner(task.request)) return;

    startBackgroundTaskRunner({
      task,
      runner,
      ...(startOverride ? { startOverride } : {}),
      now: this.now,
      onEvent: (event) => this.handleRunnerEvent(task, event),
      onStarted: () => this.watchdogs.start(task),
      onUpdated: (updated) => this.emit({ type: 'background_task_updated', task: updated }),
      onCompleted: (result) => this.completeTask(task, result),
      onFailed: (error) => this.failTask(task, error),
    });
  }

  /**
   * MCP-004 §S1: the `admission: 'already-running'` counterpart to `startTask` — no `queued`→
   * `running` transition (the state was already constructed `running`), no concurrency slot
   * (`acquireSlot` is never called, so `releaseSlot` on completion is the pre-existing idempotent
   * no-op for a task that never held one). The handle is bound before this returns, so `cancel()`
   * reaches it immediately even if it races the caller's next statement.
   */
  private startAdmittedTask(task: ITrackedBackgroundTask, runner: IBackgroundTaskRunner): void {
    if (!this.checkOwner(task.request)) return;
    const startedAt = this.now();
    task.state.startedAt = startedAt;
    task.state.updatedAt = startedAt;
    task.state.lastActivityAt = startedAt;
    this.emit({ type: 'background_task_started', task: cloneBackgroundTaskState(task.state) });
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    if (!this.checkOwner(task.request)) return;

    startBackgroundTaskRunner({
      task,
      runner,
      now: this.now,
      onEvent: (event) => this.handleRunnerEvent(task, event),
      onStarted: () => this.watchdogs.start(task),
      onUpdated: (updated) => this.emit({ type: 'background_task_updated', task: updated }),
      onCompleted: (result) => this.completeTask(task, result),
      onFailed: (error) => this.failTask(task, error),
    });
  }

  private completeTask(task: ITrackedBackgroundTask, result: IBackgroundTaskResult): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    if (result.taskId !== task.state.id || result.kind !== task.state.kind) {
      this.failTask(
        task,
        createRunnerError(
          `Background task result identity mismatch: expected ${task.state.id} (${task.state.kind}), received ${result.taskId} (${result.kind})`,
        ),
      );
      return;
    }
    this.watchdogs.clear(task);
    const completed = markBackgroundTaskCompleted(task, result, this.now());
    this.releaseSlot(task.state.id);
    task.resolve(result);
    this.emit({ type: 'background_task_completed', task: completed });
    if (!this.shuttingDown) this.drainQueue();
  }

  private failTask(task: ITrackedBackgroundTask, error: Error | string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const failed = markBackgroundTaskFailed(task, error, this.now());
    this.releaseSlot(task.state.id);
    task.reject(createRunnerError(toBackgroundTaskErrorMessage(error)));
    this.emit({ type: 'background_task_failed', task: failed });
    if (!this.shuttingDown) this.drainQueue();
  }

  private cancelTask(task: ITrackedBackgroundTask, reason?: string): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.watchdogs.clear(task);
    const cancelled = markBackgroundTaskCancelled(task, reason, this.now());
    // CORE-024: releaseSlot is idempotent — safe whether the task held a slot (running/waking) or
    // not (queued/sleeping), replacing the wasActive count guard.
    this.releaseSlot(task.state.id);
    task.reject(createRunnerError(task.state.error?.message ?? 'Background task cancelled'));
    this.emit({ type: 'background_task_cancelled', task: cancelled.task });
    if (!this.shuttingDown) this.drainQueue();
  }

  private handleRunnerEvent(task: ITrackedBackgroundTask, event: TBackgroundTaskRunnerEvent): void {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    this.applyRunnerEventToState(task, event);
    if (event.type === 'background_task_sleeping') {
      // CORE-024 (RUNTIME-17): a sleeping schedule spawns nothing — release its slot so other
      // tasks can drain. Without this, maxConcurrent sleeping schedules wedge the budget forever.
      // The status/nextFireAt change is already surfaced via background_task_updated.
      this.releaseSlot(task.state.id);
      if (!this.shuttingDown) this.drainQueue();
      return;
    }
    if (event.type === 'background_task_waking') {
      // CORE-024: re-acquire a slot for the in-flight fire (idempotent; a wake may briefly push
      // the holder count over maxConcurrent, which only pauses queue draining until it sleeps).
      this.acquireSlot(task.state.id);
      // FLOW-001: propagate a manager-level wake so an upper layer can re-enter the agent loop.
      this.emit({
        type: 'background_task_waking',
        taskId: task.state.id,
        ...(event.instruction !== undefined ? { instruction: event.instruction } : {}),
      });
      return;
    }
    this.emit({ ...event, taskId: task.state.id });
    if (event.type === 'background_task_text_delta') {
      this.watchdogs.applyTextGuards(task, event.delta);
    }
  }

  private applyRunnerEventToState(
    task: ITrackedBackgroundTask,
    event: TBackgroundTaskRunnerEvent,
  ): void {
    const now = this.now();
    this.watchdogs.recordActivity(task, now);
    const updated = applyBackgroundTaskRunnerStateEvent(task, event, now);
    if (updated) this.emit({ type: 'background_task_updated', task: updated });
  }

  private async failForTimeout(
    task: ITrackedBackgroundTask,
    reason: TBackgroundTaskTimeoutReason,
    message: string,
  ): Promise<void> {
    if (isTerminalBackgroundTaskStatus(task.state.status)) return;
    task.state.timeoutReason = reason;
    const handle = task.handle;
    this.failTask(task, new BackgroundTaskError('timeout', message));
    try {
      await handle?.cancel(message);
    } catch {
      // The timeout failure is authoritative; runner cancellation errors are secondary.
    }
  }

  private removeFromQueue(taskId: string): void {
    const index = this.queue.indexOf(taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private requireTask(taskId: string): ITrackedBackgroundTask {
    const task = this.tasks.get(taskId);
    if (!task) throw createRunnerError(`Unknown background task: ${taskId}`);
    return task;
  }

  /**
   * ARCH-053: observers are notified only after the authoritative transition is committed, so a
   * throwing observer is isolated, delivery continues to the rest, and the failure is reported.
   */
  private emit(event: TBackgroundTaskEvent): void {
    const observers = this.eventSink ? [this.eventSink, ...this.listeners] : [...this.listeners];
    deliverToObservers(event, observers, this.onObserverFailure);
  }
}

const builtInPrepareRestoredSchedules = BackgroundTaskManager.prototype.prepareRestoredSchedules;

/** Whether restore uses this package's manager and its original activation protocol. */
export function isBuiltInRestoreManager(
  manager: IBackgroundTaskManager,
  prepare: IBackgroundTaskManager['prepareRestoredSchedules'] = manager.prepareRestoredSchedules,
): manager is BackgroundTaskManager {
  return (
    manager instanceof BackgroundTaskManager &&
    builtInManagers.has(manager) &&
    Object.getPrototypeOf(manager) === BackgroundTaskManager.prototype &&
    prepare === builtInPrepareRestoredSchedules
  );
}

function isPreparedScheduledHandle(
  value: unknown,
): value is IPreparedBackgroundTaskHandle<'scheduled'> {
  if (
    typeof value !== 'object' ||
    value === null ||
    ('then' in value && typeof value.then === 'function') ||
    !('activate' in value) ||
    typeof value.activate !== 'function' ||
    !('abort' in value) ||
    typeof value.abort !== 'function' ||
    !('handle' in value) ||
    typeof value.handle !== 'object' ||
    value.handle === null
  )
    return false;
  const handle = value.handle;
  return (
    'taskId' in handle &&
    typeof handle.taskId === 'string' &&
    'cancel' in handle &&
    typeof handle.cancel === 'function' &&
    'result' in handle &&
    typeof handle.result === 'object' &&
    handle.result !== null &&
    'then' in handle.result &&
    typeof handle.result.then === 'function' &&
    'catch' in handle.result &&
    typeof handle.result.catch === 'function'
  );
}
