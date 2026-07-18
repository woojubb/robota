/**
 * Abstract base for InteractiveSession.
 *
 * Contains all delegating public methods that only require the four
 * adapter instances (bgTracker, histTracker, skillRouter, execCtrl)
 * plus the abstract accessors declared here.
 */

import {
  listAgentDefinitionsFromSession,
  listAgentJobsFromSession,
  spawnAgentJobFromSession,
  waitAgentJobFromSession,
  sendAgentJobFromSession,
  cancelAgentJobFromSession,
  closeAgentJobFromSession,
  type ISpawnAgentJobInput,
} from './interactive-session-agent-jobs.js';
import {
  buildExecutionWorkspaceSnapshot,
  buildWorkspaceTaskSpawner,
  readWorkspaceDetail,
} from './interactive-session-workspace.js';

import type { SessionBackgroundTaskTracker } from './interactive-session-background-tracker.js';
import type { SessionExecutionController } from './interactive-session-execution-controller.js';
import type { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import type { SessionSkillRouter } from './interactive-session-skill-router.js';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionOrigin,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionWorkspaceTaskSpawner,
} from '../background-tasks/index.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/edit-checkpoint-types.js';
import type {
  ICommandHostAdapters,
  ICommandResult,
  ICommandSkillListEntry,
  ICommandSkillActivationRequest,
  TCommandInvocationSource,
} from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { ISubagentJobResult } from '../subagents/index.js';
import type { IHistoryEntry, TUniversalMessage, IContextWindowState } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  ISubagentJobState,
} from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

export abstract class InteractiveSessionBase {
  protected abstract readonly bgTracker: SessionBackgroundTaskTracker;
  protected abstract readonly histTracker: SessionHistoryTracker;
  protected abstract readonly skillRouter: SessionSkillRouter;
  protected abstract readonly execCtrl: SessionExecutionController;
  protected abstract getSessionOrThrow(): Session;
  protected abstract ensureInitialized(): Promise<void>;
  protected abstract getCwd(): string;

  isExecuting(): boolean {
    return this.execCtrl.executing;
  }
  getPendingPrompt(): string | null {
    return this.execCtrl.pendingPrompt;
  }
  getStreamingText(): string {
    return this.execCtrl.streamingText;
  }
  getActiveTools(): SessionExecutionController['activeTools'] {
    return this.execCtrl.activeTools;
  }
  cancelQueue(): void {
    this.execCtrl.clearPendingQueue();
  }

  async executeCommand(
    name: string,
    args: string,
    source: TCommandInvocationSource = 'user',
  ): Promise<ICommandResult | null> {
    await this.ensureInitialized();
    if (this.execCtrl.executing)
      return {
        success: false,
        message: 'Another prompt or command is already running. Wait for it to finish.',
      };
    return this.skillRouter.executeCommand(name, args, source);
  }
  async executeModelCommand(name: string, args: string): Promise<ICommandResult | null> {
    await this.ensureInitialized();
    return this.skillRouter.executeModelCommand(name, args);
  }
  getCommandInvocationSource(): TCommandInvocationSource {
    return this.skillRouter.getCommandInvocationSource();
  }
  async executeSkillCommandByName(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null> {
    await this.ensureInitialized();
    return this.skillRouter.executeSkillCommandByName(name, args, request);
  }
  listCommands(): Array<{
    name: string;
    displayName?: string;
    description: string;
    example?: string;
  }> {
    return this.skillRouter.listCommands();
  }
  listSkills(): ICommandSkillListEntry[] {
    return this.skillRouter.listSkills();
  }
  listModelInvocableCommands(): Array<{ name: string; description: string }> {
    return this.skillRouter.listModelInvocableCommands();
  }
  getCommandHostAdapters(): ICommandHostAdapters {
    return this.skillRouter.getCommandHostAdapters();
  }
  getSkillActivationEvents(): ISkillActivationEvent[] {
    return this.histTracker.getSkillActivationEvents();
  }

  getContextState(): IContextWindowState {
    return this.getSessionOrThrow().getContextState();
  }
  async compactContext(instructions?: string): Promise<void> {
    await this.getSessionOrThrow().compact(instructions);
  }

  getFullHistory(): IHistoryEntry[] {
    return this.histTracker.getHistory();
  }
  getMessages(): TUniversalMessage[] {
    return this.histTracker
      .getHistory()
      .filter((e) => e.category === 'chat')
      .map((e) => e.data as TUniversalMessage);
  }
  listEditCheckpoints(): IEditCheckpointSummary[] {
    return this.histTracker.listEditCheckpoints();
  }
  inspectEditCheckpoint(checkpointId: string): IEditCheckpointInspection {
    return this.histTracker.inspectEditCheckpoint(checkpointId);
  }
  async restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    await this.ensureInitialized();
    return this.histTracker.restoreEditCheckpoint(checkpointId);
  }
  async rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    await this.ensureInitialized();
    return this.histTracker.rollbackEditCheckpoint(checkpointId);
  }
  // SELFHOST-007: branching time-travel.
  listCheckpointBranches(): string[] {
    return this.histTracker.listCheckpointBranches();
  }
  async forkCheckpointBranch(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    await this.ensureInitialized();
    return this.histTracker.forkCheckpointBranch(checkpointId);
  }
  switchCheckpointBranch(checkpointId: string): void {
    this.histTracker.switchCheckpointBranch(checkpointId);
  }

  getUsedMemoryReferences(): IMemoryReference[] {
    return this.histTracker.getUsedMemoryReferences();
  }
  recordMemoryEvent(event: IMemoryEvent): void {
    this.histTracker.recordMemoryEvent(event);
  }

  listContextReferences(): IContextReferenceItem[] {
    return this.histTracker.listContextReferences();
  }
  async addContextReference(path: string): Promise<IContextReferenceAddResult> {
    return this.histTracker.addContextReference(path);
  }
  removeContextReference(path: string): IContextReferenceRemoveResult {
    return this.histTracker.removeContextReference(path);
  }
  clearContextReferences(): IContextReferenceClearResult {
    return this.histTracker.clearContextReferences();
  }

  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[] {
    return this.bgTracker.listTasks(filter);
  }
  getBackgroundTask(taskId: string): IBackgroundTaskState | undefined {
    return this.bgTracker.getTask(taskId);
  }
  async cancelBackgroundTask(taskId: string, reason?: string): Promise<void> {
    await this.ensureInitialized();
    await this.bgTracker.cancelTask(taskId, reason);
  }
  async closeBackgroundTask(taskId: string): Promise<void> {
    await this.ensureInitialized();
    await this.bgTracker.closeTask(taskId);
  }
  async sendBackgroundTask(taskId: string, input: IBackgroundTaskInput): Promise<void> {
    await this.ensureInitialized();
    await this.bgTracker.sendTask(taskId, input);
  }
  async readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage> {
    await this.ensureInitialized();
    return this.bgTracker.readTaskLog(taskId, cursor);
  }
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState {
    return this.bgTracker.createGroup(input, this.getSessionOrThrow().getSessionId());
  }
  listBackgroundJobGroups(): IBackgroundJobGroupState[] {
    return this.bgTracker.listGroups(this.getSessionOrThrow().getSessionId());
  }
  getBackgroundJobGroup(groupId: string): IBackgroundJobGroupState | undefined {
    return this.bgTracker.getGroup(groupId, this.getSessionOrThrow().getSessionId());
  }
  async waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState> {
    await this.ensureInitialized();
    return this.bgTracker.waitGroup(groupId, this.getSessionOrThrow().getSessionId());
  }

  getExecutionWorkspaceSnapshot(
    options: IExecutionWorkspaceSnapshotOptions = {},
  ): IExecutionWorkspaceSnapshot {
    return buildExecutionWorkspaceSnapshot(
      {
        sessionId: this.getSessionOrThrow().getSessionId(),
        execCtrl: this.execCtrl,
        histTracker: this.histTracker,
        bgTracker: this.bgTracker,
      },
      options,
    );
  }
  listExecutionWorkspaceEntries(filter?: IExecutionWorkspaceFilter): IExecutionWorkspaceEntry[] {
    return [...this.getExecutionWorkspaceSnapshot({ filter }).entries];
  }
  getExecutionWorkspaceEntry(entryId: string): IExecutionWorkspaceEntry | undefined {
    return this.getExecutionWorkspaceSnapshot().entries.find((e) => e.id === entryId);
  }
  async readExecutionWorkspaceDetail(
    entryId: string,
    cursor?: IExecutionDetailCursor,
  ): Promise<IExecutionDetailPage> {
    await this.ensureInitialized();
    return readWorkspaceDetail(
      entryId,
      () => this.histTracker.getHistory(),
      this.bgTracker,
      this.getSessionOrThrow().getSessionId(),
      cursor,
    );
  }
  createExecutionWorkspaceTaskSpawner(origin: IExecutionOrigin): IExecutionWorkspaceTaskSpawner {
    return buildWorkspaceTaskSpawner(
      this.bgTracker,
      this.getSessionOrThrow().getSessionId(),
      this.getCwd(),
      origin,
    );
  }

  listAgentDefinitions(): Array<{ name: string; description: string }> {
    return listAgentDefinitionsFromSession(this.getSessionOrThrow());
  }
  listAgentJobs(): ISubagentJobState[] {
    return listAgentJobsFromSession(this.getSessionOrThrow());
  }
  async spawnAgentJob(input: ISpawnAgentJobInput): Promise<ISubagentJobState> {
    await this.ensureInitialized();
    return spawnAgentJobFromSession(
      this.getSessionOrThrow(),
      input,
      this.getCwd(),
      this.skillRouter.getCommandInvocationSource(),
    );
  }
  async waitAgentJob(jobId: string): Promise<ISubagentJobResult> {
    await this.ensureInitialized();
    return waitAgentJobFromSession(this.getSessionOrThrow(), jobId);
  }
  async sendAgentJob(jobId: string, prompt: string): Promise<void> {
    await this.ensureInitialized();
    await sendAgentJobFromSession(this.getSessionOrThrow(), jobId, prompt);
  }
  async cancelAgentJob(jobId: string, reason?: string): Promise<void> {
    await this.ensureInitialized();
    await cancelAgentJobFromSession(this.getSessionOrThrow(), jobId, reason);
  }
  async closeAgentJob(jobId: string): Promise<void> {
    await this.ensureInitialized();
    await closeAgentJobFromSession(this.getSessionOrThrow(), jobId);
  }

  async spawnScheduledWake(input: {
    label: string;
    cronExpression: string;
    agentInstruction: string;
  }): Promise<IBackgroundTaskState> {
    await this.ensureInitialized();
    return this.bgTracker.getManagerOrThrow().spawn({
      kind: 'scheduled',
      label: input.label,
      mode: 'background',
      parentSessionId: this.getSessionOrThrow().getSessionId(),
      depth: 0,
      cwd: this.getCwd(),
      cronExpression: input.cronExpression,
      agentInstruction: input.agentInstruction,
    });
  }

  async spawnMonitorWake(input: {
    label: string;
    command: string;
    matchPattern: string;
    agentInstruction: string;
  }): Promise<IBackgroundTaskState> {
    await this.ensureInitialized();
    return this.bgTracker.getManagerOrThrow().spawn({
      kind: 'process',
      label: input.label,
      mode: 'background',
      parentSessionId: this.getSessionOrThrow().getSessionId(),
      depth: 0,
      cwd: this.getCwd(),
      command: input.command,
      matchPattern: input.matchPattern,
      agentInstruction: input.agentInstruction,
    });
  }
}
