/**
 * ARCH-029: the conformant `IAgentJobHostContext` double.
 *
 * Split out of `command-host-double.ts` when that file passed the anti-monolith limit. The seam is
 * the same one the role ports draw: one file per contract axis.
 */

import { FAKE_ROOT, NEVER } from './double-constants.js';
import { mergeOverrides, type TOverrides } from './double-overrides.js';

import type { IAgentJobHostContext } from '../command-api/host-context.js';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  ISubagentJobState,
} from '@robota-sdk/agent-interface-transport';

/**
 * ARCH-029: the same double, for the capability `ICommandHostContext` reaches through
 * `getAgentJobCapability()`.
 *
 * `IAgentJobHostContext` declares 15 members and **none** of them optional — so it is the more honest
 * of the two contracts, and satisfying it without a cast means answering all fifteen. That is exactly
 * why fixtures cast it: there was nothing to reach for. Migrating a host cast into a job cast would
 * have been half the work, which is why this exists rather than a second double assertion.
 */
/**
 * The three states this contract returns, each meaning "nothing ran". Named rather than inlined so a
 * reader sees they are placeholders, and so the five members returning them cannot drift apart.
 */

const EMPTY_SUBAGENT_JOB: ISubagentJobState = {
  id: 'test-agent-job',
  type: 'general-purpose',
  label: 'test',
  parentSessionId: 'test-command-host',
  status: 'running',
  mode: 'background',
  depth: 1,
  cwd: FAKE_ROOT,
  promptPreview: '',
  updatedAt: NEVER,
};

const EMPTY_JOB_GROUP: IBackgroundJobGroupState = {
  id: 'test-group',
  parentSessionId: 'test-command-host',
  waitPolicy: 'wait_all',
  taskIds: [],
  status: 'running',
  createdAt: NEVER,
  updatedAt: NEVER,
  results: [],
};

const EMPTY_BACKGROUND_TASK: IBackgroundTaskState = {
  id: 'test-background-task',
  kind: 'agent',
  label: 'test',
  status: 'running',
  mode: 'background',
  parentSessionId: 'test-command-host',
  depth: 1,
  cwd: FAKE_ROOT,
  updatedAt: NEVER,
  unread: false,
};

export function createTestAgentJobHost(
  overrides?: TOverrides<IAgentJobHostContext>,
): IAgentJobHostContext {
  const base: IAgentJobHostContext = {
    listAgentDefinitions: () => [],
    listAgentJobs: () => [],
    spawnAgentJob: () => Promise.resolve(EMPTY_SUBAGENT_JOB),
    sendAgentJob: () => Promise.resolve(),
    cancelAgentJob: () => Promise.resolve(),
    closeAgentJob: () => Promise.resolve(),
    createBackgroundJobGroup: () => EMPTY_JOB_GROUP,
    waitBackgroundJobGroup: () => Promise.resolve(EMPTY_JOB_GROUP),
    spawnScheduledWake: () => Promise.resolve(EMPTY_BACKGROUND_TASK),
    listSchedules: () => [],
    pauseSchedule: () => Promise.resolve(),
    resumeSchedule: () => Promise.resolve(),
    editSchedule: () => Promise.resolve(),
    spawnMonitorWake: () => Promise.resolve(EMPTY_BACKGROUND_TASK),
    readBackgroundTaskLog: (taskId: string) => Promise.resolve({ taskId, lines: [] }),
  };
  return mergeOverrides(base, overrides);
}
