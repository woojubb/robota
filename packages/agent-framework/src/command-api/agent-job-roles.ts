/**
 * ARCH-029: the `IAgentJobHostContext` role ports.
 *
 * See `session-roles.ts` for why this is a separate file.
 */

import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
} from '../background-tasks/index.js';
import type { IScheduleEditPatch } from '@robota-sdk/agent-executor';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  ISubagentJobState,
  TBackgroundTaskIsolation,
} from '@robota-sdk/agent-interface-execution';

/** Starting, steering and ending subagent jobs. */
export interface IAgentJobDispatch {
  listAgentDefinitions(): Array<{ name: string; description: string }>;
  listAgentJobs(): ISubagentJobState[];
  spawnAgentJob(input: {
    agentType: string;
    label: string;
    mode: 'foreground' | 'background';
    prompt: string;
    model?: string;
    isolation?: TBackgroundTaskIsolation;
  }): Promise<ISubagentJobState>;
  sendAgentJob(taskId: string, prompt: string): Promise<void>;
  cancelAgentJob(taskId: string, reason?: string): Promise<void>;
  closeAgentJob(taskId: string): Promise<void>;
}

/** Fanning jobs out as a group and waiting on it. */
export interface IAgentJobGroups {
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;
}

/** Cron-driven wakes and their lifecycle. */
export interface IAgentJobSchedules {
  /**
   * FLOW-005: schedule a recurring/one-shot agent wake. On each cron fire the agent loop
   * re-enters with `agentInstruction` (FLOW-001/002). `cronExpression` may be a standard cron
   * string or an ISO timestamp (one-shot).
   */
  spawnScheduledWake(input: {
    label: string;
    cronExpression: string;
    agentInstruction: string;
  }): Promise<IBackgroundTaskState>;
  /** SELFHOST-012: list the caller's scheduled tasks (each carries cadence, `nextFireAt`, and status). */
  listSchedules(): IBackgroundTaskState[];
  /** SELFHOST-012: non-destructively pause a scheduled task — it stops firing until `resumeSchedule`. */
  pauseSchedule(taskId: string): Promise<void>;
  /** SELFHOST-012: resume a paused scheduled task, re-armed with the same identity. */
  resumeSchedule(taskId: string): Promise<void>;
  /** SELFHOST-012: edit a scheduled task's cron / instruction in place (same task id). */
  editSchedule(taskId: string, patch: IScheduleEditPatch): Promise<void>;
}

/** Output-driven wakes. */
export interface IAgentJobMonitors {
  /**
   * FLOW-005: monitor a process's output and wake the agent with `agentInstruction` when a
   * line matches `matchPattern` (FLOW-004).
   */
  spawnMonitorWake(input: {
    label: string;
    command: string;
    matchPattern: string;
    agentInstruction: string;
  }): Promise<IBackgroundTaskState>;
}

/** Reading a job's output. */
export interface IAgentJobLogs {
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
}

/** Aggregate: all 15 members remain source-compatible. Declare a role port instead of this. */
export interface IAgentJobHostContext
  extends
    IAgentJobDispatch,
    IAgentJobGroups,
    IAgentJobSchedules,
    IAgentJobMonitors,
    IAgentJobLogs {}
