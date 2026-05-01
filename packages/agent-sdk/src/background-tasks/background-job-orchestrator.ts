import {
  isTerminalBackgroundTaskStatus,
  type IBackgroundTaskError,
  type IBackgroundTaskManager,
  type IBackgroundTaskState,
  type TBackgroundTaskEvent,
  type TBackgroundTaskStatus,
} from '@robota-sdk/agent-runtime';

const DEFAULT_SUMMARY_LENGTH = 1_000;

export type TBackgroundJobWaitPolicy = 'detached' | 'wait_all' | 'wait_any' | 'manual';

export type TBackgroundJobGroupStatus = 'running' | 'completed';

export interface IBackgroundJobResultEnvelope {
  taskId: string;
  label: string;
  status: TBackgroundTaskStatus;
  summary?: string;
  outputRef?: string;
  error?: IBackgroundTaskError;
  startedAt?: string;
  completedAt?: string;
}

export interface IBackgroundJobGroupState {
  id: string;
  parentSessionId: string;
  waitPolicy: TBackgroundJobWaitPolicy;
  taskIds: string[];
  status: TBackgroundJobGroupStatus;
  createdAt: string;
  updatedAt: string;
  label?: string;
  completedAt?: string;
  results: IBackgroundJobResultEnvelope[];
}

export interface IBackgroundJobGroupCreateRequest {
  parentSessionId: string;
  waitPolicy: TBackgroundJobWaitPolicy;
  taskIds: string[];
  label?: string;
}

export type TBackgroundJobGroupEvent =
  | { type: 'background_job_group_created'; group: IBackgroundJobGroupState }
  | { type: 'background_job_group_updated'; group: IBackgroundJobGroupState }
  | { type: 'background_job_group_completed'; group: IBackgroundJobGroupState };

export type TBackgroundJobGroupEventListener = (event: TBackgroundJobGroupEvent) => void;

export type TBackgroundJobGroupIdFactory = (request: IBackgroundJobGroupCreateRequest) => string;

export interface IBackgroundJobOrchestratorOptions {
  manager: IBackgroundTaskManager;
  now?: () => string;
  idFactory?: TBackgroundJobGroupIdFactory;
  initialGroups?: readonly IBackgroundJobGroupState[];
}

interface IBackgroundJobGroupRecord {
  state: IBackgroundJobGroupState;
  completion: Promise<IBackgroundJobGroupState>;
  resolve: (state: IBackgroundJobGroupState) => void;
}

export class BackgroundJobOrchestrator {
  private readonly manager: IBackgroundTaskManager;
  private readonly now: () => string;
  private readonly idFactory: TBackgroundJobGroupIdFactory;
  private readonly unsubscribeManager: () => void;
  private readonly listeners = new Set<TBackgroundJobGroupEventListener>();
  private readonly groups = new Map<string, IBackgroundJobGroupRecord>();
  private sequence = 0;

  constructor(options: IBackgroundJobOrchestratorOptions) {
    this.manager = options.manager;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => this.nextGroupId());
    this.sequence = options.initialGroups?.length ?? 0;
    for (const group of options.initialGroups ?? []) this.restoreGroup(group);
    this.unsubscribeManager = this.manager.subscribe((event) => this.handleTaskEvent(event));
  }

  createGroup(request: IBackgroundJobGroupCreateRequest): IBackgroundJobGroupState {
    const now = this.now();
    const state: IBackgroundJobGroupState = {
      id: this.idFactory(request),
      parentSessionId: request.parentSessionId,
      waitPolicy: request.waitPolicy,
      taskIds: [...request.taskIds],
      status: 'running',
      createdAt: now,
      updatedAt: now,
      results: [],
      ...(request.label ? { label: request.label } : {}),
    };
    const record = this.createRecord(state);
    this.groups.set(state.id, record);
    this.captureExistingTerminalTasks(record);
    this.emit({ type: 'background_job_group_created', group: cloneGroup(record.state) });
    this.evaluateCompletion(record);
    return cloneGroup(record.state);
  }

  listGroups(): IBackgroundJobGroupState[] {
    return [...this.groups.values()].map((record) => cloneGroup(record.state));
  }

  getGroup(groupId: string): IBackgroundJobGroupState | undefined {
    const record = this.groups.get(groupId);
    return record ? cloneGroup(record.state) : undefined;
  }

  waitGroup(groupId: string): Promise<IBackgroundJobGroupState> {
    const record = this.groups.get(groupId);
    if (!record) return Promise.reject(new Error(`Unknown background job group: ${groupId}`));
    return record.completion;
  }

  subscribe(listener: TBackgroundJobGroupEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.unsubscribeManager();
    this.listeners.clear();
  }

  private nextGroupId(): string {
    this.sequence += 1;
    return `group_${this.sequence}`;
  }

  private restoreGroup(group: IBackgroundJobGroupState): void {
    const record = this.createRecord(cloneGroup(group));
    this.groups.set(group.id, record);
    if (group.status === 'completed') record.resolve(cloneGroup(group));
  }

  private createRecord(state: IBackgroundJobGroupState): IBackgroundJobGroupRecord {
    let resolveGroup: (state: IBackgroundJobGroupState) => void = () => {};
    const completion = new Promise<IBackgroundJobGroupState>((resolve) => {
      resolveGroup = resolve;
    });
    return { state, completion, resolve: resolveGroup };
  }

  private captureExistingTerminalTasks(record: IBackgroundJobGroupRecord): void {
    for (const taskId of record.state.taskIds) {
      const task = this.manager.get(taskId);
      if (task && isTerminalBackgroundTaskStatus(task.status)) this.captureTask(record, task);
    }
  }

  private handleTaskEvent(event: TBackgroundTaskEvent): void {
    const task = getTerminalTask(event);
    if (!task) return;
    for (const record of this.groups.values()) {
      if (!record.state.taskIds.includes(task.id)) continue;
      if (!this.captureTask(record, task)) continue;
      if (record.state.status === 'running') this.evaluateCompletion(record);
      else this.emit({ type: 'background_job_group_updated', group: cloneGroup(record.state) });
    }
  }

  private captureTask(record: IBackgroundJobGroupRecord, task: IBackgroundTaskState): boolean {
    if (record.state.results.some((result) => result.taskId === task.id)) return false;
    record.state.results = [...record.state.results, createResultEnvelope(task)];
    record.state.updatedAt = this.now();
    return true;
  }

  private evaluateCompletion(record: IBackgroundJobGroupRecord): void {
    if (record.state.status === 'completed') return;
    if (!shouldComplete(record.state)) {
      this.emit({ type: 'background_job_group_updated', group: cloneGroup(record.state) });
      return;
    }
    const now = this.now();
    record.state.status = 'completed';
    record.state.completedAt = now;
    record.state.updatedAt = now;
    const completed = cloneGroup(record.state);
    record.resolve(completed);
    this.emit({ type: 'background_job_group_completed', group: completed });
  }

  private emit(event: TBackgroundJobGroupEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function getTerminalTask(event: TBackgroundTaskEvent): IBackgroundTaskState | undefined {
  if (
    event.type === 'background_task_completed' ||
    event.type === 'background_task_failed' ||
    event.type === 'background_task_cancelled'
  ) {
    return event.task;
  }
  return undefined;
}

function shouldComplete(group: IBackgroundJobGroupState): boolean {
  if (group.waitPolicy === 'manual') return false;
  if (group.waitPolicy === 'wait_any') return group.results.length > 0;
  return group.taskIds.every((taskId) => group.results.some((result) => result.taskId === taskId));
}

function createResultEnvelope(task: IBackgroundTaskState): IBackgroundJobResultEnvelope {
  return {
    taskId: task.id,
    label: task.label,
    status: task.status,
    ...(task.result?.output ? { summary: summarizeOutput(task.result.output) } : {}),
    ...(task.transcriptPath || task.logPath
      ? { outputRef: task.transcriptPath ?? task.logPath }
      : {}),
    ...(task.error ? { error: { ...task.error } } : {}),
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
  };
}

function summarizeOutput(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= DEFAULT_SUMMARY_LENGTH) return trimmed;
  return `${trimmed.slice(0, DEFAULT_SUMMARY_LENGTH)}...`;
}

function cloneGroup(group: IBackgroundJobGroupState): IBackgroundJobGroupState {
  return {
    ...group,
    taskIds: [...group.taskIds],
    results: group.results.map((result) => ({
      ...result,
      ...(result.error ? { error: { ...result.error } } : {}),
    })),
  };
}
