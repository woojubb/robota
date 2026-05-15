/**
 * SessionBackgroundTaskTracker — manages background task and job group state
 * for an InteractiveSession. Handles subscriptions, events, and persistence
 * integration without owning the session or store directly.
 */

import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskManager,
  IBackgroundTaskState,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
  TExecutionWorkspaceUpdateCause,
} from '../background-tasks/index.js';
import {
  BackgroundJobOrchestrator,
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createLineDetailPage,
  summarizeBackgroundJobGroup,
} from '../background-tasks/index.js';
import type { Session } from '@robota-sdk/agent-sessions';
import { retrieveSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';

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
    });
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
    this.persistSession();
    this.onChanged('background_task', getTaskEventEntryId(event));
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
