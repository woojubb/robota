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
  'Creates one subagent job for delegated work in an isolated context.',
  'One tool call creates one subagent job.',
  'When the user explicitly asks to create, run, spawn, delegate to, or use agents/subagents, start the requested subagent job immediately.',
  'Do not ask a follow-up question unless execution is impossible or unsafe.',
  'For multiple or parallel agents, create one Agent tool call per requested role in the current turn.',
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
    'Agent — creates one isolated subagent job.',
    'One Agent tool call corresponds to one subagent job.',
    'When the user explicitly asks to create, run, spawn, delegate to, or use agents/subagents, start the requested subagent job immediately.',
    'Do not ask a follow-up question unless execution is impossible or unsafe.',
    'For multiple or parallel agents, create one Agent tool call per requested role in the current turn.',
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
    prompt: z.string().describe('The task for the subagent to perform'),
    subagent_type: z
      .string()
      .optional()
      .describe('Agent type: "general-purpose", "Explore", "Plan", or a custom agent name'),
    model: z.string().optional().describe('Optional model override'),
    isolation: z
      .enum(['none', 'worktree'])
      .optional()
      .describe('Optional runtime isolation mode. "worktree" runs in a Git worktree.'),
  })
  .passthrough();

type TAgentArgs = z.infer<typeof AgentSchema>;

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
  args: TAgentArgs,
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

async function runManagedAgent(
  args: TAgentArgs,
  deps: IAgentToolDeps,
  manager: ISubagentManager,
): Promise<string> {
  const agentType = args.subagent_type ?? 'general-purpose';
  const agentDef = resolveAgentDefinition(agentType, deps.customAgentRegistry);
  if (!agentDef) {
    return stringifyUnknownAgentType(agentType);
  }

  let agentId: string | undefined;
  try {
    const state = await manager.spawn(createSpawnRequest(args, agentType, agentDef, deps));
    agentId = state.id;
    const response = await manager.wait(state.id);
    return stringifyAgentSuccess(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return stringifyAgentError(message, agentId);
  }
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
