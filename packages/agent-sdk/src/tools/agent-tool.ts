/**
 * AgentTool — spawn a sub-agent with isolated context.
 *
 * Uses `SubagentManager` with an in-process runner to assemble a child Session
 * with filtered tools, model resolution, and framework system prompt. The
 * sub-agent shares the same config and context but has its own conversation
 * history.
 *
 * Each call to `createAgentTool(deps)` returns a fresh tool instance with deps
 * captured in closure, eliminating module-level mutable state and enabling
 * multiple concurrent sessions without race conditions.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { SubagentManager } from '@robota-sdk/agent-runtime';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';
import type {
  IInProcessSubagentRunnerDeps,
  ISubagentManager,
  ISubagentJobResult,
  ISubagentSpawnRequest,
} from '../subagents/index.js';
import type { IBackgroundTaskManager } from '../background-tasks/index.js';

export const AGENT_TOOL_DESCRIPTION = [
  'Creates delegated subagent jobs in isolated contexts.',
  'Without jobs, one tool call creates one subagent job from prompt.',
  'For explicit multi-agent or parallel-agent requests, use one Agent tool call with jobs containing one entry per requested role.',
  'When the user explicitly asks to create, run, spawn, delegate to, or use agents/subagents, start the requested subagent job immediately.',
  'Do not ask a follow-up question unless execution is impossible or unsafe.',
  'Subagent jobs run as background tasks by default.',
  'The tool waits for a terminal result and returns completed, failed, or timed-out outcome data to the parent conversation.',
  'Execution is represented by a real tool call and runtime background task event.',
].join(' ');

export function createAgentToolPromptDescription(
  agentDefinitions: readonly Pick<IAgentDefinition, 'name' | 'description'>[] = [],
): string {
  const availableAgents =
    agentDefinitions.length > 0
      ? ` Available agent types: ${agentDefinitions
          .map((agent) => `${agent.name} (${agent.description})`)
          .join(', ')}.`
      : '';
  return [
    'Agent — creates isolated subagent jobs.',
    'Without jobs, one Agent tool call corresponds to one subagent job.',
    'For explicit multi-agent or parallel-agent requests, use one Agent tool call with jobs containing one entry per requested role.',
    'When the user explicitly asks to create, run, spawn, delegate to, or use agents/subagents, start the requested subagent job immediately.',
    'Do not ask a follow-up question unless execution is impossible or unsafe.',
    'The tool returns terminal result data.',
    'Runtime mode is background.',
    availableAgents,
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cast a Zod schema to the IZodSchema interface expected by createZodFunctionTool */
function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

const AgentSchema = z
  .object({
    prompt: z
      .string()
      .optional()
      .describe('The task for a single subagent to perform. Required when jobs is omitted.'),
    subagent_type: z
      .string()
      .optional()
      .describe('Agent type: "general-purpose", "Explore", "Plan", or a custom agent name'),
    model: z.string().optional().describe('Optional model override'),
    isolation: z
      .enum(['none', 'worktree'])
      .optional()
      .describe('Optional runtime isolation mode. "worktree" runs in a Git worktree.'),
    jobs: z
      .array(
        z
          .object({
            prompt: z.string().describe('The task for this subagent to perform'),
            subagent_type: z.string().optional().describe('Agent type for this job'),
            model: z.string().optional().describe('Optional model override for this job'),
            isolation: z.enum(['none', 'worktree']).optional().describe('Isolation for this job'),
          })
          .passthrough(),
      )
      .optional()
      .describe('Batch of subagent jobs to start in one Agent tool call'),
  })
  .passthrough();

type TAgentArgs = z.infer<typeof AgentSchema>;
type TAgentJobArgs = NonNullable<TAgentArgs['jobs']>[number];
type TSingleAgentArgs = TAgentArgs & { prompt: string };

/** Dependencies injected at creation time via createAgentTool factory */
export interface IAgentToolDeps extends IInProcessSubagentRunnerDeps {
  cwd?: string;
  parentSessionId?: string;
  subagentDepth?: number;
  subagentManager?: ISubagentManager;
  backgroundTaskManager?: IBackgroundTaskManager;
  /** Optional custom agent registry for resolving non-built-in agent types. */
  customAgentRegistry?: (name: string) => IAgentDefinition | undefined;
  /** Model-visible and command-visible agent definitions available to this session. */
  agentDefinitions?: IAgentDefinition[];
}

/**
 * Per-session deps store — maps an opaque key (typically a Session instance) to
 * the IAgentToolDeps used when creating that session's agent tool.
 *
 * This replaces the former module-level singleton, enabling concurrent sessions
 * without overwriting each other's deps.
 */
const sessionDepsStore = new WeakMap<object, IAgentToolDeps>();

/** Store agent tool deps keyed by a session (or any object). */
export function storeAgentToolDeps(key: object, deps: IAgentToolDeps): void {
  sessionDepsStore.set(key, deps);
}

/** Retrieve agent tool deps for a given session key. */
export function retrieveAgentToolDeps(key: object): IAgentToolDeps | undefined {
  return sessionDepsStore.get(key);
}

/**
 * Resolve an agent type name to an IAgentDefinition.
 * Checks custom registry first so project/user definitions can override built-ins.
 */
function resolveAgentDefinition(
  agentType: string,
  customRegistry?: (name: string) => IAgentDefinition | undefined,
): IAgentDefinition | undefined {
  if (customRegistry) {
    const custom = customRegistry(agentType);
    if (custom) return custom;
  }
  const builtIn = getBuiltInAgent(agentType);
  if (builtIn) return builtIn;
  return undefined;
}

function createSubagentManager(deps: IAgentToolDeps): ISubagentManager {
  return (
    deps.subagentManager ??
    new SubagentManager({
      runner: createInProcessSubagentRunner(deps),
    })
  );
}

function createSpawnRequest(
  args: TSingleAgentArgs | TAgentJobArgs,
  agentType: string,
  agentDef: IAgentDefinition,
  deps: IAgentToolDeps,
): ISubagentSpawnRequest {
  return {
    type: agentType,
    label: agentDef.name,
    parentSessionId: deps.parentSessionId ?? 'unknown-session',
    mode: 'background',
    depth: deps.subagentDepth ?? 1,
    cwd: deps.cwd ?? process.cwd(),
    prompt: args.prompt,
    model: args.model,
    isolation: args.isolation,
  };
}

function stringifyUnknownAgentType(agentType: string): string {
  return JSON.stringify({
    success: false,
    output: '',
    error: `Unknown agent type: ${agentType}`,
  });
}

function stringifyAgentSuccess(result: ISubagentJobResult): string {
  const worktreePath = result.metadata?.['worktreePath'];
  const branchName = result.metadata?.['branchName'];
  return JSON.stringify({
    success: true,
    output: result.output,
    agentId: result.jobId,
    metadata: result.metadata,
    ...(typeof worktreePath === 'string' ? { worktreePath } : {}),
    ...(typeof branchName === 'string' ? { branchName } : {}),
  });
}

function stringifyAgentError(message: string, agentId?: string): string {
  return JSON.stringify({
    success: false,
    output: '',
    error: `Sub-agent error: ${message}`,
    agentId,
  });
}

function stringifyAgentBatchResult(input: {
  groupId: string;
  jobs: Array<{
    index: number;
    success: boolean;
    agentId?: string;
    subagent_type: string;
    output?: string;
    error?: string;
    metadata?: ISubagentJobResult['metadata'];
  }>;
}): string {
  const successfulJobs = input.jobs.filter((job) => job.success);
  const agentIds = input.jobs
    .map((job) => job.agentId)
    .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0);
  return JSON.stringify({
    success: input.jobs.every((job) => job.success),
    output: successfulJobs
      .map((job) => job.output ?? '')
      .filter(Boolean)
      .join('\n\n'),
    groupId: input.groupId,
    agentIds,
    jobs: input.jobs,
  });
}

async function runManagedAgent(
  args: TAgentArgs,
  deps: IAgentToolDeps,
  manager: ISubagentManager,
): Promise<string> {
  if (typeof args.prompt !== 'string' || args.prompt.length === 0) {
    return stringifyAgentError('prompt is required when jobs is omitted');
  }

  const singleArgs: TSingleAgentArgs = { ...args, prompt: args.prompt };
  const agentType = args.subagent_type ?? 'general-purpose';
  const agentDef = resolveAgentDefinition(agentType, deps.customAgentRegistry);
  if (!agentDef) {
    return stringifyUnknownAgentType(agentType);
  }

  let agentId: string | undefined;
  try {
    const state = await manager.spawn(createSpawnRequest(singleArgs, agentType, agentDef, deps));
    agentId = state.id;
    const response = await manager.wait(state.id);
    return stringifyAgentSuccess(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return stringifyAgentError(message, agentId);
  }
}

function createBatchGroupId(): string {
  return `agent_group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function runManagedAgentBatch(
  jobs: TAgentJobArgs[],
  deps: IAgentToolDeps,
  manager: ISubagentManager,
): Promise<string> {
  const groupId = createBatchGroupId();
  const resolvedJobs = jobs.map((job, index) => {
    const agentType = job.subagent_type ?? 'general-purpose';
    const agentDef = resolveAgentDefinition(agentType, deps.customAgentRegistry);
    return { index, job, agentType, agentDef };
  });

  const invalidJobs = resolvedJobs
    .filter((job) => job.agentDef === undefined)
    .map((job) => ({
      index: job.index,
      success: false,
      subagent_type: job.agentType,
      error: `Unknown agent type: ${job.agentType}`,
    }));

  const validJobs = resolvedJobs.filter(
    (job): job is typeof job & { agentDef: IAgentDefinition } => job.agentDef !== undefined,
  );

  const startedJobs = await Promise.all(
    validJobs.map(async (job) => {
      try {
        const state = await manager.spawn(
          createSpawnRequest(job.job, job.agentType, job.agentDef, deps),
        );
        return { ...job, agentId: state.id, spawnError: undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ...job, agentId: undefined, spawnError: message };
      }
    }),
  );

  const terminalJobs = await Promise.all(
    startedJobs.map(async (job) => {
      if (job.spawnError || !job.agentId) {
        return {
          index: job.index,
          success: false,
          subagent_type: job.agentType,
          error: `Sub-agent error: ${job.spawnError ?? 'missing agent id'}`,
        };
      }
      try {
        const result = await manager.wait(job.agentId);
        return {
          index: job.index,
          success: true,
          agentId: result.jobId,
          subagent_type: job.agentType,
          output: result.output,
          metadata: result.metadata,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          index: job.index,
          success: false,
          agentId: job.agentId,
          subagent_type: job.agentType,
          error: `Sub-agent error: ${message}`,
        };
      }
    }),
  );

  const batchJobs = [...invalidJobs, ...terminalJobs].sort(
    (left, right) => left.index - right.index,
  );
  return stringifyAgentBatchResult({ groupId, jobs: batchJobs });
}

/**
 * Create an agent tool instance with deps captured in closure.
 *
 * Each session gets its own tool instance — no shared mutable state.
 */
export function createAgentTool(deps: IAgentToolDeps): ReturnType<typeof createZodFunctionTool> {
  const manager = createSubagentManager(deps);

  return createZodFunctionTool(
    'Agent',
    AGENT_TOOL_DESCRIPTION,
    asZodSchema(AgentSchema),
    async (params) => {
      const args = params as TAgentArgs;
      if (Array.isArray(args.jobs) && args.jobs.length > 0) {
        return runManagedAgentBatch(args.jobs, deps, manager);
      }
      return runManagedAgent(
        {
          prompt: args.prompt,
          ...(args.subagent_type !== undefined ? { subagent_type: args.subagent_type } : {}),
          ...(args.model !== undefined ? { model: args.model } : {}),
          ...(args.isolation !== undefined ? { isolation: args.isolation } : {}),
        },
        deps,
        manager,
      );
    },
  );
}
