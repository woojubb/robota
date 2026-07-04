/**
 * Background job-group state contracts.
 *
 * SSOT for the job-group data shapes surfaced by the interactive session and the
 * execution workspace. The orchestrator runtime lives in agent-framework and imports
 * these declarations.
 */

import type { IBackgroundTaskError, TBackgroundTaskStatus } from './background-task-contracts';

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

export interface IBackgroundJobGroupSummary {
  groupId: string;
  status: TBackgroundJobGroupStatus;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
  lines: string[];
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
