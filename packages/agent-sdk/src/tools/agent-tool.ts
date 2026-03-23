/**
 * AgentTool — spawn a sub-agent with isolated context.
 *
 * Uses `createSubagentSession` to assemble a child Session with filtered tools,
 * model resolution, and framework system prompt. The sub-agent shares the same
 * config and context but has its own conversation history.
 *
 * Each call to `createAgentTool(deps)` returns a fresh tool instance with deps
 * captured in closure, eliminating module-level mutable state and enabling
 * multiple concurrent sessions without race conditions.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { IToolWithEventService, TToolArgs } from '@robota-sdk/agent-core';
import type { ITerminalOutput, TPermissionHandler } from '@robota-sdk/agent-sessions';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';

/** Cast a Zod schema to the IZodSchema interface expected by createZodFunctionTool */
function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

const AgentSchema = z.object({
  prompt: z.string().describe('The task for the subagent to perform'),
  subagent_type: z
    .string()
    .optional()
    .describe('Agent type: "general-purpose", "Explore", "Plan", or a custom agent name'),
  model: z.string().optional().describe('Optional model override'),
});

type TAgentArgs = z.infer<typeof AgentSchema>;

/** Dependencies injected at creation time via createAgentTool factory */
export interface IAgentToolDeps {
  config: IResolvedConfig;
  context: ILoadedContext;
  tools: IToolWithEventService[];
  terminal: ITerminalOutput;
  permissionHandler?: TPermissionHandler;
  onTextDelta?: (delta: string) => void;
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
  }) => void;
  /** Optional custom agent registry for resolving non-built-in agent types. */
  customAgentRegistry?: (name: string) => IAgentDefinition | undefined;
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
 * Checks built-in agents first, then falls back to custom registry.
 */
function resolveAgentDefinition(
  agentType: string,
  customRegistry?: (name: string) => IAgentDefinition | undefined,
): IAgentDefinition | undefined {
  const builtIn = getBuiltInAgent(agentType);
  if (builtIn) return builtIn;
  if (customRegistry) return customRegistry(agentType);
  return undefined;
}

/** Generate a unique agent ID for tracking. */
function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create an agent tool instance with deps captured in closure.
 *
 * Each session gets its own tool instance — no shared mutable state.
 */
export function createAgentTool(deps: IAgentToolDeps): ReturnType<typeof createZodFunctionTool> {
  async function runAgent(args: TAgentArgs): Promise<string> {
    const agentType = args.subagent_type ?? 'general-purpose';

    // Resolve agent definition
    const agentDef = resolveAgentDefinition(agentType, deps.customAgentRegistry);
    if (!agentDef) {
      return JSON.stringify({
        success: false,
        output: '',
        error: `Unknown agent type: ${agentType}`,
      });
    }

    // Override model if specified in tool args
    const effectiveDef: IAgentDefinition = args.model
      ? { ...agentDef, model: args.model }
      : agentDef;

    // Create subagent session
    const session = createSubagentSession({
      agentDefinition: effectiveDef,
      parentConfig: deps.config,
      parentContext: deps.context,
      parentTools: deps.tools,
      terminal: deps.terminal,
      permissionHandler: deps.permissionHandler,
      onTextDelta: deps.onTextDelta,
      onToolExecution: deps.onToolExecution,
    });

    const agentId = generateAgentId();

    try {
      const response = await session.run(args.prompt);
      return JSON.stringify({
        success: true,
        output: response,
        agentId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        success: false,
        output: '',
        error: `Sub-agent error: ${message}`,
        agentId,
      });
    }
  }

  return createZodFunctionTool(
    'Agent',
    'Launch a subagent to handle a task in an isolated context. The subagent gets its own context window and returns a result when done. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.',
    asZodSchema(AgentSchema),
    async (params) => {
      return runAgent(params as TAgentArgs);
    },
  );
}
