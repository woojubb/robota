/**
 * SessionBackgroundTaskTracker — manages background task and job group state
 * for an InteractiveSession. Handles subscriptions, events, and persistence
 * integration without owning the session or store directly.
 */

import { createSourceUsageSummaryEntry } from './interactive-session-execution.js';
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
  IBackgroundTaskManager,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  TBackgroundJobGroupEvent,
  TExecutionWorkspaceUpdateCause,
} from '../background-tasks/index.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

export interface IBackgroundTrackerState {
  tasks: IBackgroundTaskState[];
  taskEvents: TBackgroundTaskEvent[];
  groups: IBackgroundJobGroupState[];
  groupEvents: TBackgroundJobGroupEvent[];
}

export class SessionBackgroundTaskTracker {
  private backgroundTasks: IBackgroundTaskState[] = [];
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
  ) {}

  subscribe(session: Session): void {
    if (this.backgroundTaskUnsubscribe) return;
    const manager =
      retrieveSessionBackgroundTaskManager(session) ??
      retrieveAgentToolDeps(session)?.backgroundTaskManager;
    if (!manager) return;
    this.backgroundTaskUnsubscribe = manager.subscribe((event) => {
      this.recordTaskEvent(event);
      this.emitTaskEvent(event);
      // FLOW-002: a wake carrying an instruction re-enters the agent loop with a non-user turn.
      if (event.type === 'background_task_waking' && event.instruction !== undefined) {
        this.onWake?.(event.instruction, event.taskId);
      }
    });
    this.reArmRestoredSchedules(manager);
  }

  /**
   * FLOW-003: re-spawn restored sleeping scheduled wakes so they fire again after a resume,
   * and surface a one-time note for any whose fire time elapsed while the CLI was closed.
   */
  private reArmRestoredSchedules(manager: IBackgroundTaskManager): void {
    const nowMs = Date.now();
    for (const task of this.backgroundTasks) {
      if (task.kind !== 'scheduled' || task.status !== 'sleeping' || !task.schedule) continue;
      if (task.nextFireAt !== undefined && new Date(task.nextFireAt).getTime() < nowMs) {
        this.appendSystemNote?.(
          `Missed scheduled wake "${task.label}" (was due ${task.nextFireAt} while the session was closed); re-arming.`,
        );
      }
      void manager.spawn({
        kind: 'scheduled',
        cronExpression: task.schedule.cronExpression,
        label: task.label,
        mode: task.mode,
        parentSessionId: task.parentSessionId,
        depth: task.depth,
        cwd: task.cwd,
        ...(task.schedule.agentInstruction !== undefined
          ? { agentInstruction: task.schedule.agentInstruction }
          : {}),
        ...(task.schedule.command !== undefined ? { command: task.schedule.command } : {}),
        ...(task.schedule.shell !== undefined ? { shell: task.schedule.shell } : {}),
        ...(task.schedule.env !== undefined ? { env: { ...task.schedule.env } } : {}),
      });
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

  restoreState(state: IBackgroundTrackerState): void {
    this.backgroundTasks = state.tasks;
    this.backgroundTaskEvents = state.taskEvents;
    this.backgroundJobGroups = state.groups;
    this.backgroundJobGroupEvents = state.groupEvents;
  }

  getState(): IBackgroundTrackerState {
    return {
      tasks: this.getTaskSnapshots(),
      taskEvents: this.backgroundTaskEvents,
      groups: this.getGroupSnapshots(),
      groupEvents: this.backgroundJobGroupEvents,
    };
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
    });
    this.subscribeGroupEvents(sessionId);
    return this.backgroundJobOrchestrator;
  }

  async cancelTask(taskId: string, reason?: string): Promise<void> {
    await this.getManagerOrThrow().cancel(taskId, reason);
  }

  async closeTask(taskId: string): Promise<void> {
    await this.getManagerOrThrow().close(taskId);
  }

  async sendTask(taskId: string, input: IBackgroundTaskInput): Promise<void> {
    await this.getManagerOrThrow().send(taskId, input);
  }

  async readTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage> {
    return this.getManagerOrThrow().readLog(taskId, cursor);
  }

  listTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[] {
    return this.getManagerOrThrow().list(filter);
  }

  getTask(taskId: string): IBackgroundTaskState | undefined {
    return this.getManagerOrThrow().get(taskId);
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
    const task = this.getManagerOrThrow().get(taskId);
    if (!task) throw new Error(`Unknown background task: ${taskId}`);
    if (task.logPath || task.transcriptPath) {
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
      task.promptPreview ??
      task.commandPreview ??
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
      return this.getManagerOrThrow().list();
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

function getTaskEventEntryId(event: TBackgroundTaskEvent): string | undefined {
  if ('task' in event) return createBackgroundTaskExecutionEntryId(event.task.id);
  if ('taskId' in event) return createBackgroundTaskExecutionEntryId(event.taskId);
  return undefined;
}
