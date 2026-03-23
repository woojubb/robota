/**
 * AgentTool — spawn a sub-agent with isolated context.
 *
 * Uses `createSubagentSession` to assemble a child Session with filtered tools,
 * model resolution, and framework system prompt. The sub-agent shares the same
 * config and context but has its own conversation history.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema, TToolResult } from '@robota-sdk/agent-tools';
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

/** Dependencies injected at registration time */
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

let agentToolDeps: IAgentToolDeps | undefined;

/** Set dependencies for the agent tool. Must be called before tool is used. */
export function setAgentToolDeps(deps: IAgentToolDeps): void {
  agentToolDeps = deps;
}

/** Get the current agent tool dependencies. Returns undefined if not yet initialized. */
export function getAgentToolDeps(): IAgentToolDeps | undefined {
  return agentToolDeps;
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

async function runAgent(args: TAgentArgs): Promise<string> {
  if (!agentToolDeps) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: 'Agent tool not initialized — missing dependencies',
    };
    return JSON.stringify(result);
  }

  const agentType = args.subagent_type ?? 'general-purpose';

  // Resolve agent definition
  const agentDef = resolveAgentDefinition(agentType, agentToolDeps.customAgentRegistry);
  if (!agentDef) {
    return JSON.stringify({
      success: false,
      output: '',
      error: `Unknown agent type: ${agentType}`,
    });
  }

  // Override model if specified in tool args
  const effectiveDef: IAgentDefinition = args.model ? { ...agentDef, model: args.model } : agentDef;

  // Create subagent session
  const session = createSubagentSession({
    agentDefinition: effectiveDef,
    parentConfig: agentToolDeps.config,
    parentContext: agentToolDeps.context,
    parentTools: agentToolDeps.tools,
    terminal: agentToolDeps.terminal,
    permissionHandler: agentToolDeps.permissionHandler,
    onTextDelta: agentToolDeps.onTextDelta,
    onToolExecution: agentToolDeps.onToolExecution,
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

export const agentTool = createZodFunctionTool(
  'Agent',
  'Launch a subagent to handle a task in an isolated context. The subagent gets its own context window and returns a result when done. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.',
  asZodSchema(AgentSchema),
  async (params) => {
    return runAgent(params as TAgentArgs);
  },
);
