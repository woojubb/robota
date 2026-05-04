import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type {
  ISubagentJobResult,
  ISubagentManager,
  ISubagentSpawnRequest,
} from '../subagents/index.js';
import type { IAgentToolDeps } from './agent-tool.js';

export interface IAgentToolBatchJobArgs {
  label?: string;
  prompt: string;
  subagent_type?: string;
  model?: string;
  isolation?: 'none' | 'worktree';
}

interface IAgentBatchJobResult {
  index: number;
  success: boolean;
  groupId: string;
  label: string;
  agentId?: string;
  subagent_type: string;
  prompt: string;
  output?: string;
  error?: string;
  metadata?: ISubagentJobResult['metadata'];
}

interface IResolvedBatchJob {
  index: number;
  job: IAgentToolBatchJobArgs;
  agentType: string;
  agentDef?: IAgentDefinition;
  label: string;
}

type TValidResolvedBatchJob = IResolvedBatchJob & { agentDef: IAgentDefinition };
type TStartedBatchJob = TValidResolvedBatchJob &
  ({ agentId: string; spawnError?: undefined } | { agentId?: undefined; spawnError: string });

interface IRunManagedAgentBatchInput {
  jobs: IAgentToolBatchJobArgs[];
  deps: IAgentToolDeps;
  manager: ISubagentManager;
  resolveAgentDefinition: (
    agentType: string,
    customRegistry?: (name: string) => IAgentDefinition | undefined,
  ) => IAgentDefinition | undefined;
  createSpawnRequest: (
    args: IAgentToolBatchJobArgs,
    agentType: string,
    agentDef: IAgentDefinition,
    deps: IAgentToolDeps,
    label?: string,
  ) => ISubagentSpawnRequest;
}

function stringifyAgentBatchResult(input: {
  groupId: string;
  requestedJobCount: number;
  jobs: IAgentBatchJobResult[];
}): string {
  const successfulJobs = input.jobs.filter((job) => job.success);
  const agentIds = input.jobs
    .map((job) => job.agentId)
    .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0);
  const failedJobCount = input.jobs.filter((job) => !job.success).length;
  return JSON.stringify({
    success: input.jobs.every((job) => job.success),
    mode: 'batch',
    output: successfulJobs
      .map((job) => job.output ?? '')
      .filter(Boolean)
      .join('\n\n'),
    groupId: input.groupId,
    requestedJobCount: input.requestedJobCount,
    startedJobCount: agentIds.length,
    failedJobCount,
    agentIds,
    jobs: input.jobs,
    provenance: {
      source: 'agent-tool-batch',
      groupId: input.groupId,
      requestedJobCount: input.requestedJobCount,
      startedJobCount: agentIds.length,
      failedJobCount,
    },
  });
}

function createBatchGroupId(): string {
  const idRadix = 36;
  const randomStartIndex = 2;
  const randomEndIndex = 10;
  return `agent_group_${Date.now()}_${Math.random()
    .toString(idRadix)
    .slice(randomStartIndex, randomEndIndex)}`;
}

function normalizeJobLabel(label: string | undefined, fallback: string): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function resolveBatchJob(
  job: IAgentToolBatchJobArgs,
  index: number,
  input: IRunManagedAgentBatchInput,
): IResolvedBatchJob {
  const agentType = job.subagent_type ?? 'general-purpose';
  const agentDef = input.resolveAgentDefinition(agentType, input.deps.customAgentRegistry);
  const label = normalizeJobLabel(job.label, agentDef?.name ?? agentType);
  return { index, job, agentType, agentDef, label };
}

function isValidBatchJob(job: IResolvedBatchJob): job is TValidResolvedBatchJob {
  return job.agentDef !== undefined;
}

function createUnknownAgentBatchResult(
  job: IResolvedBatchJob,
  groupId: string,
): IAgentBatchJobResult {
  return {
    index: job.index,
    success: false,
    groupId,
    label: job.label,
    subagent_type: job.agentType,
    prompt: job.job.prompt,
    error: `Unknown agent type: ${job.agentType}`,
  };
}

async function spawnBatchJob(
  job: TValidResolvedBatchJob,
  input: IRunManagedAgentBatchInput,
): Promise<TStartedBatchJob> {
  try {
    const state = await input.manager.spawn(
      input.createSpawnRequest(job.job, job.agentType, job.agentDef, input.deps, job.label),
    );
    return { ...job, agentId: state.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...job, spawnError: message };
  }
}

function createBatchSpawnErrorResult(job: TStartedBatchJob, groupId: string): IAgentBatchJobResult {
  return {
    index: job.index,
    success: false,
    groupId,
    label: job.label,
    subagent_type: job.agentType,
    prompt: job.job.prompt,
    error: `Sub-agent error: ${job.spawnError ?? 'missing agent id'}`,
  };
}

function createBatchSuccessResult(
  job: TStartedBatchJob & { agentId: string },
  groupId: string,
  result: ISubagentJobResult,
): IAgentBatchJobResult {
  return {
    index: job.index,
    success: true,
    groupId,
    label: job.label,
    agentId: result.jobId,
    subagent_type: job.agentType,
    prompt: job.job.prompt,
    output: result.output,
    metadata: result.metadata,
  };
}

function createBatchWaitErrorResult(
  job: TStartedBatchJob & { agentId: string },
  groupId: string,
  message: string,
): IAgentBatchJobResult {
  return {
    index: job.index,
    success: false,
    groupId,
    label: job.label,
    agentId: job.agentId,
    subagent_type: job.agentType,
    prompt: job.job.prompt,
    error: `Sub-agent error: ${message}`,
  };
}

async function waitBatchJob(
  job: TStartedBatchJob,
  groupId: string,
  manager: ISubagentManager,
): Promise<IAgentBatchJobResult> {
  if (job.agentId === undefined) {
    return createBatchSpawnErrorResult(job, groupId);
  }

  try {
    const result = await manager.wait(job.agentId);
    return createBatchSuccessResult({ ...job, agentId: job.agentId }, groupId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createBatchWaitErrorResult({ ...job, agentId: job.agentId }, groupId, message);
  }
}

export async function runManagedAgentBatch(input: IRunManagedAgentBatchInput): Promise<string> {
  const groupId = createBatchGroupId();
  const resolvedJobs = input.jobs.map((job, index) => resolveBatchJob(job, index, input));
  const invalidJobs = resolvedJobs
    .filter((job) => !isValidBatchJob(job))
    .map((job) => createUnknownAgentBatchResult(job, groupId));
  const startedJobs = await Promise.all(
    resolvedJobs.filter(isValidBatchJob).map((job) => spawnBatchJob(job, input)),
  );
  const terminalJobs = await Promise.all(
    startedJobs.map((job) => waitBatchJob(job, groupId, input.manager)),
  );
  const batchJobs = [...invalidJobs, ...terminalJobs].sort(
    (left, right) => left.index - right.index,
  );

  return stringifyAgentBatchResult({
    groupId,
    requestedJobCount: input.jobs.length,
    jobs: batchJobs,
  });
}
