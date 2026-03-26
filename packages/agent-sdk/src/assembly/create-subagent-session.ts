/**
 * Subagent session factory — assembles an isolated child Session for subagent execution.
 *
 * Unlike `createSession`, this factory does not load config files or context from disk.
 * It receives pre-resolved config and context from the parent session, applies tool
 * filtering and model resolution from the agent definition, and creates a lightweight
 * Session suitable for subagent use.
 */

import type { IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import { Session } from '@robota-sdk/agent-sessions';
import type { ITerminalOutput, TPermissionHandler } from '@robota-sdk/agent-sessions';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import { assembleSubagentPrompt } from './subagent-prompts.js';
import type { IAIProvider } from '@robota-sdk/agent-core';

/** Model shortcut names mapped to full Anthropic model IDs. */
const MODEL_SHORTCUTS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-6',
};

/** Options for creating a subagent session. */
export interface ISubagentOptions {
  /** Agent definition (built-in or custom). */
  agentDefinition: IAgentDefinition;
  /** Parent's resolved config (for provider, permissions, etc.). */
  parentConfig: IResolvedConfig;
  /** Parent's loaded context (CLAUDE.md, AGENTS.md). */
  parentContext: ILoadedContext;
  /** Parent session's available tools (to inherit/filter). */
  parentTools: IToolWithEventService[];
  /** AI provider instance. */
  provider: IAIProvider;
  /** Terminal output interface. */
  terminal: ITerminalOutput;
  /** Whether this is a fork worker (uses fork suffix instead of standard). */
  isForkWorker?: boolean;
  /** Permission mode from parent (bypassPermissions, acceptEdits, etc.). */
  permissionMode?: TPermissionMode;
  /** Permission handler from parent. */
  permissionHandler?: TPermissionHandler;
  /** Plugin hooks configuration from parent session. */
  hooks?: Record<string, unknown>;
  /** Hook type executors from parent session (prompt, agent, etc.). */
  hookTypeExecutors?: IHookTypeExecutor[];
  /** Streaming callback. */
  onTextDelta?: (delta: string) => void;
  /** Tool execution callback. */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
  }) => void;
}

/**
 * Resolve a model shortcut name to a full model ID.
 * Returns the shortcut mapping if found, otherwise returns the input as-is.
 */
function resolveModelId(shortName: string, _parentModel: string): string {
  return MODEL_SHORTCUTS[shortName] ?? shortName;
}

/**
 * Filter parent tools according to the agent definition's tool constraints.
 *
 * Filtering order:
 * 1. Remove disallowed tools (denylist)
 * 2. Keep only allowed tools (allowlist), if specified
 * 3. Always remove the 'Agent' tool (subagents cannot spawn subagents)
 */
function filterTools(
  parentTools: IToolWithEventService[],
  agentDefinition: IAgentDefinition,
): IToolWithEventService[] {
  let tools = [...parentTools];

  // Step 1: Remove disallowed tools
  if (agentDefinition.disallowedTools) {
    const denySet = new Set(agentDefinition.disallowedTools);
    tools = tools.filter((t) => !denySet.has(t.getName()));
  }

  // Step 2: Keep only allowed tools (if allowlist specified)
  if (agentDefinition.tools) {
    const allowSet = new Set(agentDefinition.tools);
    tools = tools.filter((t) => allowSet.has(t.getName()));
  }

  // Step 3: Always remove Agent tool
  tools = tools.filter((t) => t.getName() !== 'Agent');

  return tools;
}

/**
 * Create a fully-configured Session for subagent execution.
 *
 * Assembles provider, tools, and system prompt from parent context and
 * agent definition, then returns a new Session instance.
 */
export function createSubagentSession(options: ISubagentOptions): Session {
  const { agentDefinition, parentConfig, parentContext, parentTools, terminal } = options;

  // Filter tools based on agent definition constraints
  const tools = filterTools(parentTools, agentDefinition);

  // Resolve model: agent override or parent model
  const model = agentDefinition.model
    ? resolveModelId(agentDefinition.model, parentConfig.provider.model)
    : parentConfig.provider.model;

  // Assemble system prompt with framework suffix
  const systemMessage = assembleSubagentPrompt({
    agentBody: agentDefinition.systemPrompt,
    claudeMd: parentContext.claudeMd,
    agentsMd: parentContext.agentsMd,
    isForkWorker: options.isForkWorker ?? false,
  });

  const provider = options.provider;

  return new Session({
    tools,
    provider,
    systemMessage,
    terminal,
    model,
    maxTurns: agentDefinition.maxTurns,
    permissions: parentConfig.permissions,
    permissionMode: options.permissionMode,
    defaultTrustLevel: parentConfig.defaultTrustLevel,
    permissionHandler: options.permissionHandler,
    hooks: options.hooks,
    hookTypeExecutors: options.hookTypeExecutors,
    onTextDelta: options.onTextDelta,
    onToolExecution: options.onToolExecution,
  });
}
